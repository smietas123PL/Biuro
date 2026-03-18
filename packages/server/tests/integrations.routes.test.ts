import express from 'express';
import { createServer, type Server } from 'http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const dbMock = vi.hoisted(() => ({
  query: vi.fn(),
}));

const alertSlackMock = vi.hoisted(() => vi.fn());
const alertDiscordMock = vi.hoisted(() => vi.fn());

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

    const app = express();
    app.use(express.json());
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
});
