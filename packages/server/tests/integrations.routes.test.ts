import express from 'express';
import { createHmac } from 'crypto';
import { createServer, type Server } from 'http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const dbMock = vi.hoisted(() => ({
  query: vi.fn(),
}));

const alertSlackMock = vi.hoisted(() => vi.fn());
const alertDiscordMock = vi.hoisted(() => vi.fn());
const sendSlackMessageMock = vi.hoisted(() => vi.fn());

const envMock = vi.hoisted(() => ({
  PORT: 3100,
  LOG_LEVEL: 'info',
  SLACK_SIGNING_SECRET: 'slack-secret',
  DISCORD_WEBHOOK_SECRET: 'discord-secret',
}));

vi.mock('../src/db/client.js', () => ({
  db: dbMock,
}));

vi.mock('../src/env.js', () => ({
  env: envMock,
}));

vi.mock('../src/middleware/auth.js', () => ({
  requireRole: () => (_req: express.Request, _res: express.Response, next: express.NextFunction) => next(),
}));

vi.mock('../src/services/notifications.js', () => ({
  NotificationService: {
    alertSlack: alertSlackMock,
    alertDiscord: alertDiscordMock,
    sendSlackMessage: sendSlackMessageMock,
  },
}));

import integrationsRouter from '../src/routes/integrations.js';

describe('integration routes', () => {
  let server: Server;
  let baseUrl: string;

  beforeEach(async () => {
    dbMock.query.mockReset();
    alertSlackMock.mockReset();
    alertDiscordMock.mockReset();
    sendSlackMessageMock.mockReset();

    const app = express();
    const captureRawBody: Parameters<typeof express.json>[0]['verify'] = (req, _res, buffer, encoding) => {
      if (buffer.length === 0) {
        return;
      }

      const bodyEncoding = typeof encoding === 'string' ? (encoding as BufferEncoding) : 'utf8';
      (req as express.Request & { rawBody?: string }).rawBody = buffer.toString(bodyEncoding);
    };

    app.use(express.json({ verify: captureRawBody }));
    app.use(express.urlencoded({ extended: false, verify: captureRawBody }));
    app.use('/api/integrations', integrationsRouter);

    server = createServer(app);
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve());
    });

    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Expected server to listen on a TCP port');
    }

    baseUrl = `http://127.0.0.1:${address.port}/api/integrations`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => {
        if (err) {
          reject(err);
          return;
        }
        resolve();
      });
    });
  });

  it('returns integration overview with outgoing config and recent webhook test history', async () => {
    dbMock.query
      .mockResolvedValueOnce({
        rows: [
          {
            slack_webhook_url: 'https://hooks.slack.test/services/current',
            discord_webhook_url: 'https://discord.test/api/webhooks/current',
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'audit-2',
            created_at: '2026-03-18T20:10:00.000Z',
            details: {
              type: 'discord',
              status: 'failure',
              target_url: 'https://discord.test/api/webhooks/current',
              error: 'Webhook failed: 500 Internal Server Error',
            },
          },
          {
            id: 'audit-1',
            created_at: '2026-03-18T20:00:00.000Z',
            details: {
              type: 'slack',
              status: 'success',
              target_url: 'https://hooks.slack.test/services/current',
              error: null,
            },
          },
        ],
      });

    const response = await fetch(`${baseUrl}/overview`, {
      headers: {
        'x-company-id': 'company-1',
        'x-forwarded-proto': 'https',
        'x-forwarded-host': 'biuro.example.com',
      },
    });

    expect(response.status).toBe(200);

    await expect(response.json()).resolves.toMatchObject({
      base_url: 'https://biuro.example.com',
      slack: {
        interactions_url: 'https://biuro.example.com/api/integrations/slack/interactions',
        approval_actions: {
          ready: true,
          status: 'Ready for one-click approvals',
          requirements: [
            {
              label:
                'Interactivity endpoint exposed at https://biuro.example.com/api/integrations/slack/interactions',
              met: true,
            },
            {
              label: 'SLACK_SIGNING_SECRET configured on the server',
              met: true,
            },
            {
              label: 'Outgoing Slack webhook saved for this company',
              met: true,
            },
          ],
        },
      },
      outgoing: {
        slack_webhook_url: 'https://hooks.slack.test/services/current',
        discord_webhook_url: 'https://discord.test/api/webhooks/current',
      },
      webhook_tests: {
        last_test: {
          type: 'discord',
          status: 'failure',
          created_at: '2026-03-18T20:10:00.000Z',
          target_url: 'https://discord.test/api/webhooks/current',
          error: 'Webhook failed: 500 Internal Server Error',
        },
        recent: [
          {
            id: 'audit-2',
            type: 'discord',
            status: 'failure',
            created_at: '2026-03-18T20:10:00.000Z',
            target_url: 'https://discord.test/api/webhooks/current',
            error: 'Webhook failed: 500 Internal Server Error',
          },
          {
            id: 'audit-1',
            type: 'slack',
            status: 'success',
            created_at: '2026-03-18T20:00:00.000Z',
            target_url: 'https://hooks.slack.test/services/current',
            error: null,
          },
        ],
      },
    });

    expect(dbMock.query).toHaveBeenCalledTimes(2);
    expect(String(dbMock.query.mock.calls[0]?.[0])).toContain('SELECT slack_webhook_url, discord_webhook_url FROM companies');
    expect(String(dbMock.query.mock.calls[1]?.[0])).toContain("action = 'integration.webhook_tested'");
  });

  it('updates company integration config and records an audit entry', async () => {
    dbMock.query
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'company-1',
            slack_webhook_url: 'https://hooks.slack.test/services/abc',
            discord_webhook_url: 'https://discord.test/api/webhooks/xyz',
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] });

    const response = await fetch(`${baseUrl}/config`, {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        'x-company-id': 'company-1',
      },
      body: JSON.stringify({
        slack_webhook_url: 'https://hooks.slack.test/services/abc',
        discord_webhook_url: 'https://discord.test/api/webhooks/xyz',
      }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      success: true,
      outgoing: {
        slack_webhook_url: 'https://hooks.slack.test/services/abc',
        discord_webhook_url: 'https://discord.test/api/webhooks/xyz',
      },
    });

    expect(dbMock.query).toHaveBeenCalledTimes(2);
    expect(String(dbMock.query.mock.calls[0]?.[0])).toContain('UPDATE companies');
    expect(dbMock.query.mock.calls[0]?.[1]).toEqual([
      'https://hooks.slack.test/services/abc',
      'https://discord.test/api/webhooks/xyz',
      'company-1',
    ]);
    expect(String(dbMock.query.mock.calls[1]?.[0])).toContain('integration.config_updated');
  });

  it('sends a Slack test webhook using stored company config and records a successful audit event', async () => {
    dbMock.query
      .mockResolvedValueOnce({
        rows: [
          {
            name: 'QA Test Corp',
            slack_webhook_url: 'https://hooks.slack.test/services/stored',
            discord_webhook_url: null,
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] });
    alertSlackMock.mockResolvedValue({ ok: true });

    const response = await fetch(`${baseUrl}/test-webhook`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-company-id': 'company-1',
      },
      body: JSON.stringify({
        type: 'slack',
      }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ success: true });

    expect(alertSlackMock).toHaveBeenCalledWith(
      'https://hooks.slack.test/services/stored',
      expect.stringContaining('QA Test Corp')
    );
    expect(dbMock.query).toHaveBeenCalledTimes(2);
    expect(String(dbMock.query.mock.calls[1]?.[0])).toContain('integration.webhook_tested');
    expect(JSON.parse(String(dbMock.query.mock.calls[1]?.[1]?.[1]))).toMatchObject({
      type: 'slack',
      status: 'success',
      target_url: 'https://hooks.slack.test/services/stored',
      error: null,
    });
  });

  it('returns 502 for failed webhook tests and records the failure in audit_log', async () => {
    dbMock.query
      .mockResolvedValueOnce({
        rows: [
          {
            name: 'QA Test Corp',
            slack_webhook_url: null,
            discord_webhook_url: 'https://discord.test/api/webhooks/stored',
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] });
    alertDiscordMock.mockResolvedValue({ ok: false, error: 'Webhook failed: 500 Internal Server Error' });

    const response = await fetch(`${baseUrl}/test-webhook`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-company-id': 'company-1',
      },
      body: JSON.stringify({
        type: 'discord',
      }),
    });

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({
      error: 'Webhook failed: 500 Internal Server Error',
    });

    expect(alertDiscordMock).toHaveBeenCalledWith(
      'https://discord.test/api/webhooks/stored',
      expect.stringContaining('QA Test Corp')
    );
    expect(String(dbMock.query.mock.calls[1]?.[0])).toContain('integration.webhook_tested');
    expect(JSON.parse(String(dbMock.query.mock.calls[1]?.[1]?.[1]))).toMatchObject({
      type: 'discord',
      status: 'failure',
      target_url: 'https://discord.test/api/webhooks/stored',
      error: 'Webhook failed: 500 Internal Server Error',
    });
  });

  it('stores inbound Discord messages against a task matched by discord_channel metadata', async () => {
    dbMock.query
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'task-1',
            company_id: 'company-1',
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] });

    const response = await fetch(`${baseUrl}/discord/webhook`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-webhook-secret': 'discord-secret',
      },
      body: JSON.stringify({
        id: 'discord-message-1',
        channel_id: 'discord-channel-42',
        content: 'Customer asked for a Friday status update.',
        author: {
          id: 'user-9',
          username: 'ops-user',
          bot: false,
        },
      }),
    });

    expect(response.status).toBe(200);
    expect(dbMock.query).toHaveBeenCalledTimes(2);
    expect(String(dbMock.query.mock.calls[0]?.[0])).toContain("metadata->>$1 = $2");
    expect(dbMock.query.mock.calls[0]?.[1]).toEqual([
      'discord_channel',
      'discord-channel-42',
      'discord_thread',
    ]);
    expect(String(dbMock.query.mock.calls[1]?.[0])).toContain('INSERT INTO messages');
    expect(dbMock.query.mock.calls[1]?.[1]?.[0]).toBe('company-1');
    expect(dbMock.query.mock.calls[1]?.[1]?.[1]).toBe('task-1');
    expect(dbMock.query.mock.calls[1]?.[1]?.[2]).toBe('Customer asked for a Friday status update.');
    expect(JSON.parse(String(dbMock.query.mock.calls[1]?.[1]?.[3]))).toMatchObject({
      source: 'discord',
      channel_id: 'discord-channel-42',
      discord_message_id: 'discord-message-1',
      discord_author: 'ops-user',
      discord_author_id: 'user-9',
    });
  });

  it('ignores bot-authored Discord webhook messages', async () => {
    const response = await fetch(`${baseUrl}/discord/webhook`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-webhook-secret': 'discord-secret',
      },
      body: JSON.stringify({
        id: 'discord-message-2',
        channel_id: 'discord-channel-42',
        content: 'Automated sync message',
        author: {
          id: 'bot-1',
          username: 'system-bot',
          bot: true,
        },
      }),
    });

    expect(response.status).toBe(200);
    expect(dbMock.query).not.toHaveBeenCalled();
  });

  it('resolves approvals from Slack interactive actions and returns a replacement payload', async () => {
    dbMock.query
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'approval-1',
            company_id: 'company-1',
            task_id: 'task-1',
            reason: 'Budget threshold exceeded',
            status: 'pending',
            task_title: 'Prepare launch notes',
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'approval-1',
            company_id: 'company-1',
            task_id: 'task-1',
            reason: 'Budget threshold exceeded',
            status: 'approved',
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const payload = JSON.stringify({
      type: 'block_actions',
      user: {
        id: 'U123',
        username: 'ops-lead',
      },
      actions: [
        {
          action_id: 'approval.approve',
          value: JSON.stringify({ approval_id: 'approval-1' }),
        },
      ],
    });
    const body = new URLSearchParams({ payload }).toString();
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = `v0=${createHmac('sha256', 'slack-secret')
      .update(`v0:${timestamp}:${body}`)
      .digest('hex')}`;

    const response = await fetch(`${baseUrl}/slack/interactions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'x-slack-request-timestamp': timestamp,
        'x-slack-signature': signature,
      },
      body,
    });

    expect(response.status).toBe(200);
    const payloadResponse = await response.json();
    expect(payloadResponse).toMatchObject({
      replace_original: true,
      response_type: 'in_channel',
      text: 'Approved: Prepare launch notes',
    });
    expect(payloadResponse.blocks[0]).toMatchObject({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: '*Approved* for *Prepare launch notes*',
      },
    });
    expect(payloadResponse.blocks[1]).toMatchObject({
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: '*Status*\nApproved' },
        { type: 'mrkdwn', text: '*Resolved by*\nops-lead' },
      ],
    });

    expect(String(dbMock.query.mock.calls[0]?.[0])).toContain('FROM approvals a');
    expect(String(dbMock.query.mock.calls[1]?.[0])).toContain('UPDATE approvals');
    expect(String(dbMock.query.mock.calls[2]?.[0])).toContain("SET status = CASE WHEN assigned_to IS NULL THEN 'backlog' ELSE 'assigned' END");
    expect(String(dbMock.query.mock.calls[3]?.[0])).toContain('INSERT INTO messages');
    expect(String(dbMock.query.mock.calls[4]?.[0])).toContain('approval.resolved');
  });

  it('handles Slack reject actions for already resolved approvals without mutating state again', async () => {
    dbMock.query.mockResolvedValueOnce({
      rows: [
        {
          id: 'approval-9',
          company_id: 'company-1',
          task_id: 'task-9',
          reason: 'High-risk production deploy',
          status: 'approved',
          task_title: 'Ship migration rollback',
        },
      ],
    });

    const payload = JSON.stringify({
      type: 'block_actions',
      user: {
        id: 'U999',
        name: 'release-manager',
      },
      actions: [
        {
          action_id: 'approval.reject',
          value: JSON.stringify({ approval_id: 'approval-9' }),
        },
      ],
    });
    const body = new URLSearchParams({ payload }).toString();
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = `v0=${createHmac('sha256', 'slack-secret')
      .update(`v0:${timestamp}:${body}`)
      .digest('hex')}`;

    const response = await fetch(`${baseUrl}/slack/interactions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'x-slack-request-timestamp': timestamp,
        'x-slack-signature': signature,
      },
      body,
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      replace_original: true,
      response_type: 'in_channel',
      text: 'Rejected: Ship migration rollback',
    });
    expect(dbMock.query).toHaveBeenCalledTimes(1);
  });
});
