import { env } from '../env.js';
import { db } from '../db/client.js';
import { logger } from '../utils/logger.js';
import { deliverOutgoingWebhooks } from '../services/outgoingWebhooks.js';

export async function checkSafety(
  agentId: string,
  taskId: string
): Promise<{ ok: boolean; reason?: string }> {
  // 1. Circular Delegation Check
  const isCircular = await detectCircularDelegation(taskId);
  if (isCircular) return { ok: false, reason: 'Circular delegation detected' };

  // 2. Hard heartbeat rate limit, independent from optional governance policies
  const heartbeatCount = await db.query(
    `SELECT COUNT(*)::int AS count
     FROM heartbeats
     WHERE agent_id = $1
       AND created_at > now() - interval '1 hour'`,
    [agentId]
  );
  if ((heartbeatCount.rows[0]?.count ?? 0) >= env.MAX_HEARTBEATS_PER_HOUR) {
    return { ok: false, reason: 'Heartbeat rate limit exceeded' };
  }

  // 3. Message Flood Detection (e.g., > 10 messages in 1 minute for this task/agent)
  const messageCount = await db.query(
    `SELECT COUNT(*) FROM messages 
     WHERE task_id = $1 AND from_agent = $2 
     AND created_at > now() - interval '1 minute'`,
    [taskId, agentId]
  );
  if (parseInt(messageCount.rows[0].count) > 10) {
    return { ok: false, reason: 'Message flood detected' };
  }

  // 4. Consecutive Error Detection (from heartbeat logs)
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
  const result = await db.query(
    `WITH RECURSIVE chain AS (
       SELECT
         id,
         parent_id,
         1 AS depth
       FROM tasks
       WHERE id = $1
       UNION ALL
       SELECT
         t.id,
         t.parent_id,
         c.depth + 1
       FROM tasks t
       JOIN chain c ON t.id = c.parent_id
       WHERE c.depth < 20
     )
     SELECT COUNT(*) AS cycle_count
     FROM chain
     WHERE id = $1
       AND depth > 1`,
    [taskId]
  );

  return Number(result.rows[0]?.cycle_count ?? 0) > 0;
}

export async function autoPauseAgent(agentId: string, reason: string) {
  logger.warn(
    { agentId, reason },
    'Auto-pausing agent due to safety violation'
  );

  await db.query(
    "UPDATE agents SET status = 'paused', config = config || $1 WHERE id = $2",
    [JSON.stringify({ pause_reason: reason }), agentId]
  );

  const res = await db.query(
    `SELECT a.name as agent_name, a.company_id, c.name as company_name, c.slack_webhook_url, c.discord_webhook_url 
     FROM agents a 
     JOIN companies c ON a.company_id = c.id 
     WHERE a.id = $1`,
    [agentId]
  );

  const {
    agent_name,
    company_id,
    company_name,
    slack_webhook_url,
    discord_webhook_url,
  } = res.rows[0];
  const message = `CRITICAL SAFETY ALERT\nCompany: ${company_name}\nAgent: ${agent_name}\nReason: ${reason}\nStatus: AUTO-PAUSED`;

  await db.query(
    `INSERT INTO audit_log (company_id, agent_id, action, details)
     VALUES ($1, $2, 'agent.auto_paused', $3)`,
    [
      company_id,
      agentId,
      JSON.stringify({
        reason,
        agent_name,
        company_name,
      }),
    ]
  );

  await deliverOutgoingWebhooks({
    companyId: company_id,
    agentId,
    event: 'agent.auto_paused',
    slackWebhookUrl: slack_webhook_url,
    slackText: message,
    discordWebhookUrl: discord_webhook_url,
    discordMessage: message,
    metadata: {
      reason,
      agent_name,
      company_name,
    },
  });
}
