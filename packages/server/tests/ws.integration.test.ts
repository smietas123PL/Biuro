import { createServer, type Server } from 'http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import WebSocket from 'ws';

const dbMock = vi.hoisted(() => ({
  query: vi.fn(),
}));

const envMock = vi.hoisted(() => ({
  AUTH_ENABLED: true,
  WS_RATE_LIMIT_WINDOW_MS: 60_000,
  WS_RATE_LIMIT_MAX: 30,
}));

const loggerMock = vi.hoisted(() => ({
  info: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
}));

vi.mock('../src/db/client.js', () => ({
  db: dbMock,
}));

vi.mock('../src/env.js', () => ({
  env: envMock,
}));

vi.mock('../src/utils/logger.js', () => ({
  logger: loggerMock,
}));

import { initWSHub } from '../src/ws.js';

function buildWsUrl(server: Server, query: Record<string, string>) {
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Server is not listening on a TCP port');
  }

  const params = new URLSearchParams(query);
  return `ws://127.0.0.1:${address.port}/ws?${params.toString()}`;
}

async function waitForClose(url: string) {
  return await new Promise<{ code: number; reason: string }>((resolve, reject) => {
    const ws = new WebSocket(url);

    ws.once('close', (code, reason) => {
      resolve({ code, reason: reason.toString() });
    });

    ws.once('error', () => {
      // Expected for refused websocket sessions closed immediately after handshake.
    });

    setTimeout(() => {
      reject(new Error(`Timed out waiting for websocket close: ${url}`));
    }, 2000);
  });
}

async function openSocket(url: string) {
  return await new Promise<WebSocket>((resolve, reject) => {
    const ws = new WebSocket(url);

    ws.once('open', () => {
      resolve(ws);
    });

    ws.once('close', (code, reason) => {
      reject(new Error(`Socket closed before opening (${code}: ${reason.toString()})`));
    });

    ws.once('error', reject);

    setTimeout(() => {
      reject(new Error(`Timed out waiting for websocket open: ${url}`));
    }, 2000);
  });
}

async function waitForMessage(ws: WebSocket) {
  return await new Promise<string>((resolve, reject) => {
    ws.once('message', (payload) => {
      resolve(payload.toString());
    });

    ws.once('close', (code, reason) => {
      reject(new Error(`Socket closed before message (${code}: ${reason.toString()})`));
    });

    ws.once('error', reject);

    setTimeout(() => {
      reject(new Error('Timed out waiting for websocket message'));
    }, 2000);
  });
}

describe('websocket authorization', () => {
  let server: Server;
  let hub: ReturnType<typeof initWSHub>;

  beforeEach(async () => {
    dbMock.query.mockReset();
    loggerMock.info.mockReset();
    loggerMock.error.mockReset();
    loggerMock.warn.mockReset();
    envMock.AUTH_ENABLED = true;
    envMock.WS_RATE_LIMIT_WINDOW_MS = 60_000;
    envMock.WS_RATE_LIMIT_MAX = 30;

    server = createServer();
    hub = initWSHub(server);

    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve());
    });
  });

  afterEach(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => {
        if (err) {
          reject(err);
          return;
        }
        resolve();
      });
    });
  });

  it('rejects websocket connections without a session token when auth is enabled', async () => {
    const result = await waitForClose(buildWsUrl(server, { companyId: 'company-1' }));

    expect(result.code).toBe(4401);
    expect(result.reason).toBe('Missing token');
    expect(dbMock.query).not.toHaveBeenCalled();
  });

  it('rejects websocket connections when the session user has no role in the company', async () => {
    dbMock.query
      .mockResolvedValueOnce({ rows: [{ user_id: 'user-1' }] })
      .mockResolvedValueOnce({ rows: [] });

    const result = await waitForClose(buildWsUrl(server, { companyId: 'company-1', token: 'valid-token' }));

    expect(result.code).toBe(4403);
    expect(result.reason).toBe('Forbidden');
    expect(dbMock.query).toHaveBeenCalledTimes(2);
  });

  it('accepts authorized websocket connections and broadcasts only to connected company clients', async () => {
    dbMock.query
      .mockResolvedValueOnce({ rows: [{ user_id: 'user-1' }] })
      .mockResolvedValueOnce({ rows: [{ role: 'owner' }] });

    const ws = await openSocket(buildWsUrl(server, { companyId: 'company-1', token: 'valid-token' }));
    const messagePromise = waitForMessage(ws);

    hub.broadcast('company-1', 'agent.working', { agentId: 'agent-1', taskId: 'task-1' });

    const payload = JSON.parse(await messagePromise);
    expect(payload).toMatchObject({
      event: 'agent.working',
      data: {
        agentId: 'agent-1',
        taskId: 'task-1',
      },
    });

    await new Promise<void>((resolve) => {
      ws.close(1000, 'done');
      ws.once('close', () => resolve());
    });
  });

  it('rejects websocket connections when the client exceeds the configured connection rate limit', async () => {
    envMock.WS_RATE_LIMIT_MAX = 1;
    envMock.WS_RATE_LIMIT_WINDOW_MS = 60_000;
    envMock.AUTH_ENABLED = false;

    const firstSocket = await openSocket(buildWsUrl(server, { companyId: 'company-1' }));
    const secondResult = await waitForClose(buildWsUrl(server, { companyId: 'company-1' }));

    expect(secondResult.code).toBe(4429);
    expect(secondResult.reason).toBe('Too many websocket connection attempts');
    expect(loggerMock.warn).toHaveBeenCalledWith(
      { clientIp: '127.0.0.1' },
      'WS connection rate limit exceeded'
    );

    await new Promise<void>((resolve) => {
      firstSocket.close(1000, 'done');
      firstSocket.once('close', () => resolve());
    });
  });
});
