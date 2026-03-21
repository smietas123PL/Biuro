import express from 'express';
import { createServer, type Server } from 'http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const dbMock = vi.hoisted(() => ({
  query: vi.fn(),
}));
const runtimeExecuteMock = vi.hoisted(() => vi.fn());
const getRuntimeMock = vi.hoisted(() =>
  vi.fn(() => ({ execute: runtimeExecuteMock }))
);
const enqueueCompanyWakeupMock = vi.hoisted(() => vi.fn());

vi.mock('../src/db/client.js', () => ({
  db: dbMock,
}));

vi.mock('../src/orchestrator/schedulerQueue.js', () => ({
  enqueueCompanyWakeup: enqueueCompanyWakeupMock,
}));

vi.mock('../src/middleware/auth.js', () => ({
  requireRole:
    () =>
    (
      req: express.Request & {
        user?: { id: string; companyId: string; role: string };
      },
      _res: express.Response,
      next: express.NextFunction
    ) => {
      req.user = {
        id: 'user-1',
        companyId: 'company-1',
        role: 'owner',
      };
      next();
    },
}));

vi.mock('../src/runtime/registry.js', () => ({
  runtimeRegistry: {
    getRuntime: getRuntimeMock,
  },
}));

import agentsRouter from '../src/routes/agents.js';

describe('agent failure explanation route', () => {
  let server: Server;
  let baseUrl: string;

  beforeEach(async () => {
    dbMock.query.mockReset();
    runtimeExecuteMock.mockReset();
    getRuntimeMock.mockClear();
    enqueueCompanyWakeupMock.mockReset();

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

  it('explains a failure event with LLM output and writes an audit entry', async () => {
    runtimeExecuteMock.mockResolvedValue({
      thought: JSON.stringify({
        headline: 'Provider timeout during launch note generation',
        summary:
          'The agent reached a heartbeat error because the model call timed out after fallback routing was exhausted.',
        likely_cause:
          'Both provider attempts failed, so the heartbeat could not complete the drafting step.',
        evidence: [
          'heartbeat.error fired on Prepare launch notes',
          'openai/gpt-4o failed with timeout',
        ],
        recommended_actions: [
          'Retry with a smaller prompt or a faster model.',
          'Replay from the last stable event after provider health recovers.',
        ],
        severity: 'high',
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
      if (
        text ===
        'SELECT id, company_id, name, role, status FROM agents WHERE id = $1 AND company_id = $2'
      ) {
        expect(params).toEqual(['agent-1', 'company-1']);
        return {
          rows: [
            {
              id: 'agent-1',
              company_id: 'company-1',
              name: 'Ada',
              role: 'Research Lead',
              status: 'active',
            },
          ],
        };
      }

      if (text.includes('FROM heartbeats h')) {
        return {
          rows: [
            {
              id: 'hb-1',
              task_id: 'task-2',
              task_title: 'Prepare launch notes',
              status: 'error',
              duration_ms: 5100,
              cost_usd: '0.00',
              details: {
                error: 'Anthropic timeout',
                llm_routing: {
                  attempts: [
                    {
                      runtime: 'openai',
                      model: 'gpt-4o',
                      status: 'failed',
                      reason: 'timeout',
                    },
                    {
                      runtime: 'claude',
                      model: 'claude-sonnet',
                      status: 'failed',
                      reason: 'timeout',
                    },
                  ],
                },
              },
              created_at: '2026-03-18T10:06:00.000Z',
            },
          ],
        };
      }

      if (
        text.includes('FROM audit_log') &&
        text.includes('WHERE agent_id = $1')
      ) {
        return { rows: [] };
      }

      if (text.includes('FROM messages m')) {
        return { rows: [] };
      }

      if (text.includes('FROM agent_sessions s')) {
        return { rows: [] };
      }

      if (text.includes('FROM companies')) {
        expect(params).toEqual(['company-1']);
        return {
          rows: [
            {
              id: 'company-1',
              name: 'QA Test Corp',
              mission: 'Ship reliable software',
              config: {
                llm_primary_runtime: 'claude',
                llm_fallback_order: ['openai', 'gemini'],
              },
            },
          ],
        };
      }

      if (text.includes(`'agent.failure_explained'`)) {
        expect(params?.[0]).toBe('company-1');
        expect(params?.[1]).toBe('agent-1');
        const details = JSON.parse(String(params?.[2]));
        expect(details).toMatchObject({
          event_id: 'heartbeat:hb-1',
          severity: 'high',
          headline: 'Provider timeout during launch note generation',
        });
        return { rows: [], rowCount: 1 };
      }

      throw new Error(`Unexpected query: ${text}`);
    });

    const response = await fetch(`${baseUrl}/agent-1/failure-explanation`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        task_id: 'task-2',
        types: ['heartbeat'],
      }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      target_event: {
        id: 'heartbeat:hb-1',
        action: 'heartbeat.error',
        task_title: 'Prepare launch notes',
      },
      explanation: {
        headline: 'Provider timeout during launch note generation',
        severity: 'high',
      },
      planner: {
        mode: 'llm',
        runtime: 'claude',
      },
    });
  });

  it('falls back to a heuristic explanation when the LLM response is invalid', async () => {
    runtimeExecuteMock.mockResolvedValue({
      thought: 'this is not valid JSON',
      actions: [{ type: 'continue', thought: 'still not json' }],
      routing: {
        selected_runtime: 'claude',
        selected_model: 'claude-sonnet',
        attempts: [
          { runtime: 'claude', model: 'claude-sonnet', status: 'success' },
        ],
      },
    });

    dbMock.query.mockImplementation(async (text: string) => {
      if (
        text ===
        'SELECT id, company_id, name, role, status FROM agents WHERE id = $1 AND company_id = $2'
      ) {
        return {
          rows: [
            {
              id: 'agent-1',
              company_id: 'company-1',
              name: 'Ada',
              role: 'Research Lead',
              status: 'active',
            },
          ],
        };
      }

      if (text.includes('FROM heartbeats h')) {
        return {
          rows: [
            {
              id: 'hb-1',
              task_id: 'task-2',
              task_title: 'Prepare launch notes',
              status: 'error',
              duration_ms: 5100,
              cost_usd: '0.00',
              details: {
                error: 'Anthropic timeout',
              },
              created_at: '2026-03-18T10:06:00.000Z',
            },
          ],
        };
      }

      if (
        text.includes('FROM audit_log') &&
        text.includes('WHERE agent_id = $1')
      ) {
        return { rows: [] };
      }

      if (text.includes('FROM messages m')) {
        return { rows: [] };
      }

      if (text.includes('FROM agent_sessions s')) {
        return { rows: [] };
      }

      if (text.includes('FROM companies')) {
        return {
          rows: [
            {
              id: 'company-1',
              name: 'QA Test Corp',
              mission: 'Ship reliable software',
              config: {
                llm_primary_runtime: 'claude',
                llm_fallback_order: ['openai', 'gemini'],
              },
            },
          ],
        };
      }

      if (text.includes(`'agent.failure_explained'`)) {
        return { rows: [], rowCount: 1 };
      }

      throw new Error(`Unexpected query: ${text}`);
    });

    const response = await fetch(`${baseUrl}/agent-1/failure-explanation`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        task_id: 'task-2',
        types: ['heartbeat'],
      }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      explanation: {
        headline: 'Failure in Prepare launch notes',
        severity: 'high',
      },
      planner: {
        mode: 'rules',
        fallback_reason: 'invalid_llm_output',
      },
    });
  });

  it('returns 404 when no failure event exists in the replay scope', async () => {
    dbMock.query.mockImplementation(async (text: string) => {
      if (
        text ===
        'SELECT id, company_id, name, role, status FROM agents WHERE id = $1 AND company_id = $2'
      ) {
        return {
          rows: [
            {
              id: 'agent-1',
              company_id: 'company-1',
              name: 'Ada',
              role: 'Research Lead',
              status: 'active',
            },
          ],
        };
      }

      if (text.includes('FROM heartbeats h')) {
        return {
          rows: [
            {
              id: 'hb-1',
              task_id: 'task-2',
              task_title: 'Prepare launch notes',
              status: 'worked',
              duration_ms: 1200,
              cost_usd: '0.05',
              details: {},
              created_at: '2026-03-18T10:06:00.000Z',
            },
          ],
        };
      }

      if (
        text.includes('FROM audit_log') &&
        text.includes('WHERE agent_id = $1')
      ) {
        return { rows: [] };
      }

      if (text.includes('FROM messages m')) {
        return { rows: [] };
      }

      if (text.includes('FROM agent_sessions s')) {
        return { rows: [] };
      }

      throw new Error(`Unexpected query: ${text}`);
    });

    const response = await fetch(`${baseUrl}/agent-1/failure-explanation`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        task_id: 'task-2',
        types: ['heartbeat'],
      }),
    });

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: 'No failure event found in the current replay scope',
    });
  });
});
