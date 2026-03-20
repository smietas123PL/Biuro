import { Router } from 'express';
import type {
  ObservabilityHeartbeatRunItem,
  ObservabilityRecentHeartbeatRunsResponse,
  ObservabilityRecentTracesResponse,
  ObservabilitySpanItem,
  ObservabilityTraceDetailResponse,
} from '@biuro/shared';
import { z } from 'zod';
import { db } from '../db/client.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { metricsRegistry, renderMetrics } from '../observability/metrics.js';
import {
  getRecentSpans,
  getTracingServiceName,
} from '../observability/tracing.js';
import type { AuthRequest } from '../utils/context.js';
import { logger } from '../utils/logger.js';

const router: Router = Router();

const recentTraceQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
const recentHeartbeatRunsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

const traceParamsSchema = z.object({
  traceId: z.string().min(16),
});

const clientEventSchema = z.object({
  name: z.string().min(1).max(120),
  tutorial_version: z.string().min(1).max(32),
  step_id: z.string().min(1).max(120).optional(),
  step_index: z.number().int().min(0).optional(),
  total_steps: z.number().int().min(1).max(100).optional(),
  route: z.string().min(1).max(200).optional(),
  source: z.string().min(1).max(64).optional(),
  occurred_at: z.string().datetime(),
  metadata: z
    .record(z.union([z.string(), z.number(), z.boolean(), z.null()]))
    .optional(),
});

router.get('/metrics', async (_req, res) => {
  res.setHeader('Content-Type', metricsRegistry.contentType);
  res.send(await renderMetrics());
});

router.post('/client-events', requireAuth(), async (req: AuthRequest, res) => {
  const parsed = clientEventSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error });
  }

  logger.info(
    {
      event: 'client_observability_event',
      user_id: req.user?.id,
      company_id: req.user?.companyId,
      payload: parsed.data,
    },
    'Captured client observability event'
  );

  return res.status(204).send();
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
  '/heartbeat-runs/recent',
  requireRole(['owner', 'admin']),
  async (req: AuthRequest, res) => {
    const parsed = recentHeartbeatRunsQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error });
    }

    const companyId = req.user?.companyId;
    if (!companyId) {
      return res.status(400).json({ error: 'Missing company context' });
    }

    const result = await db.query(
      `SELECT
         h.id,
         h.agent_id,
         a.name AS agent_name,
         h.task_id,
         t.title AS task_title,
         h.status,
         h.created_at,
         COALESCE(h.duration_ms, 0) AS duration_ms,
         COALESCE(h.cost_usd::float, 0) AS cost_usd,
         h.details
       FROM heartbeats h
       JOIN agents a ON a.id = h.agent_id
       LEFT JOIN tasks t ON t.id = h.task_id
       WHERE a.company_id = $1
       ORDER BY h.created_at DESC
       LIMIT $2`,
      [companyId, parsed.data.limit]
    );

    const items: ObservabilityHeartbeatRunItem[] = result.rows.map((row) => {
      const details =
        row.details && typeof row.details === 'object' ? row.details : {};
      const heartbeatExecution =
        details.heartbeat_execution &&
        typeof details.heartbeat_execution === 'object'
          ? details.heartbeat_execution
          : {};
      const retrievalBudget =
        heartbeatExecution.retrieval_budget &&
        typeof heartbeatExecution.retrieval_budget === 'object'
          ? heartbeatExecution.retrieval_budget
          : {};
      const llmRouting =
        details.llm_routing && typeof details.llm_routing === 'object'
          ? details.llm_routing
          : {};

      return {
        heartbeat_id: String(row.id),
        agent_id: String(row.agent_id),
        agent_name: String(row.agent_name ?? 'Agent'),
        task_id: row.task_id ? String(row.task_id) : null,
        task_title: row.task_title ? String(row.task_title) : null,
        status: String(row.status),
        created_at: new Date(row.created_at).toISOString(),
        duration_ms: Number(row.duration_ms ?? 0),
        cost_usd: Number(row.cost_usd ?? 0),
        llm_selected_runtime:
          typeof llmRouting.selected_runtime === 'string'
            ? llmRouting.selected_runtime
            : null,
        llm_selected_model:
          typeof llmRouting.selected_model === 'string'
            ? llmRouting.selected_model
            : null,
        llm_fallback_count: Number(
          heartbeatExecution.llm_fallback_count ?? 0
        ),
        retrieval_count: Array.isArray(heartbeatExecution.retrievals)
          ? heartbeatExecution.retrievals.length
          : Number(retrievalBudget.consumed_requests ?? 0),
        retrieval_fallback_count: Number(
          heartbeatExecution.retrieval_fallback_count ?? 0
        ),
        retrieval_skipped_count: Number(
          retrievalBudget.skipped_requests ?? 0
        ),
        budget_capped: Boolean(details.budget_capped),
      };
    });

    const payload: ObservabilityRecentHeartbeatRunsResponse = {
      generated_at: new Date().toISOString(),
      count: items.length,
      items,
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
