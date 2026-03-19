import express from 'express';
import { createServer, type Server } from 'http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const dbMock = vi.hoisted(() => ({
  query: vi.fn(),
}));
const getRuntimeMock = vi.hoisted(() => vi.fn());

vi.mock('../src/db/client.js', () => ({
  db: dbMock,
}));

vi.mock('../src/runtime/registry.js', () => ({
  runtimeRegistry: {
    getRuntime: getRuntimeMock,
  },
}));

vi.mock('../src/middleware/auth.js', () => ({
  requireRole: () => (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    const companyId = req.headers['x-company-id'];
    const role = req.headers['x-test-role'];
    (req as express.Request & { user?: { id: string; companyId?: string; role?: string } }).user = {
      id: 'user-1',
      companyId: typeof companyId === 'string' ? companyId : undefined,
      role: typeof role === 'string' ? role : 'owner',
    };
    next();
  },
}));

import nlCommandRouter from '../src/routes/nlCommand.js';

describe('natural language command route', () => {
  let server: Server;
  let baseUrl: string;

  beforeEach(async () => {
    dbMock.query.mockReset();
    getRuntimeMock.mockReset();
    getRuntimeMock.mockImplementation(() => ({
      execute: vi.fn(async () => {
        throw new Error('LLM planner disabled in route tests');
      }),
    }));

    const app = express();
    app.use(express.json());
    app.use('/api/nl-command', nlCommandRouter);

    server = createServer(app);
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve());
    });

    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Expected server to listen on a TCP port');
    }

    baseUrl = `http://127.0.0.1:${address.port}/api/nl-command`;
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

  it('builds a pause-agent execution plan for an owner', async () => {
    dbMock.query
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'company-1',
            name: 'Acme Labs',
            mission: 'Ship safely',
            config: {},
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'agent-1',
            name: 'Ada',
            role: 'Research Lead',
            title: 'Lead Strategist',
            status: 'idle',
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [],
      });

    const response = await fetch(baseUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-company-id': 'company-1',
        'x-test-role': 'owner',
      },
      body: JSON.stringify({
        input: 'pause Ada',
      }),
    });

    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      can_execute: true,
      source: 'rules',
      planner: {
        mode: 'rules',
      },
      actions: [
        {
          type: 'api_request',
          endpoint: '/agents/agent-1/pause',
          method: 'POST',
        },
        {
          type: 'navigate',
          path: '/agents',
        },
      ],
    });
    const auditInsert = dbMock.query.mock.calls.find((call) =>
      String(call[0]).includes('nl_command.planned')
    );
    expect(auditInsert).toBeTruthy();
    expect(String(auditInsert?.[1]?.[1] ?? '')).toContain('"source":"rules"');
  });

  it('creates a task plan with assignee lookup for a member', async () => {
    dbMock.query.mockResolvedValueOnce({
      rows: [
        {
          id: 'company-1',
          name: 'Acme Labs',
          mission: 'Ship safely',
          config: {},
        },
      ],
    }).mockResolvedValueOnce({
      rows: [
        {
          id: 'agent-2',
          name: 'Ben',
          role: 'Operator',
          title: 'Delivery Manager',
          status: 'idle',
        },
      ],
    });

    const response = await fetch(baseUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-company-id': 'company-1',
        'x-test-role': 'member',
      },
      body: JSON.stringify({
        input: 'create task Prepare launch notes and assign to Ben',
      }),
    });

    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      can_execute: true,
      actions: [
        {
          type: 'api_request',
          endpoint: '/companies/company-1/tasks',
          method: 'POST',
          body: {
            title: 'Prepare launch notes',
            assigned_to: 'agent-2',
          },
        },
        {
          type: 'navigate',
          path: '/tasks',
        },
      ],
    });
  });

  it('refuses management actions for viewers and returns guidance', async () => {
    dbMock.query.mockResolvedValueOnce({
      rows: [
        {
          id: 'company-1',
          name: 'Acme Labs',
          mission: 'Ship safely',
          config: {},
        },
      ],
    }).mockResolvedValueOnce({
      rows: [
        {
          id: 'agent-1',
          name: 'Ada',
          role: 'Research Lead',
          title: 'Lead Strategist',
          status: 'idle',
        },
      ],
    });

    const response = await fetch(baseUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-company-id': 'company-1',
        'x-test-role': 'viewer',
      },
      body: JSON.stringify({
        input: 'pause Ada',
      }),
    });

    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.can_execute).toBe(false);
    expect(payload.actions).toEqual([]);
    expect(payload.warnings).toContain('Pausing agents requires owner or admin access.');
  });
});
