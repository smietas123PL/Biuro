import { db } from '../db/client.js';
import { logger } from '../utils/logger.js';
import { runtimeRegistry } from '../runtime/registry.js';
import { buildAgentContext } from './context.js';
import { AgentAction } from '../types/agent.js';
import { canUseTool } from '../tools/registry.js';
import { executeTool } from '../tools/executor.js';
import { evaluatePolicy } from '../governance/policies.js';
import { createApprovalRequest } from '../governance/approvals.js';
import { checkSafety, autoPauseAgent } from './safety.js';
import { getWSHub } from '../ws.js';
import { findRelatedMemories, storeMemory } from './memory.js';
import { BillingService } from '../services/billing.js';
import { AgentResponse } from '../types/agent.js';

export async function processAgentHeartbeat(agentId: string) {
  const startedAt = Date.now();

  // 1. Budget Check (Simplified for Faza 1B)
  const budgetRes = await db.query(
    'SELECT * FROM budgets WHERE agent_id = $1 AND month = date_trunc($2, now())::date',
    [agentId, 'month']
  );
  if (budgetRes.rows.length > 0 && budgetRes.rows[0].spent_usd >= budgetRes.rows[0].limit_usd) {
    logger.warn({ agentId }, 'Agent over budget, skipping heartbeat');
    return;
  }

  // 2. Atomic Task Checkout
  // Look for tasks assigned to this agent or unassigned tasks for their company (if we want auto-pickup)
  const task = await db.transaction(async (client) => {
    const res = await client.query(
      `UPDATE tasks 
       SET status = 'in_progress', locked_by = $1, locked_at = now() 
       WHERE id = (
         SELECT id FROM tasks 
         WHERE (assigned_to = $1 OR assigned_to IS NULL) 
         AND status IN ('backlog', 'assigned')
         ORDER BY priority DESC, created_at ASC 
         LIMIT 1 
         FOR UPDATE SKIP LOCKED
       ) 
       RETURNING *`,
      [agentId]
    );
    return res.rows[0];
  });

  if (!task) return;

  // 2.5 Safety Check
  const safety = await checkSafety(agentId, task.id);
  if (!safety.ok) {
    await autoPauseAgent(agentId, safety.reason!);
    return;
  }

  logger.info({ agentId, taskId: task.id }, 'Agent starting task work');

  // 2.8 WS Notify
  getWSHub()?.broadcast(task.company_id, 'agent.working', { agentId, taskId: task.id });

  try {
    // 3. Get Runtime & Build Context
    const memories = await findRelatedMemories(task.company_id, task.title + ' ' + task.description);
    
    const agentRes = await db.query('SELECT runtime FROM agents WHERE id = $1', [agentId]);
    const runtimeName = agentRes.rows[0].runtime;
    const runtime = runtimeRegistry.getRuntime(runtimeName);
    
    const context = await buildAgentContext(agentId, task.id);
    if (memories.length > 0) {
      context.additional_context = (context.additional_context || '') + 
        `\n\n### PAST EXPERIENCES (MEMORIES):\n${memories.join('\n---\n')}`;
    }

    // 3.5 Load Session State
    const sessionRes = await db.query(
      'SELECT state FROM agent_sessions WHERE agent_id = $1 AND task_id = $2',
      [agentId, task.id]
    );
    if (sessionRes.rows.length > 0) {
      context.history.push({
        role: 'user',
        content: `Restoring session. Previous state: ${JSON.stringify(sessionRes.rows[0].state)}`
      });
    }

    // 4. Execute
    const response = await runtime.execute(context);
    const usage = response.usage;
    const costUsd = usage?.cost_usd ?? 0;
    const durationMs = Date.now() - startedAt;

    // 4.5 Save Session State (if any metadata returned)
    const newState = usage || {}; // For now just save usage, but could be more
    await db.query(
      `INSERT INTO agent_sessions (agent_id, task_id, state) 
       VALUES ($1, $2, $3) 
       ON CONFLICT (agent_id, task_id) DO UPDATE SET state = $3, updated_at = now()`,
      [agentId, task.id, JSON.stringify(newState)]
    );

    // 5. Save History & Stats
    await db.query(
      `INSERT INTO audit_log (company_id, agent_id, action, details, cost_usd) 
       VALUES ($1, $2, $3, $4, $5)`,
      [task.company_id, agentId, 'heartbeat.completed', JSON.stringify({ thought: response.thought, task_id: task.id, duration_ms: durationMs }), costUsd]
    );

    await db.query(
      `INSERT INTO heartbeats (agent_id, task_id, status, duration_ms, cost_usd, details)
       VALUES ($1, $2, 'worked', $3, $4, $5)`,
      [agentId, task.id, durationMs, costUsd, JSON.stringify({ thought: response.thought })]
    );

    await db.query(
      `INSERT INTO budgets (agent_id, month, limit_usd, spent_usd)
       SELECT id, date_trunc('month', now())::date, monthly_budget_usd, $2
       FROM agents
       WHERE id = $1
       ON CONFLICT (agent_id, month) DO UPDATE
       SET spent_usd = budgets.spent_usd + EXCLUDED.spent_usd,
           limit_usd = GREATEST(budgets.limit_usd, EXCLUDED.limit_usd)`,
      [agentId, costUsd]
    );

    // 6. Process Actions
    for (const action of response.actions as AgentAction[]) {
      await handleAction(agentId, task, action, response);
    }

    // 7. Unlock Task
    await db.query(
      "UPDATE tasks SET status = 'in_progress', locked_by = NULL, locked_at = NULL WHERE id = $1",
      [task.id]
    );

  } catch (err) {
    logger.error({ err, agentId, taskId: task.id }, 'Heartbeat failed');
    await db.query(
      "UPDATE tasks SET status = 'backlog', locked_by = NULL, locked_at = NULL WHERE id = $1",
      [task.id]
    );
  }
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
      
      // Post-execution billing
      if (response.usage && response.usage.cost_usd > 0) {
        await BillingService.recordUsage(
          task.company_id, 
          response.usage.cost_usd, 
          `Agent ${agentId} completed task ${task.id}`
        );
      }
      break;

    case 'delegate':
      // 3.5.1 Policy Check for Delegation
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

      await db.query(
        `INSERT INTO tasks (company_id, parent_id, title, description, status) 
         VALUES ($1, $2, $3, $4, 'backlog')`,
        [task.company_id, task.id, `Delegated: ${action.name}`, action.description]
      );
      break;

    case 'use_tool':
      try {
        const canUse = await canUseTool(agentId, action.tool_name);
        if (!canUse) throw new Error(`Permission Denied for tool: ${action.tool_name}`);

        const result = await executeTool(agentId, task.id, action.tool_name, action.params);
        
        await db.query(
          `INSERT INTO messages (company_id, task_id, from_agent, content, type, metadata) 
           VALUES ($1, $2, $3, $4, 'tool_result', $5)`,
          [task.company_id, task.id, agentId, `Tool Result (${action.tool_name}): ${JSON.stringify(result)}`, 'tool_result', JSON.stringify({ tool: action.tool_name, result })]
        );
      } catch (err: any) {
        await db.query(
          `INSERT INTO messages (company_id, task_id, from_agent, content, type) 
           VALUES ($1, $2, $3, $4, 'status_update')`,
          [task.company_id, task.id, agentId, `Tool Error (${action.tool_name}): ${err.message}`, 'message']
        );
      }
      break;
    
    case 'request_approval':
      await createApprovalRequest(task.company_id, task.id, agentId, action.reason, action.payload);
      await db.query("UPDATE tasks SET status = 'blocked' WHERE id = $1", [task.id]);
      break;
    case 'message':
      await db.query(
        `INSERT INTO messages (company_id, task_id, from_agent, to_agent_id, content, type) 
         VALUES ($1, $2, $3, $4, $5, 'message')`,
        [task.company_id, task.id, agentId, action.to_agent_id, action.content]
      );
      break;

    case 'continue':
      // Just log the thought and keep working in next heartbeat
      await db.query(
        `INSERT INTO messages (company_id, task_id, from_agent, content, type) 
         VALUES ($1, $2, $3, $4, 'status_update')`,
        [task.company_id, task.id, agentId, action.thought]
      );
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
