import path from 'path';
import { describe, expect, it } from 'vitest';
import { buildDockerSandboxArgs, validateSandboxedCommand } from '../src/tools/bashSandbox.js';

describe('bash sandbox', () => {
  it('builds a locked-down docker run command with disabled network and readonly mounts', () => {
    const args = buildDockerSandboxArgs('git status --short', {
      workdir: 'packages/server',
      writable_paths: ['tmp-test-artifacts'],
    });

    expect(args).toContain('run');
    expect(args).toContain('--network');
    expect(args).toContain('none');
    expect(args).toContain('--read-only');
    expect(args).toContain('--cap-drop');
    expect(args).toContain('ALL');
    expect(args).toContain('--security-opt');
    expect(args).toContain('no-new-privileges');
    expect(args).toContain('--tmpfs');
    expect(args).toContain('/tmp:rw,noexec,nosuid,size=64m');
    expect(args).toContain('--workdir');
    expect(args).toContain('/workspace/packages/server');
    expect(args.some((value) => value.includes(`dst=/workspace,readonly`))).toBe(true);
    expect(args.some((value) => value.includes('dst=/workspace/tmp-test-artifacts'))).toBe(true);
    expect(args).toContain('--entrypoint');
    expect(args).toContain('sh');
    expect(args.slice(-3)).toEqual(['alpine/git:2.47.2', '-lc', 'git status --short']);
  });

  it('rejects shell control operators that could break command isolation', () => {
    expect(() => validateSandboxedCommand('git status && whoami')).toThrow(
      'Unsafe shell control operators are not allowed'
    );
    expect(() => validateSandboxedCommand('pwd; cat /etc/passwd')).toThrow(
      'Unsafe shell control operators are not allowed'
    );
  });
});
