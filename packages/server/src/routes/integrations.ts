import { Router } from 'express';
import { IntegrationService } from '../services/integrations.js';

const router: Router = Router();

router.post('/slack/events', async (req, res) => {
  // Challenge for Slack verification
  if (req.body.challenge) return res.send(req.body.challenge);
  
  await IntegrationService.handleSlackEvent(req.body.event);
  res.sendStatus(200);
});

router.post('/slack/command', async (req, res) => {
  const { command, text, company_id } = req.body;
  const result = await IntegrationService.handleSlashCommand(command, text, company_id);
  res.send({ text: result });
});

router.post('/discord/webhook', async (req, res) => {
  await IntegrationService.handleDiscordEvent(req.body);
  res.sendStatus(200);
});

export default router;
