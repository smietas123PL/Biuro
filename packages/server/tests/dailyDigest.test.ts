import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbMock = vi.hoisted(() => ({
  query: vi.fn(),
}));

const deliverOutgoingWebhooksMock = vi.hoisted(() => vi.fn());

const envMock = vi.hoisted(() => ({
  DAILY_DIGEST_ENABLED: true,
  DAILY_DIGEST_HOUR_UTC: 18,
  DAILY_DIGEST_MINUTE_UTC: 0,
}));

vi.mock('../src/db/client.js', () => ({
  db: dbMock,
}));

vi.mock('../src/services/outgoingWebhooks.js', () => ({
  deliverOutgoingWebhooks: deliverOutgoingWebhooksMock,
}));

vi.mock('../src/env.js', () => ({
  env: envMock,
}));

import {
  dispatchDueDailyDigests,
  formatDailyDigestMessage,
  generateDailyDigest,
  isDailyDigestWindowOpen,
} from '../src/services/dailyDigest.js';

describe('daily digest service', () => {
  beforeEach(() => {
    dbMock.query.mockReset();
    deliverOutgoingWebhooksMock.mockReset();
  });

  it('generates a digest summary and formats the outbound message', async () => {
    dbMock.query
      .mockResolvedValueOnce({
        rows: [{ id: 'company-1', name: 'QA Test Corp', slack_webhook_url: 'https://hooks.slack.test/digest', discord_webhook_url: null }],
      })
      .mockResolvedValueOnce({ rows: [{ count: '4' }] })
      .mockResolvedValueOnce({ rows: [{ count: '2' }] })
      .mockResolvedValueOnce({ rows: [{ total: 8.75 }] })
      .mockResolvedValueOnce({ rows: [{ total: 40 }] })
      .mockResolvedValueOnce({
        rows: [
          { message: 'Tool timeout', count: 3 },
          { message: 'Missing approval', count: 1 },
        ],
      });

    const summary = await generateDailyDigest('company-1', new Date('2026-03-19T18:05:00.000Z'));
    expect(summary).toMatchObject({
      companyId: 'company-1',
      companyName: 'QA Test Corp',
      completedTasksToday: 4,
      blockedTasks: 2,
      dailyCostUsd: 8.75,
      dailyBudgetUsd: 40,
    });

    expect(formatDailyDigestMessage(summary!)).toContain('Completed today: 4');
    expect(formatDailyDigestMessage(summary!)).toContain('Daily cost vs budget: $8.75 / $40.00');
    expect(formatDailyDigestMessage(summary!)).toContain('1. Tool timeout (3)');
  });

  it('dispatches one digest per due company and records webhook delivery metadata', async () => {
    deliverOutgoingWebhooksMock.mockResolvedValue([
      { target: 'slack', status: 'success', error: null },
    ]);

    dbMock.query.mockImplementation(async (text: string, params?: any[]) => {
      if (String(text).includes('FROM companies c')) {
        expect(params?.[0]).toBeInstanceOf(Date);
        return {
          rows: [
            {
              id: 'company-1',
              name: 'QA Test Corp',
              slack_webhook_url: 'https://hooks.slack.test/digest',
              discord_webhook_url: null,
              config: {
                daily_digest_enabled: true,
                daily_digest_hour_utc: 18,
                daily_digest_minute_utc: 0,
              },
            },
          ],
        };
      }

      if (text === 'SELECT id, name, slack_webhook_url, discord_webhook_url FROM companies WHERE id = $1') {
        return {
          rows: [
            {
              id: 'company-1',
              name: 'QA Test Corp',
              slack_webhook_url: 'https://hooks.slack.test/digest',
              discord_webhook_url: null,
            },
          ],
        };
      }

      if (String(text).includes('FROM tasks') && String(text).includes('completed_at')) {
        return { rows: [{ count: '5' }] };
      }

      if (String(text).includes("status = 'blocked'")) {
        return { rows: [{ count: '1' }] };
      }

      if (String(text).includes('FROM audit_log') && String(text).includes('SUM(cost_usd)')) {
        return { rows: [{ total: 11.2 }] };
      }

      if (String(text).includes('FROM agents a') && String(text).includes('SUM(COALESCE')) {
        return { rows: [{ total: 50 }] };
      }

      if (String(text).includes('FROM heartbeats h')) {
        return { rows: [{ message: 'Tool timeout', count: 2 }] };
      }

      if (String(text).includes(`'digest.daily_sent'`)) {
        return { rows: [], rowCount: 1 };
      }

      throw new Error(`Unexpected query: ${text}`);
    });

    const results = await dispatchDueDailyDigests(new Date('2026-03-19T18:15:00.000Z'));

    expect(results).toHaveLength(1);
    expect(deliverOutgoingWebhooksMock).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: 'company-1',
        event: 'digest.daily_sent',
        slackWebhookUrl: 'https://hooks.slack.test/digest',
        slackText: expect.stringContaining('Completed today: 5'),
      })
    );
  });

  it('opens the digest window only after the configured UTC time', () => {
    expect(isDailyDigestWindowOpen(new Date('2026-03-19T17:59:00.000Z'))).toBe(false);
    expect(isDailyDigestWindowOpen(new Date('2026-03-19T18:00:00.000Z'))).toBe(true);
  });

  it('skips companies whose own digest settings are disabled or not due yet', async () => {
    dbMock.query.mockResolvedValueOnce({
      rows: [
        {
          id: 'company-1',
          name: 'QA Test Corp',
          slack_webhook_url: 'https://hooks.slack.test/digest',
          discord_webhook_url: null,
          config: {
            daily_digest_enabled: false,
            daily_digest_hour_utc: 18,
            daily_digest_minute_utc: 0,
          },
        },
        {
          id: 'company-2',
          name: 'Night Shift',
          slack_webhook_url: 'https://hooks.slack.test/digest-2',
          discord_webhook_url: null,
          config: {
            daily_digest_enabled: true,
            daily_digest_hour_utc: 20,
            daily_digest_minute_utc: 0,
          },
        },
      ],
    });

    const results = await dispatchDueDailyDigests(new Date('2026-03-19T18:15:00.000Z'));

    expect(results).toEqual([]);
    expect(deliverOutgoingWebhooksMock).not.toHaveBeenCalled();
  });
});
