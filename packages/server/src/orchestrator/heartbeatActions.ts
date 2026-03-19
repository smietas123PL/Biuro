import { db } from '../db/client.js';
import { logger } from '../utils/logger.js';
import { AgentAction } from '../types/agent.js';
import { canUseTool } from '../tools/registry.js';
import { executeTool } from '../tools/executor.js';
import { evaluatePolicy } from '../governance/policies.js';
import { createApprovalRequest } from '../governance/approvals.js';
import {
  broadcastCollaborationSignal,
  findDelegateAgent,
} from '../services/collaboration.js';
import { enqueueCompanyWakeup } from './schedulerQueue.js';
import { storeMemory } from './memory.js';

export async function handleHeartbeatAction(
  agentId: string,
  task: any,
  action: AgentAction
) {
  logger.info({ agentId, action: action.type }, 'Processing agent action');

  switch (action.type) {
    case 'complete_task':
      await db.query(
        "UPDATE tasks SET status = 'done', result = $1, completed_at = now() WHERE id = $2",
        [action.result, task.id]
      );
      await storeMemory(
        task.company_id,
        agentId,
        task.id,
        `Task: ${task.title}\nResult: ${action.result}`
      );
      break;

    case 'delegate': {
      const delegationDepth = await getDelegationDepth(task.id);
      const policy = await evaluatePolicy(task.company_id, 'delegation_limit', {
        depth: delegationDepth + 1,
      });

      if (!policy.allowed) {
        if (policy.requires_approval) {
          await createApprovalRequest(
            task.company_id,
            task.id,
            agentId,
            policy.reason!,
            action,
            policy.policy_id
          );
          await db.query("UPDATE tasks SET status = 'blocked' WHERE id = $1", [
            task.id,
          ]);
        } else {
          logger.warn(
            { agentId, taskId: task.id },
            'Delegation blocked by policy'
          );
        }
        break;
      }

      const delegateAgent = await findDelegateAgent(
        task.company_id,
        action.to_role,
        agentId
      );
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
      const delegatedTaskId = delegatedTaskRes.rows[0]?.id as
        | string
        | undefined;
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

      await broadcastCollaborationSignal(
        task.company_id,
        task.id,
        'delegation',
        {
          agent_id: agentId,
          delegated_task_id: delegatedTaskId ?? null,
          delegated_to_agent_id: delegateAgent?.id ?? null,
          delegated_to_role: action.to_role,
        }
      );
      break;
    }

    case 'use_tool':
      try {
        const toolPolicy = await evaluatePolicy(
          task.company_id,
          'tool_restriction',
          { tool_name: action.tool_name }
        );
        if (!toolPolicy.allowed) {
          throw new Error(
            toolPolicy.reason || `Tool blocked by policy: ${action.tool_name}`
          );
        }

        const canUse = await canUseTool(agentId, action.tool_name);
        if (!canUse) {
          throw new Error(`Permission denied for tool: ${action.tool_name}`);
        }

        const result = await executeTool(
          agentId,
          task.id,
          action.tool_name,
          action.params
        );

        await db.query(
          `INSERT INTO messages (company_id, task_id, from_agent, content, type, metadata)
           VALUES ($1, $2, $3, $4, 'tool_result', $5)`,
          [
            task.company_id,
            task.id,
            agentId,
            `Tool Result (${action.tool_name}): ${JSON.stringify(result)}`,
            JSON.stringify({ tool: action.tool_name, result }),
          ]
        );
      } catch (err: any) {
        await db.query(
          `INSERT INTO messages (company_id, task_id, from_agent, content, type)
           VALUES ($1, $2, $3, $4, 'status_update')`,
          [
            task.company_id,
            task.id,
            agentId,
            `Tool Error (${action.tool_name}): ${err.message}`,
          ]
        );
      }
      break;

    case 'request_approval':
      await createApprovalRequest(
        task.company_id,
        task.id,
        agentId,
        action.reason,
        action.payload
      );
      await db.query("UPDATE tasks SET status = 'blocked' WHERE id = $1", [
        task.id,
      ]);
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
      await broadcastCollaborationSignal(
        task.company_id,
        task.id,
        'status_update',
        {
          agent_id: agentId,
        }
      );
      break;
  }
}

async function getDelegationDepth(taskId: string): Promise<number> {
  const res = await db.query(
    'WITH RECURSIVE parents AS (SELECT id, parent_id FROM tasks WHERE id = $1 UNION ALL SELECT t.id, t.parent_id FROM tasks t JOIN parents p ON t.id = p.parent_id) SELECT count(*) FROM parents',
    [taskId]
  );
  return parseInt(res.rows[0].count) - 1;
}
