import { execFile } from 'child_process';
import path from 'path';
import { promisify } from 'util';
import { env } from '../env.js';

const execFilePromise = promisify(execFile);
const FORBIDDEN_SHELL_PATTERN = /(\&\&|\|\||[;|><`]|[$][(]|\r|\n)/;
const INLINE_ENV_ASSIGNMENT_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*=/;

type BashToolConfig = {
  workdir?: string;
  writable_paths?: unknown;
  writablePaths?: unknown;
};

function normalizeWorkspaceRoot() {
  return path.resolve(env.WORKSPACE_ROOT);
}

function normalizeWritablePaths(config: BashToolConfig, workspaceRoot: string) {
  const raw = config.writable_paths ?? config.writablePaths;
  if (!Array.isArray(raw)) {
    return [];
  }

  return raw
    .filter((value): value is string => typeof value === 'string')
    .map((value) => value.trim())
    .filter(Boolean)
    .map((relativePath) =>
      resolveWorkspaceSubpath(relativePath, workspaceRoot)
    );
}

function resolveWorkspaceSubpath(inputPath: string, workspaceRoot: string) {
  const resolvedPath = path.resolve(workspaceRoot, inputPath);
  const relativePath = path.relative(workspaceRoot, resolvedPath);

  if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    throw new Error('Sandbox path must stay inside the workspace');
  }

  return {
    hostPath: resolvedPath,
    relativePath: relativePath || '.',
  };
}

function normalizeSandboxWorkdir(
  config: BashToolConfig,
  workspaceRoot: string
) {
  const requested =
    typeof config.workdir === 'string' && config.workdir.trim().length > 0
      ? config.workdir.trim()
      : '.';
  const resolved = resolveWorkspaceSubpath(requested, workspaceRoot);
  const containerWorkdir =
    resolved.relativePath === '.'
      ? env.BASH_SANDBOX_WORKDIR
      : path.posix.join(
          env.BASH_SANDBOX_WORKDIR,
          resolved.relativePath.split(path.sep).join(path.posix.sep)
        );

  return {
    hostPath: resolved.hostPath,
    containerWorkdir,
  };
}

export function validateSandboxedCommand(command: string) {
  const normalizedCommand = command.trim();
  if (!normalizedCommand) {
    throw new Error('Sandbox command cannot be empty');
  }

  if (FORBIDDEN_SHELL_PATTERN.test(command)) {
    throw new Error('Unsafe shell control operators are not allowed');
  }

  const commandParts = normalizedCommand.split(/\s+/);
  const binary = commandParts[0];

  if (!binary) {
    throw new Error('Sandbox command cannot be empty');
  }

  if (INLINE_ENV_ASSIGNMENT_PATTERN.test(binary)) {
    throw new Error(
      'Inline environment overrides are not allowed in sandboxed commands'
    );
  }

  if (
    binary.startsWith('./') ||
    binary.startsWith('../') ||
    binary.startsWith('/')
  ) {
    throw new Error(
      'Direct script execution paths are not allowed in sandboxed commands'
    );
  }

  if (!env.BASH_SANDBOX_ALLOWED_BINARIES.includes(binary)) {
    throw new Error(`Command "${binary}" is not in the sandbox allowlist`);
  }

  return normalizedCommand;
}

export function buildDockerSandboxArgs(
  command: string,
  config: BashToolConfig = {}
) {
  const workspaceRoot = normalizeWorkspaceRoot();
  const writablePaths = normalizeWritablePaths(config, workspaceRoot);
  const workdir = normalizeSandboxWorkdir(config, workspaceRoot);
  const args = [
    'run',
    '--rm',
    '--interactive=false',
    '--network',
    'none',
    '--read-only',
    '--cap-drop',
    'ALL',
    '--security-opt',
    'no-new-privileges',
    '--pids-limit',
    String(env.BASH_SANDBOX_PIDS_LIMIT),
    '--memory',
    `${env.BASH_SANDBOX_MEMORY_MB}m`,
    '--cpus',
    String(env.BASH_SANDBOX_CPU_LIMIT),
    '--tmpfs',
    '/tmp:rw,noexec,nosuid,size=64m',
    '--user',
    env.BASH_SANDBOX_USER,
    '--workdir',
    workdir.containerWorkdir,
    '--entrypoint',
    'sh',
    '--mount',
    `type=bind,src=${workspaceRoot},dst=${env.BASH_SANDBOX_WORKDIR},readonly`,
  ];

  for (const writablePath of writablePaths) {
    const containerPath =
      writablePath.relativePath === '.'
        ? env.BASH_SANDBOX_WORKDIR
        : path.posix.join(
            env.BASH_SANDBOX_WORKDIR,
            writablePath.relativePath.split(path.sep).join(path.posix.sep)
          );
    args.push(
      '--mount',
      `type=bind,src=${writablePath.hostPath},dst=${containerPath}`
    );
  }

  args.push(env.BASH_SANDBOX_IMAGE, '-lc', command);

  return args;
}

async function runDockerSandbox(command: string, config: BashToolConfig = {}) {
  const args = buildDockerSandboxArgs(command, config);
  const { stdout, stderr } = await execFilePromise(
    env.BASH_SANDBOX_DOCKER_BINARY,
    args,
    {
      timeout: env.BASH_SANDBOX_TIMEOUT_MS,
      maxBuffer: 1024 * 1024,
      windowsHide: true,
    }
  );

  return stdout || stderr;
}

async function runHostSandbox(command: string, config: BashToolConfig = {}) {
  const workspaceRoot = normalizeWorkspaceRoot();
  const workdir = normalizeSandboxWorkdir(config, workspaceRoot);

  const { stdout, stderr } = await execFilePromise('sh', ['-lc', command], {
    cwd: workdir.hostPath,
    timeout: env.BASH_SANDBOX_TIMEOUT_MS,
    maxBuffer: 1024 * 1024,
    windowsHide: true,
    env: {
      PATH: process.env.PATH ?? '',
      HOME: process.env.HOME ?? process.env.USERPROFILE ?? '',
      TMPDIR: process.env.TMPDIR ?? process.env.TEMP ?? process.env.TMP ?? '',
    },
  });

  return stdout || stderr;
}

export async function runSandboxedBashCommand(
  command: string,
  config: BashToolConfig = {}
) {
  validateSandboxedCommand(command);

  if (env.BASH_SANDBOX_MODE === 'host') {
    return runHostSandbox(command, config);
  }

  return runDockerSandbox(command, config);
}
