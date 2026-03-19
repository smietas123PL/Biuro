import { logger } from '../utils/logger.js';

export const NotificationService = {
  async sendWebhook(url: string, payload: any) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!response.ok)
        throw new Error(
          `Webhook failed: ${response.status} ${response.statusText}`
        );
      logger.info({ url }, 'Webhook sent successfully');
      return { ok: true as const };
    } catch (err: any) {
      logger.error({ err: err.message, url }, 'Failed to send webhook');
      return { ok: false as const, error: err.message as string };
    }
  },

  async alertSlack(url: string, message: string) {
    return this.sendWebhook(url, { text: message });
  },

  async sendSlackMessage(url: string, payload: Record<string, unknown>) {
    return this.sendWebhook(url, payload);
  },

  async alertDiscord(url: string, message: string) {
    return this.sendWebhook(url, { content: message });
  },
};
