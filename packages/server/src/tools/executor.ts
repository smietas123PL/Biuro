import { exec } from 'child_process';
import { promisify } from 'util';
import { db } from '../db/client.js';
import { logger } from '../utils/logger.js';
import { MCPService } from '../services/mcp.js';

const execPromise = promisify(exec);

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

  return command;
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

  let output: any;
  let status: 'success' | 'error' = 'success';

  try {
    switch (tool.type) {
      case 'builtin':
        output = await handleBuiltin(tool.name, params);
        break;
      case 'bash':
        const command = validateBashCommand(tool, params);
        const { stdout, stderr } = await execPromise(command, {
          timeout: 10000,
          maxBuffer: 1024 * 1024,
        });
        output = stdout || stderr;
        break;
      case 'http':
        const res = await fetch(tool.config.url, {
          method: params.method || 'GET',
          body: JSON.stringify(params.data),
          headers: { 'Content-Type': 'application/json', ...tool.config.headers }
        });
        output = await res.json();
        break;
      case 'mcp':
        // tool.config expected to have { serverName, command, args, env }
        output = await MCPService.callTool(
          tool.config.serverName,
          { command: tool.config.command, args: tool.config.args, env: tool.config.env },
          tool.name,
          params
        );
        break;
      default:
        throw new Error(`Unsupported tool type: ${tool.type}`);
    }
  } catch (err: any) {
    status = 'error';
    output = { error: err.message };
    logger.error({ err, toolName }, 'Tool execution failed');
  }

  // 2. Log tool call
  await db.query(
    `INSERT INTO tool_calls (agent_id, task_id, tool_id, input, output, status, duration_ms)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [agentId, taskId, tool.id, JSON.stringify(params), JSON.stringify(output), status, Date.now() - startTime]
  );

  return output;
}

async function handleBuiltin(name: string, params: any) {
  if (name === 'web_search') {
    // Mock web search for skeleton
    return { results: [`Search result for ${params.query}`] };
  }
  if (name === 'file_write') {
    // restricted to workspace
    return { ok: true, path: params.path };
  }
  throw new Error(`Unknown builtin tool: ${name}`);
}
