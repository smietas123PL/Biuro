import { db } from '../db/client.js';
import { AgentResponse } from '../types/agent.js';
import { broadcastCompanyEvent } from '../realtime/eventBus.js';
import { broadcastCollaborationSignal } from '../services/collaboration.js';
import type { HeartbeatExecutionTelemetrySnapshot } from './heartbeatExecutionTelemetry.js';
import {
  applyAgentBudgetSpend,
  emitBudgetThresholdAlert,
  getAgentBudgetSnapshot,
  getCompanyDailyCost,
} from './heartbeatBudget.js';

export async function recordHeartbeat(
  agentId: string,
  status: string,
  startedAt: number,
  details: Record<string, unknown>
) {
  await db.query(
    `INSERT INTO heartbeats (agent_id, status, duration_ms, details)
     VALUES ($1, $2, $3, $4)`,
    [agentId, status, Date.now() - startedAt, JSON.stringify(details)]
  );
}

export async function persistSuccessfulHeartbeat(args: {
  agentId: string;
  agentName: string;
  task: any;
  response: AgentResponse;
  startedAt: number;
  executionTelemetry?: HeartbeatExecutionTelemetrySnapshot | null;
}) {
  const { agentId, agentName, task, response, startedAt, executionTelemetry } =
    args;
  const usage = response.usage;
  const costUsd = usage?.cost_usd ?? 0;
  const durationMs = Date.now() - startedAt;
  const budgetApplication = await applyAgentBudgetSpend(agentId, costUsd);
  const newState = usage || {};
  const llmFallbackCount =
    response.routing?.attempts.filter((attempt) => attempt.status === 'fallback')
      .length ?? 0;
  const heartbeatExecution =
    executionTelemetry ??
    ({
      retrieval_budget: {
        max_requests: 0,
        consumed_requests: 0,
        skipped_requests: 0,
      },
      retrievals: [],
      retrieval_fallback_count: 0,
      llm_fallback_count: llmFallbackCount,
    } satisfies HeartbeatExecutionTelemetrySnapshot);
  const mergedExecutionTelemetry: HeartbeatExecutionTelemetrySnapshot = {
    ...heartbeatExecution,
    llm_fallback_count: llmFallbackCount,
  };

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
        heartbeat_execution: mergedExecutionTelemetry,
      }),
      costUsd,
    ]
  );

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
        heartbeat_execution: mergedExecutionTelemetry,
      }),
    ]
  );

  if (
    typeof response.thought === 'string' &&
    response.thought.trim().length > 0
  ) {
    await broadcastCompanyEvent(
      task.company_id,
      'agent.thought',
      {
        agent_id: agentId,
        agent_name: agentName,
        task_id: task.id,
        task_title: task.title,
        thought: response.thought,
      },
      'worker'
    );
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
      await broadcastCompanyEvent(
        task.company_id,
        'budget.updated',
        {
          agent_id: agentId,
          agent_name: agentName,
          task_id: task.id,
          task_title: task.title,
          limit_usd: budgetSnapshot.limit_usd,
          spent_usd: budgetSnapshot.spent_usd,
          utilization_pct: budgetSnapshot.utilization_pct,
        },
        'worker'
      );

      await emitBudgetThresholdAlert({
        companyId: task.company_id,
        agentId,
        agentName,
        taskId: task.id,
        taskTitle: task.title,
        budget: budgetSnapshot,
      });
    }

    await broadcastCompanyEvent(
      task.company_id,
      'cost.updated',
      {
        agent_id: agentId,
        agent_name: agentName,
        task_id: task.id,
        task_title: task.title,
        delta_cost_usd: costUsd,
        daily_cost_usd: companyDailyCostUsd,
      },
      'worker'
    );
  }
  return {
    costUsd,
    durationMs,
    budgetApplication,
  };
}
