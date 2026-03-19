import express from 'express';
import { createServer, type Server } from 'http';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { metricsHandler, observabilityMiddleware } from '../src/observability/http.js';
import observabilityRouter from '../src/routes/observability.js';
import { initializeTracing, startActiveSpan } from '../src/observability/tracing.js';

vi.mock('../src/middleware/auth.js', () => ({
  requireRole: () => (_req: express.Request, _res: express.Response, next: express.NextFunction) => next(),
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
    const app = express();
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
    await startActiveSpan(spanName, { 'test.case': 'recent-traces' }, async () => 'ok');

    const response = await fetch(`${baseUrl}/api/observability/traces/recent?limit=10`);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.service).toBeTruthy();
    expect(Array.isArray(payload.items)).toBe(true);
    expect(payload.items.some((item: { name: string }) => item.name === spanName)).toBe(true);
  });

  it('returns a trace drilldown grouped by trace id', async () => {
    let traceId = '';
    await startActiveSpan(`trace.parent.${Date.now()}`, { 'test.case': 'trace-detail' }, async (span) => {
      traceId = span.spanContext().traceId;
      span.addEvent('parent-started');
      return 'ok';
    });

    const response = await fetch(`${baseUrl}/api/observability/traces/${traceId}`);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.trace_id).toBe(traceId);
    expect(payload.summary.span_count).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(payload.items)).toBe(true);
    expect(payload.items[0].trace_id).toBe(traceId);
  });
});
