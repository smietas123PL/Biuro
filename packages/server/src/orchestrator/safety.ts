import { db } from '../db/client.js';
import { logger } from '../utils/logger.js';
import { NotificationService } from '../services/notifications.js';

export async function checkSafety(agentId: string, taskId: string): Promise<{ ok: boolean; reason?: string }> {
  // 1. Circular Delegation Check
  const isCircular = await detectCircularDelegation(taskId);
  if (isCircular) return { ok: false, reason: 'Circular delegation detected' };

  // 2. Message Flood Detection (e.g., > 10 messages in 1 minute for this task/agent)
  const messageCount = await db.query(
    `SELECT COUNT(*) FROM messages 
     WHERE task_id = $1 AND from_agent = $2 
     AND created_at > now() - interval '1 minute'`,
    [taskId, agentId]
  );
  if (parseInt(messageCount.rows[0].count) > 10) {
    return { ok: false, reason: 'Message flood detected' };
  }

  // 3. Consecutive Error Detection (from heartbeat logs)
  const errorCount = await db.query(
    `SELECT COUNT(*) FROM heartbeats 
     WHERE agent_id = $1 AND status = 'error' 
     AND created_at > now() - interval '5 minutes'`,
    [agentId]
  );
  if (parseInt(errorCount.rows[0].count) > 5) {
     return { ok: false, reason: 'Too many consecutive errors' };
  }

  return { ok: true };
}

async function detectCircularDelegation(taskId: string): Promise<boolean> {
  const visited = new Set<string>();
  let currentId = taskId;
  
  while (currentId) {
    if (visited.has(currentId)) return true;
    visited.add(currentId);
    
    const res = await db.query('SELECT parent_id FROM tasks WHERE id = $1', [currentId]);
    currentId = res.rows[0]?.parent_id;
  }
  
  return false;
}

export async function autoPauseAgent(agentId: string, reason: string) {
  logger.warn({ agentId, reason }, 'Auto-pausing agent due to safety violation');
  
  // 1. Pause in DB
  await db.query(
    "UPDATE agents SET status = 'paused', config = config || $1 WHERE id = $2",
    [JSON.stringify({ pause_reason: reason }), agentId]
  );

  // 2. Notify
  const res = await db.query(
    `SELECT a.name as agent_name, c.name as company_name, c.slack_webhook_url, c.discord_webhook_url 
     FROM agents a 
     JOIN companies c ON a.company_id = c.id 
     WHERE a.id = $1`,
    [agentId]
  );
  
  const { agent_name, company_name, slack_webhook_url, discord_webhook_url } = res.rows[0];
  const message = `🚨 *CRITICAL SAFETY ALERT* 🚨\nCompany: ${company_name}\nAgent: ${agent_name}\nReason: ${reason}\nStatus: AUTO-PAUSED`;

  if (slack_webhook_url) await NotificationService.alertSlack(slack_webhook_url, message);
  if (discord_webhook_url) await NotificationService.alertDiscord(discord_webhook_url, message);
}
