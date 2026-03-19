import { db } from '../db/client.js';
import { broadcastCompanyEvent } from '../realtime/eventBus.js';
import { deliverOutgoingWebhooks } from '../services/outgoingWebhooks.js';

type AgentBudgetSnapshot = {
  limit_usd: number;
  spent_usd: number;
  utilization_pct: number | null;
};

export async function isAgentBudgetExceeded(agentId: string) {
  const budgetRes = await db.query(
    `WITH seeded_budget AS (
       INSERT INTO budgets (agent_id, month, limit_usd, spent_usd)
       SELECT id, date_trunc('month', now())::date, monthly_budget_usd, 0
       FROM agents
       WHERE id = $1
         AND monthly_budget_usd > 0
       ON CONFLICT (agent_id, month) DO UPDATE
       SET limit_usd = GREATEST(budgets.limit_usd, EXCLUDED.limit_usd)
       RETURNING spent_usd::float AS spent_usd, limit_usd::float AS limit_usd
     ),
     current_budget AS (
       SELECT spent_usd, limit_usd
       FROM seeded_budget
       UNION ALL
       SELECT b.spent_usd::float AS spent_usd, b.limit_usd::float AS limit_usd
       FROM budgets b
       WHERE b.agent_id = $1
         AND b.month = date_trunc('month', now())::date
         AND NOT EXISTS (SELECT 1 FROM seeded_budget)
     )
     SELECT spent_usd >= limit_usd AS exceeded
     FROM current_budget
     LIMIT 1`,
    [agentId]
  );

  if (budgetRes.rows.length === 0) {
    return false;
  }

  return Boolean(budgetRes.rows[0].exceeded);
}

export async function applyAgentBudgetSpend(agentId: string, costUsd: number) {
  if (costUsd <= 0) {
    return { applied: true, capped: false };
  }

  const applyRes = await db.query(
    `WITH seeded_budget AS (
       INSERT INTO budgets (agent_id, month, limit_usd, spent_usd)
       SELECT id, date_trunc('month', now())::date, monthly_budget_usd, $2::numeric
       FROM agents
       WHERE id = $1
         AND monthly_budget_usd >= $2::numeric
       ON CONFLICT (agent_id, month) DO UPDATE
       SET limit_usd = GREATEST(budgets.limit_usd, EXCLUDED.limit_usd),
           spent_usd = budgets.spent_usd + EXCLUDED.spent_usd
       WHERE budgets.spent_usd + EXCLUDED.spent_usd <= budgets.limit_usd
       RETURNING spent_usd::float AS spent_usd, limit_usd::float AS limit_usd
     )
     SELECT spent_usd, limit_usd
     FROM seeded_budget`,
    [agentId, costUsd]
  );

  if (applyRes.rows.length > 0) {
    return { applied: true, capped: false };
  }

  const capExistingRes = await db.query(
    `UPDATE budgets
     SET spent_usd = limit_usd
     WHERE agent_id = $1
       AND month = date_trunc('month', now())::date
       AND limit_usd > 0
       AND spent_usd < limit_usd
     RETURNING spent_usd::float AS spent_usd, limit_usd::float AS limit_usd`,
    [agentId]
  );
  if (capExistingRes.rows.length > 0) {
    return { applied: false, capped: true };
  }

  const seedCappedRes = await db.query(
    `INSERT INTO budgets (agent_id, month, limit_usd, spent_usd)
     SELECT id, date_trunc('month', now())::date, monthly_budget_usd, monthly_budget_usd
     FROM agents
     WHERE id = $1
       AND monthly_budget_usd > 0
     ON CONFLICT (agent_id, month) DO NOTHING
     RETURNING spent_usd::float AS spent_usd, limit_usd::float AS limit_usd`,
    [agentId]
  );

  return { applied: false, capped: seedCappedRes.rows.length > 0 };
}

export async function getAgentBudgetSnapshot(
  agentId: string
): Promise<AgentBudgetSnapshot | null> {
  const snapshotRes = await db.query(
    `SELECT
       limit_usd::float AS limit_usd,
       spent_usd::float AS spent_usd,
       CASE
         WHEN limit_usd > 0 THEN ROUND((spent_usd / limit_usd) * 100, 2)
         ELSE NULL
       END AS utilization_pct
     FROM budgets
     WHERE agent_id = $1
       AND month = date_trunc('month', now())::date
     LIMIT 1`,
    [agentId]
  );

  return snapshotRes.rows[0]
    ? {
        limit_usd: Number(snapshotRes.rows[0].limit_usd ?? 0),
        spent_usd: Number(snapshotRes.rows[0].spent_usd ?? 0),
        utilization_pct:
          snapshotRes.rows[0].utilization_pct === null
            ? null
            : Number(snapshotRes.rows[0].utilization_pct),
      }
    : null;
}

export async function getCompanyDailyCost(companyId: string) {
  const costRes = await db.query(
    `SELECT COALESCE(SUM(cost_usd), 0)::float AS total
     FROM audit_log
     WHERE company_id = $1
       AND created_at >= date_trunc('day', now())`,
    [companyId]
  );

  return Number(costRes.rows[0]?.total ?? 0);
}

export async function emitBudgetThresholdAlert(args: {
  companyId: string;
  agentId: string;
  agentName: string;
  taskId: string;
  taskTitle: string;
  budget: AgentBudgetSnapshot;
}) {
  const utilizationPct = args.budget.utilization_pct;
  if (utilizationPct === null || args.budget.limit_usd <= 0) {
    return;
  }

  const thresholdPct =
    utilizationPct >= 95 ? 95 : utilizationPct >= 80 ? 80 : null;
  if (!thresholdPct) {
    return;
  }

  const monthKey = new Date().toISOString().slice(0, 7);
  const existingAlertRes = await db.query(
    `SELECT id
     FROM audit_log
     WHERE company_id = $1
       AND agent_id = $2
       AND action = 'budget.threshold_alerted'
       AND details->>'month' = $3
       AND details->>'threshold_pct' = $4
     LIMIT 1`,
    [args.companyId, args.agentId, monthKey, String(thresholdPct)]
  );

  if (existingAlertRes.rows.length > 0) {
    return;
  }

  const tone = thresholdPct >= 95 ? 'critical' : 'warning';
  const message = `${args.agentName} reached ${utilizationPct.toFixed(1)}% of monthly budget while working on "${args.taskTitle}" ($${args.budget.spent_usd.toFixed(2)} / $${args.budget.limit_usd.toFixed(2)}).`;

  await db.query(
    `INSERT INTO audit_log (company_id, agent_id, action, entity_type, entity_id, details)
     VALUES ($1, $2, 'budget.threshold_alerted', 'agent', $2, $3)`,
    [
      args.companyId,
      args.agentId,
      JSON.stringify({
        month: monthKey,
        task_id: args.taskId,
        task_title: args.taskTitle,
        threshold_pct: thresholdPct,
        utilization_pct: utilizationPct,
        spent_usd: args.budget.spent_usd,
        limit_usd: args.budget.limit_usd,
        tone,
      }),
    ]
  );

  await broadcastCompanyEvent(
    args.companyId,
    'budget.threshold',
    {
      agent_id: args.agentId,
      agent_name: args.agentName,
      task_id: args.taskId,
      task_title: args.taskTitle,
      threshold_pct: thresholdPct,
      utilization_pct: utilizationPct,
      spent_usd: args.budget.spent_usd,
      limit_usd: args.budget.limit_usd,
      tone,
      message,
    },
    'worker'
  );

  const companyRes = await db.query(
    'SELECT slack_webhook_url, discord_webhook_url FROM companies WHERE id = $1',
    [args.companyId]
  );
  const company = companyRes.rows[0];

  await deliverOutgoingWebhooks({
    companyId: args.companyId,
    agentId: args.agentId,
    event: 'budget.threshold',
    slackWebhookUrl: company?.slack_webhook_url ?? null,
    slackText: `Budget alert: ${message}`,
    discordWebhookUrl: company?.discord_webhook_url ?? null,
    discordMessage: `Budget alert: ${message}`,
    metadata: {
      task_id: args.taskId,
      task_title: args.taskTitle,
      threshold_pct: thresholdPct,
      utilization_pct: utilizationPct,
      spent_usd: args.budget.spent_usd,
      limit_usd: args.budget.limit_usd,
      tone,
    },
  });
}
