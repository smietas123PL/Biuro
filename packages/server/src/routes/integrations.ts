import { Router, type Request } from 'express';
import { createHmac, timingSafeEqual } from 'crypto';
import { z } from 'zod';
import { db } from '../db/client.js';
import { IntegrationService } from '../services/integrations.js';
import { NotificationService } from '../services/notifications.js';
import { env } from '../env.js';
import { requireRole } from '../middleware/auth.js';
import type { AuthRequest } from '../utils/context.js';

const router: Router = Router();
type RawBodyRequest = Request & { rawBody?: string };
type IntegrationRequirement = { label: string; met: boolean };

const integrationConfigSchema = z.object({
  slack_webhook_url: z
    .union([z.string().url(), z.literal(''), z.null()])
    .optional(),
  discord_webhook_url: z
    .union([z.string().url(), z.literal(''), z.null()])
    .optional(),
});

const integrationTestSchema = z.object({
  type: z.enum(['slack', 'discord']),
  url: z.union([z.string().url(), z.literal('')]).optional(),
});

function timingSafeMatch(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
}

function verifySlackSignature(req: RawBodyRequest) {
  if (!env.SLACK_SIGNING_SECRET) {
    throw new Error('Slack signing secret is not configured');
  }

  const timestamp = req.header('x-slack-request-timestamp');
  const signature = req.header('x-slack-signature');
  const rawBody = req.rawBody || '';

  if (!timestamp || !signature || !rawBody) {
    return false;
  }

  const requestAgeSeconds = Math.abs(
    Math.floor(Date.now() / 1000) - Number(timestamp)
  );
  if (!Number.isFinite(requestAgeSeconds) || requestAgeSeconds > 60 * 5) {
    return false;
  }

  const expectedSignature = `v0=${createHmac('sha256', env.SLACK_SIGNING_SECRET)
    .update(`v0:${timestamp}:${rawBody}`)
    .digest('hex')}`;

  return timingSafeMatch(signature, expectedSignature);
}

function verifyDiscordWebhookSecret(req: Request) {
  if (!env.DISCORD_WEBHOOK_SECRET) {
    throw new Error('Discord webhook secret is not configured');
  }

  const secret = req.header('x-webhook-secret');
  if (!secret) {
    return false;
  }

  return timingSafeMatch(secret, env.DISCORD_WEBHOOK_SECRET);
}

function getPublicBaseUrl(req: Request) {
  const forwardedProto = req.header('x-forwarded-proto');
  const forwardedHost = req.header('x-forwarded-host');
  const protocol = forwardedProto?.split(',')[0]?.trim() || req.protocol;
  const host =
    forwardedHost?.split(',')[0]?.trim() ||
    req.header('host') ||
    `localhost:${env.PORT}`;
  return `${protocol}://${host}`;
}

function normalizeOptionalUrl(value?: string | null) {
  if (!value) {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function getCompanyId(req: AuthRequest) {
  return (
    req.user?.companyId ||
    (typeof req.header('x-company-id') === 'string'
      ? req.header('x-company-id')
      : undefined) ||
    null
  );
}

router.get(
  '/overview',
  requireRole(['owner', 'admin']),
  async (req: AuthRequest, res, next) => {
    const baseUrl = getPublicBaseUrl(req);
    const companyId = getCompanyId(req);

    try {
      let outgoing = {
        slack_webhook_url: null as string | null,
        discord_webhook_url: null as string | null,
      };
      let recentTests: Array<{
        id: string;
        type: 'slack' | 'discord';
        status: 'success' | 'failure';
        created_at: string;
        target_url: string | null;
        error: string | null;
      }> = [];
      let lastTest: {
        type: 'slack' | 'discord';
        status: 'success' | 'failure';
        created_at: string;
        target_url: string | null;
        error: string | null;
      } | null = null;

      if (companyId) {
        const [companyRes, recentTestsRes] = await Promise.all([
          db.query(
            'SELECT slack_webhook_url, discord_webhook_url FROM companies WHERE id = $1',
            [companyId]
          ),
          db.query(
            `SELECT id, details, created_at
           FROM audit_log
           WHERE company_id = $1
             AND action = 'integration.webhook_tested'
           ORDER BY created_at DESC
           LIMIT 10`,
            [companyId]
          ),
        ]);

        if (companyRes.rows.length > 0) {
          outgoing = {
            slack_webhook_url: companyRes.rows[0].slack_webhook_url ?? null,
            discord_webhook_url: companyRes.rows[0].discord_webhook_url ?? null,
          };
        }

        recentTests = recentTestsRes.rows.map((row) => ({
          id: row.id,
          type: row.details?.type === 'discord' ? 'discord' : 'slack',
          status: row.details?.status === 'failure' ? 'failure' : 'success',
          created_at: row.created_at,
          target_url: row.details?.target_url ?? null,
          error: row.details?.error ?? null,
        }));
        lastTest = recentTests[0] ?? null;
      }

      res.json({
        base_url: baseUrl,
        slack: {
          configured: Boolean(env.SLACK_SIGNING_SECRET),
          signing_secret_configured: Boolean(env.SLACK_SIGNING_SECRET),
          events_url: `${baseUrl}/api/integrations/slack/events`,
          slash_command_url: `${baseUrl}/api/integrations/slack/command`,
          interactions_url: `${baseUrl}/api/integrations/slack/interactions`,
          slash_command_name: '/biuro-task',
          example_payload: {
            command: '/biuro-task',
            text: 'Analyze Q4 revenue patterns',
            company_id: companyId,
          },
          approval_actions: {
            ready:
              Boolean(env.SLACK_SIGNING_SECRET) &&
              Boolean(outgoing.slack_webhook_url) &&
              Boolean(`${baseUrl}/api/integrations/slack/interactions`),
            status: getSlackApprovalStatus({
              signingSecretConfigured: Boolean(env.SLACK_SIGNING_SECRET),
              slackWebhookConfigured: Boolean(outgoing.slack_webhook_url),
            }),
            requirements: buildSlackApprovalRequirements({
              baseUrl,
              signingSecretConfigured: Boolean(env.SLACK_SIGNING_SECRET),
              slackWebhookConfigured: Boolean(outgoing.slack_webhook_url),
            }),
          },
        },
        discord: {
          configured: Boolean(env.DISCORD_WEBHOOK_SECRET),
          webhook_secret_configured: Boolean(env.DISCORD_WEBHOOK_SECRET),
          webhook_url: `${baseUrl}/api/integrations/discord/webhook`,
          expected_header: 'x-webhook-secret',
        },
        outgoing,
        webhook_tests: {
          last_test: lastTest,
          recent: recentTests,
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

function buildSlackApprovalRequirements(args: {
  baseUrl: string;
  signingSecretConfigured: boolean;
  slackWebhookConfigured: boolean;
}): IntegrationRequirement[] {
  return [
    {
      label: `Interactivity endpoint exposed at ${args.baseUrl}/api/integrations/slack/interactions`,
      met: true,
    },
    {
      label: 'SLACK_SIGNING_SECRET configured on the server',
      met: args.signingSecretConfigured,
    },
    {
      label: 'Outgoing Slack webhook saved for this company',
      met: args.slackWebhookConfigured,
    },
  ];
}

function getSlackApprovalStatus(args: {
  signingSecretConfigured: boolean;
  slackWebhookConfigured: boolean;
}) {
  if (args.signingSecretConfigured && args.slackWebhookConfigured) {
    return 'Ready for one-click approvals';
  }

  if (!args.signingSecretConfigured && !args.slackWebhookConfigured) {
    return 'Missing signing secret and outgoing webhook';
  }

  if (!args.signingSecretConfigured) {
    return 'Missing signing secret';
  }

  return 'Missing outgoing Slack webhook';
}

router.patch(
  '/config',
  requireRole(['owner', 'admin']),
  async (req: AuthRequest, res, next) => {
    const companyId = getCompanyId(req);
    if (!companyId) {
      return res.status(400).json({ error: 'Missing company context' });
    }

    const parsed = integrationConfigSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error });
    }

    try {
      const slackWebhookUrl = normalizeOptionalUrl(
        parsed.data.slack_webhook_url
      );
      const discordWebhookUrl = normalizeOptionalUrl(
        parsed.data.discord_webhook_url
      );

      const result = await db.query(
        `UPDATE companies
       SET slack_webhook_url = $1,
           discord_webhook_url = $2
       WHERE id = $3
       RETURNING id, slack_webhook_url, discord_webhook_url`,
        [slackWebhookUrl, discordWebhookUrl, companyId]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Company not found' });
      }

      await db.query(
        `INSERT INTO audit_log (company_id, action, entity_type, details)
       VALUES ($1, 'integration.config_updated', 'integration', $2)`,
        [
          companyId,
          JSON.stringify({
            slack_webhook_configured: Boolean(result.rows[0].slack_webhook_url),
            discord_webhook_configured: Boolean(
              result.rows[0].discord_webhook_url
            ),
          }),
        ]
      );

      res.json({
        success: true,
        outgoing: {
          slack_webhook_url: result.rows[0].slack_webhook_url ?? null,
          discord_webhook_url: result.rows[0].discord_webhook_url ?? null,
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/test-webhook',
  requireRole(['owner', 'admin']),
  async (req: AuthRequest, res, next) => {
    const companyId = getCompanyId(req);
    if (!companyId) {
      return res.status(400).json({ error: 'Missing company context' });
    }

    const parsed = integrationTestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error });
    }

    try {
      const companyRes = await db.query(
        'SELECT name, slack_webhook_url, discord_webhook_url FROM companies WHERE id = $1',
        [companyId]
      );
      if (companyRes.rows.length === 0) {
        return res.status(404).json({ error: 'Company not found' });
      }

      const company = companyRes.rows[0];
      const explicitUrl = normalizeOptionalUrl(parsed.data.url);
      const targetUrl =
        parsed.data.type === 'slack'
          ? (explicitUrl ?? company.slack_webhook_url ?? null)
          : (explicitUrl ?? company.discord_webhook_url ?? null);

      if (!targetUrl) {
        return res
          .status(400)
          .json({ error: `Missing ${parsed.data.type} webhook URL` });
      }

      const message = `Integration test from Autonomiczne Biuro for ${company.name} at ${new Date().toISOString()}`;
      const result =
        parsed.data.type === 'slack'
          ? await NotificationService.alertSlack(targetUrl, message)
          : await NotificationService.alertDiscord(targetUrl, message);

      await db.query(
        `INSERT INTO audit_log (company_id, action, entity_type, details)
       VALUES ($1, 'integration.webhook_tested', 'integration', $2)`,
        [
          companyId,
          JSON.stringify({
            type: parsed.data.type,
            status: result.ok ? 'success' : 'failure',
            target_url: targetUrl,
            error: result.ok ? null : (result.error ?? null),
          }),
        ]
      );

      if (!result.ok) {
        return res
          .status(502)
          .json({ error: result.error || 'Webhook test failed' });
      }

      res.json({ success: true });
    } catch (err) {
      next(err);
    }
  }
);

router.post('/slack/events', async (req: RawBodyRequest, res) => {
  try {
    if (!verifySlackSignature(req)) {
      return res.status(401).json({ error: 'Invalid Slack signature' });
    }
  } catch (err: any) {
    return res.status(503).json({ error: err.message });
  }

  if (req.body.challenge) return res.send(req.body.challenge);

  await IntegrationService.handleSlackEvent(req.body.event);
  res.sendStatus(200);
});

router.post('/slack/command', async (req: RawBodyRequest, res) => {
  try {
    if (!verifySlackSignature(req)) {
      return res.status(401).json({ error: 'Invalid Slack signature' });
    }
  } catch (err: any) {
    return res.status(503).json({ error: err.message });
  }

  const { command, text, company_id } = req.body;
  const result = await IntegrationService.handleSlashCommand(
    command,
    text,
    company_id
  );
  res.send({ text: result });
});

router.post('/slack/interactions', async (req: RawBodyRequest, res) => {
  try {
    if (!verifySlackSignature(req)) {
      return res.status(401).json({ error: 'Invalid Slack signature' });
    }
  } catch (err: any) {
    return res.status(503).json({ error: err.message });
  }

  const payloadRaw =
    typeof req.body?.payload === 'string' ? req.body.payload : null;
  if (!payloadRaw) {
    return res.status(400).json({ error: 'Missing Slack interaction payload' });
  }

  let payload: any;
  try {
    payload = JSON.parse(payloadRaw);
  } catch {
    return res.status(400).json({ error: 'Invalid Slack interaction payload' });
  }

  const result = await IntegrationService.handleSlackInteraction(payload);
  res.json(result);
});

router.post('/discord/webhook', async (req, res) => {
  try {
    if (!verifyDiscordWebhookSecret(req)) {
      return res.status(401).json({ error: 'Invalid Discord webhook secret' });
    }
  } catch (err: any) {
    return res.status(503).json({ error: err.message });
  }

  await IntegrationService.handleDiscordEvent(req.body);
  res.sendStatus(200);
});

export default router;
