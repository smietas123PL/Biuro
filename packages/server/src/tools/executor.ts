import { SpanStatusCode } from '@opentelemetry/api';
import { mkdir, writeFile } from 'fs/promises';
import path from 'path';
import { db } from '../db/client.js';
import { logger } from '../utils/logger.js';
import { MCPService } from '../services/mcp.js';
import { recordToolCallMetric } from '../observability/metrics.js';
import { startActiveSpan } from '../observability/tracing.js';
import { env } from '../env.js';
import { runSandboxedBashCommand, validateSandboxedCommand } from './bashSandbox.js';

const WORKSPACE_ROOT = path.resolve(env.WORKSPACE_ROOT);
export type ExecutableTool = {
  id?: string;
  name: string;
  type: 'builtin' | 'bash' | 'http' | 'mcp';
  config: any;
};

function getAllowedBashCommands(config: any): string[] {
  const configuredCommands = config?.allowed_commands ?? config?.allowedCommands;
  if (!Array.isArray(configuredCommands)) {
    return [];
  }

  return configuredCommands
    .filter((value): value is string => typeof value === 'string')
    .map((command) => command.trim())
    .filter(Boolean);
}

function validateBashCommand(tool: any, params: any) {
  const command = typeof params?.command === 'string' ? params.command.trim() : '';
  if (!command) {
    throw new Error('Bash tool requires a non-empty command');
  }

  const allowedCommands = getAllowedBashCommands(tool.config);
  if (allowedCommands.length === 0) {
    throw new Error(`Bash tool "${tool.name}" is missing allowed_commands configuration`);
  }

  const isAllowed = allowedCommands.some(
    (allowedCommand) => command === allowedCommand || command.startsWith(`${allowedCommand} `)
  );

  if (!isAllowed) {
    throw new Error('Command not in whitelist');
  }

  return validateSandboxedCommand(command);
}

function resolveWorkspacePath(inputPath: unknown) {
  const requestedPath = typeof inputPath === 'string' ? inputPath.trim() : '';
  if (!requestedPath) {
    throw new Error('file_write requires a non-empty path');
  }

  const resolvedPath = path.resolve(WORKSPACE_ROOT, requestedPath);
  const relativePath = path.relative(WORKSPACE_ROOT, resolvedPath);
  if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    throw new Error('file_write path must stay inside the workspace');
  }

  return {
    requestedPath,
    resolvedPath,
    relativePath: relativePath || '.',
  };
}

async function runWebSearch(params: any) {
  const query = typeof params?.query === 'string' ? params.query.trim() : '';
  if (!query) {
    throw new Error('web_search requires a non-empty query');
  }

  const maxResults = Math.min(
    8,
    Math.max(1, Number.isFinite(Number(params?.max_results)) ? Number(params.max_results) : 5)
  );

  const response = await fetch(
    `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`,
    {
      headers: {
        Accept: 'application/json',
      },
    }
  );

  if (!response.ok) {
    throw new Error(`web_search failed with status ${response.status}`);
  }

  const payload = await response.json() as {
    AbstractText?: string;
    AbstractURL?: string;
    Heading?: string;
    Results?: Array<{ FirstURL?: string; Text?: string }>;
    RelatedTopics?: Array<
      | { FirstURL?: string; Text?: string }
      | { Name?: string; Topics?: Array<{ FirstURL?: string; Text?: string }> }
    >;
  };

  const relatedTopicResults = (payload.RelatedTopics ?? []).flatMap((entry) => {
    if (Array.isArray((entry as { Topics?: unknown[] }).Topics)) {
      return (entry as { Topics: Array<{ FirstURL?: string; Text?: string }> }).Topics;
    }

    return [entry as { FirstURL?: string; Text?: string }];
  });

  const candidates = [
    payload.AbstractText
      ? {
          title: payload.Heading || 'Instant answer',
          url: payload.AbstractURL || '',
          snippet: payload.AbstractText,
          source: 'duckduckgo-abstract',
        }
      : null,
    ...(payload.Results ?? []).map((entry) => ({
      title: entry.Text?.split(' - ')[0] || 'Search result',
      url: entry.FirstURL || '',
      snippet: entry.Text || '',
      source: 'duckduckgo-results',
    })),
    ...relatedTopicResults.map((entry) => ({
      title: entry.Text?.split(' - ')[0] || 'Related topic',
      url: entry.FirstURL || '',
      snippet: entry.Text || '',
      source: 'duckduckgo-related',
    })),
  ]
    .filter((entry): entry is { title: string; url: string; snippet: string; source: string } => Boolean(entry))
    .filter((entry) => entry.snippet.trim().length > 0)
    .filter((entry, index, collection) =>
      collection.findIndex((candidate) => candidate.url === entry.url && candidate.snippet === entry.snippet) === index
    )
    .slice(0, maxResults);

  return {
    query,
    engine: 'duckduckgo',
    results: candidates,
  };
}

async function runFileWrite(params: any) {
  const { resolvedPath, relativePath } = resolveWorkspacePath(params?.path);
  const content = typeof params?.content === 'string' ? params.content : '';
  if (!content.length) {
    throw new Error('file_write requires string content');
  }

  await mkdir(path.dirname(resolvedPath), { recursive: true });
  await writeFile(resolvedPath, content, 'utf8');

  return {
    ok: true,
    path: relativePath,
    bytes_written: Buffer.byteLength(content, 'utf8'),
  };
}

export async function executeStandaloneTool(tool: ExecutableTool, params: any) {
  switch (tool.type) {
    case 'builtin':
      return handleBuiltin(tool.name, params);
    case 'bash': {
      const command = validateBashCommand(tool, params);
      return runSandboxedBashCommand(command, tool.config);
    }
    case 'http': {
      const method = typeof params?.method === 'string' ? params.method : tool.config.method || 'GET';
      const response = await fetch(tool.config.url, {
        method,
        body: params?.data ? JSON.stringify(params.data) : undefined,
        headers: {
          'Content-Type': 'application/json',
          ...(tool.config.headers ?? {}),
        },
      });

      const contentType = response.headers.get('content-type') ?? '';
      const output = contentType.includes('application/json')
        ? await response.json().catch(() => null)
        : await response.text();

      if (!response.ok) {
        const error = new Error(`HTTP tool responded with status ${response.status}`);
        (error as Error & { output?: unknown; status?: number }).output = output;
        (error as Error & { output?: unknown; status?: number }).status = response.status;
        throw error;
      }

      return output;
    }
    case 'mcp':
      return MCPService.callTool(
        tool.config.serverName,
        { command: tool.config.command, args: tool.config.args, env: tool.config.env },
        tool.name,
        params
      );
    default:
      throw new Error(`Unsupported tool type: ${tool.type}`);
  }
}

export async function executeTool(agentId: string, taskId: string, toolName: string, params: any) {
  const startTime = Date.now();
  
  // 1. Get Tool Info
  const toolRes = await db.query(
    'SELECT * FROM tools WHERE name = $1 AND company_id = (SELECT company_id FROM agents WHERE id = $2)',
    [toolName, agentId]
  );
  
  if (toolRes.rows.length === 0) throw new Error(`Tool ${toolName} not found`);
  const tool = toolRes.rows[0];

  logger.info({ agentId, toolName, toolType: tool.type }, 'Executing tool');

  return startActiveSpan(
    'tool.execute',
    {
      'agent.id': agentId,
      'task.id': taskId,
      'tool.id': tool.id,
      'tool.name': tool.name,
      'tool.type': tool.type,
    },
    async (span) => {
      let output: any;
      let status: 'success' | 'error' = 'success';

      try {
        output = await executeStandaloneTool(tool, params);
      } catch (err: any) {
        status = 'error';
        output = { error: err.message };
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: err.message,
        });
        logger.error({ err, toolName }, 'Tool execution failed');
      }

      const durationMs = Date.now() - startTime;
      span.setAttribute('tool.status', status);
      span.setAttribute('tool.duration_ms', durationMs);

      await db.query(
        `INSERT INTO tool_calls (agent_id, task_id, tool_id, input, output, status, duration_ms)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [agentId, taskId, tool.id, JSON.stringify(params), JSON.stringify(output), status, durationMs]
      );

      recordToolCallMetric({
        toolName: tool.name,
        toolType: tool.type,
        status,
        durationMs,
      });

      return output;
    }
  );
}

async function handleBuiltin(name: string, params: any) {
  if (name === 'web_search') {
    return runWebSearch(params);
  }
  if (name === 'file_write') {
    return runFileWrite(params);
  }
  throw new Error(`Unknown builtin tool: ${name}`);
}
