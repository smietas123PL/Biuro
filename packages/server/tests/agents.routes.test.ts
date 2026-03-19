import express from 'express';
import { createServer, type Server } from 'http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const dbMock = vi.hoisted(() => ({
  query: vi.fn(),
}));

vi.mock('../src/db/client.js', () => ({
  db: dbMock,
}));

vi.mock('../src/middleware/auth.js', () => ({
  requireRole: () => (_req: express.Request, _res: express.Response, next: express.NextFunction) => next(),
}));

import agentsRouter from '../src/routes/agents.js';

describe('agent routes', () => {
  let server: Server;
  let baseUrl: string;

  function mockReplayQueries() {
    dbMock.query
      .mockResolvedValueOnce({
        rows: [{ id: 'agent-1', company_id: 'company-1', name: 'Ada', role: 'Research Lead', status: 'active' }],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'heartbeat-1',
            task_id: 'task-1',
            task_title: 'Research customer pain points',
            status: 'completed',
            duration_ms: 4200,
            cost_usd: '1.75',
            details: { thought: 'Summarized the interview notes.' },
            created_at: '2026-03-18T10:02:00.000Z',
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'audit-1',
            action: 'task.started',
            details: { reason: 'Picked the highest-priority queued task.' },
            cost_usd: null,
            created_at: '2026-03-18T10:00:00.000Z',
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'message-1',
            task_id: 'task-1',
            task_title: 'Research customer pain points',
            from_agent: 'agent-1',
            to_agent: 'agent-2',
            content: 'Initial findings are ready for review.',
            type: 'message',
            metadata: { channel: 'internal' },
            created_at: '2026-03-18T10:01:00.000Z',
          },
          {
            id: 'message-2',
            task_id: 'task-1',
            task_title: 'Research customer pain points',
            from_agent: 'agent-2',
            to_agent: 'agent-1',
            content: 'Please validate the top three patterns.',
            type: 'message',
            metadata: { channel: 'internal' },
            created_at: '2026-03-18T10:04:00.000Z',
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'session-1',
            task_id: 'task-1',
            task_title: 'Research customer pain points',
            state: { summary: 'Paused pending product sign-off.' },
            updated_at: '2026-03-18T10:03:00.000Z',
          },
        ],
      });
  }

  function mockReplayDiffQueries() {
    dbMock.query
      .mockResolvedValueOnce({
        rows: [{ id: 'agent-1', company_id: 'company-1', name: 'Ada', role: 'Research Lead', status: 'active' }],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'heartbeat-left-1',
            task_id: 'task-1',
            task_title: 'Research customer pain points',
            status: 'completed',
            duration_ms: 4200,
            cost_usd: '1.75',
            details: { thought: 'Summarized the interview notes.' },
            created_at: '2026-03-18T10:02:00.000Z',
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'audit-left-1',
            action: 'task.started',
            details: { reason: 'Picked the highest-priority queued task.' },
            cost_usd: null,
            created_at: '2026-03-18T10:00:00.000Z',
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'message-left-1',
            task_id: 'task-1',
            task_title: 'Research customer pain points',
            from_agent: 'agent-1',
            to_agent: 'agent-2',
            content: 'Initial findings are ready for review.',
            type: 'message',
            metadata: { channel: 'internal' },
            created_at: '2026-03-18T10:01:00.000Z',
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'session-left-1',
            task_id: 'task-1',
            task_title: 'Research customer pain points',
            state: { summary: 'Paused pending product sign-off.' },
            updated_at: '2026-03-18T10:03:00.000Z',
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [{ id: 'agent-1', company_id: 'company-1', name: 'Ada', role: 'Research Lead', status: 'active' }],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'heartbeat-right-1',
            task_id: 'task-2',
            task_title: 'Prepare launch notes',
            status: 'completed',
            duration_ms: 2100,
            cost_usd: '0.80',
            details: { thought: 'Drafted the launch memo.' },
            created_at: '2026-03-18T11:02:00.000Z',
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'audit-right-1',
            action: 'task.started',
            details: { reason: 'Switched into ship-readiness mode.' },
            cost_usd: null,
            created_at: '2026-03-18T11:00:00.000Z',
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'message-right-1',
            task_id: 'task-2',
            task_title: 'Prepare launch notes',
            from_agent: 'agent-1',
            to_agent: 'agent-3',
            content: 'Launch notes draft is ready.',
            type: 'message',
            metadata: { channel: 'internal' },
            created_at: '2026-03-18T11:04:00.000Z',
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'session-right-1',
            task_id: 'task-2',
            task_title: 'Prepare launch notes',
            state: { summary: 'Waiting on final approval.' },
            updated_at: '2026-03-18T11:03:00.000Z',
          },
        ],
      });
  }

  beforeEach(async () => {
    dbMock.query.mockReset();

    const app = express();
    app.use(express.json());
    app.use('/api/agents', agentsRouter);

    server = createServer(app);
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve());
    });

    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Expected server to listen on a TCP port');
    }

    baseUrl = `http://127.0.0.1:${address.port}/api/agents`;
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

  it('returns a filtered replay timeline with task and event-type metadata for session replay', async () => {
    mockReplayQueries();

    const response = await fetch(
      `${baseUrl}/agent-1/replay?limit=5&from=2026-03-18T09:59:00.000Z&to=2026-03-18T10:05:00.000Z&task_id=task-1&types=message,session`
    );

    expect(response.status).toBe(200);

    const payload = await response.json();

    expect(payload).toMatchObject({
      agent_id: 'agent-1',
      filters: {
        applied: {
          task_id: 'task-1',
          types: ['message', 'session'],
        },
        tasks: [
          {
            task_id: 'task-1',
            task_title: 'Research customer pain points',
            event_count: 4,
          },
        ],
      },
      window: {
        from: '2026-03-18T09:59:00.000Z',
        to: '2026-03-18T10:05:00.000Z',
        limit: 5,
        returned: 3,
      },
      items: [
        {
          id: 'message:message-1',
          type: 'message',
          action: 'message.sent',
          direction: 'outbound',
          summary: 'Initial findings are ready for review.',
          timestamp: '2026-03-18T10:01:00.000Z',
        },
        {
          id: 'session:session-1',
          type: 'session',
          action: 'session.updated',
          summary: 'Paused pending product sign-off.',
          timestamp: '2026-03-18T10:03:00.000Z',
        },
        {
          id: 'message:message-2',
          type: 'message',
          action: 'message.received',
          direction: 'inbound',
          summary: 'Please validate the top three patterns.',
          timestamp: '2026-03-18T10:04:00.000Z',
        },
      ],
    });
    expect(payload.filters.available_types).toEqual(
      expect.arrayContaining(['heartbeat', 'audit', 'message', 'session'])
    );

    expect(dbMock.query).toHaveBeenCalledTimes(5);
    expect(String(dbMock.query.mock.calls[1]?.[0])).toContain('FROM heartbeats h');
    expect(String(dbMock.query.mock.calls[2]?.[0])).toContain('FROM audit_log');
    expect(String(dbMock.query.mock.calls[3]?.[0])).toContain('FROM messages m');
    expect(String(dbMock.query.mock.calls[4]?.[0])).toContain('FROM agent_sessions s');
  });

  it('exports the filtered replay as an HTML attachment', async () => {
    mockReplayQueries();

    const response = await fetch(
      `${baseUrl}/agent-1/replay/report?limit=5&task_id=task-1&types=message,session`
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/html');
    expect(response.headers.get('content-disposition')).toContain('attachment; filename=');

    const html = await response.text();
    expect(html).toContain('Biuro Replay Report');
    expect(html).toContain('Ada');
    expect(html).toContain('Initial findings are ready for review.');
    expect(html).toContain('Please validate the top three patterns.');
    expect(html).toContain('Task Scope');
  });

  it('returns a task-to-task replay diff with summary deltas', async () => {
    mockReplayDiffQueries();

    const response = await fetch(
      `${baseUrl}/agent-1/replay/diff?left_task_id=task-1&right_task_id=task-2&limit=20`
    );

    expect(response.status).toBe(200);

    const payload = await response.json();

    expect(payload).toMatchObject({
      agent: {
        id: 'agent-1',
        name: 'Ada',
      },
      filters: {
        limit: 20,
        types: [],
      },
      left: {
        task_id: 'task-1',
        task_title: 'Research customer pain points',
        event_count: 3,
        total_duration_ms: 4200,
        total_cost_usd: 1.75,
      },
      right: {
        task_id: 'task-2',
        task_title: 'Prepare launch notes',
        event_count: 3,
        total_duration_ms: 2100,
        total_cost_usd: 0.8,
      },
      delta: {
        event_count: 0,
        total_duration_ms: 2100,
        total_cost_usd: 0.95,
      },
    });
    expect(payload.left.highlights).toEqual(
      expect.arrayContaining([
        'Initial findings are ready for review.',
        'Summarized the interview notes.',
        'Paused pending product sign-off.',
      ])
    );
    expect(payload.right.highlights).toEqual(
      expect.arrayContaining([
        'Launch notes draft is ready.',
        'Drafted the launch memo.',
        'Waiting on final approval.',
      ])
    );

    expect(dbMock.query).toHaveBeenCalledTimes(10);
  });
});
