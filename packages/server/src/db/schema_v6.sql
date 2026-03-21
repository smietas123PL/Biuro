-- Schema v6: Notification Integration

ALTER TABLE companies ADD COLUMN slack_webhook_url TEXT;
ALTER TABLE companies ADD COLUMN discord_webhook_url TEXT;