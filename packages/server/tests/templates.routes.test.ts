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
  requireRole: () => (_req: express.Request, _res: express.Response, next: express.NextFunction) => next(),
}));

import templatesRouter from '../src/routes/templates.js';

describe('template routes', () => {
  let server: Server;
  let baseUrl: string;

  beforeEach(async () => {
    dbMock.query.mockReset();
    dbMock.transaction.mockReset();

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

  it('falls back to the default runtime when importing a template with an unknown runtime', async () => {
    const clientQueryMock = vi.fn(async (text: string, params?: any[]) => {
      if (text === 'SELECT name, mission FROM companies WHERE id = $1') {
        return {
          rows: [{ name: 'Current Company', mission: 'Current mission' }],
        };
      }

      if (text === 'UPDATE companies SET name = $1, mission = $2 WHERE id = $3') {
        expect(params).toEqual(['Future Corp', 'Import templates safely', 'company-1']);
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

    dbMock.transaction.mockImplementation(async (fn: (client: { query: typeof clientQueryMock }) => Promise<unknown>) =>
      fn({
        query: clientQueryMock,
      } as never)
    );
    dbMock.query.mockResolvedValue({ rows: [], rowCount: 1 });

    const response = await fetch(`${baseUrl}/import`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-company-id': 'company-1',
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
    expect(String(dbMock.query.mock.calls[0]?.[0])).toContain('template.imported');
    expect(JSON.parse(String(dbMock.query.mock.calls[0]?.[1]?.[1]))).toMatchObject({
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
});
