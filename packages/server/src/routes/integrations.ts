import { Router, type Request } from 'express';
import { createHmac, timingSafeEqual } from 'crypto';
import { IntegrationService } from '../services/integrations.js';
import { env } from '../env.js';

const router: Router = Router();
type RawBodyRequest = Request & { rawBody?: string };

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

  const requestAgeSeconds = Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp));
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
  const result = await IntegrationService.handleSlashCommand(command, text, company_id);
  res.send({ text: result });
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
