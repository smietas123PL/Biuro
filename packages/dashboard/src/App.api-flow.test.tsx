import { createServer, type IncomingMessage, type ServerResponse } from 'http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import App from './App';
import { AuthProvider } from './context/AuthContext';
import { CompanyProvider } from './context/CompanyContext';
import { AUTH_TOKEN_KEY, COMPANY_STORAGE_KEY } from './lib/session';

type CapturedRequest = {
  method: string;
  url: string;
  headers: IncomingMessage['headers'];
  body: unknown;
};

type TestApiServer = {
  baseUrl: string;
  requests: CapturedRequest[];
  close: () => Promise<void>;
};

class FakeWebSocket {
  url: string;
  onmessage: ((event: MessageEvent) => void) | null = null;

  constructor(url: string) {
    this.url = url;
  }

  close() {
    return undefined;
  }
}

function json(res: ServerResponse, statusCode: number, payload: unknown) {
  res.writeHead(statusCode, { 'content-type': 'application/json' });
  res.end(JSON.stringify(payload));
}

async function readJsonBody(req: IncomingMessage) {
  const chunks: Buffer[] = [];

  for await (const chunk of req) {
    chunks.push(Buffer.from(chunk));
  }

  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : null;
}

async function startTestApiServer(): Promise<TestApiServer> {
  const requests: CapturedRequest[] = [];

  const server = createServer(async (req, res) => {
    const method = req.method ?? 'GET';
    const url = req.url ?? '/';
    const body = await readJsonBody(req);

    requests.push({
      method,
      url,
      headers: req.headers,
      body,
    });

    if (method === 'POST' && url === '/api/auth/login') {
      json(res, 200, {
        token: 'token-123',
        user: {
          id: 'user-1',
          email: 'ada@example.com',
          full_name: 'Ada Lovelace',
        },
      });
      return;
    }

    if (method === 'GET' && url === '/api/auth/me') {
      json(res, 200, {
        token: 'token-123',
        user: {
          id: 'user-1',
          email: 'ada@example.com',
          full_name: 'Ada Lovelace',
        },
        companies: [
          {
            id: 'company-1',
            name: 'QA Test Corp',
            role: 'owner',
          },
        ],
      });
      return;
    }

    if (method === 'GET' && url === '/api/companies') {
      json(res, 200, [
        {
          id: 'company-1',
          name: 'QA Test Corp',
          role: 'owner',
        },
      ]);
      return;
    }

    if (method === 'GET' && url === '/api/companies/company-1/stats') {
      res.writeHead(200, {
        'content-type': 'application/json',
      });
      res.end(
        JSON.stringify({
          agent_count: 3,
          active_agents: 1,
          idle_agents: 2,
          paused_agents: 0,
          task_count: 7,
          pending_tasks: 2,
          completed_tasks: 5,
          blocked_tasks: 0,
          goal_count: 2,
          pending_approvals: 1,
          daily_cost_usd: 1.2345,
        })
      );
      return;
    }

    if (method === 'GET' && url === '/api/companies/company-1/activity-feed?limit=12') {
      json(res, 200, []);
      return;
    }

    if (method === 'GET' && url === '/api/companies/company-1/retrieval-metrics?days=7') {
      json(res, 200, {
        range_days: 7,
        totals: {
          searches: 0,
          knowledge_searches: 0,
          memory_searches: 0,
          avg_latency_ms: 0,
          avg_result_count: 0,
          avg_overlap_count: 0,
          zero_result_rate_pct: 0,
        },
        by_source: [],
        by_consumer: [],
        recent: [],
      });
      return;
    }

    if (method === 'GET' && url === '/api/companies/company-1/memory-insights?days=30') {
      json(res, 200, {
        range_days: 30,
        summary: {
          total_memories: 0,
          recent_memories: 0,
          agents_with_memories: 0,
          tasks_with_memories: 0,
          memory_reuse_searches: 0,
        },
        recurring_topics: [],
        top_agents: [],
        revisited_queries: [],
        recent_lessons: [],
      });
      return;
    }

    if (method === 'GET' && url === '/api/companies/company-1/budgets-summary') {
      json(res, 200, {
        totals: {
          limit_usd: 10,
          spent_usd: 1.23,
          remaining_usd: 8.77,
          utilization_pct: 12.3,
        },
      });
      return;
    }

    json(res, 404, { error: `Unhandled route: ${method} ${url}` });
  });

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve());
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Expected test API server to listen on a TCP port');
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    requests,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => {
          if (err) {
            reject(err);
            return;
          }
          resolve();
        });
      }),
  };
}

describe('App API-backed auth flow', () => {
  let apiServer: TestApiServer;
  let nativeFetch: typeof fetch;

  beforeEach(async () => {
    apiServer = await startTestApiServer();
    nativeFetch = globalThis.fetch;

    vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
      const rawUrl =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;
      const resolvedUrl = rawUrl.startsWith('/')
        ? `${apiServer.baseUrl}${rawUrl}`
        : rawUrl;

      const { signal: _signal, ...restInit } = init ?? {};
      return nativeFetch(resolvedUrl, restInit);
    });
    vi.stubGlobal('WebSocket', FakeWebSocket as unknown as typeof WebSocket);
    window.history.replaceState({}, '', '/auth');
  });

  afterEach(async () => {
    await apiServer.close();
  });

  it('logs in through the auth screen and hydrates the dashboard from live API responses', async () => {
    const user = userEvent.setup();

    render(
      <MemoryRouter initialEntries={['/auth']}>
        <AuthProvider>
          <CompanyProvider>
            <App />
          </CompanyProvider>
        </AuthProvider>
      </MemoryRouter>
    );

    await user.type(screen.getByLabelText('Email'), 'ada@example.com');
    await user.type(screen.getByLabelText('Password'), 'password123');
    await user.click(screen.getAllByRole('button', { name: 'Log in' })[1]);

    await waitFor(() => {
      expect(screen.getByText('Overview')).toBeTruthy();
    });

    expect(screen.getByText('Ada Lovelace')).toBeTruthy();
    expect(screen.getByText('Live operating snapshot for QA Test Corp')).toBeTruthy();
    expect(screen.getByDisplayValue('QA Test Corp')).toBeTruthy();

    expect(localStorage.getItem(AUTH_TOKEN_KEY)).toBe('token-123');
    expect(localStorage.getItem(COMPANY_STORAGE_KEY)).toBe('company-1');

    const loginRequest = apiServer.requests.find((request) => request.method === 'POST' && request.url === '/api/auth/login');
    expect(loginRequest?.body).toEqual({
      email: 'ada@example.com',
      password: 'password123',
    });

    const companiesRequest = apiServer.requests.find((request) => request.method === 'GET' && request.url === '/api/companies');
    expect(companiesRequest?.headers.authorization).toBe('Bearer token-123');

    await waitFor(() => {
      expect(
        apiServer.requests.some(
          (request) => request.method === 'GET' && request.url === '/api/companies/company-1/stats'
        )
      ).toBe(true);
    });
  });
});
