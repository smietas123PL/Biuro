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
    if (type === 'status_update' || type === 'approval_request') {
      return 'status_update';
    }
    if (type === 'tool_result' || type === 'tool_call') {
      return 'tool_activity';
    }
    return 'message';
  },
  getTaskCollaborationSnapshot: vi.fn(),
}));

vi.mock('../src/orchestrator/schedulerQueue.js', () => ({
  enqueueCompanyWakeup: vi.fn(),
}));

vi.mock('../src/realtime/eventBus.js', () => ({
  broadcastCompanyEvent: vi.fn(),
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

import tasksRouter from '../src/routes/tasks.js';

describe('task messaging and reads routes', () => {
  let server: Server;
  let baseUrl: string;

  beforeEach(async () => {
    dbMock.query.mockReset();
    broadcastCollaborationSignalMock.mockReset();

    const app = express();
    app.use(express.json());
    app.use('/api/tasks', tasksRouter);

    server = createServer(app);
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve());
    });

    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Expected server to listen on a TCP port');
    }

    baseUrl = `http://127.0.0.1:${address.port}/api/tasks`;
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

  it('returns a scoped task detail by id', async () => {
    dbMock.query.mockResolvedValueOnce({
      rows: [
        {
          id: 'task-1',
          company_id: '11111111-1111-4111-8111-111111111111',
          title: 'Verify refund',
          status: 'assigned',
          assigned_to_name: 'Ada',
        },
      ],
    });

    const response = await fetchWithCompany(`${baseUrl}/task-1`);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      id: 'task-1',
      title: 'Verify refund',
      status: 'assigned',
    });
    expect(dbMock.query).toHaveBeenCalledWith(
      expect.stringContaining('FROM tasks t'),
      ['task-1', '11111111-1111-4111-8111-111111111111']
    );
  });

  it('lists tasks with assignee and status filters inside the company scope', async () => {
    dbMock.query.mockResolvedValueOnce({
      rows: [
        {
          id: 'task-1',
          assigned_to: '22222222-2222-4222-8222-222222222222',
          status: 'assigned',
        },
      ],
    });

    const response = await fetchWithCompany(
      `${baseUrl}?assigned_to=22222222-2222-4222-8222-222222222222&status=assigned`
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toHaveLength(1);
    expect(dbMock.query).toHaveBeenCalledWith(
      'SELECT * FROM tasks WHERE company_id = $1 AND assigned_to = $2 AND status = $3 ORDER BY priority DESC, created_at ASC',
      [
        '11111111-1111-4111-8111-111111111111',
        '22222222-2222-4222-8222-222222222222',
        'assigned',
      ]
    );
  });

  it('creates a task message and broadcasts a collaboration signal', async () => {
    dbMock.query
      .mockResolvedValueOnce({
        rows: [{ company_id: '11111111-1111-4111-8111-111111111111' }],
      })
      .mockResolvedValueOnce({
        rows: [{ id: '22222222-2222-4222-8222-222222222222' }],
      })
      .mockResolvedValueOnce({
        rows: [{ id: '33333333-3333-4333-8333-333333333333' }],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'message-1',
            task_id: 'task-1',
            from_agent: '22222222-2222-4222-8222-222222222222',
            to_agent: '33333333-3333-4333-8333-333333333333',
            content: 'Confirm the ledger entry before we close the refund.',
            type: 'message',
          },
        ],
      });

    const response = await fetchWithCompany(`${baseUrl}/task-1/messages`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        content: 'Confirm the ledger entry before we close the refund.',
        from_agent: '22222222-2222-4222-8222-222222222222',
        to_agent: '33333333-3333-4333-8333-333333333333',
      }),
    });

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      id: 'message-1',
      task_id: 'task-1',
      type: 'message',
    });
    expect(broadcastCollaborationSignalMock).toHaveBeenCalledWith(
      '11111111-1111-4111-8111-111111111111',
      'task-1',
      'message',
      {
        from_agent_id: '22222222-2222-4222-8222-222222222222',
        to_agent_id: '33333333-3333-4333-8333-333333333333',
        message_id: 'message-1',
      }
    );
  });

  it('rejects a message when the sender agent is outside the company scope', async () => {
    dbMock.query
      .mockResolvedValueOnce({
        rows: [{ company_id: '11111111-1111-4111-8111-111111111111' }],
      })
      .mockResolvedValueOnce({
        rows: [],
      });

    const response = await fetchWithCompany(`${baseUrl}/task-1/messages`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        content: 'Confirm the ledger entry before we close the refund.',
        from_agent: '22222222-2222-4222-8222-222222222222',
      }),
    });

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: 'Sender agent not found',
    });
    expect(broadcastCollaborationSignalMock).not.toHaveBeenCalled();
  });
});
