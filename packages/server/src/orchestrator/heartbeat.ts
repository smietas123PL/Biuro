import { SpanStatusCode } from '@opentelemetry/api';
import { db } from '../db/client.js';
import { evaluatePolicy } from '../governance/policies.js';
import {
  activeHeartbeatsGauge,
  recordHeartbeatMetric,
} from '../observability/metrics.js';
import { startActiveSpan } from '../observability/tracing.js';
import { broadcastCompanyEvent } from '../realtime/eventBus.js';
import { AgentAction, AgentActionsSchema } from '../types/agent.js';
import { logger } from '../utils/logger.js';
import { handleHeartbeatAction } from './heartbeatActions.js';
import { isAgentBudgetExceeded } from './heartbeatBudget.js';
import {
  persistSuccessfulHeartbeat,
  recordHeartbeat,
} from './heartbeatRecording.js';
import { prepareHeartbeatExecution } from './heartbeatRuntime.js';
import { autoPauseAgent, checkSafety } from './safety.js';

export type HeartbeatOutcome = {
  status:
    | 'skipped'
    | 'idle'
    | 'budget_exceeded'
    | 'blocked'
    | 'worked'
    | 'error';
  companyId: string | null;
  taskId: string | null;
};

export { applyAgentBudgetSpend } from './heartbeatBudget.js';

export async function processAgentHeartbeat(agentId: string) {
  const startedAt = Date.now();
  return startActiveSpan(
    'worker.heartbeat',
    { 'agent.id': agentId },
    async (span) => {
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
        const rateLimitPolicy = await evaluatePolicy(companyId, 'rate_limit', {
          agentId,
        });
        if (!rateLimitPolicy.allowed) {
          logger.warn(
            { agentId, reason: rateLimitPolicy.reason },
            'Agent heartbeat blocked by rate limit policy'
          );
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
          await recordHeartbeat(agentId, heartbeatStatus, startedAt, {
            reason: 'monthly budget exceeded',
          });
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
          await recordHeartbeat(agentId, heartbeatStatus, startedAt, {
            reason: 'no eligible tasks',
          });
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

        const { agentName, context, runtime } = await prepareHeartbeatExecution(
          agentId,
          task
        );

        await broadcastCompanyEvent(
          task.company_id,
          'agent.working',
          {
            agentId,
            agentName,
            taskId: task.id,
            taskTitle: task.title,
          },
          'worker'
        );

        const response = await runtime.execute(context);
        const parsedActions = AgentActionsSchema.safeParse(
          response.actions ?? []
        );
        if (!parsedActions.success) {
          logger.warn(
            { agentId, taskId: task.id, issues: parsedActions.error.issues },
            'Runtime returned invalid actions'
          );
          throw new Error('Runtime returned invalid actions');
        }

        const persistence = await persistSuccessfulHeartbeat({
          agentId,
          agentName,
          task,
          response,
          startedAt,
        });

        span.setAttribute('heartbeat.cost_usd', persistence.costUsd);
        span.setAttribute('heartbeat.duration_ms', persistence.durationMs);
        span.setAttribute('heartbeat.status', 'worked');

        heartbeatStatus = 'worked';
        outcome = {
          status: 'worked',
          companyId,
          taskId: task.id,
        };

        for (const action of parsedActions.data as AgentAction[]) {
          await handleHeartbeatAction(agentId, task, action);
        }

        await db.query(
          'UPDATE tasks SET locked_by = NULL, locked_at = NULL WHERE id = $1',
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
          message:
            err instanceof Error ? err.message : 'Unknown heartbeat error',
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
    }
  );
}
