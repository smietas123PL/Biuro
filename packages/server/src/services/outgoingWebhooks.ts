import { db } from '../db/client.js';
import { NotificationService } from './notifications.js';

type DeliveryAttempt = {
  target: 'slack' | 'discord';
  status: 'success' | 'failure';
  error: string | null;
};

export async function deliverOutgoingWebhooks(args: {
  companyId: string;
  agentId?: string | null;
  event: string;
  slackWebhookUrl?: string | null;
  slackText?: string | null;
  slackPayload?: Record<string, unknown> | null;
  discordWebhookUrl?: string | null;
  discordMessage?: string | null;
  metadata?: Record<string, unknown>;
}) {
  const attempts: DeliveryAttempt[] = [];

  if (args.slackWebhookUrl && (args.slackPayload || args.slackText)) {
    const result = args.slackPayload
      ? await NotificationService.sendSlackMessage(
          args.slackWebhookUrl,
          args.slackPayload
        )
      : await NotificationService.alertSlack(
          args.slackWebhookUrl,
          args.slackText!
        );

    attempts.push({
      target: 'slack',
      status: result.ok ? 'success' : 'failure',
      error: result.ok ? null : (result.error ?? null),
    });
  }

  if (args.discordWebhookUrl && args.discordMessage) {
    const result = await NotificationService.alertDiscord(
      args.discordWebhookUrl,
      args.discordMessage
    );
    attempts.push({
      target: 'discord',
      status: result.ok ? 'success' : 'failure',
      error: result.ok ? null : (result.error ?? null),
    });
  }

  if (attempts.length === 0) {
    return attempts;
  }

  await db.query(
    `INSERT INTO audit_log (company_id, agent_id, action, details)
     VALUES ($1, $2, 'integration.outgoing_delivery', $3)`,
    [
      args.companyId,
      args.agentId ?? null,
      JSON.stringify({
        event: args.event,
        attempts,
        ...(args.metadata ?? {}),
      }),
    ]
  );

  return attempts;
}
