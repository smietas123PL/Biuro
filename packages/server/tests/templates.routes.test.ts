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
      _req: express.Request & {
        user?: { id: string; companyId?: string; role?: string };
      },
      _res: express.Response,
      next: express.NextFunction
    ) => {
      const testCompanyIdHeader = _req.headers['x-test-company-id'];
      _req.user = {
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

vi.mock('../src/runtime/registry.js', () => ({
  runtimeRegistry: {
    getRuntime: getRuntimeMock,
  },
}));

import templatesRouter from '../src/routes/templates.js';

describe('template routes', () => {
  let server: Server;
  let baseUrl: string;

  beforeEach(async () => {
    dbMock.query.mockReset();
    dbMock.transaction.mockReset();
    runtimeExecuteMock.mockReset();
    getRuntimeMock.mockClear();

    const app = express();
    app.use(express.json());
    app.use('/api/templates', templatesRouter);

    server = createServer(app);
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve());
    });

    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Expected server to listen on a TCP port');
    }

    baseUrl = `http://127.0.0.1:${address.port}/api/templates`;
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
        'x-test-company-id': 'company-1',
        ...(init?.headers ?? {}),
      },
    });
  }

  it('falls back to the default runtime when importing a template with an unknown runtime', async () => {
    const clientQueryMock = vi.fn(async (text: string, params?: any[]) => {
      if (text === 'SELECT name, mission FROM companies WHERE id = $1') {
        return {
          rows: [{ name: 'Current Company', mission: 'Current mission' }],
        };
      }

      if (
        text === 'UPDATE companies SET name = $1, mission = $2 WHERE id = $3'
      ) {
        expect(params).toEqual([
          'Future Corp',
          'Import templates safely',
          'company-1',
        ]);
        return { rows: [], rowCount: 1 };
      }

      if (text.includes('INSERT INTO agents')) {
        expect(params).toEqual([
          'company-1',
          'Nova',
          'operator',
          null,
          'gemini',
          null,
          null,
          '{}',
          10,
        ]);
        return {
          rows: [{ id: 'agent-1' }],
        };
      }

      if (text.includes('INSERT INTO budgets')) {
        expect(params).toEqual(['agent-1', 10, 0]);
        return { rows: [], rowCount: 1 };
      }

      throw new Error(`Unexpected transaction query: ${text}`);
    });

    dbMock.transaction.mockImplementation(
      async (
        fn: (client: { query: typeof clientQueryMock }) => Promise<unknown>
      ) =>
        fn({
          query: clientQueryMock,
        } as never)
    );
    dbMock.query.mockResolvedValue({ rows: [], rowCount: 1 });

    const response = await fetchWithCompany(`${baseUrl}/import`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        version: '1.1',
        company: {
          name: 'Future Corp',
          mission: 'Import templates safely',
        },
        roles: ['owner'],
        goals: [],
        policies: [],
        tools: [],
        agents: [
          {
            ref: 'agent-1',
            name: 'Nova',
            role: 'operator',
            runtime: 'future-runtime-v2',
            monthly_budget_usd: 10,
            tools: [],
          },
        ],
        budgets: [],
      }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      success: true,
      goalsImported: 0,
      toolsImported: 0,
      policiesImported: 0,
      agentsImported: 1,
      budgetsImported: 1,
    });

    expect(dbMock.transaction).toHaveBeenCalledTimes(1);
    expect(clientQueryMock).toHaveBeenCalled();
    expect(dbMock.query).toHaveBeenCalledTimes(1);
    expect(String(dbMock.query.mock.calls[0]?.[0])).toContain(
      'template.imported'
    );
    expect(
      JSON.parse(String(dbMock.query.mock.calls[0]?.[1]?.[1]))
    ).toMatchObject({
      source: 'custom',
      template_version: '1.1',
      preserve_company_identity: false,
      changes: {
        success: true,
        agentsImported: 1,
        budgetsImported: 1,
      },
    });
  });

  it('generates an AI template suggestion and writes an audit entry', async () => {
    runtimeExecuteMock.mockResolvedValue({
      thought: JSON.stringify({
        title: 'Review competitor pricing changes',
        description:
          'Inspect recent competitor pricing updates and summarize any meaningful shifts for the team.',
        priority: 72,
        default_role: 'researcher',
        suggested_agent_id: '11111111-1111-4111-8111-111111111111',
        suggested_agent_name: 'Mina',
        confidence: 'high',
        warnings: [],
      }),
      actions: [
        {
          type: 'continue',
          thought: 'done',
        },
      ],
      routing: {
        selected_runtime: 'claude',
        selected_model: 'claude-sonnet',
        attempts: [
          {
            runtime: 'claude',
            model: 'claude-sonnet',
            status: 'success',
          },
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
              mission: 'Ship reliable software',
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
              role: 'researcher',
              title: 'Research Analyst',
              status: 'idle',
            },
          ],
        };
      }

      if (text.includes(`'template.ai_suggested'`)) {
        expect(params?.[0]).toBe('company-1');
        const details = JSON.parse(String(params?.[1]));
        expect(details.prompt).toContain('konkurencja');
        expect(details.planner).toMatchObject({
          mode: 'llm',
          runtime: 'claude',
          model: 'claude-sonnet',
        });
        expect(details.suggestion).toMatchObject({
          title: 'Review competitor pricing changes',
          suggested_agent_name: 'Mina',
        });
        return { rows: [], rowCount: 1 };
      }

      throw new Error(`Unexpected query: ${text}`);
    });

    const response = await fetchWithCompany(`${baseUrl}/ai-suggest`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        prompt:
          'sprawdz czy konkurencja obniżyła ceny i przygotuj krótkie podsumowanie',
      }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      suggestion: {
        title: 'Review competitor pricing changes',
        suggested_agent_name: 'Mina',
        priority: 72,
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

  it('rejects template AI suggestions without company context', async () => {
    const response = await fetch(`${baseUrl}/ai-suggest`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        prompt: 'review competitor pricing changes',
      }),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: 'Missing company ID',
    });
    expect(dbMock.query).not.toHaveBeenCalled();
  });
});
