import { Router } from 'express';
import { db } from '../db/client.js';
import { z } from 'zod';
import { requireRole } from '../middleware/auth.js';
import { defaultModelsByRuntime } from '../runtime/defaultModels.js';
import { enqueueCompanyWakeup } from '../orchestrator/schedulerQueue.js';

const router: Router = Router();

const hireSchema = z.object({
  company_id: z.string().uuid(),
  name: z.string().min(1),
  role: z.string().min(1),
  title: z.string().optional(),
  runtime: z.enum(['claude', 'openai', 'gemini']).default('gemini'),
  model: z.string().min(1).optional(),
  system_prompt: z.string().optional(),
  config: z.record(z.any()).optional(),
  reports_to: z.string().uuid().optional(),
  monthly_budget_usd: z.number().optional(),
});

const replayQuerySchema = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  task_id: z.string().min(1).optional(),
  types: z.preprocess((value) => {
    if (typeof value === 'string') {
      return value
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
    }

    if (Array.isArray(value)) {
      return value;
    }

    return undefined;
  }, z.array(z.enum(['heartbeat', 'audit', 'message', 'session'])).optional()),
  limit: z.coerce.number().int().min(1).max(300).default(120),
});

const replayDiffQuerySchema = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  left_task_id: z.string().min(1),
  right_task_id: z.string().min(1),
  types: z.preprocess((value) => {
    if (typeof value === 'string') {
      return value
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
    }

    if (Array.isArray(value)) {
      return value;
    }

    return undefined;
  }, z.array(z.enum(['heartbeat', 'audit', 'message', 'session'])).optional()),
  limit: z.coerce.number().int().min(1).max(300).default(120),
});

function formatReplaySummary(value: unknown, fallback: string) {
  if (typeof value !== 'string') {
    return fallback;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : fallback;
}

type ReplayEventType = 'heartbeat' | 'audit' | 'message' | 'session';

type ReplayEvent = {
  id: string;
  type: ReplayEventType;
  action: string;
  timestamp: string;
  summary: string;
  task_id?: string | null;
  task_title?: string | null;
  status?: string | null;
  duration_ms?: number | null;
  cost_usd?: string | number | null;
  direction?: 'inbound' | 'outbound';
  details?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  message_type?: string | null;
};

type ReplayTaskOption = {
  task_id: string;
  task_title: string;
  event_count: number;
};

type ReplayPayload = {
  agent: {
    id: string;
    company_id: string;
    name: string;
    role: string;
    status: string;
  };
  agent_id: string;
  generated_at: string;
  filters: {
    applied: {
      task_id: string | null;
      types: ReplayEventType[];
    };
    available_types: ReplayEventType[];
    tasks: ReplayTaskOption[];
  };
  window: {
    from: string | null;
    to: string | null;
    limit: number;
    returned: number;
  };
  items: ReplayEvent[];
};

type ReplayDiffSide = {
  task_id: string;
  task_title: string;
  event_count: number;
  total_duration_ms: number;
  total_cost_usd: number;
  first_event_at: string | null;
  last_event_at: string | null;
  type_counts: Record<ReplayEventType, number>;
  highlights: string[];
};

type ReplayDiffPayload = {
  agent: ReplayPayload['agent'];
  generated_at: string;
  filters: {
    from: string | null;
    to: string | null;
    types: ReplayEventType[];
    limit: number;
  };
  left: ReplayDiffSide;
  right: ReplayDiffSide;
  delta: {
    event_count: number;
    total_duration_ms: number;
    total_cost_usd: number;
  };
};

function escapeHtml(value: unknown) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function slugifyFilename(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'agent';
}

function toNumericValue(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === '') {
    return 0;
  }

  const numericValue = typeof value === 'string' ? Number(value) : value;
  return Number.isFinite(numericValue) ? numericValue : 0;
}

function createEmptyTypeCounts(): Record<ReplayEventType, number> {
  return {
    heartbeat: 0,
    audit: 0,
    message: 0,
    session: 0,
  };
}

function summarizeReplaySide(payload: ReplayPayload, taskId: string): ReplayDiffSide {
  const task = payload.filters.tasks.find((entry) => entry.task_id === taskId);
  const typeCounts = createEmptyTypeCounts();
  const totalDuration = payload.items.reduce((sum, item) => sum + (item.duration_ms ?? 0), 0);
  const totalCost = payload.items.reduce((sum, item) => sum + toNumericValue(item.cost_usd), 0);
  const firstEvent = payload.items[0] ?? null;
  const lastEvent = payload.items[payload.items.length - 1] ?? null;
  const highlights = Array.from(
    new Set(
      payload.items
        .map((item) => item.summary)
        .filter((summary) => typeof summary === 'string' && summary.trim().length > 0)
    )
  ).slice(0, 3);

  payload.items.forEach((item) => {
    typeCounts[item.type] += 1;
  });

  return {
    task_id: taskId,
    task_title: task?.task_title ?? taskId,
    event_count: payload.items.length,
    total_duration_ms: totalDuration,
    total_cost_usd: Number(totalCost.toFixed(4)),
    first_event_at: firstEvent?.timestamp ?? null,
    last_event_at: lastEvent?.timestamp ?? null,
    type_counts: typeCounts,
    highlights,
  };
}

function buildReplayReportHtml(payload: ReplayPayload) {
  const selectedTypesLabel = payload.filters.applied.types.length > 0
    ? payload.filters.applied.types.join(', ')
    : 'all';
  const selectedTaskLabel = payload.filters.applied.task_id
    ? payload.filters.tasks.find((task) => task.task_id === payload.filters.applied.task_id)?.task_title ?? payload.filters.applied.task_id
    : 'All tasks';
  const eventTypeCounts = payload.items.reduce((accumulator, item) => {
    accumulator.set(item.type, (accumulator.get(item.type) ?? 0) + 1);
    return accumulator;
  }, new Map<ReplayEventType, number>());

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(payload.agent.name)} Replay Report</title>
    <style>
      :root {
        color-scheme: light;
        --bg: #f6f4ee;
        --panel: #fffdf8;
        --border: #d9d2c3;
        --ink: #1d2a22;
        --muted: #5d675f;
        --accent: #1f6f5f;
        --accent-soft: #d9efe8;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        font-family: "Segoe UI", "Helvetica Neue", Arial, sans-serif;
        background: linear-gradient(180deg, #f7f0e4 0%, var(--bg) 100%);
        color: var(--ink);
      }
      .page {
        max-width: 1040px;
        margin: 0 auto;
        padding: 32px 20px 48px;
      }
      .hero, .panel, .event {
        background: var(--panel);
        border: 1px solid var(--border);
        border-radius: 20px;
        box-shadow: 0 14px 40px rgba(34, 46, 38, 0.08);
      }
      .hero {
        padding: 28px;
        margin-bottom: 20px;
      }
      .eyebrow {
        margin: 0 0 10px;
        color: var(--accent);
        font-size: 12px;
        letter-spacing: 0.22em;
        text-transform: uppercase;
        font-weight: 700;
      }
      h1 {
        margin: 0 0 8px;
        font-size: 34px;
        line-height: 1.1;
      }
      .subtle {
        color: var(--muted);
        margin: 0;
      }
      .grid {
        display: grid;
        gap: 16px;
        grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
        margin: 20px 0;
      }
      .panel {
        padding: 18px;
      }
      .label {
        font-size: 11px;
        letter-spacing: 0.16em;
        text-transform: uppercase;
        color: var(--muted);
        margin-bottom: 8px;
      }
      .value {
        font-size: 22px;
        font-weight: 700;
      }
      .meta {
        display: flex;
        flex-wrap: wrap;
        gap: 12px;
        margin-top: 12px;
      }
      .chip {
        background: var(--accent-soft);
        color: var(--accent);
        border-radius: 999px;
        padding: 8px 12px;
        font-size: 12px;
        font-weight: 700;
      }
      .section-title {
        margin: 24px 0 14px;
        font-size: 18px;
      }
      .timeline {
        display: grid;
        gap: 14px;
      }
      .event {
        padding: 18px;
      }
      .event-top {
        display: flex;
        justify-content: space-between;
        gap: 16px;
        align-items: baseline;
        margin-bottom: 10px;
      }
      .event-type {
        font-size: 12px;
        letter-spacing: 0.16em;
        text-transform: uppercase;
        color: var(--accent);
        font-weight: 700;
      }
      .event-time {
        color: var(--muted);
        font-size: 13px;
      }
      .event-summary {
        margin: 0;
        font-size: 18px;
        line-height: 1.4;
      }
      .event-detail {
        color: var(--muted);
        margin-top: 8px;
        font-size: 14px;
      }
      @media print {
        body { background: #fff; }
        .page { padding: 0; }
        .hero, .panel, .event { box-shadow: none; }
      }
    </style>
  </head>
  <body>
    <main class="page">
      <section class="hero">
        <p class="eyebrow">Biuro Replay Report</p>
        <h1>${escapeHtml(payload.agent.name)}</h1>
        <p class="subtle">${escapeHtml(payload.agent.role)} • status ${escapeHtml(payload.agent.status)}</p>
        <div class="grid">
          <div class="panel">
            <div class="label">Events Exported</div>
            <div class="value">${escapeHtml(payload.window.returned)}</div>
          </div>
          <div class="panel">
            <div class="label">Task Scope</div>
            <div class="value">${escapeHtml(selectedTaskLabel)}</div>
          </div>
          <div class="panel">
            <div class="label">Type Filter</div>
            <div class="value">${escapeHtml(selectedTypesLabel)}</div>
          </div>
          <div class="panel">
            <div class="label">Generated At</div>
            <div class="value">${escapeHtml(new Date(payload.generated_at).toLocaleString())}</div>
          </div>
        </div>
        <div class="meta">
          ${Array.from(eventTypeCounts.entries()).map(([type, count]) => (
            `<span class="chip">${escapeHtml(type)}: ${escapeHtml(count)}</span>`
          )).join('')}
        </div>
      </section>

      <h2 class="section-title">Timeline</h2>
      <section class="timeline">
        ${payload.items.map((item) => `
          <article class="event">
            <div class="event-top">
              <span class="event-type">${escapeHtml(item.action)}</span>
              <span class="event-time">${escapeHtml(new Date(item.timestamp).toLocaleString())}</span>
            </div>
            <p class="event-summary">${escapeHtml(item.summary)}</p>
            <div class="event-detail">
              ${item.task_title ? `Task: ${escapeHtml(item.task_title)}<br />` : ''}
              Type: ${escapeHtml(item.type)}
              ${item.duration_ms ? `<br />Duration: ${escapeHtml(item.duration_ms)} ms` : ''}
              ${item.cost_usd ? `<br />Cost: $${escapeHtml(item.cost_usd)}` : ''}
              ${item.direction ? `<br />Direction: ${escapeHtml(item.direction)}` : ''}
            </div>
          </article>
        `).join('')}
      </section>
    </main>
  </body>
</html>`;
}

async function buildReplayPayload(agentId: string, params: z.infer<typeof replayQuerySchema>): Promise<ReplayPayload | null> {
  const { from, to, task_id, types, limit } = params;
  const fromValue = from ?? null;
  const toValue = to ?? null;
  const selectedTypes = types ?? [];

  const agentResult = await db.query(
    'SELECT id, company_id, name, role, status FROM agents WHERE id = $1',
    [agentId]
  );

  if (agentResult.rows.length === 0) {
    return null;
  }

  const agent = agentResult.rows[0] as ReplayPayload['agent'];

  const [heartbeatsResult, auditResult, messageResult, sessionResult] = await Promise.all([
    db.query(
      `SELECT h.id, h.task_id, t.title AS task_title, h.status, h.duration_ms, h.cost_usd, h.details, h.created_at
       FROM heartbeats h
       LEFT JOIN tasks t ON t.id = h.task_id
       WHERE h.agent_id = $1
         AND ($2::timestamptz IS NULL OR h.created_at >= $2)
         AND ($3::timestamptz IS NULL OR h.created_at <= $3)
       ORDER BY h.created_at DESC
       LIMIT $4`,
      [agentId, fromValue, toValue, limit]
    ),
    db.query(
      `SELECT id, action, details, cost_usd, created_at
       FROM audit_log
       WHERE agent_id = $1
         AND ($2::timestamptz IS NULL OR created_at >= $2)
         AND ($3::timestamptz IS NULL OR created_at <= $3)
       ORDER BY created_at DESC
       LIMIT $4`,
      [agentId, fromValue, toValue, limit]
    ),
    db.query(
      `SELECT m.id, m.task_id, t.title AS task_title, m.from_agent, m.to_agent, m.content, m.type, m.metadata, m.created_at
       FROM messages m
       LEFT JOIN tasks t ON t.id = m.task_id
       WHERE (m.from_agent = $1 OR m.to_agent = $1)
         AND ($2::timestamptz IS NULL OR m.created_at >= $2)
         AND ($3::timestamptz IS NULL OR m.created_at <= $3)
       ORDER BY m.created_at DESC
       LIMIT $4`,
      [agentId, fromValue, toValue, limit]
    ),
    db.query(
      `SELECT s.id, s.task_id, t.title AS task_title, s.state, s.updated_at
       FROM agent_sessions s
       LEFT JOIN tasks t ON t.id = s.task_id
       WHERE s.agent_id = $1
         AND ($2::timestamptz IS NULL OR s.updated_at >= $2)
         AND ($3::timestamptz IS NULL OR s.updated_at <= $3)
       ORDER BY s.updated_at DESC
       LIMIT $4`,
      [agentId, fromValue, toValue, limit]
    ),
  ]);

  const allItems: ReplayEvent[] = [
    ...heartbeatsResult.rows.map((row): ReplayEvent => ({
      id: `heartbeat:${row.id}`,
      type: 'heartbeat',
      action: `heartbeat.${row.status}`,
      timestamp: String(row.created_at),
      summary: formatReplaySummary(row.details?.thought, row.task_title ? `Heartbeat on ${row.task_title}` : `Heartbeat marked ${row.status}`),
      task_id: row.task_id,
      task_title: row.task_title,
      status: row.status,
      duration_ms: row.duration_ms,
      cost_usd: row.cost_usd,
      details: row.details ?? {},
    })),
    ...auditResult.rows.map((row): ReplayEvent => ({
      id: `audit:${row.id}`,
      type: 'audit',
      action: String(row.action),
      timestamp: String(row.created_at),
      summary: formatReplaySummary(row.details?.reason ?? row.details?.message, String(row.action).replaceAll('.', ' ')),
      cost_usd: row.cost_usd,
      details: row.details ?? {},
    })),
    ...messageResult.rows.map((row): ReplayEvent => ({
      id: `message:${row.id}`,
      type: 'message',
      action: row.from_agent === agentId ? 'message.sent' : 'message.received',
      timestamp: String(row.created_at),
      summary: formatReplaySummary(row.content, row.from_agent === agentId ? 'Sent a message' : 'Received a message'),
      task_id: row.task_id,
      task_title: row.task_title,
      direction: row.from_agent === agentId ? 'outbound' : 'inbound',
      message_type: row.type,
      metadata: row.metadata ?? {},
    })),
    ...sessionResult.rows.map((row): ReplayEvent => ({
      id: `session:${row.id}`,
      type: 'session',
      action: 'session.updated',
      timestamp: String(row.updated_at),
      summary: formatReplaySummary(row.state?.summary, row.task_title ? `Session updated for ${row.task_title}` : 'Session state updated'),
      task_id: row.task_id,
      task_title: row.task_title,
      details: row.state ?? {},
    })),
  ].sort((left, right) => new Date(left.timestamp).getTime() - new Date(right.timestamp).getTime());

  const taskOptions: ReplayTaskOption[] = Array.from(
    allItems.reduce((accumulator, item) => {
      if (!item.task_id || !item.task_title) {
        return accumulator;
      }

      const existing = accumulator.get(item.task_id);
      if (existing) {
        existing.event_count += 1;
        return accumulator;
      }

      accumulator.set(item.task_id, {
        task_id: item.task_id,
        task_title: item.task_title,
        event_count: 1,
      });
      return accumulator;
    }, new Map<string, ReplayTaskOption>())
  ).map((entry) => entry[1]);

  const availableTypes = Array.from(new Set(allItems.map((item) => item.type))) as ReplayEventType[];

  const items = allItems
    .filter((item) => !task_id || item.task_id === task_id)
    .filter((item) => selectedTypes.length === 0 || selectedTypes.includes(item.type))
    .slice(-limit);

  return {
    agent,
    agent_id: agentId,
    generated_at: new Date().toISOString(),
    filters: {
      applied: {
        task_id: task_id ?? null,
        types: selectedTypes,
      },
      available_types: availableTypes,
      tasks: taskOptions,
    },
    window: {
      from: fromValue,
      to: toValue,
      limit,
      returned: items.length,
    },
    items,
  };
}

// Hire
router.post('/', requireRole(['owner', 'admin', 'member']), async (req, res, next) => {
  try {
    const parsed = hireSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error });

    const { company_id, name, role, title, runtime, model, system_prompt, config, reports_to, monthly_budget_usd } = parsed.data;
    const monthlyBudgetUsd = monthly_budget_usd ?? 0;
    const agent = await db.transaction(async (client) => {
      const result = await client.query(
        `INSERT INTO agents (company_id, name, role, title, runtime, model, system_prompt, config, reports_to, monthly_budget_usd) 
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
        [company_id, name, role, title, runtime, model ?? defaultModelsByRuntime[runtime], system_prompt, JSON.stringify(config || {}), reports_to || null, monthlyBudgetUsd]
      );
      const createdAgent = result.rows[0];

      await client.query(
        `INSERT INTO budgets (agent_id, month, limit_usd, spent_usd)
         VALUES ($1, date_trunc('month', now())::date, $2, 0)
         ON CONFLICT (agent_id, month) DO UPDATE
         SET limit_usd = EXCLUDED.limit_usd`,
        [createdAgent.id, monthlyBudgetUsd]
      );

      await client.query(
        "INSERT INTO audit_log (company_id, agent_id, action, entity_type, entity_id) VALUES ($1, $2, 'agent.hired', 'agent', $2)",
        [company_id, createdAgent.id]
      );

      return createdAgent;
    });

    await enqueueCompanyWakeup(company_id, 'agent_hired', {
      agentId: agent.id,
    });
    res.status(201).json(agent);
  } catch (err) {
    next(err);
  }
});

// List
router.get('/', requireRole(['owner', 'admin', 'member', 'viewer']), async (req, res, next) => {
  try {
    const { company_id } = req.query;
    if (!company_id || typeof company_id !== 'string') return res.status(400).json({ error: 'Missing company_id' });
    const result = await db.query(
      'SELECT * FROM agents WHERE company_id = $1 ORDER BY created_at ASC',
      [company_id]
    );
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
});

// Get Detail
router.get('/:id', requireRole(['owner', 'admin', 'member', 'viewer']), async (req, res, next) => {
  try {
    if (!req.params.id || req.params.id === 'undefined') return res.status(400).json({ error: 'Invalid ID' });
    const result = await db.query('SELECT * FROM agents WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Agent not found' });
    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

// Org Chart (flat list for now)
router.get('/org-chart/:companyId', requireRole(['owner', 'admin', 'member', 'viewer']), async (req, res, next) => {
  try {
    if (!req.params.companyId || req.params.companyId === 'undefined') return res.status(400).json({ error: 'Invalid ID' });
    const result = await db.query(
      'SELECT id, name, role, title, reports_to FROM agents WHERE company_id = $1',
      [req.params.companyId]
    );
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
});

// Status Actions
router.post('/:id/pause', requireRole(['owner', 'admin']), async (req, res, next) => {
  try {
    if (!req.params.id || req.params.id === 'undefined') return res.status(400).json({ error: 'Invalid ID' });
    await db.query("UPDATE agents SET status = 'paused' WHERE id = $1", [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/resume', requireRole(['owner', 'admin']), async (req, res, next) => {
  try {
    if (!req.params.id || req.params.id === 'undefined') return res.status(400).json({ error: 'Invalid ID' });
    const result = await db.query("UPDATE agents SET status = 'idle' WHERE id = $1 RETURNING id, company_id", [req.params.id]);
    if (result.rows[0]?.company_id) {
      await enqueueCompanyWakeup(String(result.rows[0].company_id), 'agent_resumed', {
        agentId: String(result.rows[0].id),
      });
    }
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/terminate', requireRole(['owner', 'admin']), async (req, res, next) => {
  try {
    if (!req.params.id || req.params.id === 'undefined') return res.status(400).json({ error: 'Invalid ID' });
    await db.query("UPDATE agents SET status = 'terminated' WHERE id = $1", [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.get('/:id/heartbeats', requireRole(['owner', 'admin', 'member', 'viewer']), async (req, res, next) => {
  try {
    if (!req.params.id || req.params.id === 'undefined') return res.status(400).json({ error: 'Invalid ID' });
    const result = await db.query(
      `SELECT status, created_at AS timestamp, duration_ms, cost_usd, details
       FROM heartbeats
       WHERE agent_id = $1
       ORDER BY created_at DESC
       LIMIT 10`,
      [req.params.id]
    );
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
});

router.get('/:id/replay', requireRole(['owner', 'admin', 'member', 'viewer']), async (req, res, next) => {
  try {
    if (!req.params.id || req.params.id === 'undefined') return res.status(400).json({ error: 'Invalid ID' });
    const agentId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;

    const parsed = replayQuerySchema.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ error: parsed.error });

    const payload = await buildReplayPayload(agentId, parsed.data);
    if (!payload) return res.status(404).json({ error: 'Agent not found' });

    res.json(payload);
  } catch (err) {
    next(err);
  }
});

router.get('/:id/replay/report', requireRole(['owner', 'admin', 'member', 'viewer']), async (req, res, next) => {
  try {
    if (!req.params.id || req.params.id === 'undefined') return res.status(400).json({ error: 'Invalid ID' });
    const agentId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;

    const parsed = replayQuerySchema.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ error: parsed.error });

    const payload = await buildReplayPayload(agentId, parsed.data);
    if (!payload) return res.status(404).json({ error: 'Agent not found' });

    const filename = `agent-replay-${slugifyFilename(payload.agent.name)}-${payload.generated_at.slice(0, 10)}.html`;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buildReplayReportHtml(payload));
  } catch (err) {
    next(err);
  }
});

router.get('/:id/replay/diff', requireRole(['owner', 'admin', 'member', 'viewer']), async (req, res, next) => {
  try {
    if (!req.params.id || req.params.id === 'undefined') return res.status(400).json({ error: 'Invalid ID' });
    const agentId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;

    const parsed = replayDiffQuerySchema.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ error: parsed.error });

    const { from, to, left_task_id, right_task_id, types, limit } = parsed.data;
    if (left_task_id === right_task_id) {
      return res.status(400).json({ error: 'Choose two different tasks to compare' });
    }

    const sharedParams = {
      from,
      to,
      types,
      limit,
    };

    const leftPayload = await buildReplayPayload(agentId, { ...sharedParams, task_id: left_task_id });
    const rightPayload = await buildReplayPayload(agentId, { ...sharedParams, task_id: right_task_id });

    if (!leftPayload || !rightPayload) return res.status(404).json({ error: 'Agent not found' });

    const left = summarizeReplaySide(leftPayload, left_task_id);
    const right = summarizeReplaySide(rightPayload, right_task_id);

    const response: ReplayDiffPayload = {
      agent: leftPayload.agent,
      generated_at: new Date().toISOString(),
      filters: {
        from: from ?? null,
        to: to ?? null,
        types: types ?? [],
        limit,
      },
      left,
      right,
      delta: {
        event_count: left.event_count - right.event_count,
        total_duration_ms: left.total_duration_ms - right.total_duration_ms,
        total_cost_usd: Number((left.total_cost_usd - right.total_cost_usd).toFixed(4)),
      },
    };

    res.json(response);
  } catch (err) {
    next(err);
  }
});

router.get('/:id/budgets', requireRole(['owner', 'admin', 'member', 'viewer']), async (req, res, next) => {
    try {
      if (!req.params.id || req.params.id === 'undefined') return res.status(400).json({ error: 'Invalid ID' });
      const agentCheck = await db.query('SELECT id FROM agents WHERE id = $1', [req.params.id]);
      if (agentCheck.rows.length === 0) return res.status(404).json({ error: 'Agent not found' });

      const result = await db.query(
        `SELECT agent_id, month, limit_usd, spent_usd, created_at
         FROM budgets
         WHERE agent_id = $1
         ORDER BY month DESC, created_at DESC`,
        [req.params.id]
      );
      res.json(result.rows);
    } catch (err) {
      next(err);
    }
});

router.post('/:id/tools/:toolId', requireRole(['owner', 'admin']), async (req, res, next) => {
    try {
        const { id, toolId } = req.params;
        if (!id || id === 'undefined' || !toolId || toolId === 'undefined') return res.status(400).json({ error: 'Invalid ID' });
        
        // Verify tool exists
        const toolCheck = await db.query('SELECT id FROM tools WHERE id = $1', [toolId]);
        if (toolCheck.rows.length === 0) return res.status(404).json({ error: 'Tool not found' });

        // Verify agent exists
        const agentCheck = await db.query('SELECT id FROM agents WHERE id = $1', [id]);
        if (agentCheck.rows.length === 0) return res.status(404).json({ error: 'Agent not found' });

        // Assign tool
        await db.query(
            'INSERT INTO agent_tools (agent_id, tool_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
            [id, toolId]
        );

        res.status(201).json({ id: toolId, agent_id: id });
    } catch (err) {
        next(err);
    }
});

export default router;
