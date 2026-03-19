import express from 'express';
import { createServer, type Server } from 'http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const dbMock = vi.hoisted(() => ({
  query: vi.fn(),
}));
const enqueueCompanyWakeupMock = vi.hoisted(() => vi.fn());

vi.mock('../src/db/client.js', () => ({
  db: dbMock,
}));

vi.mock('../src/orchestrator/schedulerQueue.js', () => ({
  enqueueCompanyWakeup: enqueueCompanyWakeupMock,
}));

vi.mock('../src/middleware/auth.js', () => ({
  requireRole: () => (_req: express.Request, _res: express.Response, next: express.NextFunction) => next(),
}));

import tasksRouter from '../src/routes/tasks.js';

describe('task routes', () => {
  let server: Server;
  let baseUrl: string;

  beforeEach(async () => {
    dbMock.query.mockReset();
    enqueueCompanyWakeupMock.mockReset();

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

  it('returns a collaboration snapshot across a delegated task tree', async () => {
    dbMock.query
      .mockResolvedValueOnce({
        rows: [{ id: 'task-root' }],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'task-root',
            parent_id: null,
            title: 'Ship launch plan',
            description: 'Coordinate launch prep across the pod.',
            status: 'in_progress',
            assigned_to: 'agent-1',
            assigned_to_name: 'Ada',
            assigned_to_role: 'Lead Strategist',
            assigned_to_status: 'working',
            priority: 10,
            depth: 0,
            created_at: '2026-03-18T10:00:00.000Z',
            updated_at: '2026-03-18T10:05:00.000Z',
            completed_at: null,
          },
          {
            id: 'task-child',
            parent_id: 'task-root',
            title: 'Delegated: Validate messaging',
            description: 'Pressure-test the headline hierarchy.',
            status: 'done',
            assigned_to: 'agent-2',
            assigned_to_name: 'Ben',
            assigned_to_role: 'Messaging Specialist',
            assigned_to_status: 'idle',
            priority: 0,
            depth: 1,
            created_at: '2026-03-18T10:02:00.000Z',
            updated_at: '2026-03-18T10:04:00.000Z',
            completed_at: '2026-03-18T10:04:00.000Z',
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'msg-1',
            task_id: 'task-root',
            task_title: 'Ship launch plan',
            from_agent: 'agent-1',
            from_agent_name: 'Ada',
            from_agent_role: 'Lead Strategist',
            to_agent: 'agent-2',
            to_agent_name: 'Ben',
            to_agent_role: 'Messaging Specialist',
            content: 'Pressure-test the new headline stack before noon.',
            type: 'delegation',
            metadata: { child_task_id: 'task-child' },
            created_at: '2026-03-18T10:02:00.000Z',
          },
          {
            id: 'msg-2',
            task_id: 'task-child',
            task_title: 'Delegated: Validate messaging',
            from_agent: null,
            from_agent_name: null,
            from_agent_role: null,
            to_agent: 'agent-2',
            to_agent_name: 'Ben',
            to_agent_role: 'Messaging Specialist',
            content: 'Need a recommendation on the strongest hero message.',
            type: 'message',
            metadata: {},
            created_at: '2026-03-18T10:03:00.000Z',
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'hb-1',
            task_id: 'task-root',
            task_title: 'Ship launch plan',
            agent_id: 'agent-1',
            agent_name: 'Ada',
            agent_role: 'Lead Strategist',
            status: 'worked',
            duration_ms: 2200,
            cost_usd: '0.75',
            details: { thought: 'Ben should challenge the narrative before we lock copy.' },
            created_at: '2026-03-18T10:01:30.000Z',
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [],
      })
      .mockResolvedValueOnce({
        rows: [],
      });

    const response = await fetch(`${baseUrl}/task-child/collaboration`);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.root_task).toMatchObject({
      id: 'task-root',
      title: 'Ship launch plan',
    });
    expect(payload.current_task).toMatchObject({
      id: 'task-child',
      title: 'Delegated: Validate messaging',
    });
    expect(payload.summary).toMatchObject({
      task_count: 2,
      participant_count: 2,
      thought_count: 1,
      delegation_count: 1,
    });
    expect(payload.participants.map((item: any) => item.name)).toEqual(['Ada', 'Ben']);
    expect(payload.timeline.map((item: any) => item.kind)).toEqual(['thought', 'delegation', 'supervisor']);
    expect(payload.timeline[0]).toMatchObject({
      agent_name: 'Ada',
      content: 'Ben should challenge the narrative before we lock copy.',
    });
    expect(payload.tasks.find((item: any) => item.id === 'task-child')).toMatchObject({
      completed_at: '2026-03-18T10:04:00.000Z',
      status: 'done',
    });
  });

  it('creates a task and enqueues a scheduler wakeup', async () => {
    dbMock.query
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'task-1',
            company_id: 'company-1',
            title: 'Launch QA sweep',
            description: 'Validate release blockers.',
            assigned_to: 'agent-1',
            status: 'assigned',
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] });

    const response = await fetch(baseUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        company_id: '11111111-1111-4111-8111-111111111111',
        title: 'Launch QA sweep',
        description: 'Validate release blockers.',
        assigned_to: '22222222-2222-4222-8222-222222222222',
        priority: 1,
      }),
    });

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      id: 'task-1',
      status: 'assigned',
    });
    expect(enqueueCompanyWakeupMock).toHaveBeenCalledWith('11111111-1111-4111-8111-111111111111', 'task_created', {
      taskId: 'task-1',
      agentId: 'agent-1',
    });
  });
});
