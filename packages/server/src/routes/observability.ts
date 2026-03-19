import { Router } from 'express';
import type {
  ObservabilityRecentTracesResponse,
  ObservabilitySpanItem,
  ObservabilityTraceDetailResponse,
} from '@biuro/shared';
import { z } from 'zod';
import { requireRole } from '../middleware/auth.js';
import { metricsRegistry, renderMetrics } from '../observability/metrics.js';
import {
  getRecentSpans,
  getTracingServiceName,
} from '../observability/tracing.js';

const router: Router = Router();

const recentTraceQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

const traceParamsSchema = z.object({
  traceId: z.string().min(16),
});

router.get('/metrics', async (_req, res) => {
  res.setHeader('Content-Type', metricsRegistry.contentType);
  res.send(await renderMetrics());
});

router.get(
  '/traces/recent',
  requireRole(['owner', 'admin']),
  async (req, res) => {
    const parsed = recentTraceQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error });
    }

    const spans = getRecentSpans(parsed.data.limit);
    const payload: ObservabilityRecentTracesResponse = {
      generated_at: new Date().toISOString(),
      service: getTracingServiceName(),
      count: spans.length,
      items: spans,
    };
    res.json(payload);
  }
);

router.get(
  '/traces/:traceId',
  requireRole(['owner', 'admin']),
  async (req, res) => {
    const parsed = traceParamsSchema.safeParse(req.params);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error });
    }

    const matchingSpans = getRecentSpans(200)
      .filter((span) => span.trace_id === parsed.data.traceId)
      .sort(
        (left, right) =>
          Date.parse(left.start_time) - Date.parse(right.start_time)
      ) as ObservabilitySpanItem[];

    if (matchingSpans.length === 0) {
      return res
        .status(404)
        .json({ error: 'Trace not found in recent history' });
    }

    const startedAt = matchingSpans[0]?.start_time ?? new Date().toISOString();
    const endedAt =
      matchingSpans[matchingSpans.length - 1]?.end_time ?? startedAt;
    const durationMs = Number(
      matchingSpans
        .reduce((longest, span) => Math.max(longest, span.duration_ms), 0)
        .toFixed(3)
    );

    const payload: ObservabilityTraceDetailResponse = {
      generated_at: new Date().toISOString(),
      service: getTracingServiceName(),
      trace_id: parsed.data.traceId,
      summary: {
        span_count: matchingSpans.length,
        started_at: startedAt,
        ended_at: endedAt,
        duration_ms: durationMs,
      },
      items: matchingSpans,
    };
    res.json(payload);
  }
);

export default router;
