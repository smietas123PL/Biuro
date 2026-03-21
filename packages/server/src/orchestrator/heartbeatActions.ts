import { db } from '../db/client.js';
import { logger } from '../utils/logger.js';
import { AgentAction } from '../types/agent.js';
import { canUseTool } from '../tools/registry.js';
import { executeTool } from '../tools/executor.js';
import { evaluatePolicy } from '../governance/policies.js';
import { createApprovalRequest } from '../governance/approvals.js';
import { evaluateCriticalToolConsensus } from '../governance/multiModelConsensus.js';
import { broadcastCompanyEvent } from '../realtime/eventBus.js';
import {
  broadcastCollaborationSignal,
  findDelegateAgent,
} from '../services/collaboration.js';
import { enqueueCompanyWakeup } from './schedulerQueue.js';
import { storeMemory } from './memory.js';

async function insertStatusUpdate(
  companyId: string,
  taskId: string,
  agentId: string,
  content: string
) {
  await db.query(
    `INSERT INTO messages (company_id, task_id, from_agent, content, type)
     VALUES ($1, $2, $3, $4, 'status_update')`,
    [companyId, taskId, agentId, content]
  );
}

async function blockTaskForApproval(args: {
  companyId: string;
  taskId: string;
  assignedTo?: string | null;
  agentId: string;
  reason: string;
  payload: Record<string, unknown>;
  policyId?: string;
}) {
  const { companyId, taskId, assignedTo, agentId, reason, payload, policyId } =
    args;
  await createApprovalRequest(
    companyId,
    taskId,
    agentId,
    reason,
    payload,
    policyId
  );
  await db.query(
    "UPDATE tasks SET status = 'blocked', locked_by = NULL, locked_at = NULL WHERE id = $1",
    [taskId]
  );
  await broadcastCollaborationSignal(companyId, taskId, 'status_update', {
    agent_id: agentId,
    status: 'blocked',
  });
  await broadcastCompanyEvent(
    companyId,
    'task.updated',
    {
      company_id: companyId,
      task_id: taskId,
      status: 'blocked',
      assigned_to: assignedTo ?? null,
      source: 'approval_requested',
    },
    'worker'
  );
}

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
      await broadcastCollaborationSignal(task.company_id, task.id, 'status_update', {
        agent_id: agentId,
        status: 'done',
      });
      await broadcastCompanyEvent(
        task.company_id,
        'task.updated',
        {
          company_id: task.company_id,
          task_id: task.id,
          status: 'done',
          assigned_to: task.assigned_to ?? null,
          result: action.result,
          source: 'heartbeat_complete',
        },
        'worker'
      );
      await storeMemory(
        task.company_id,
        agentId,
        task.id,
        `Task: ${task.title}\nResult: ${action.result}`,
        {
          task_title: task.title,
          source: 'complete_task',
        }
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
        const approvalPolicy = await evaluatePolicy(
          task.company_id,
          'approval_required',
          {
            action: 'use_tool',
            tool_name: action.tool_name,
          }
        );
        if (!approvalPolicy.allowed && approvalPolicy.requires_approval) {
          await blockTaskForApproval({
            companyId: task.company_id,
            taskId: task.id,
            assignedTo: task.assigned_to ?? null,
            agentId,
            reason:
              approvalPolicy.reason ||
              `Approval required before using tool ${action.tool_name}`,
            payload: {
              action: 'use_tool',
              tool_name: action.tool_name,
              params: action.params,
            },
            policyId: approvalPolicy.policy_id,
          });
          await insertStatusUpdate(
            task.company_id,
            task.id,
            agentId,
            `Tool blocked pending approval (${action.tool_name}): ${approvalPolicy.reason || 'approval required'}`
          );
          break;
        }

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

        const toolRes = await db.query(
          `SELECT id, name, description, type, config
           FROM tools
           WHERE company_id = $1 AND name = $2
           LIMIT 1`,
          [task.company_id, action.tool_name]
        );
        const tool = toolRes.rows[0] as
          | {
              id: string;
              name: string;
              description?: string | null;
              type?: string;
              config?: unknown;
            }
          | undefined;

        if (tool) {
          const consensus = await evaluateCriticalToolConsensus({
            companyId: task.company_id,
            task: {
              id: task.id,
              title: task.title,
              description: task.description ?? null,
            },
            tool,
            params: action.params,
          });

          if (consensus.required && !consensus.accepted) {
            await blockTaskForApproval({
              companyId: task.company_id,
              taskId: task.id,
              assignedTo: task.assigned_to ?? null,
              agentId,
              reason: consensus.reason,
              payload: {
                action: 'use_tool',
                tool_name: action.tool_name,
                params: action.params,
                consensus,
              },
            });
            await insertStatusUpdate(
              task.company_id,
              task.id,
              agentId,
              `Consensus rejected tool execution (${action.tool_name}): ${consensus.reason}`
            );
            break;
          }

          if (consensus.required && consensus.accepted) {
            await insertStatusUpdate(
              task.company_id,
              task.id,
              agentId,
              `Consensus approved tool execution (${action.tool_name}) with ${consensus.approvals}/${consensus.totalVotes} approvals`
            );
          }
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
      await blockTaskForApproval({
        companyId: task.company_id,
        taskId: task.id,
        assignedTo: task.assigned_to ?? null,
        agentId,
        reason: action.reason,
        payload: action.payload,
      });
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
