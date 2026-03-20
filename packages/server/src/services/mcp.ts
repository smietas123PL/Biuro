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
  private static transports: Map<string, StdioClientTransport> = new Map();

  static async getClient(
    name: string,
    config: MCPServerConfig
  ): Promise<Client> {
    const cachedClient = this.clients.get(name);
    if (cachedClient) return cachedClient;

    logger.info({ name, command: config.command }, 'Connecting to MCP Server');

    const transport = new StdioClientTransport({
      command: config.command,
      args: config.args,
      env: { ...process.env, ...config.env } as Record<string, string>,
    });

    const client = new Client(
      { name: 'biuro-app', version: '1.0.0' },
      { capabilities: {} }
    );

    try {
      await client.connect(transport);
      this.clients.set(name, client);
      this.transports.set(name, transport);
      return client;
    } catch (err) {
      await transport.close().catch((closeErr: unknown) => {
        logger.warn(
          { err: closeErr, name },
          'Failed to close MCP transport after connect error'
        );
      });
      throw err;
    }
  }

  static async callTool(
    serverName: string,
    config: MCPServerConfig,
    toolName: string,
    args: any
  ) {
    const client = await this.getClient(serverName, config);
    try {
      const result = await client.callTool({
        name: toolName,
        arguments: args,
      });
      return result;
    } catch (err: any) {
      logger.error(
        { err: err.message, serverName, toolName },
        'MCP Tool Call Failed'
      );
      throw err;
    }
  }

  static async listTools(serverName: string, config: MCPServerConfig) {
    const client = await this.getClient(serverName, config);
    return await client.listTools();
  }

  static async closeClient(name: string) {
    const client = this.clients.get(name);
    if (!client) {
      return false;
    }

    this.clients.delete(name);
    const transport = this.transports.get(name);
    this.transports.delete(name);

    try {
      await client.close();
      logger.info({ name }, 'Closed MCP client');
    } catch (err) {
      logger.warn({ err, name }, 'Failed to close MCP client cleanly');
    }

    if (transport) {
      try {
        await transport.close();
      } catch (err) {
        logger.warn({ err, name }, 'Failed to close MCP transport cleanly');
      }
    }

    return true;
  }

  static async closeAllClients() {
    const clientNames = [...this.clients.keys()];
    if (clientNames.length === 0) {
      return;
    }

    await Promise.all(clientNames.map((name) => this.closeClient(name)));
  }

  static async cleanup(serverName: string) {
    return this.closeClient(serverName);
  }

  static async shutdown() {
    await this.closeAllClients();
  }
}
