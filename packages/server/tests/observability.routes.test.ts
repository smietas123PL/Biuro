import express from 'express';
import { createServer, type Server } from 'http';
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
const dbMock = vi.hoisted(() => ({
  query: vi.fn(),
}));
import {
  metricsHandler,
  observabilityMiddleware,
} from '../src/observability/http.js';
import observabilityRouter from '../src/routes/observability.js';
import {
  initializeTracing,
  startActiveSpan,
} from '../src/observability/tracing.js';

vi.mock('../src/db/client.js', () => ({
  db: dbMock,
}));

vi.mock('../src/middleware/auth.js', () => ({
  requireAuth:
    () =>
    (
      req: express.Request & {
        user?: { id: string; companyId?: string; role?: string };
      },
      _res: express.Response,
      next: express.NextFunction
    ) => {
      req.user = {
        id: 'user-1',
        companyId: '11111111-1111-1111-1111-111111111111',
        role: 'owner',
      };
      next();
    },
  requireRole:
    () =>
    (
      req: express.Request & {
        user?: { id: string; companyId?: string; role?: string };
      },
      _res: express.Response,
      next: express.NextFunction
    ) => {
      req.user = {
        id: 'user-1',
        companyId: '11111111-1111-1111-1111-111111111111',
        role: 'owner',
      };
      next();
    },
}));

describe('observability routes', () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(() => {
    initializeTracing({
      serviceName: 'biuro-test',
      historyLimit: 100,
    });
  });

  beforeEach(async () => {
    dbMock.query.mockReset();
    dbMock.query.mockResolvedValue({ rows: [] });

    const app = express();
    app.use(express.json());
    app.use(observabilityMiddleware);
    app.get('/metrics', metricsHandler);
    app.get('/api/demo', (_req, res) => {
      res.json({ ok: true });
    });
    app.use('/api/observability', observabilityRouter);

    server = createServer(app);
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve());
    });

    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Expected server to listen on a TCP port');
    }

    baseUrl = `http://127.0.0.1:${address.port}`;
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

  it('exposes Prometheus metrics on /metrics', async () => {
    const demoResponse = await fetch(`${baseUrl}/api/demo`);
    expect(demoResponse.status).toBe(200);

    const response = await fetch(`${baseUrl}/metrics`);
    const metricsText = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/plain');
    expect(metricsText).toContain('biuro_http_requests_total');
    expect(metricsText).toContain('biuro_http_request_duration_ms');
    expect(metricsText).toContain('biuro_heartbeat_runs_total');
  });

  it('returns recent spans from the in-memory OpenTelemetry exporter', async () => {
    const spanName = `test.operation.${Date.now()}`;
    await startActiveSpan(
      spanName,
      { 'test.case': 'recent-traces' },
      async () => 'ok'
    );

    const response = await fetch(
      `${baseUrl}/api/observability/traces/recent?limit=10`
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.service).toBeTruthy();
    expect(Array.isArray(payload.items)).toBe(true);
    expect(
      payload.items.some((item: { name: string }) => item.name === spanName)
    ).toBe(true);
  });

  it('returns a trace drilldown grouped by trace id', async () => {
    let traceId = '';
    await startActiveSpan(
      `trace.parent.${Date.now()}`,
      { 'test.case': 'trace-detail' },
      async (span) => {
        traceId = span.spanContext().traceId;
        span.addEvent('parent-started');
        return 'ok';
      }
    );

    const response = await fetch(
      `${baseUrl}/api/observability/traces/${traceId}`
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.trace_id).toBe(traceId);
    expect(payload.summary.span_count).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(payload.items)).toBe(true);
    expect(payload.items[0].trace_id).toBe(traceId);
  });

  it('accepts validated client-side observability events', async () => {
    const response = await fetch(`${baseUrl}/api/observability/client-events`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: 'onboarding_started',
        tutorial_version: 'v1',
        step_id: 'welcome',
        step_index: 0,
        total_steps: 6,
        route: '/dashboard',
        source: 'manual',
        occurred_at: '2026-03-20T08:00:00.000Z',
        metadata: {
          replay: false,
        },
      }),
    });

    expect(response.status).toBe(204);
  });

  it('returns recent heartbeat run summaries for the active company', async () => {
    dbMock.query.mockResolvedValueOnce({
      rows: [
        {
          id: 'heartbeat-1',
          agent_id: 'agent-1',
          agent_name: 'Ada',
          task_id: 'task-1',
          task_title: 'Investigate churn',
          status: 'worked',
          created_at: '2026-03-20T10:00:00.000Z',
          duration_ms: 1800,
          cost_usd: 0.42,
          details: {
            budget_capped: false,
            llm_routing: {
              selected_runtime: 'openai',
              selected_model: 'gpt-4o',
            },
            heartbeat_execution: {
              retrieval_budget: {
                max_requests: 2,
                consumed_requests: 2,
                skipped_requests: 1,
              },
              retrievals: [
                {
                  scope: 'memory',
                  consumer: 'heartbeat_memory',
                },
                {
                  scope: 'knowledge',
                  consumer: 'agent_context',
                },
              ],
              retrieval_fallback_count: 1,
              llm_fallback_count: 1,
            },
          },
        },
      ],
    });

    const response = await fetch(
      `${baseUrl}/api/observability/heartbeat-runs/recent?limit=5`
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.count).toBe(1);
    expect(payload.items[0]).toEqual({
      heartbeat_id: 'heartbeat-1',
      agent_id: 'agent-1',
      agent_name: 'Ada',
      task_id: 'task-1',
      task_title: 'Investigate churn',
      status: 'worked',
      created_at: '2026-03-20T10:00:00.000Z',
      duration_ms: 1800,
      cost_usd: 0.42,
      llm_selected_runtime: 'openai',
      llm_selected_model: 'gpt-4o',
      llm_fallback_count: 1,
      retrieval_count: 2,
      retrieval_fallback_count: 1,
      retrieval_skipped_count: 1,
      budget_capped: false,
    });
    expect(dbMock.query).toHaveBeenCalledWith(
      expect.stringContaining('FROM heartbeats h'),
      ['11111111-1111-1111-1111-111111111111', 5]
    );
  });
});
