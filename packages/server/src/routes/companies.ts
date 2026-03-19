import { Router } from 'express';
import type { CompanyRuntimeSettingsResponse, RuntimeName } from '@biuro/shared';
import { db } from '../db/client.js';
import { z } from 'zod';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { AuthRequest } from '../utils/context.js';
import { attachBudgetForecasts, buildBudgetForecast, buildDailySpendSeries, summarizeAgentBudgets, toFloat } from '../utils/budgets.js';
import {
  ALL_RUNTIMES,
  extractCompanyRuntimeSettings,
  getDefaultRuntimeSettings,
  normalizeRuntimeOrder,
} from '../runtime/preferences.js';

const router: Router = Router();

const createSchema = z.object({
  name: z.string().min(1),
  mission: z.string().optional(),
});

const policySchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  type: z.enum(['approval_required', 'budget_threshold', 'delegation_limit', 'rate_limit', 'tool_restriction']),
  rules: z.record(z.any()).optional(),
});
const auditLogFilterSchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional(),
  action: z.string().min(1).optional(),
  action_prefix: z.string().min(1).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  cursor_created_at: z.string().datetime().optional(),
  cursor_id: z.string().uuid().optional(),
});
const retrievalMetricsSchema = z.object({
  days: z.coerce.number().int().min(1).max(90).default(7),
});
const runtimeSettingsSchema = z.object({
  primary_runtime: z.enum(['claude', 'openai', 'gemini']),
  fallback_order: z.array(z.enum(['claude', 'openai', 'gemini'])).min(1).max(3),
});

function clampLimit(value: unknown, fallback: number, max: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.max(1, Math.min(Math.trunc(parsed), max));
}

function getSingleQueryValue(value: unknown) {
  if (typeof value === 'string' || typeof value === 'number') {
    return value;
  }

  if (Array.isArray(value)) {
    return value[0];
  }

  return undefined;
}

function buildRuntimeSettingsPayload(config: unknown) {
  const resolved = extractCompanyRuntimeSettings(config);
  const defaults = getDefaultRuntimeSettings();
  return {
    primary_runtime: resolved.primaryRuntime,
    fallback_order: resolved.fallbackOrder,
    system_defaults: {
      primary_runtime: defaults.primaryRuntime,
      fallback_order: defaults.fallbackOrder,
    },
    available_runtimes: ALL_RUNTIMES,
  };
}

// Policies Root (4.4/4.5)
router.get('/policies', requireRole(['owner', 'admin', 'member', 'viewer']), async (req, res, next) => {
  try {
    const { company_id } = req.query;
    let q = 'SELECT * FROM policies';
    let params: any[] = [];
    if (company_id) {
      q += ' WHERE company_id = $1';
      params.push(company_id);
    }
    q += ' ORDER BY created_at DESC';
    const result = await db.query(q, params);
    res.json(result.rows);
  } catch (err) { next(err); }
});

router.post('/policies', requireRole(['owner', 'admin']), async (req, res, next) => {
  try {
    const parsed = policySchema.extend({ company_id: z.string().uuid() }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error });
    const { company_id, name, description, type, rules } = parsed.data;
    const result = await db.query(
      'INSERT INTO policies (company_id, name, description, type, rules) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [company_id, name, description, type, JSON.stringify(rules || {})]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) { next(err); }
});

// Create
router.post('/', requireAuth(), async (req: AuthRequest, res, next) => {
  try {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error });

    const { name, mission } = parsed.data;
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const company = await db.transaction(async (client) => {
      const result = await client.query(
        'INSERT INTO companies (name, mission) VALUES ($1, $2) RETURNING *',
        [name, mission]
      );
      const createdCompany = result.rows[0];

      await client.query(
        "INSERT INTO audit_log (company_id, action, entity_type, entity_id, details) VALUES ($1, 'company.created', 'company', $1, '{}')",
        [createdCompany.id]
      );

      await client.query(
        "INSERT INTO user_roles (user_id, company_id, role) VALUES ($1, $2, 'owner') ON CONFLICT (user_id, company_id) DO NOTHING",
        [userId, createdCompany.id]
      );

      return createdCompany;
    });

    res.status(201).json(company);
  } catch (err) { next(err); }
});

// List
router.get('/', requireAuth(), async (req: AuthRequest, res, next) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const result = await db.query(
      `SELECT c.*, ur.role
       FROM companies c
       JOIN user_roles ur ON ur.company_id = c.id
       WHERE ur.user_id = $1
       ORDER BY c.created_at DESC`,
      [userId]
    );
    res.json(result.rows);
  } catch (err) { next(err); }
});

// Get
router.get('/:id', requireRole(['owner', 'admin', 'member', 'viewer']), async (req, res, next) => {
  try {
    const result = await db.query('SELECT * FROM companies WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Company not found' });
    res.json(result.rows[0]);
  } catch (err) { next(err); }
});

router.get('/:id/runtime-settings', requireRole(['owner', 'admin', 'member', 'viewer']), async (req, res, next) => {
  try {
    const result = await db.query('SELECT id, name, config FROM companies WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Company not found' });
    }

    const payload: CompanyRuntimeSettingsResponse = {
      company_id: result.rows[0].id,
      company_name: result.rows[0].name,
      ...buildRuntimeSettingsPayload(result.rows[0].config),
    };
    res.json(payload);
  } catch (err) {
    next(err);
  }
});

router.patch('/:id/runtime-settings', requireRole(['owner', 'admin']), async (req: AuthRequest, res, next) => {
  try {
    const parsed = runtimeSettingsSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error });
    }

    const normalizedFallbackOrder = normalizeRuntimeOrder(parsed.data.fallback_order, ALL_RUNTIMES);
    const updatePayload = {
      llm_primary_runtime: parsed.data.primary_runtime,
      llm_fallback_order: normalizedFallbackOrder,
    };

    const result = await db.transaction(async (client) => {
      const companyRes = await client.query('SELECT id, name, config FROM companies WHERE id = $1', [req.params.id]);
      if (companyRes.rows.length === 0) {
        return null;
      }

      const currentConfig = companyRes.rows[0].config && typeof companyRes.rows[0].config === 'object'
        ? companyRes.rows[0].config
        : {};

      const mergedConfig = {
        ...currentConfig,
        ...updatePayload,
      };

      const updateRes = await client.query(
        'UPDATE companies SET config = $2 WHERE id = $1 RETURNING id, name, config',
        [req.params.id, JSON.stringify(mergedConfig)]
      );

      await client.query(
        `INSERT INTO audit_log (company_id, action, entity_type, entity_id, details)
         VALUES ($1, 'company.runtime_settings_updated', 'company', $1, $2)`,
        [
          req.params.id,
          JSON.stringify({
            primary_runtime: parsed.data.primary_runtime,
            fallback_order: normalizedFallbackOrder,
            updated_by: req.user?.id ?? null,
          }),
        ]
      );

      return updateRes.rows[0];
    });

    if (!result) {
      return res.status(404).json({ error: 'Company not found' });
    }

    const payload: CompanyRuntimeSettingsResponse = {
      company_id: result.id,
      company_name: result.name,
      ...buildRuntimeSettingsPayload(result.config),
    };
    res.json(payload);
  } catch (err) {
    next(err);
  }
});

// Stats
router.get('/:id/stats', requireRole(['owner', 'admin', 'member', 'viewer']), async (req, res, next) => {
  try {
    const companyId = req.params.id;
    const [agents, tasks, goals, pendingApprovals, dailyCost] = await Promise.all([
      db.query(
        `SELECT
           COUNT(*)::int AS total,
           COUNT(*) FILTER (WHERE status = 'working')::int AS working,
           COUNT(*) FILTER (WHERE status = 'idle')::int AS idle,
           COUNT(*) FILTER (WHERE status = 'paused')::int AS paused
         FROM agents
         WHERE company_id = $1 AND status != 'terminated'`,
        [companyId]
      ),
      db.query(
        `SELECT
           COUNT(*)::int AS total,
           COUNT(*) FILTER (WHERE status IN ('backlog', 'assigned', 'in_progress', 'review'))::int AS pending,
           COUNT(*) FILTER (WHERE status = 'done')::int AS completed,
           COUNT(*) FILTER (WHERE status = 'blocked')::int AS blocked
         FROM tasks
         WHERE company_id = $1`,
        [companyId]
      ),
      db.query('SELECT COUNT(*)::int AS total FROM goals WHERE company_id = $1', [companyId]),
      db.query("SELECT COUNT(*)::int AS total FROM approvals WHERE company_id = $1 AND status = 'pending'", [companyId]),
      db.query(
        `SELECT COALESCE(SUM(cost_usd), 0)::float AS total
         FROM audit_log
         WHERE company_id = $1 AND created_at >= date_trunc('day', now())`,
        [companyId]
      ),
    ]);

    const agentStats = agents.rows[0];
    const taskStats = tasks.rows[0];

    res.json({
      agent_count: agentStats.total,
      active_agents: agentStats.working,
      idle_agents: agentStats.idle,
      paused_agents: agentStats.paused,
      task_count: taskStats.total,
      pending_tasks: taskStats.pending,
      completed_tasks: taskStats.completed,
      blocked_tasks: taskStats.blocked,
      goal_count: goals.rows[0].total,
      pending_approvals: pendingApprovals.rows[0].total,
      daily_cost_usd: dailyCost.rows[0].total,
    });
  } catch (err) { next(err); }
});

router.get('/:id/activity-feed', requireRole(['owner', 'admin', 'member', 'viewer']), async (req, res, next) => {
  try {
    const limit = clampLimit(req.query.limit, 20, 50);
    const result = await db.query(
      `SELECT
         h.id,
         h.status,
         h.created_at,
         COALESCE(h.cost_usd, 0)::float AS cost_usd,
         h.details,
         a.id AS agent_id,
         a.name AS agent_name,
         t.id AS task_id,
         t.title AS task_title
       FROM heartbeats h
       JOIN agents a ON a.id = h.agent_id
       LEFT JOIN tasks t ON t.id = h.task_id
       WHERE a.company_id = $1
       ORDER BY h.created_at DESC
       LIMIT $2`,
      [req.params.id, limit]
    );

    res.json(
      result.rows.map((row) => ({
        id: row.id,
        type: `heartbeat.${row.status}`,
        created_at: row.created_at,
        cost_usd: row.cost_usd,
        agent_id: row.agent_id,
        agent_name: row.agent_name,
        task_id: row.task_id,
        task_title: row.task_title,
        summary:
          row.details?.thought ||
          (row.status === 'worked' ? 'Completed a heartbeat cycle.' : `Heartbeat status: ${row.status}`),
      }))
    );
  } catch (err) { next(err); }
});

router.get('/:id/budgets-summary', requireRole(['owner', 'admin', 'member', 'viewer']), async (req, res, next) => {
  try {
    const companyId = req.params.id;
    const [balanceRes, agentBudgetRes, dailySpendRes, agentLast7dSpendRes] = await Promise.all([
      db.query(
        'SELECT COALESCE(balance, 0)::float AS balance FROM company_credits WHERE company_id = $1',
        [companyId]
      ),
      db.query(
        `SELECT
           a.id,
           a.name,
           a.role,
           a.title,
           a.runtime,
           a.status,
           COALESCE(a.monthly_budget_usd, 0)::float AS configured_limit_usd,
           COALESCE(b.limit_usd, a.monthly_budget_usd, 0)::float AS limit_usd,
           COALESCE(b.spent_usd, 0)::float AS spent_usd
         FROM agents a
         LEFT JOIN budgets b
           ON b.agent_id = a.id
          AND b.month = date_trunc('month', now())::date
         WHERE a.company_id = $1
           AND a.status != 'terminated'
         ORDER BY
           CASE
             WHEN COALESCE(b.limit_usd, a.monthly_budget_usd, 0) > 0
               THEN COALESCE(b.spent_usd, 0) / COALESCE(NULLIF(b.limit_usd, 0), NULLIF(a.monthly_budget_usd, 0))
             ELSE 0
           END DESC,
           a.created_at ASC`,
        [companyId]
      ),
      db.query(
        `SELECT
           to_char(date_trunc('day', created_at), 'YYYY-MM-DD') AS day,
           COALESCE(SUM(cost_usd), 0)::float AS total_usd
         FROM audit_log
         WHERE company_id = $1
           AND created_at >= date_trunc('day', now()) - interval '6 days'
         GROUP BY 1
         ORDER BY 1 ASC`,
        [companyId]
      ),
      db.query(
        `SELECT
           agent_id,
           COALESCE(SUM(cost_usd), 0)::float AS last_7d_spend_usd
         FROM audit_log
         WHERE company_id = $1
           AND agent_id IS NOT NULL
           AND created_at >= now() - interval '7 days'
         GROUP BY agent_id`,
        [companyId]
      ),
    ]);

    const dailySpendMap = new Map(
      dailySpendRes.rows.map((row) => [row.day as string, toFloat(row.total_usd)])
    );
    const daily_spend = buildDailySpendSeries(
      Array.from(dailySpendMap.entries()).map(([day, total_usd]) => ({ day, total_usd }))
    );
    const { agents: summarizedAgents, totals } = summarizeAgentBudgets(agentBudgetRes.rows);
    const agents = attachBudgetForecasts(summarizedAgents, agentLast7dSpendRes.rows);
    const companyLast7dSpendUsd = daily_spend.reduce((sum, point) => sum + point.total_usd, 0);
    const forecast = buildBudgetForecast({
      totalSpentUsd: totals.spent_usd,
      last7dSpendUsd: companyLast7dSpendUsd,
    });

    res.json({
      balance_usd: balanceRes.rows[0]?.balance ?? 0,
      totals: {
        ...totals,
        forecast: {
          ...forecast,
          projected_over_limit_usd:
            totals.limit_usd > 0
              ? Math.max(forecast.projected_month_spend_usd - totals.limit_usd, 0)
              : null,
        },
      },
      daily_spend,
      agents,
    });
  } catch (err) { next(err); }
});

router.get('/:id/retrieval-metrics', requireRole(['owner', 'admin', 'member', 'viewer']), async (req, res, next) => {
  try {
    const parsed = retrievalMetricsSchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error });
    }

    const companyId = req.params.id;
    const days = parsed.data.days;
    const [summaryRes, sourceRes, consumerRes, recentRes] = await Promise.all([
      db.query(
        `SELECT
           COUNT(*)::int AS searches,
           COUNT(*) FILTER (WHERE scope = 'knowledge')::int AS knowledge_searches,
           COUNT(*) FILTER (WHERE scope = 'memory')::int AS memory_searches,
           COALESCE(AVG(latency_ms), 0)::float AS avg_latency_ms,
           COALESCE(AVG(result_count), 0)::float AS avg_result_count,
           COALESCE(AVG(overlap_count), 0)::float AS avg_overlap_count,
           COALESCE(AVG(CASE WHEN result_count = 0 THEN 1 ELSE 0 END) * 100, 0)::float AS zero_result_rate_pct
         FROM retrieval_metrics
         WHERE company_id = $1
           AND created_at >= now() - make_interval(days => $2)`,
        [companyId, days]
      ),
      db.query(
        `SELECT embedding_source, COUNT(*)::int AS total
         FROM retrieval_metrics
         WHERE company_id = $1
           AND created_at >= now() - make_interval(days => $2)
         GROUP BY embedding_source
         ORDER BY total DESC, embedding_source ASC`,
        [companyId, days]
      ),
      db.query(
        `SELECT consumer, COUNT(*)::int AS total
         FROM retrieval_metrics
         WHERE company_id = $1
           AND created_at >= now() - make_interval(days => $2)
         GROUP BY consumer
         ORDER BY total DESC, consumer ASC`,
        [companyId, days]
      ),
      db.query(
        `SELECT scope, consumer, result_count, overlap_count, top_distance, embedding_source, created_at
         FROM retrieval_metrics
         WHERE company_id = $1
           AND created_at >= now() - make_interval(days => $2)
         ORDER BY created_at DESC
         LIMIT 8`,
        [companyId, days]
      ),
    ]);

    res.json({
      range_days: days,
      totals: summaryRes.rows[0] ?? {
        searches: 0,
        knowledge_searches: 0,
        memory_searches: 0,
        avg_latency_ms: 0,
        avg_result_count: 0,
        avg_overlap_count: 0,
        zero_result_rate_pct: 0,
      },
      by_source: sourceRes.rows,
      by_consumer: consumerRes.rows,
      recent: recentRes.rows,
    });
  } catch (err) { next(err); }
});

// Org Chart
router.get('/:id/org-chart', requireRole(['owner', 'admin', 'member', 'viewer']), async (req, res, next) => {
  try {
    const result = await db.query(
      "SELECT id, name, role, title, reports_to, status FROM agents WHERE company_id = $1 AND status != 'terminated' ORDER BY created_at ASC",
      [req.params.id]
    );
    res.json(result.rows);
  } catch (err) { next(err); }
});

// Audit Log
router.get('/:id/audit-log', requireRole(['owner', 'admin']), async (req, res, next) => {
  try {
    const companyId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    if (!companyId) {
      return res.status(400).json({ error: 'Invalid company ID' });
    }

    const parsed = auditLogFilterSchema.safeParse({
      limit: getSingleQueryValue(req.query.limit),
      action: getSingleQueryValue(req.query.action),
      action_prefix: getSingleQueryValue(req.query.action_prefix),
      from: getSingleQueryValue(req.query.from),
      to: getSingleQueryValue(req.query.to),
      cursor_created_at: getSingleQueryValue(req.query.cursor_created_at),
      cursor_id: getSingleQueryValue(req.query.cursor_id),
    });
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error });
    }

    if (parsed.data.from && parsed.data.to && new Date(parsed.data.from) > new Date(parsed.data.to)) {
      return res.status(400).json({ error: 'Invalid date range: "from" must be earlier than "to"' });
    }

    if ((parsed.data.cursor_created_at && !parsed.data.cursor_id) || (!parsed.data.cursor_created_at && parsed.data.cursor_id)) {
      return res.status(400).json({ error: 'Cursor requires both "cursor_created_at" and "cursor_id"' });
    }

    const limit = parsed.data.limit ?? 100;
    const params: Array<string | number> = [companyId];
    const clauses = ['company_id = $1'];

    if (parsed.data.action) {
      params.push(parsed.data.action);
      clauses.push(`action = $${params.length}`);
    }

    if (parsed.data.action_prefix) {
      params.push(`${parsed.data.action_prefix}%`);
      clauses.push(`action LIKE $${params.length}`);
    }

    if (parsed.data.from) {
      params.push(parsed.data.from);
      clauses.push(`created_at >= $${params.length}::timestamptz`);
    }

    if (parsed.data.to) {
      params.push(parsed.data.to);
      clauses.push(`created_at <= $${params.length}::timestamptz`);
    }

    if (parsed.data.cursor_created_at && parsed.data.cursor_id) {
      params.push(parsed.data.cursor_created_at);
      const cursorCreatedAtIndex = params.length;
      params.push(parsed.data.cursor_id);
      const cursorIdIndex = params.length;
      clauses.push(
        `(created_at < $${cursorCreatedAtIndex}::timestamptz OR (created_at = $${cursorCreatedAtIndex}::timestamptz AND id < $${cursorIdIndex}::uuid))`
      );
    }

    params.push(limit + 1);
    const result = await db.query(
      `SELECT *
       FROM audit_log
       WHERE ${clauses.join(' AND ')}
       ORDER BY created_at DESC, id DESC
       LIMIT $${params.length}`,
      params
    );
    const hasMore = result.rows.length > limit;
    const items = hasMore ? result.rows.slice(0, limit) : result.rows;
    const lastItem = items[items.length - 1];

    res.json({
      items,
      has_more: hasMore,
      next_cursor: hasMore && lastItem
        ? {
            created_at: lastItem.created_at,
            id: lastItem.id,
          }
        : null,
    });
  } catch (err) { next(err); }
});

// Create Policy
router.post('/:id/policies', requireRole(['owner', 'admin']), async (req, res, next) => {
  try {
    const parsed = policySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error });
    const { name, description, type, rules } = parsed.data;
    const result = await db.query(
      'INSERT INTO policies (company_id, name, description, type, rules) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [req.params.id, name, description, type, JSON.stringify(rules || {})]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) { next(err); }
});

// List Policies
router.get('/:id/policies', requireRole(['owner', 'admin', 'member', 'viewer']), async (req, res, next) => {
  try {
    const result = await db.query(
      'SELECT * FROM policies WHERE company_id = $1 ORDER BY created_at DESC',
      [req.params.id]
    );
    res.json(result.rows);
  } catch (err) { next(err); }
});

export default router;
