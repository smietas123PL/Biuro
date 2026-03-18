import { logger } from '../utils/logger.js';

export const NotificationService = {
  async sendWebhook(url: string, payload: any) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!response.ok) throw new Error(`Webhook failed: ${response.statusText}`);
      logger.info({ url }, 'Webhook sent successfully');
    } catch (err: any) {
      logger.error({ err: err.message, url }, 'Failed to send webhook');
    }
  },

  async alertSlack(url: string, message: string) {
    return this.sendWebhook(url, { text: message });
  },

  async alertDiscord(url: string, message: string) {
    return this.sendWebhook(url, { content: message });
  }
};
