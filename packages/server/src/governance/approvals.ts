import { db } from '../db/client.js';
import { deliverOutgoingWebhooks } from '../services/outgoingWebhooks.js';
import { enqueueCompanyWakeup } from '../orchestrator/schedulerQueue.js';

type ApprovalResolutionSource = 'dashboard' | 'slack' | 'api' | 'system';

function buildSlackApprovalConfirm(args: {
  status: 'approved' | 'rejected';
  taskTitle: string;
}) {
  const approving = args.status === 'approved';

  return {
    title: {
      type: 'plain_text',
      text: approving ? 'Approve request?' : 'Reject request?',
      emoji: true,
    },
    text: {
      type: 'mrkdwn',
      text: approving
        ? `Approve *${args.taskTitle}* and let the task continue?`
        : `Reject *${args.taskTitle}* and block the task?`,
    },
    confirm: {
      type: 'plain_text',
      text: approving ? 'Approve' : 'Reject',
      emoji: true,
    },
    deny: {
      type: 'plain_text',
      text: 'Cancel',
      emoji: true,
    },
  };
}

function buildSlackApprovalBlocks(args: {
  approvalId: string;
  companyName: string;
  taskTitle: string;
  reason: string;
  payload: unknown;
}) {
  const actionValue = JSON.stringify({ approval_id: args.approvalId });

  return [
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: 'Approval required',
        emoji: true,
      },
    },
    {
      type: 'section',
      fields: [
        {
          type: 'mrkdwn',
          text: `*Company*\n${args.companyName}`,
        },
        {
          type: 'mrkdwn',
          text: `*Task*\n${args.taskTitle}`,
        },
      ],
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Reason*\n${args.reason}`,
      },
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Payload*\n\`\`\`${JSON.stringify(args.payload, null, 2)}\`\`\``,
      },
    },
    {
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: `Approval ID: \`${args.approvalId}\``,
        },
        {
          type: 'mrkdwn',
          text: 'One click here resolves the approval in Biuro and writes an audit entry.',
        },
      ],
    },
    {
      type: 'actions',
      elements: [
        {
          type: 'button',
          style: 'primary',
          text: {
            type: 'plain_text',
            text: 'Approve',
            emoji: true,
          },
          action_id: 'approval.approve',
          value: actionValue,
          confirm: buildSlackApprovalConfirm({
            status: 'approved',
            taskTitle: args.taskTitle,
          }),
        },
        {
          type: 'button',
          style: 'danger',
          text: {
            type: 'plain_text',
            text: 'Reject',
            emoji: true,
          },
          action_id: 'approval.reject',
          value: actionValue,
          confirm: buildSlackApprovalConfirm({
            status: 'rejected',
            taskTitle: args.taskTitle,
          }),
        },
      ],
    },
  ];
}

export async function createApprovalRequest(
  companyId: string,
  taskId: string,
  agentId: string,
  reason: string,
  payload: any,
  policyId?: string
) {
  const [approvalRes, taskRes, companyRes] = await Promise.all([
    db.query(
      `INSERT INTO approvals (company_id, task_id, requested_by_agent, reason, payload, policy_id)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [companyId, taskId, agentId, reason, JSON.stringify(payload), policyId]
    ),
    db.query('SELECT title FROM tasks WHERE id = $1', [taskId]),
    db.query(
      'SELECT name, slack_webhook_url, discord_webhook_url FROM companies WHERE id = $1',
      [companyId]
    ),
  ]);

  const approval = approvalRes.rows[0];
  const taskTitle = taskRes.rows[0]?.title ?? taskId;
  const company = companyRes.rows[0];

  await db.query(
    `INSERT INTO messages (company_id, task_id, from_agent, content, type, metadata) 
     VALUES ($1, $2, $3, $4, 'approval_request', $5)`,
    [
      companyId,
      taskId,
      agentId,
      `Sent approval request: ${reason}`,
      JSON.stringify({
        approval_id: approval.id,
        policy_id: policyId ?? null,
      }),
    ]
  );

  await db.query(
    `INSERT INTO audit_log (company_id, agent_id, action, entity_type, entity_id, details)
     VALUES ($1, $2, 'approval.requested', 'approval', $3, $4)`,
    [
      companyId,
      agentId,
      approval.id,
      JSON.stringify({
        task_id: taskId,
        reason,
        policy_id: policyId ?? null,
      }),
    ]
  );

  const discordMessage = `Approval required\nCompany: ${company.name}\nTask: ${taskTitle}\nReason: ${reason}\nPayload: ${JSON.stringify(payload)}`;

  await deliverOutgoingWebhooks({
    companyId,
    agentId,
    event: 'approval.requested',
    slackWebhookUrl: company.slack_webhook_url,
    slackPayload: {
      text: `Approval required for ${taskTitle}`,
      blocks: buildSlackApprovalBlocks({
        approvalId: approval.id,
        companyName: company.name,
        taskTitle,
        reason,
        payload,
      }),
    },
    discordWebhookUrl: company.discord_webhook_url,
    discordMessage,
    metadata: {
      approval_id: approval.id,
      task_id: taskId,
      task_title: taskTitle,
      reason,
      policy_id: policyId ?? null,
    },
  });

  return approval;
}

export async function resolveApproval(
  approvalId: string,
  status: 'approved' | 'rejected',
  notes?: string,
  options?: {
    source?: ApprovalResolutionSource;
    resolvedBy?: string | null;
  }
) {
  const approvalLookup = await db.query(
    `SELECT a.*, t.title AS task_title
     FROM approvals a
     LEFT JOIN tasks t ON t.id = a.task_id
     WHERE a.id = $1`,
    [approvalId]
  );

  if (approvalLookup.rows.length === 0) {
    return null;
  }

  const current = approvalLookup.rows[0];
  if (current.status !== 'pending') {
    return { ...current, already_resolved: true as const };
  }

  const res = await db.query(
    `UPDATE approvals
     SET status = $1, resolution_notes = $2, resolved_at = now()
     WHERE id = $3
     RETURNING *`,
    [status, notes ?? null, approvalId]
  );

  if (status === 'approved') {
    await db.query(
      `UPDATE tasks
       SET status = CASE WHEN assigned_to IS NULL THEN 'backlog' ELSE 'assigned' END,
           updated_at = now()
       WHERE id = (SELECT task_id FROM approvals WHERE id = $1)`,
      [approvalId]
    );
    await enqueueCompanyWakeup(current.company_id, 'approval_resolved', {
      taskId: current.task_id,
      agentId: current.requested_by_agent ?? null,
    });
  } else {
    await db.query(
      "UPDATE tasks SET status = 'blocked' WHERE id = (SELECT task_id FROM approvals WHERE id = $1)",
      [approvalId]
    );
  }

  await db.query(
    `INSERT INTO messages (company_id, task_id, content, type, metadata)
     VALUES ($1, $2, $3, 'status_update', $4)`,
    [
      current.company_id,
      current.task_id,
      `Approval ${status}: ${current.reason}`,
      JSON.stringify({
        approval_id: approvalId,
        source: options?.source ?? 'system',
        resolved_by: options?.resolvedBy ?? null,
        notes: notes ?? null,
      }),
    ]
  );

  await db.query(
    `INSERT INTO audit_log (company_id, action, entity_type, entity_id, details)
     VALUES ($1, 'approval.resolved', 'approval', $2, $3)`,
    [
      current.company_id,
      approvalId,
      JSON.stringify({
        status,
        source: options?.source ?? 'system',
        resolved_by: options?.resolvedBy ?? null,
        task_id: current.task_id,
        notes: notes ?? null,
      }),
    ]
  );

  return {
    ...res.rows[0],
    task_title: current.task_title ?? null,
    already_resolved: false as const,
  };
}
