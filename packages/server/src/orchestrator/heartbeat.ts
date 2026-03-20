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
import type { HeartbeatExecutionTelemetrySnapshot } from './heartbeatExecutionTelemetry.js';
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

async function claimHeartbeatAgent(agentId: string) {
  const claimRes = await db.query(
    "UPDATE agents SET status = 'working' WHERE id = $1 AND status = 'idle' RETURNING id, company_id",
    [agentId]
  );

  if (claimRes.rows.length === 0) {
    return null;
  }

  return {
    companyId: claimRes.rows[0].company_id as string,
  };
}

async function enforceHeartbeatGuards(args: {
  agentId: string;
  companyId: string;
  startedAt: number;
}) {
  const { agentId, companyId, startedAt } = args;
  const rateLimitPolicy = await evaluatePolicy(companyId, 'rate_limit', {
    agentId,
  });
  if (!rateLimitPolicy.allowed) {
    logger.warn(
      { agentId, reason: rateLimitPolicy.reason },
      'Agent heartbeat blocked by rate limit policy'
    );
    await recordHeartbeat(agentId, 'idle', startedAt, {
      reason: rateLimitPolicy.reason ?? 'agent rate limit exceeded',
    });
    return {
      heartbeatStatus: 'idle' as const,
      outcome: {
        status: 'idle' as const,
        companyId,
        taskId: null,
      },
    };
  }

  const budgetExceeded = await isAgentBudgetExceeded(agentId);
  if (budgetExceeded) {
    logger.warn({ agentId }, 'Agent over budget, skipping heartbeat');
    await recordHeartbeat(agentId, 'budget_exceeded', startedAt, {
      reason: 'monthly budget exceeded',
    });
    return {
      heartbeatStatus: 'budget_exceeded' as const,
      outcome: {
        status: 'budget_exceeded' as const,
        companyId,
        taskId: null,
      },
    };
  }

  return null;
}

async function checkoutHeartbeatTask(agentId: string) {
  return db.transaction(async (client) => {
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
}

async function setTaskBlocked(taskId: string) {
  await db.query(
    "UPDATE tasks SET status = 'blocked', locked_by = NULL, locked_at = NULL WHERE id = $1",
    [taskId]
  );
}

async function releaseTaskLock(taskId: string) {
  await db.query(
    'UPDATE tasks SET locked_by = NULL, locked_at = NULL WHERE id = $1',
    [taskId]
  );
}

async function resetTaskAfterFailure(taskId: string) {
  await db.query(
    "UPDATE tasks SET status = 'backlog', locked_by = NULL, locked_at = NULL WHERE id = $1",
    [taskId]
  );
}

async function restoreAgentToIdle(agentId: string) {
  await db.query(
    "UPDATE agents SET status = 'idle' WHERE id = $1 AND status = 'working'",
    [agentId]
  );
}

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
      const claim = await claimHeartbeatAgent(agentId);

      if (!claim) {
        span.setAttribute('heartbeat.claimed', false);
        span.setAttribute('heartbeat.status', 'skipped');
        return outcome;
      }

      const { companyId } = claim;
      let task: any;
      let heartbeatStatus = 'idle';
      let executionTelemetry: HeartbeatExecutionTelemetrySnapshot | null = null;

      span.setAttribute('heartbeat.claimed', true);
      span.setAttribute('company.id', companyId);
      activeHeartbeatsGauge.inc();

      try {
        const guardResult = await enforceHeartbeatGuards({
          agentId,
          companyId,
          startedAt,
        });
        if (guardResult) {
          heartbeatStatus = guardResult.heartbeatStatus;
          span.setAttribute('heartbeat.status', heartbeatStatus);
          outcome = guardResult.outcome;
          return outcome;
        }

        task = await checkoutHeartbeatTask(agentId);

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
          await setTaskBlocked(task.id);
          await autoPauseAgent(agentId, safety.reason!);
          outcome = {
            status: 'blocked',
            companyId,
            taskId: task.id,
          };
          return outcome;
        }

        logger.info({ agentId, taskId: task.id }, 'Agent starting task work');

        const preparedExecution = await prepareHeartbeatExecution(agentId, task);
        const { agentName, context, runtime } = preparedExecution;
        executionTelemetry = preparedExecution.executionTelemetry.snapshot();
        span.setAttribute(
          'heartbeat.retrieval_count',
          executionTelemetry.retrievals.length
        );
        span.setAttribute(
          'heartbeat.retrieval_fallback_count',
          executionTelemetry.retrieval_fallback_count
        );
        span.setAttribute(
          'heartbeat.retrieval_skipped_count',
          executionTelemetry.retrieval_budget.skipped_requests
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
          executionTelemetry,
        });
        const llmFallbackCount =
          response.routing?.attempts.filter(
            (attempt) => attempt.status === 'fallback'
          ).length ?? 0;
        span.setAttribute(
          'heartbeat.llm_fallback_count',
          llmFallbackCount
        );

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

        await releaseTaskLock(task.id);
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
          heartbeat_execution: executionTelemetry,
        });

        if (task?.id) {
          await resetTaskAfterFailure(task.id);
        }
      } finally {
        recordHeartbeatMetric(heartbeatStatus, Date.now() - startedAt);
        activeHeartbeatsGauge.dec();
        await restoreAgentToIdle(agentId);
      }

      return outcome;
    }
  );
}
