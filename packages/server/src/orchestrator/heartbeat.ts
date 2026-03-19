import { db } from '../db/client.js';
import { SpanStatusCode } from '@opentelemetry/api';
import { logger } from '../utils/logger.js';
import { runtimeRegistry } from '../runtime/registry.js';
import { extractCompanyRuntimeSettings } from '../runtime/preferences.js';
import { buildAgentContext } from './context.js';
import { AgentAction, AgentActionsSchema, AgentResponse } from '../types/agent.js';
import { canUseTool } from '../tools/registry.js';
import { executeTool } from '../tools/executor.js';
import { evaluatePolicy } from '../governance/policies.js';
import { createApprovalRequest } from '../governance/approvals.js';
import { checkSafety, autoPauseAgent } from './safety.js';
import { broadcastCompanyEvent } from '../realtime/eventBus.js';
import { findRelatedMemories, storeMemory } from './memory.js';
import { broadcastCollaborationSignal, findDelegateAgent } from '../services/collaboration.js';
import { activeHeartbeatsGauge, recordHeartbeatMetric } from '../observability/metrics.js';
import { startActiveSpan } from '../observability/tracing.js';
import { NotificationService } from '../services/notifications.js';
import { enqueueCompanyWakeup } from './schedulerQueue.js';

export type HeartbeatOutcome = {
  status: 'skipped' | 'idle' | 'budget_exceeded' | 'blocked' | 'worked' | 'error';
  companyId: string | null;
  taskId: string | null;
};

export async function processAgentHeartbeat(agentId: string) {
  const startedAt = Date.now();
  return startActiveSpan('worker.heartbeat', { 'agent.id': agentId }, async (span) => {
    let outcome: HeartbeatOutcome = {
      status: 'skipped',
      companyId: null,
      taskId: null,
    };
    const claimRes = await db.query(
      "UPDATE agents SET status = 'working' WHERE id = $1 AND status = 'idle' RETURNING id, company_id",
      [agentId]
    );

    if (claimRes.rows.length === 0) {
      span.setAttribute('heartbeat.claimed', false);
      span.setAttribute('heartbeat.status', 'skipped');
      return outcome;
    }

    const companyId = claimRes.rows[0].company_id as string;
    let task: any;
    let heartbeatStatus = 'idle';

    span.setAttribute('heartbeat.claimed', true);
    span.setAttribute('company.id', companyId);
    activeHeartbeatsGauge.inc();

    try {
      const rateLimitPolicy = await evaluatePolicy(companyId, 'rate_limit', { agentId });
      if (!rateLimitPolicy.allowed) {
        logger.warn({ agentId, reason: rateLimitPolicy.reason }, 'Agent heartbeat blocked by rate limit policy');
        span.setAttribute('heartbeat.status', heartbeatStatus);
        await recordHeartbeat(agentId, heartbeatStatus, startedAt, {
          reason: rateLimitPolicy.reason ?? 'agent rate limit exceeded',
        });
        outcome = {
          status: 'idle',
          companyId,
          taskId: null,
        };
        return outcome;
      }

      const budgetExceeded = await isAgentBudgetExceeded(agentId);
      if (budgetExceeded) {
        logger.warn({ agentId }, 'Agent over budget, skipping heartbeat');
        heartbeatStatus = 'budget_exceeded';
        span.setAttribute('heartbeat.status', heartbeatStatus);
        await recordHeartbeat(agentId, heartbeatStatus, startedAt, { reason: 'monthly budget exceeded' });
        outcome = {
          status: 'budget_exceeded',
          companyId,
          taskId: null,
        };
        return outcome;
      }

      task = await db.transaction(async (client) => {
        const res = await client.query(
          `UPDATE tasks
           SET status = 'in_progress', locked_by = $1, locked_at = now()
           WHERE id = (
             SELECT id FROM tasks
           WHERE (assigned_to = $1 OR assigned_to IS NULL)
             AND (
               status IN ('backlog', 'assigned')
               OR (status = 'in_progress' AND assigned_to = $1 AND locked_by IS NULL)
             )
           ORDER BY priority DESC, created_at ASC
           LIMIT 1
           FOR UPDATE SKIP LOCKED
           )
           RETURNING *`,
          [agentId]
        );
        return res.rows[0];
      });

      if (!task) {
        span.setAttribute('heartbeat.status', heartbeatStatus);
        await recordHeartbeat(agentId, heartbeatStatus, startedAt, { reason: 'no eligible tasks' });
        outcome = {
          status: 'idle',
          companyId,
          taskId: null,
        };
        return outcome;
      }

      outcome.companyId = task.company_id;
      outcome.taskId = task.id;
      span.setAttribute('task.id', task.id);
      span.setAttribute('task.status', task.status);

      const safety = await checkSafety(agentId, task.id);
      if (!safety.ok) {
        heartbeatStatus = 'blocked';
        span.setAttribute('heartbeat.status', heartbeatStatus);
        await db.query(
          "UPDATE tasks SET status = 'blocked', locked_by = NULL, locked_at = NULL WHERE id = $1",
          [task.id]
        );
        await autoPauseAgent(agentId, safety.reason!);
        outcome = {
          status: 'blocked',
          companyId,
          taskId: task.id,
        };
        return outcome;
      }

      logger.info({ agentId, taskId: task.id }, 'Agent starting task work');

      const memories = await findRelatedMemories(task.company_id, task.title + ' ' + task.description, 3, {
        agentId,
        taskId: task.id,
        consumer: 'heartbeat_memory',
      });

      const agentRes = await db.query('SELECT runtime, name FROM agents WHERE id = $1', [agentId]);
      const runtimeName = agentRes.rows[0].runtime;
      const agentName = agentRes.rows[0].name;
      const companyConfigRes = await db.query('SELECT config FROM companies WHERE id = $1', [task.company_id]);
      const runtimeSettings = extractCompanyRuntimeSettings(companyConfigRes.rows[0]?.config);
      const preferredRuntime = runtimeSettings.primaryRuntime || runtimeName;
      const runtime = runtimeRegistry.getRuntime(preferredRuntime, {
        fallbackOrder: runtimeSettings.fallbackOrder,
      });

      await broadcastCompanyEvent(task.company_id, 'agent.working', {
        agentId,
        agentName,
        taskId: task.id,
        taskTitle: task.title,
      }, 'worker');

      const context = await buildAgentContext(agentId, task.id);
      if (memories.length > 0) {
        context.additional_context = (context.additional_context || '') +
          `\n\n### PAST EXPERIENCES (MEMORIES):\n${memories.join('\n---\n')}`;
      }

      const sessionRes = await db.query(
        'SELECT state FROM agent_sessions WHERE agent_id = $1 AND task_id = $2',
        [agentId, task.id]
      );
      if (sessionRes.rows.length > 0) {
        context.history.push({
          role: 'user',
          content: `Restoring session. Previous state: ${JSON.stringify(sessionRes.rows[0].state)}`,
        });
      }

      const response = await runtime.execute(context);
      const parsedActions = AgentActionsSchema.safeParse(response.actions ?? []);
      if (!parsedActions.success) {
        logger.warn(
          { agentId, taskId: task.id, issues: parsedActions.error.issues },
          'Runtime returned invalid actions'
        );
        throw new Error('Runtime returned invalid actions');
      }

      const usage = response.usage;
      const costUsd = usage?.cost_usd ?? 0;
      const durationMs = Date.now() - startedAt;
      const budgetApplication = await applyAgentBudgetSpend(agentId, costUsd);

      span.setAttribute('heartbeat.cost_usd', costUsd);
      span.setAttribute('heartbeat.duration_ms', durationMs);

      const newState = usage || {};
      await db.query(
        `INSERT INTO agent_sessions (agent_id, task_id, state)
         VALUES ($1, $2, $3)
         ON CONFLICT (agent_id, task_id) DO UPDATE SET state = $3, updated_at = now()`,
        [agentId, task.id, JSON.stringify(newState)]
      );

      await db.query(
        `INSERT INTO audit_log (company_id, agent_id, action, details, cost_usd)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          task.company_id,
          agentId,
          'heartbeat.completed',
          JSON.stringify({
            thought: response.thought,
            task_id: task.id,
            duration_ms: durationMs,
            budget_capped: !budgetApplication.applied,
            llm_routing: response.routing ?? null,
          }),
          costUsd,
        ]
      );

      heartbeatStatus = 'worked';
      outcome = {
        status: 'worked',
        companyId,
        taskId: task.id,
      };
      span.setAttribute('heartbeat.status', heartbeatStatus);
      await db.query(
        `INSERT INTO heartbeats (agent_id, task_id, status, duration_ms, cost_usd, details)
         VALUES ($1, $2, 'worked', $3, $4, $5)`,
        [
          agentId,
          task.id,
          durationMs,
          costUsd,
          JSON.stringify({
            thought: response.thought,
            budget_capped: !budgetApplication.applied,
            llm_routing: response.routing ?? null,
          }),
        ]
      );

      if (typeof response.thought === 'string' && response.thought.trim().length > 0) {
        await broadcastCollaborationSignal(task.company_id, task.id, 'thought', {
          agent_id: agentId,
          task_title: task.title,
        });
      }

      if (costUsd > 0) {
        const [budgetSnapshot, companyDailyCostUsd] = await Promise.all([
          getAgentBudgetSnapshot(agentId),
          getCompanyDailyCost(task.company_id),
        ]);

        if (budgetSnapshot) {
          await broadcastCompanyEvent(task.company_id, 'budget.updated', {
            agent_id: agentId,
            agent_name: agentName,
            task_id: task.id,
            task_title: task.title,
            limit_usd: budgetSnapshot.limit_usd,
            spent_usd: budgetSnapshot.spent_usd,
            utilization_pct: budgetSnapshot.utilization_pct,
          }, 'worker');

          await emitBudgetThresholdAlert({
            companyId: task.company_id,
            agentId,
            agentName,
            taskId: task.id,
            taskTitle: task.title,
            budget: budgetSnapshot,
          });
        }

        await broadcastCompanyEvent(task.company_id, 'cost.updated', {
          agent_id: agentId,
          agent_name: agentName,
          task_id: task.id,
          task_title: task.title,
          delta_cost_usd: costUsd,
          daily_cost_usd: companyDailyCostUsd,
        }, 'worker');
      }

      for (const action of parsedActions.data as AgentAction[]) {
        await handleAction(agentId, task, action, response);
      }

      await db.query(
        "UPDATE tasks SET locked_by = NULL, locked_at = NULL WHERE id = $1",
        [task.id]
      );
    } catch (err) {
      heartbeatStatus = 'error';
      outcome = {
        status: 'error',
        companyId,
        taskId: task?.id ?? null,
      };
      span.setAttribute('heartbeat.status', heartbeatStatus);
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: err instanceof Error ? err.message : 'Unknown heartbeat error',
      });
      logger.error({ err, agentId, taskId: task?.id }, 'Heartbeat failed');
      await recordHeartbeat(agentId, heartbeatStatus, startedAt, {
        error: err instanceof Error ? err.message : 'Unknown heartbeat error',
        task_id: task?.id ?? null,
      });

      if (task?.id) {
        await db.query(
          "UPDATE tasks SET status = 'backlog', locked_by = NULL, locked_at = NULL WHERE id = $1",
          [task.id]
        );
      }
    } finally {
      recordHeartbeatMetric(heartbeatStatus, Date.now() - startedAt);
      activeHeartbeatsGauge.dec();
      await db.query(
        "UPDATE agents SET status = 'idle' WHERE id = $1 AND status = 'working'",
        [agentId]
      );
    }

    return outcome;
  });
}

async function handleAction(agentId: string, task: any, action: AgentAction, response: AgentResponse) {
  logger.info({ agentId, action: action.type }, 'Processing agent action');

  switch (action.type) {
    case 'complete_task':
      await db.query(
        "UPDATE tasks SET status = 'done', result = $1, completed_at = now() WHERE id = $2",
        [action.result, task.id]
      );
      await storeMemory(task.company_id, agentId, task.id, `Task: ${task.title}\nResult: ${action.result}`);
      break;

    case 'delegate': {
      const delegationDepth = await getDelegationDepth(task.id);
      const policy = await evaluatePolicy(task.company_id, 'delegation_limit', { depth: delegationDepth + 1 });

      if (!policy.allowed) {
        if (policy.requires_approval) {
          await createApprovalRequest(task.company_id, task.id, agentId, policy.reason!, action, policy.policy_id);
          await db.query("UPDATE tasks SET status = 'blocked' WHERE id = $1", [task.id]);
        } else {
          logger.warn({ agentId, taskId: task.id }, 'Delegation blocked by policy');
        }
        break;
      }

      const delegateAgent = await findDelegateAgent(task.company_id, action.to_role, agentId);
      const delegatedTaskRes = await db.query(
        `INSERT INTO tasks (company_id, parent_id, title, description, assigned_to, status, metadata)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id, assigned_to`,
        [
          task.company_id,
          task.id,
          `Delegated: ${action.name}`,
          action.description,
          delegateAgent?.id ?? null,
          delegateAgent ? 'assigned' : 'backlog',
          JSON.stringify({
            delegated_by_agent_id: agentId,
            delegated_to_role: action.to_role,
          }),
        ]
      );
      const delegatedTaskId = delegatedTaskRes.rows[0]?.id as string | undefined;
      await enqueueCompanyWakeup(task.company_id, 'delegated_task_created', {
        taskId: delegatedTaskId ?? null,
        agentId: delegateAgent?.id ?? null,
      });

      await db.query(
        `INSERT INTO messages (company_id, task_id, from_agent, to_agent, content, type, metadata)
         VALUES ($1, $2, $3, $4, $5, 'delegation', $6)`,
        [
          task.company_id,
          task.id,
          agentId,
          delegateAgent?.id ?? null,
          delegateAgent
            ? `Delegated "${action.name}" to ${delegateAgent.name}.`
            : `Delegated "${action.name}" for role ${action.to_role}.`,
          JSON.stringify({
            child_task_id: delegatedTaskId ?? null,
            delegated_to_role: action.to_role,
            delegated_to_agent_id: delegateAgent?.id ?? null,
          }),
        ]
      );

      if (delegatedTaskId) {
        await db.query(
          `INSERT INTO messages (company_id, task_id, from_agent, to_agent, content, type, metadata)
           VALUES ($1, $2, $3, $4, $5, 'message', $6)`,
          [
            task.company_id,
            delegatedTaskId,
            agentId,
            delegateAgent?.id ?? null,
            action.description,
            JSON.stringify({
              source: 'auto_delegation_handoff',
              parent_task_id: task.id,
              parent_task_title: task.title,
            }),
          ]
        );
      }

      await broadcastCollaborationSignal(task.company_id, task.id, 'delegation', {
        agent_id: agentId,
        delegated_task_id: delegatedTaskId ?? null,
        delegated_to_agent_id: delegateAgent?.id ?? null,
        delegated_to_role: action.to_role,
      });
      break;
    }

    case 'use_tool':
      try {
        const toolPolicy = await evaluatePolicy(task.company_id, 'tool_restriction', { tool_name: action.tool_name });
        if (!toolPolicy.allowed) {
          throw new Error(toolPolicy.reason || `Tool blocked by policy: ${action.tool_name}`);
        }

        const canUse = await canUseTool(agentId, action.tool_name);
        if (!canUse) throw new Error(`Permission denied for tool: ${action.tool_name}`);

        const result = await executeTool(agentId, task.id, action.tool_name, action.params);

        await db.query(
          `INSERT INTO messages (company_id, task_id, from_agent, content, type, metadata)
           VALUES ($1, $2, $3, $4, 'tool_result', $5)`,
          [task.company_id, task.id, agentId, `Tool Result (${action.tool_name}): ${JSON.stringify(result)}`, JSON.stringify({ tool: action.tool_name, result })]
        );
      } catch (err: any) {
        await db.query(
          `INSERT INTO messages (company_id, task_id, from_agent, content, type)
           VALUES ($1, $2, $3, $4, 'status_update')`,
          [task.company_id, task.id, agentId, `Tool Error (${action.tool_name}): ${err.message}`]
        );
      }
      break;

    case 'request_approval':
      await createApprovalRequest(task.company_id, task.id, agentId, action.reason, action.payload);
      await db.query("UPDATE tasks SET status = 'blocked' WHERE id = $1", [task.id]);
      break;

    case 'message':
      await db.query(
        `INSERT INTO messages (company_id, task_id, from_agent, to_agent, content, type)
         VALUES ($1, $2, $3, $4, $5, 'message')`,
        [task.company_id, task.id, agentId, action.to_agent_id, action.content]
      );
      await broadcastCollaborationSignal(task.company_id, task.id, 'message', {
        agent_id: agentId,
        to_agent_id: action.to_agent_id,
      });
      break;

    case 'continue':
      await db.query(
        `INSERT INTO messages (company_id, task_id, from_agent, content, type)
         VALUES ($1, $2, $3, $4, 'status_update')`,
        [task.company_id, task.id, agentId, action.thought]
      );
      await broadcastCollaborationSignal(task.company_id, task.id, 'status_update', {
        agent_id: agentId,
      });
      break;
  }
}

async function getDelegationDepth(taskId: string): Promise<number> {
  const res = await db.query(
    "WITH RECURSIVE parents AS (SELECT id, parent_id FROM tasks WHERE id = $1 UNION ALL SELECT t.id, t.parent_id FROM tasks t JOIN parents p ON t.id = p.parent_id) SELECT count(*) FROM parents",
    [taskId]
  );
  return parseInt(res.rows[0].count) - 1;
}

async function recordHeartbeat(agentId: string, status: string, startedAt: number, details: Record<string, unknown>) {
  await db.query(
    `INSERT INTO heartbeats (agent_id, status, duration_ms, details)
     VALUES ($1, $2, $3, $4)`,
    [agentId, status, Date.now() - startedAt, JSON.stringify(details)]
  );
}

async function isAgentBudgetExceeded(agentId: string) {
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

async function getAgentBudgetSnapshot(agentId: string) {
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

async function getCompanyDailyCost(companyId: string) {
  const costRes = await db.query(
    `SELECT COALESCE(SUM(cost_usd), 0)::float AS total
     FROM audit_log
     WHERE company_id = $1
       AND created_at >= date_trunc('day', now())`,
    [companyId]
  );

  return Number(costRes.rows[0]?.total ?? 0);
}

async function emitBudgetThresholdAlert(args: {
  companyId: string;
  agentId: string;
  agentName: string;
  taskId: string;
  taskTitle: string;
  budget: {
    limit_usd: number;
    spent_usd: number;
    utilization_pct: number | null;
  };
}) {
  const utilizationPct = args.budget.utilization_pct;
  if (utilizationPct === null || args.budget.limit_usd <= 0) {
    return;
  }

  const thresholdPct = utilizationPct >= 95 ? 95 : utilizationPct >= 80 ? 80 : null;
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

  await broadcastCompanyEvent(args.companyId, 'budget.threshold', {
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
  }, 'worker');

  const companyRes = await db.query(
    'SELECT slack_webhook_url, discord_webhook_url FROM companies WHERE id = $1',
    [args.companyId]
  );
  const company = companyRes.rows[0];

  if (company?.slack_webhook_url) {
    await NotificationService.alertSlack(company.slack_webhook_url, `Budget alert: ${message}`);
  }

  if (company?.discord_webhook_url) {
    await NotificationService.alertDiscord(company.discord_webhook_url, `Budget alert: ${message}`);
  }
}
