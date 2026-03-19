import { db } from '../db/client.js';
import { logger } from '../utils/logger.js';
import { resolveApproval } from '../governance/approvals.js';
import { enqueueCompanyWakeup } from '../orchestrator/schedulerQueue.js';

async function storeInboundTaskMessage(args: {
  platform: 'slack' | 'discord';
  channelId: string;
  content: string;
  metadata?: Record<string, unknown>;
}) {
  const taskRes = await db.query(
    `SELECT id, company_id
     FROM tasks
     WHERE metadata->>$1 = $2
        OR metadata->>$3 = $2
     LIMIT 1`,
    [`${args.platform}_channel`, args.channelId, `${args.platform}_thread`]
  );

  if (taskRes.rows.length === 0) {
    return { matched: false as const };
  }

  const task = taskRes.rows[0];
  await db.query(
    `INSERT INTO messages (company_id, task_id, content, type, metadata)
     VALUES ($1, $2, $3, 'message', $4)`,
    [
      task.company_id,
      task.id,
      args.content,
      JSON.stringify({
        source: args.platform,
        channel_id: args.channelId,
        ...(args.metadata ?? {}),
      }),
    ]
  );

  return { matched: true as const, taskId: task.id, companyId: task.company_id };
}

function buildSlackApprovalResponse(args: {
  status: 'approved' | 'rejected';
  title: string;
  reason: string;
  notes: string;
  resolvedBy: string;
  alreadyResolved?: boolean;
}) {
  const statusLabel = args.status === 'approved' ? 'Approved' : 'Rejected';
  const summary = args.alreadyResolved
    ? `Approval was already ${statusLabel.toLowerCase()}.`
    : `${statusLabel} in Slack.`;

  return {
    replace_original: true,
    response_type: 'in_channel',
    text: `${statusLabel}: ${args.title}`,
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*${statusLabel}* for *${args.title}*`,
        },
      },
      {
        type: 'section',
        fields: [
          {
            type: 'mrkdwn',
            text: `*Status*\n${statusLabel}`,
          },
          {
            type: 'mrkdwn',
            text: `*Resolved by*\n${args.resolvedBy}`,
          },
        ],
      },
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: summary,
          },
          {
            type: 'mrkdwn',
            text: `Reason: ${args.reason}`,
          },
          {
            type: 'mrkdwn',
            text: args.notes,
          },
        ],
      },
    ],
  };
}

export const IntegrationService = {
  async handleSlackEvent(event: any) {
    logger.info({ type: event.type }, 'Handling Slack event');

    if (event.type === 'message' && !event.bot_id) {
      await storeInboundTaskMessage({
        platform: 'slack',
        channelId: event.channel,
        content: event.text,
        metadata: {
          slack_user: event.user ?? null,
          slack_ts: event.ts ?? null,
        },
      });
    }
  },

  async handleSlackInteraction(payload: any) {
    const action = payload?.actions?.[0];
    if (!action?.action_id || typeof action.value !== 'string') {
      return {
        response_type: 'ephemeral',
        text: 'Unsupported Slack interaction payload.',
      };
    }

    if (action.action_id !== 'approval.approve' && action.action_id !== 'approval.reject') {
      return {
        response_type: 'ephemeral',
        text: `Unknown action: ${action.action_id}`,
      };
    }

    let approvalId: string | null = null;
    try {
      const parsed = JSON.parse(action.value) as { approval_id?: string };
      approvalId = parsed.approval_id ?? null;
    } catch {
      approvalId = null;
    }

    if (!approvalId) {
      return {
        response_type: 'ephemeral',
        text: 'Missing approval id in Slack action payload.',
      };
    }

    const status = action.action_id === 'approval.approve' ? 'approved' : 'rejected';
    const resolvedBy =
      payload.user?.username ??
      payload.user?.name ??
      payload.user?.real_name ??
      payload.user?.id ??
      'unknown-user';
    const notes = `Resolved in Slack by ${resolvedBy}`;
    const resolution = await resolveApproval(approvalId, status, notes, {
      source: 'slack',
      resolvedBy: payload.user?.id ?? null,
    });

    if (!resolution) {
      return {
        response_type: 'ephemeral',
        text: 'Approval not found.',
      };
    }

    return buildSlackApprovalResponse({
      status,
      title: resolution.task_title ?? 'Approval request',
      reason: resolution.reason,
      notes,
      resolvedBy,
      alreadyResolved: Boolean((resolution as { already_resolved?: boolean }).already_resolved),
    });
  },

  async handleDiscordEvent(message: any) {
    logger.info(
      {
        author: message.author?.username ?? 'unknown',
        channelId: message.channel_id ?? null,
      },
      'Handling Discord message'
    );

    if (!message?.channel_id || !message?.content?.trim()) {
      return;
    }

    if (message.author?.bot || message.webhook_id) {
      return;
    }

    await storeInboundTaskMessage({
      platform: 'discord',
      channelId: message.channel_id,
      content: message.content,
      metadata: {
        discord_message_id: message.id ?? null,
        discord_author: message.author?.username ?? null,
        discord_author_id: message.author?.id ?? null,
      },
    });
  },

  async handleSlashCommand(command: string, params: string, companyId: string) {
    if (command === '/biuro-task') {
      const res = await db.query(
        "INSERT INTO tasks (company_id, title, description, status) VALUES ($1, $2, $3, 'backlog') RETURNING id, company_id",
        [companyId, 'New Task from Slack', params]
      );
      await enqueueCompanyWakeup(companyId, 'slash_command_task_created', {
        taskId: res.rows[0].id,
      });
      return `Task created: ${res.rows[0].id}`;
    }
    return `Unknown command: ${command}`;
  }
};
