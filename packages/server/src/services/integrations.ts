import { db } from '../db/client.js';
import { logger } from '../utils/logger.js';
import { createApprovalRequest } from '../governance/approvals.js';

export const IntegrationService = {
  async handleSlackEvent(event: any) {
    logger.info({ type: event.type }, 'Handling Slack event');
    
    // Example: Handling a message in a synced channel
    if (event.type === 'message' && !event.bot_id) {
       // Find the task associated with this channel/thread
       const taskRes = await db.query(
         "SELECT id, company_id FROM tasks WHERE metadata->>'slack_channel' = $1 LIMIT 1",
         [event.channel]
       );
       
       if (taskRes.rows.length > 0) {
         const task = taskRes.rows[0];
         await db.query(
           "INSERT INTO messages (company_id, task_id, content, type) VALUES ($1, $2, $3, 'message')",
           [task.company_id, task.id, event.text]
         );
       }
    }
  },

  async handleDiscordEvent(message: any) {
    logger.info({ author: message.author.username }, 'Handling Discord message');
    // Similar logic to Slack...
  },

  async handleSlashCommand(command: string, params: string, companyId: string) {
    if (command === '/biuro-task') {
      const res = await db.query(
        "INSERT INTO tasks (company_id, title, description, status) VALUES ($1, $2, $3, 'backlog') RETURNING id",
        [companyId, 'New Task from Slack', params]
      );
      return `Task created: ${res.rows[0].id}`;
    }
    return `Unknown command: ${command}`;
  }
};
