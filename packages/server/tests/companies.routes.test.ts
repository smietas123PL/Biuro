import express from 'express';
import { createServer, type Server } from 'http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const dbMock = vi.hoisted(() => ({
  query: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock('../src/db/client.js', () => ({
  db: dbMock,
}));

vi.mock('../src/middleware/auth.js', () => ({
  requireAuth:
    () =>
    (
      _req: express.Request,
      _res: express.Response,
      next: express.NextFunction
    ) =>
      next(),
  requireRole:
    () =>
    (
      _req: express.Request,
      _res: express.Response,
      next: express.NextFunction
    ) => {
      (_req as express.Request & { user?: { id: string } }).user = {
        id: 'user-1',
      };
      next();
    },
}));

import companiesRouter from '../src/routes/companies.js';

describe('companies settings routes', () => {
  let server: Server;
  let baseUrl: string;

  beforeEach(async () => {
    dbMock.query.mockReset();
    dbMock.transaction.mockReset();
    dbMock.transaction.mockImplementation(
      async (fn: (client: { query: typeof dbMock.query }) => unknown) =>
        fn({ query: dbMock.query })
    );

    const app = express();
    app.use(express.json());
    app.use('/api/companies', companiesRouter);

    server = createServer(app);
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve());
    });

    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Expected server to listen on a TCP port');
    }

    baseUrl = `http://127.0.0.1:${address.port}/api/companies/company-1`;
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

  it('returns company runtime settings with defaults applied', async () => {
    dbMock.query.mockResolvedValueOnce({
      rows: [
        {
          id: 'company-1',
          name: 'QA Test Corp',
          config: {
            llm_primary_runtime: 'claude',
            llm_fallback_order: ['claude', 'openai'],
          },
        },
      ],
    });

    const response = await fetch(`${baseUrl}/runtime-settings`);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toMatchObject({
      company_id: 'company-1',
      company_name: 'QA Test Corp',
      primary_runtime: 'claude',
      fallback_order: ['claude', 'openai', 'gemini'],
      available_runtimes: ['gemini', 'claude', 'openai'],
    });
  });

  it('updates company runtime settings and records an audit event', async () => {
    dbMock.query
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'company-1',
            name: 'QA Test Corp',
            config: {
              llm_primary_runtime: 'gemini',
              llm_fallback_order: ['gemini', 'claude', 'openai'],
            },
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'company-1',
            name: 'QA Test Corp',
            config: {
              llm_primary_runtime: 'openai',
              llm_fallback_order: ['openai', 'gemini', 'claude'],
            },
          },
        ],
      })
      .mockResolvedValueOnce({ rowCount: 1, rows: [] });

    const response = await fetch(`${baseUrl}/runtime-settings`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        primary_runtime: 'openai',
        fallback_order: ['openai', 'gemini', 'claude'],
      }),
    });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toMatchObject({
      primary_runtime: 'openai',
      fallback_order: ['openai', 'gemini', 'claude'],
    });
    expect(dbMock.query).toHaveBeenNthCalledWith(
      2,
      'UPDATE companies SET config = $2 WHERE id = $1 RETURNING id, name, config',
      [
        'company-1',
        JSON.stringify({
          llm_primary_runtime: 'openai',
          llm_fallback_order: ['openai', 'gemini', 'claude'],
        }),
      ]
    );
    expect(dbMock.query).toHaveBeenNthCalledWith(
      3,
      `INSERT INTO audit_log (company_id, action, entity_type, entity_id, details)
         VALUES ($1, 'company.runtime_settings_updated', 'company', $1, $2)`,
      [
        'company-1',
        JSON.stringify({
          primary_runtime: 'openai',
          fallback_order: ['openai', 'gemini', 'claude'],
          updated_by: 'user-1',
        }),
      ]
    );
  });

  it('returns company digest settings with defaults applied', async () => {
    dbMock.query.mockResolvedValueOnce({
      rows: [
        {
          id: 'company-1',
          name: 'QA Test Corp',
          config: {
            daily_digest_enabled: false,
            daily_digest_hour_utc: 20,
            daily_digest_minute_utc: 15,
          },
        },
      ],
    });

    const response = await fetch(`${baseUrl}/digest-settings`);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toMatchObject({
      company_id: 'company-1',
      company_name: 'QA Test Corp',
      enabled: false,
      hour_utc: 20,
      minute_utc: 15,
    });
  });

  it('updates company digest settings and records an audit event', async () => {
    dbMock.query
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'company-1',
            name: 'QA Test Corp',
            config: {
              llm_primary_runtime: 'gemini',
              daily_digest_enabled: true,
              daily_digest_hour_utc: 18,
              daily_digest_minute_utc: 0,
            },
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'company-1',
            name: 'QA Test Corp',
            config: {
              llm_primary_runtime: 'gemini',
              daily_digest_enabled: false,
              daily_digest_hour_utc: 19,
              daily_digest_minute_utc: 15,
            },
          },
        ],
      })
      .mockResolvedValueOnce({ rowCount: 1, rows: [] });

    const response = await fetch(`${baseUrl}/digest-settings`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        enabled: false,
        hour_utc: 19,
        minute_utc: 15,
      }),
    });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toMatchObject({
      enabled: false,
      hour_utc: 19,
      minute_utc: 15,
    });
    expect(dbMock.query).toHaveBeenNthCalledWith(
      2,
      'UPDATE companies SET config = $2 WHERE id = $1 RETURNING id, name, config',
      [
        'company-1',
        JSON.stringify({
          llm_primary_runtime: 'gemini',
          daily_digest_enabled: false,
          daily_digest_hour_utc: 19,
          daily_digest_minute_utc: 15,
        }),
      ]
    );
    expect(dbMock.query).toHaveBeenNthCalledWith(
      3,
      `INSERT INTO audit_log (company_id, action, entity_type, entity_id, details)
         VALUES ($1, 'company.digest_settings_updated', 'company', $1, $2)`,
      [
        'company-1',
        JSON.stringify({
          enabled: false,
          hour_utc: 19,
          minute_utc: 15,
          updated_by: 'user-1',
        }),
      ]
    );
  });

  it('returns memory insights with recurring lessons and reuse signals', async () => {
    dbMock.query
      .mockResolvedValueOnce({
        rows: [
          {
            total_memories: 12,
            recent_memories: 4,
            agents_with_memories: 2,
            tasks_with_memories: 3,
            memory_reuse_searches: 5,
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            agent_id: 'agent-1',
            agent_name: 'Ada',
            total_memories: 3,
            latest_memory_at: '2026-03-19T08:40:00.000Z',
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'mem-1',
            content:
              'Customer churn spikes when onboarding steps are hidden from the sidebar.',
            created_at: '2026-03-19T08:40:00.000Z',
            agent_id: 'agent-1',
            agent_name: 'Ada',
            task_id: 'task-1',
            task_title: 'Audit onboarding',
          },
          {
            id: 'mem-2',
            content:
              'Customer churn drops when onboarding steps are visible and progress is explicit.',
            created_at: '2026-03-18T08:40:00.000Z',
            agent_id: 'agent-1',
            agent_name: 'Ada',
            task_id: 'task-2',
            task_title: 'Rewrite onboarding',
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            query: 'onboarding churn',
            total: 3,
          },
        ],
      });

    const response = await fetch(`${baseUrl}/memory-insights?days=30`);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toMatchObject({
      range_days: 30,
      summary: {
        total_memories: 12,
        recent_memories: 4,
        agents_with_memories: 2,
        tasks_with_memories: 3,
        memory_reuse_searches: 5,
      },
      top_agents: [
        {
          agent_id: 'agent-1',
          agent_name: 'Ada',
          total_memories: 3,
        },
      ],
      revisited_queries: [
        {
          query: 'onboarding churn',
          total: 3,
        },
      ],
    });
    expect(data.recent_lessons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'mem-1',
          agent_id: 'agent-1',
          task_id: 'task-1',
          task_title: 'Audit onboarding',
        }),
      ])
    );
    expect(data.recurring_topics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: 'customer churn',
          count: 2,
        }),
      ])
    );
  });
});
