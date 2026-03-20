import crypto from 'node:crypto';
import { SpanStatusCode } from '@opentelemetry/api';
import type express from 'express';
import { startActiveSpan, getTraceId } from './tracing.js';
import { recordHttpRequestMetric } from './metrics.js';
import { contextStore, getContext } from '../utils/context.js';

function normalizeRoute(req: express.Request) {
  const routePath = typeof req.route?.path === 'string' ? req.route.path : '';
  const baseUrl = req.baseUrl || '';
  return routePath
    ? `${baseUrl}${routePath}` || routePath
    : req.path || req.originalUrl || 'unknown';
}

export function observabilityMiddleware(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
) {
  const startedAt = performance.now();
  const requestId =
    typeof req.headers['x-request-id'] === 'string'
      ? req.headers['x-request-id']
      : crypto.randomUUID();

  void startActiveSpan(
    `http.${req.method.toLowerCase()}`,
    {
      'service.name': 'biuro-api',
      'http.method': req.method,
      'http.target': req.originalUrl,
      'http.route': req.path,
    },
    (span) =>
      new Promise<void>((resolve) => {
        const traceId = span.spanContext().traceId;
        res.setHeader('x-trace-id', traceId);
        res.setHeader('x-request-id', requestId);

        res.once('finish', () => {
          const durationMs = performance.now() - startedAt;
          const route = normalizeRoute(req);

          span.setAttribute('http.route', route);
          span.setAttribute('http.status_code', res.statusCode);
          span.setAttribute(
            'http.response_content_length',
            Number(res.getHeader('content-length') || 0)
          );
          span.setStatus({
            code:
              res.statusCode >= 500 ? SpanStatusCode.ERROR : SpanStatusCode.OK,
            message:
              res.statusCode >= 500 ? `HTTP ${res.statusCode}` : undefined,
          });

          recordHttpRequestMetric({
            method: req.method,
            route,
            statusCode: res.statusCode,
            durationMs,
          });

          resolve();
        });

        const existingContext = getContext();
        contextStore.run(
          {
            ...existingContext,
            requestId,
          },
          () => {
            next();
          }
        );
      })
  );
}

export function metricsHandler(_req: express.Request, res: express.Response) {
  void import('./metrics.js').then(
    async ({ metricsRegistry, renderMetrics }) => {
      res.setHeader('Content-Type', metricsRegistry.contentType);
      res.send(await renderMetrics());
    }
  );
}

export function traceIdHandler(_req: express.Request, res: express.Response) {
  res.json({ trace_id: getTraceId() });
}
