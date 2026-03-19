import express from 'express';
import { createServer, type Server } from 'http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const dbMock = vi.hoisted(() => ({
  query: vi.fn(),
  transaction: vi.fn(),
}));
const runtimeExecuteMock = vi.hoisted(() => vi.fn());
const getRuntimeMock = vi.hoisted(() =>
  vi.fn(() => ({ execute: runtimeExecuteMock }))
);

vi.mock('../src/db/client.js', () => ({
  db: dbMock,
}));

vi.mock('../src/middleware/auth.js', () => ({
  requireRole:
    () =>
    (
      _req: express.Request,
      _res: express.Response,
      next: express.NextFunction
    ) =>
      next(),
}));

vi.mock('../src/runtime/registry.js', () => ({
  runtimeRegistry: {
    getRuntime: getRuntimeMock,
  },
}));

import goalsRouter from '../src/routes/goals.js';

describe('goals routes', () => {
  let server: Server;
  let baseUrl: string;

  beforeEach(async () => {
    dbMock.query.mockReset();
    dbMock.transaction.mockReset();
    runtimeExecuteMock.mockReset();
    getRuntimeMock.mockClear();

    const app = express();
    app.use(express.json());
    app.use('/api/companies/:companyId/goals', goalsRouter);

    server = createServer(app);
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve());
    });

    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Expected server to listen on a TCP port');
    }

    baseUrl = `http://127.0.0.1:${address.port}/api/companies/company-1/goals`;
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

  it('generates an AI goal decomposition and writes an audit entry', async () => {
    runtimeExecuteMock.mockResolvedValue({
      thought: JSON.stringify({
        title: 'Launch the partner program',
        description:
          'Coordinate the partner launch with clear sequencing and ownership.',
        goals: [
          {
            ref: 'goal-root',
            parent_ref: null,
            title: 'Launch the partner program',
            description:
              'Coordinate the partner launch with clear sequencing and ownership.',
            status: 'active',
          },
          {
            ref: 'goal-ops',
            parent_ref: 'goal-root',
            title: 'Define the launch scope',
            description: 'Lock the target segment, offer, and timing.',
            status: 'active',
          },
          {
            ref: 'goal-onboarding',
            parent_ref: 'goal-root',
            title: 'Prepare onboarding motion',
            description:
              'Document the path from signed partner to activated partner.',
            status: 'active',
          },
        ],
        starter_tasks: [
          {
            ref: 'task-1',
            goal_ref: 'goal-ops',
            title: 'Starter: Define the launch scope',
            description:
              'Write the first scope draft and list open launch decisions.',
            priority: 80,
            suggested_agent_id: '11111111-1111-4111-8111-111111111111',
            suggested_agent_name: 'Mina',
          },
        ],
        confidence: 'high',
        warnings: [],
      }),
      actions: [{ type: 'continue', thought: 'done' }],
      routing: {
        selected_runtime: 'claude',
        selected_model: 'claude-sonnet',
        attempts: [
          { runtime: 'claude', model: 'claude-sonnet', status: 'success' },
        ],
      },
    });

    dbMock.query.mockImplementation(async (text: string, params?: any[]) => {
      if (text.includes('FROM companies')) {
        expect(params).toEqual(['company-1']);
        return {
          rows: [
            {
              id: 'company-1',
              name: 'QA Test Corp',
              mission: 'Scale a reliable operating system',
              config: {
                llm_primary_runtime: 'claude',
                llm_fallback_order: ['openai', 'gemini'],
              },
            },
          ],
        };
      }

      if (text.includes('FROM agents')) {
        expect(params).toEqual(['company-1']);
        return {
          rows: [
            {
              id: '11111111-1111-4111-8111-111111111111',
              name: 'Mina',
              role: 'partnerships',
              title: 'Partnership Lead',
              status: 'idle',
            },
          ],
        };
      }

      if (text.includes(`'goal.ai_decomposed'`)) {
        expect(params?.[0]).toBe('company-1');
        const details = JSON.parse(String(params?.[1]));
        expect(details.prompt).toContain('partner');
        expect(details.planner).toMatchObject({
          mode: 'llm',
          runtime: 'claude',
          model: 'claude-sonnet',
        });
        expect(details.suggestion).toMatchObject({
          title: 'Launch the partner program',
        });
        return { rows: [], rowCount: 1 };
      }

      throw new Error(`Unexpected query: ${text}`);
    });

    const response = await fetch(`${baseUrl}/ai-decompose`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        prompt: 'launch our partner program in Q2 and keep ownership clear',
      }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      suggestion: {
        title: 'Launch the partner program',
        goals: expect.arrayContaining([
          expect.objectContaining({ ref: 'goal-root' }),
        ]),
        starter_tasks: expect.arrayContaining([
          expect.objectContaining({
            goal_ref: 'goal-ops',
            suggested_agent_name: 'Mina',
          }),
        ]),
      },
      planner: {
        mode: 'llm',
        runtime: 'claude',
      },
    });

    expect(getRuntimeMock).toHaveBeenCalledWith('claude', {
      fallbackOrder: ['openai', 'gemini', 'claude'],
    });
  });

  it('applies an AI goal decomposition in one transaction and audits it', async () => {
    const clientQueryMock = vi.fn(async (text: string, params?: any[]) => {
      if (text.includes('INSERT INTO goals')) {
        if (params?.[2] === 'Launch the partner program') {
          return { rows: [{ id: 'goal-db-root' }], rowCount: 1 };
        }
        if (params?.[2] === 'Define the launch scope') {
          expect(params?.[1]).toBe('goal-db-root');
          return { rows: [{ id: 'goal-db-child-1' }], rowCount: 1 };
        }
        if (params?.[2] === 'Prepare onboarding motion') {
          expect(params?.[1]).toBe('goal-db-root');
          return { rows: [{ id: 'goal-db-child-2' }], rowCount: 1 };
        }
      }

      if (text.includes('INSERT INTO tasks')) {
        expect(params?.[1]).toBe('goal-db-child-1');
        expect(params?.[2]).toBe('Starter: Define the launch scope');
        expect(params?.[4]).toBe('11111111-1111-4111-8111-111111111111');
        expect(params?.[5]).toBe(80);
        expect(params?.[6]).toBe('assigned');
        return { rows: [{ id: 'task-db-1' }], rowCount: 1 };
      }

      throw new Error(`Unexpected transaction query: ${text}`);
    });

    dbMock.transaction.mockImplementation(
      async (
        fn: (client: { query: typeof clientQueryMock }) => Promise<unknown>
      ) => fn({ query: clientQueryMock } as never)
    );
    dbMock.query.mockImplementation(async (text: string, params?: any[]) => {
      if (text.includes(`'goal.decomposition_applied'`)) {
        expect(params?.[0]).toBe('company-1');
        expect(params?.[1]).toBe('goal-db-root');
        const details = JSON.parse(String(params?.[2]));
        expect(details.created_goal_count).toBe(3);
        expect(details.created_goal_ids).toEqual([
          'goal-db-root',
          'goal-db-child-1',
          'goal-db-child-2',
        ]);
        expect(details.created_task_count).toBe(1);
        expect(details.created_task_ids).toEqual(['task-db-1']);
        return { rows: [], rowCount: 1 };
      }

      if (text.includes('SELECT id')) {
        return {
          rows: [{ id: '11111111-1111-4111-8111-111111111111' }],
        };
      }

      throw new Error(`Unexpected query: ${text}`);
    });

    const response = await fetch(`${baseUrl}/ai-decompose/apply`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        suggestion: {
          title: 'Launch the partner program',
          description:
            'Coordinate the partner launch with clear sequencing and ownership.',
          goals: [
            {
              ref: 'goal-root',
              parent_ref: null,
              title: 'Launch the partner program',
              description:
                'Coordinate the partner launch with clear sequencing and ownership.',
              status: 'active',
            },
            {
              ref: 'goal-ops',
              parent_ref: 'goal-root',
              title: 'Define the launch scope',
              description: 'Lock the target segment, offer, and timing.',
              status: 'active',
            },
            {
              ref: 'goal-onboarding',
              parent_ref: 'goal-root',
              title: 'Prepare onboarding motion',
              description:
                'Document the path from signed partner to activated partner.',
              status: 'active',
            },
          ],
          starter_tasks: [
            {
              ref: 'task-1',
              goal_ref: 'goal-ops',
              title: 'Starter: Define the launch scope',
              description:
                'Write the first scope draft and list open launch decisions.',
              priority: 80,
              suggested_agent_id: '11111111-1111-4111-8111-111111111111',
              suggested_agent_name: 'Mina',
            },
          ],
          confidence: 'high',
          warnings: [],
        },
      }),
    });

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      root_goal_id: 'goal-db-root',
      created_goal_ids: ['goal-db-root', 'goal-db-child-1', 'goal-db-child-2'],
      created_goal_count: 3,
      created_task_ids: ['task-db-1'],
      created_task_count: 1,
    });
  });
});
