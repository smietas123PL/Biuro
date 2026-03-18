import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { logger } from '../utils/logger.js';

interface MCPServerConfig {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

export class MCPService {
  private static clients: Map<string, Client> = new Map();

  static async getClient(name: string, config: MCPServerConfig): Promise<Client> {
    if (this.clients.has(name)) return this.clients.get(name)!;

    logger.info({ name, command: config.command }, 'Connecting to MCP Server');
    
    const transport = new StdioClientTransport({
      command: config.command,
      args: config.args,
      env: { ...process.env, ...config.env } as Record<string, string>
    });

    const client = new Client(
      { name: 'biuro-app', version: '1.0.0' },
      { capabilities: {} }
    );

    await client.connect(transport);
    this.clients.set(name, client);
    
    return client;
  }

  static async callTool(serverName: string, config: MCPServerConfig, toolName: string, args: any) {
    const client = await this.getClient(serverName, config);
    try {
      const result = await client.callTool({
        name: toolName,
        arguments: args
      });
      return result;
    } catch (err: any) {
      logger.error({ err: err.message, serverName, toolName }, 'MCP Tool Call Failed');
      throw err;
    }
  }

  static async listTools(serverName: string, config: MCPServerConfig) {
    const client = await this.getClient(serverName, config);
    return await client.listTools();
  }
}
