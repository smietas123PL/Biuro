import { beforeEach, describe, expect, it, vi } from 'vitest';

const sdkState = vi.hoisted(() => ({
  clients: [] as Array<{
    connect: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
    callTool: ReturnType<typeof vi.fn>;
    listTools: ReturnType<typeof vi.fn>;
  }>,
  transports: [] as Array<{
    close: ReturnType<typeof vi.fn>;
    config: Record<string, unknown>;
  }>,
  connectError: null as Error | null,
}));

vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: vi.fn().mockImplementation(() => {
    const client = {
      connect: vi.fn(async () => {
        if (sdkState.connectError) {
          throw sdkState.connectError;
        }
      }),
      close: vi.fn(async () => undefined),
      callTool: vi.fn(),
      listTools: vi.fn(),
    };
    sdkState.clients.push(client);
    return client;
  }),
}));

vi.mock('@modelcontextprotocol/sdk/client/stdio.js', () => ({
  StdioClientTransport: vi.fn().mockImplementation((config: Record<string, unknown>) => {
    const transport = {
      config,
      close: vi.fn(async () => undefined),
    };
    sdkState.transports.push(transport);
    return transport;
  }),
}));

vi.mock('../src/utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { MCPService } from '../src/services/mcp.js';

describe('MCPService', () => {
  beforeEach(async () => {
    await MCPService.closeAllClients();
    sdkState.connectError = null;
    sdkState.clients.length = 0;
    sdkState.transports.length = 0;
  });

  it('reuses cached clients and closes them during cleanup', async () => {
    const first = await MCPService.getClient('notes', {
      command: 'node',
      args: ['dist/mock-mcp.js'],
    });
    const second = await MCPService.getClient('notes', {
      command: 'node',
      args: ['dist/mock-mcp.js'],
    });

    expect(first).toBe(second);
    expect(sdkState.clients).toHaveLength(1);

    await MCPService.closeAllClients();

    expect(sdkState.clients[0]?.close).toHaveBeenCalledTimes(1);

    await MCPService.getClient('notes', {
      command: 'node',
      args: ['dist/mock-mcp.js'],
    });

    expect(sdkState.clients).toHaveLength(2);
  });

  it('closes the transport when connecting a new client fails', async () => {
    sdkState.connectError = new Error('connect failed');

    await expect(
      MCPService.getClient('broken', {
        command: 'node',
        args: ['dist/broken-mcp.js'],
      })
    ).rejects.toThrow('connect failed');

    expect(sdkState.clients).toHaveLength(1);
    expect(sdkState.transports).toHaveLength(1);
    expect(sdkState.transports[0]?.close).toHaveBeenCalledTimes(1);
  });
});
