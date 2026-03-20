import express from 'express';
import { createServer, type Server } from 'http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const dbMock = vi.hoisted(() => ({
  query: vi.fn(),
}));
const broadcastCollaborationSignalMock = vi.hoisted(() => vi.fn());

vi.mock('../src/db/client.js', () => ({
  db: dbMock,
}));

vi.mock('../src/services/collaboration.js', () => ({
  broadcastCollaborationSignal: broadcastCollaborationSignalMock,
  deriveCollaborationSignalKind: (
    type: string | null | undefined,
    fromAgent: string | null | undefined
  ) => {
    if (!fromAgent) return 'supervisor_message';
    if (type === 'delegation') return 'delegation';
    if (type === 'status_update' || type === 'approval_request')
      return 'status_update';
    if (type === 'tool_call' || type === 'tool_result') return 'tool_activity';
    return 'message';
  },
}));

vi.mock('../src/middleware/auth.js', () => ({
  requireRole:
    () =>
    (
      req: express.Request & {
        user?: { id: string; companyId?: string; role?: string };
      },
      _res: express.Response,
      next: express.NextFunction
    ) => {
      const testCompanyIdHeader = req.headers['x-test-company-id'];
      req.user = {
        id: 'user-1',
        companyId:
          typeof testCompanyIdHeader === 'string'
            ? testCompanyIdHeader
            : undefined,
        role: 'owner',
      };
      next();
    },
}));

import messagesRouter from '../src/routes/messages.js';

describe('messages routes', () => {
  let server: Server;
  let baseUrl: string;

  beforeEach(async () => {
    dbMock.query.mockReset();
    broadcastCollaborationSignalMock.mockReset();

    const app = express();
    app.use(express.json());
    app.use('/api/messages', messagesRouter);

    server = createServer(app);
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve());
    });

    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Expected server to listen on a TCP port');
    }

    baseUrl = `http://127.0.0.1:${address.port}/api/messages`;
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

  function fetchWithCompany(path: string, init?: RequestInit) {
    return fetch(path, {
      ...init,
      headers: {
        'x-test-company-id': '11111111-1111-4111-8111-111111111111',
        ...(init?.headers ?? {}),
      },
    });
  }

  it('creates a delegation message and broadcasts a collaboration signal', async () => {
    dbMock.query
      .mockResolvedValueOnce({ rows: [{ id: 'task-1' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'agent-1' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'agent-2' }] })
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'message-1',
            task_id: 'task-1',
            from_agent: 'agent-1',
            to_agent: 'agent-2',
            content: 'Please validate the new headline hierarchy.',
            type: 'delegation',
          },
        ],
      });

    const response = await fetchWithCompany(baseUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        task_id: '11111111-1111-4111-8111-111111111112',
        from_agent: '22222222-2222-4222-8222-222222222222',
        to_agent: '33333333-3333-4333-8333-333333333333',
        content: 'Please validate the new headline hierarchy.',
        type: 'delegation',
        metadata: {
          child_task_id: 'task-child',
        },
      }),
    });

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      id: 'message-1',
      type: 'delegation',
    });
    expect(broadcastCollaborationSignalMock).toHaveBeenCalledWith(
      '11111111-1111-4111-8111-111111111111',
      '11111111-1111-4111-8111-111111111112',
      'delegation',
      {
        from_agent_id: '22222222-2222-4222-8222-222222222222',
        to_agent_id: '33333333-3333-4333-8333-333333333333',
        message_id: 'message-1',
      }
    );
  });

  it('rejects blank content before touching the database', async () => {
    const response = await fetchWithCompany(baseUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        task_id: '11111111-1111-4111-8111-111111111112',
        content: '   ',
      }),
    });
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBeTruthy();
    expect(dbMock.query).not.toHaveBeenCalled();
    expect(broadcastCollaborationSignalMock).not.toHaveBeenCalled();
  });

  it('lists task messages within the authenticated company scope', async () => {
    dbMock.query.mockResolvedValueOnce({
      rows: [
        {
          id: 'message-1',
          task_id: 'task-1',
          content: 'Need a recommendation on the strongest hero message.',
        },
      ],
    });

    const response = await fetchWithCompany(`${baseUrl}/task/task-1`);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual([
      expect.objectContaining({
        id: 'message-1',
        task_id: 'task-1',
      }),
    ]);
    expect(dbMock.query).toHaveBeenCalledWith(
      expect.stringContaining('WHERE m.task_id = $1'),
      ['task-1', '11111111-1111-4111-8111-111111111111']
    );
  });
});
