import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbMock = vi.hoisted(() => ({
  query: vi.fn(),
}));
const sendSlackMessageMock = vi.hoisted(() => vi.fn());
const alertSlackMock = vi.hoisted(() => vi.fn());
const alertDiscordMock = vi.hoisted(() => vi.fn());

vi.mock('../src/db/client.js', () => ({
  db: dbMock,
}));

vi.mock('../src/services/notifications.js', () => ({
  NotificationService: {
    sendSlackMessage: sendSlackMessageMock,
    alertSlack: alertSlackMock,
    alertDiscord: alertDiscordMock,
  },
}));

import { deliverOutgoingWebhooks } from '../src/services/outgoingWebhooks.js';

describe('outgoing webhooks service', () => {
  beforeEach(() => {
    dbMock.query.mockReset();
    sendSlackMessageMock.mockReset();
    alertSlackMock.mockReset();
    alertDiscordMock.mockReset();
  });

  it('returns early when no outgoing targets are configured', async () => {
    await expect(
      deliverOutgoingWebhooks({
        companyId: 'company-1',
        event: 'approval.requested',
      })
    ).resolves.toEqual([]);

    expect(dbMock.query).not.toHaveBeenCalled();
    expect(sendSlackMessageMock).not.toHaveBeenCalled();
    expect(alertSlackMock).not.toHaveBeenCalled();
    expect(alertDiscordMock).not.toHaveBeenCalled();
  });

  it('delivers Slack payloads and Discord messages, then audits the attempts', async () => {
    sendSlackMessageMock.mockResolvedValueOnce({ ok: true });
    alertDiscordMock.mockResolvedValueOnce({ ok: false, error: 'Discord 500' });

    const attempts = await deliverOutgoingWebhooks({
      companyId: 'company-1',
      agentId: 'agent-1',
      event: 'approval.requested',
      slackWebhookUrl: 'https://slack.example/webhook',
      slackPayload: { text: 'Approval required' },
      discordWebhookUrl: 'https://discord.example/webhook',
      discordMessage: 'Approval required',
      metadata: { approval_id: 'approval-1' },
    });

    expect(attempts).toEqual([
      {
        target: 'slack',
        status: 'success',
        error: null,
      },
      {
        target: 'discord',
        status: 'failure',
        error: 'Discord 500',
      },
    ]);
    expect(sendSlackMessageMock).toHaveBeenCalledWith(
      'https://slack.example/webhook',
      { text: 'Approval required' }
    );
    expect(alertDiscordMock).toHaveBeenCalledWith(
      'https://discord.example/webhook',
      'Approval required'
    );
    expect(dbMock.query).toHaveBeenCalledWith(
      expect.stringContaining('integration.outgoing_delivery'),
      [
        'company-1',
        'agent-1',
        JSON.stringify({
          event: 'approval.requested',
          attempts: [
            {
              target: 'slack',
              status: 'success',
              error: null,
            },
            {
              target: 'discord',
              status: 'failure',
              error: 'Discord 500',
            },
          ],
          approval_id: 'approval-1',
        }),
      ]
    );
  });

  it('uses the plain Slack text helper when only text is provided', async () => {
    alertSlackMock.mockResolvedValueOnce({ ok: false, error: 'Slack 403' });

    const attempts = await deliverOutgoingWebhooks({
      companyId: 'company-1',
      event: 'digest.ready',
      slackWebhookUrl: 'https://slack.example/text',
      slackText: 'Digest ready',
    });

    expect(attempts).toEqual([
      {
        target: 'slack',
        status: 'failure',
        error: 'Slack 403',
      },
    ]);
    expect(alertSlackMock).toHaveBeenCalledWith(
      'https://slack.example/text',
      'Digest ready'
    );
  });
});
