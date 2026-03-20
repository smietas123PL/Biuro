import express from 'express';
import { createServer, type Server } from 'http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const dbMock = vi.hoisted(() => ({
  query: vi.fn(),
  transaction: vi.fn(),
}));

const executeStandaloneToolMock = vi.hoisted(() => vi.fn());

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

vi.mock('../src/tools/executor.js', () => ({
  executeStandaloneTool: executeStandaloneToolMock,
}));

import toolsRouter from '../src/routes/tools.js';

describe('tools routes', () => {
  let server: Server;
  let baseUrl: string;

  beforeEach(async () => {
    dbMock.query.mockReset();
    dbMock.transaction.mockReset();
    executeStandaloneToolMock.mockReset();
    dbMock.transaction.mockImplementation(
      async (fn: (client: { query: typeof dbMock.query }) => unknown) =>
        fn({ query: dbMock.query })
    );

    const app = express();
    app.use(express.json());
    app.use('/api/companies/:companyId/tools', toolsRouter);

    server = createServer(app);
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve());
    });

    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Expected server to listen on a TCP port');
    }

    baseUrl = `http://127.0.0.1:${address.port}/api/companies/company-1/tools`;
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

  it('returns tools with usage aggregates, assignments, and recent call history', async () => {
    dbMock.query
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'tool-1',
            company_id: 'company-1',
            name: 'web_search',
            description: 'Search current public information.',
            type: 'builtin',
            config: {},
            created_at: '2026-03-18T10:00:00.000Z',
            agent_count: 2,
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'call-2',
            tool_id: 'tool-1',
            task_id: 'task-2',
            agent_id: 'agent-1',
            input: { query: 'launch notes' },
            output: { error: 'timeout' },
            task_title: 'Prepare launch notes',
            agent_name: 'Ada',
            status: 'error',
            duration_ms: 1200,
            created_at: '2026-03-18T11:10:00.000Z',
          },
          {
            id: 'call-1',
            tool_id: 'tool-1',
            task_id: 'task-1',
            agent_id: 'agent-2',
            input: { query: 'pain points' },
            output: { results: [] },
            task_title: 'Research customer pain points',
            agent_name: 'Ben',
            status: 'success',
            duration_ms: 800,
            created_at: '2026-03-18T10:10:00.000Z',
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          { tool_id: 'tool-1', agent_id: 'agent-1', agent_name: 'Ada' },
          { tool_id: 'tool-1', agent_id: 'agent-2', agent_name: 'Ben' },
        ],
      });

    const response = await fetch(baseUrl);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject([
      {
        id: 'tool-1',
        name: 'web_search',
        agent_count: 2,
        assigned_agents: [
          { agent_id: 'agent-1', agent_name: 'Ada' },
          { agent_id: 'agent-2', agent_name: 'Ben' },
        ],
        usage: {
          total_calls: 2,
          success_count: 1,
          error_count: 1,
          last_called_at: '2026-03-18T11:10:00.000Z',
          last_status: 'error',
        },
        recent_calls: [
          {
            id: 'call-2',
            task_title: 'Prepare launch notes',
            agent_name: 'Ada',
            status: 'error',
          },
          {
            id: 'call-1',
            task_title: 'Research customer pain points',
            agent_name: 'Ben',
            status: 'success',
          },
        ],
      },
    ]);

    expect(dbMock.query).toHaveBeenCalledTimes(3);
  });

  it('rejects tool creation when body company_id does not match route company context', async () => {
    const response = await fetch(baseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        company_id: '22222222-2222-2222-2222-222222222222',
        name: 'web_search',
        type: 'builtin',
        config: { builtin: 'web_search' },
      }),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: 'Tool company_id must match the authenticated company context',
    });
    expect(dbMock.query).not.toHaveBeenCalled();
  });

  it('updates an existing tool', async () => {
    dbMock.query
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'tool-1',
            company_id: 'company-1',
            name: 'web_search',
            description: 'Old description',
            type: 'builtin',
            config: { builtin: 'web_search' },
            created_at: '2026-03-18T10:00:00.000Z',
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'tool-1',
            company_id: 'company-1',
            name: 'market_search',
            description: 'Updated description',
            type: 'builtin',
            config: {
              builtin: 'web_search',
              example_params: { query: 'market map' },
            },
          },
        ],
      });

    const response = await fetch(`${baseUrl}/tool-1`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'market_search',
        description: 'Updated description',
        config: {
          builtin: 'web_search',
          example_params: { query: 'market map' },
        },
      }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      id: 'tool-1',
      name: 'market_search',
      description: 'Updated description',
    });
    expect(String(dbMock.query.mock.calls[1]?.[0])).toContain('UPDATE tools');
  });

  it('runs a standalone tool test and returns the output', async () => {
    dbMock.query.mockResolvedValueOnce({
      rows: [
        {
          id: 'tool-1',
          company_id: 'company-1',
          name: 'web_search',
          description: 'Search current public information.',
          type: 'builtin',
          config: { builtin: 'web_search' },
        },
      ],
    });
    executeStandaloneToolMock.mockResolvedValueOnce({
      results: [{ title: 'Biuro' }],
    });

    const response = await fetch(`${baseUrl}/tool-1/test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input: { query: 'Biuro' } }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      tool_id: 'tool-1',
      output: { results: [{ title: 'Biuro' }] },
    });
    expect(executeStandaloneToolMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'tool-1', name: 'web_search' }),
      { query: 'Biuro' }
    );
  });

  it('returns upstream failure when tool test throws', async () => {
    dbMock.query.mockResolvedValueOnce({
      rows: [
        {
          id: 'tool-2',
          company_id: 'company-1',
          name: 'internal_api',
          description: 'Call internal API.',
          type: 'http',
          config: { url: 'https://api.internal.example.com' },
        },
      ],
    });
    const upstreamError = Object.assign(
      new Error('HTTP tool responded with status 503'),
      {
        output: { error: 'temporarily unavailable' },
        status: 503,
      }
    );
    executeStandaloneToolMock.mockRejectedValueOnce(upstreamError);

    const response = await fetch(`${baseUrl}/tool-2/test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input: { data: { ping: true } } }),
    });

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: 'HTTP tool responded with status 503',
      status: 503,
      output: { error: 'temporarily unavailable' },
    });
  });

  it('assigns and unassigns a tool for an agent in the same company', async () => {
    dbMock.query
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'tool-1',
            company_id: 'company-1',
            name: 'web_search',
            description: 'Search current public information.',
            type: 'builtin',
            config: {},
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [{ id: 'agent-1', name: 'Ada' }],
      })
      .mockResolvedValueOnce({ rows: [] });

    const assignResponse = await fetch(`${baseUrl}/tool-1/assign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agent_id: 'agent-1' }),
    });

    expect(assignResponse.status).toBe(201);
    await expect(assignResponse.json()).resolves.toMatchObject({
      ok: true,
      tool_id: 'tool-1',
      agent: { id: 'agent-1', name: 'Ada' },
    });

    dbMock.query.mockReset();
    dbMock.query
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'tool-1',
            company_id: 'company-1',
            name: 'web_search',
            description: 'Search current public information.',
            type: 'builtin',
            config: {},
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [{ id: 'agent-1' }],
      })
      .mockResolvedValueOnce({ rows: [] });

    const removeResponse = await fetch(`${baseUrl}/tool-1/assign/agent-1`, {
      method: 'DELETE',
    });

    expect(removeResponse.status).toBe(200);
    await expect(removeResponse.json()).resolves.toMatchObject({
      ok: true,
      tool_id: 'tool-1',
      agent_id: 'agent-1',
    });
  });

  it('seeds the default tools for a company', async () => {
    dbMock.query
      .mockResolvedValueOnce({
        rowCount: 1,
        rows: [{ id: 'tool-1', name: 'web_search' }],
      })
      .mockResolvedValueOnce({
        rowCount: 1,
        rows: [{ id: 'tool-2', name: 'file_write' }],
      })
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })
      .mockResolvedValueOnce({
        rowCount: 1,
        rows: [{ id: 'tool-5', name: 'shell_utils' }],
      });

    const response = await fetch(`${baseUrl}/seed`, { method: 'POST' });

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      inserted: ['web_search', 'file_write', 'shell_utils'],
      existing: ['webhook_notify', 'internal_api'],
      total_defaults: 5,
    });
    expect(dbMock.transaction).toHaveBeenCalledTimes(1);
  });

  it('deletes a tool and its dependent records', async () => {
    dbMock.query
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'tool-1',
            company_id: 'company-1',
            name: 'web_search',
            description: 'Search current public information.',
            type: 'builtin',
            config: {},
          },
        ],
      })
      .mockResolvedValue({ rows: [] });

    const response = await fetch(`${baseUrl}/tool-1`, { method: 'DELETE' });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      deleted_tool_id: 'tool-1',
    });
    expect(dbMock.transaction).toHaveBeenCalledTimes(1);
  });

  it('returns paginated tool call detail filtered by status and agent', async () => {
    dbMock.query
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'tool-1',
            company_id: 'company-1',
            name: 'web_search',
            description: 'Search current public information.',
            type: 'builtin',
            created_at: '2026-03-18T10:00:00.000Z',
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            total: 3,
            success_count: 0,
            error_count: 3,
            last_called_at: '2026-03-18T12:30:00.000Z',
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'call-9',
            task_id: 'task-9',
            agent_id: 'agent-1',
            input: { query: 'launch blockers' },
            output: { error: 'Provider timeout' },
            task_title: 'Prepare launch notes',
            agent_name: 'Ada',
            status: 'error',
            duration_ms: 2100,
            created_at: '2026-03-18T12:30:00.000Z',
          },
        ],
      });

    const response = await fetch(
      `${baseUrl}/tool-1/calls?status=error&agent_id=agent-1&page=2&limit=1`
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      tool: {
        id: 'tool-1',
        name: 'web_search',
        type: 'builtin',
      },
      filters: {
        status: 'error',
        agent_id: 'agent-1',
      },
      pagination: {
        page: 2,
        limit: 1,
        total: 3,
        total_pages: 3,
        has_more: true,
      },
      summary: {
        total_calls: 3,
        success_count: 0,
        error_count: 3,
        last_called_at: '2026-03-18T12:30:00.000Z',
      },
      items: [
        {
          id: 'call-9',
          task_id: 'task-9',
          agent_id: 'agent-1',
          task_title: 'Prepare launch notes',
          agent_name: 'Ada',
          status: 'error',
          input: { query: 'launch blockers' },
          output: { error: 'Provider timeout' },
        },
      ],
    });
  });
});
