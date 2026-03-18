import { db } from '../db/client.js';
import { NotificationService } from '../services/notifications.js';

export async function createApprovalRequest(
  companyId: string,
  taskId: string,
  agentId: string,
  reason: string,
  payload: any,
  policyId?: string
) {
  const res = await db.query(
    `INSERT INTO approvals (company_id, task_id, requested_by_agent, reason, payload, policy_id)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [companyId, taskId, agentId, reason, JSON.stringify(payload), policyId]
  );
  
  // Also status_update in messages
  await db.query(
    `INSERT INTO messages (company_id, task_id, from_agent, content, type) 
     VALUES ($1, $2, $3, $4, 'approval_request')`,
    [companyId, taskId, agentId, `Sent approval request: ${reason}`]
  );

  // Notify Webhooks
  const companyRes = await db.query(
    "SELECT name, slack_webhook_url, discord_webhook_url FROM companies WHERE id = $1",
    [companyId]
  );
  const { name, slack_webhook_url, discord_webhook_url } = companyRes.rows[0];
  const message = `📥 *APPROVAL REQUIRED* 📥\nCompany: ${name}\nReason: ${reason}\nPayload: ${JSON.stringify(payload)}`;

  if (slack_webhook_url) await NotificationService.alertSlack(slack_webhook_url, message);
  if (discord_webhook_url) await NotificationService.alertDiscord(discord_webhook_url, message);

  return res.rows[0];
}

export async function resolveApproval(approvalId: string, status: 'approved' | 'rejected', notes?: string) {
  const res = await db.query(
    `UPDATE approvals SET status = $1, resolution_notes = $2, resolved_at = now() 
     WHERE id = $3 RETURNING *`,
    [status, notes, approvalId]
  );
  
  if (status === 'approved') {
    // Unblock the task if needed
    await db.query("UPDATE tasks SET status = 'in_progress' WHERE id = (SELECT task_id FROM approvals WHERE id = $1)", [approvalId]);
  } else {
     await db.query("UPDATE tasks SET status = 'blocked' WHERE id = (SELECT task_id FROM approvals WHERE id = $1)", [approvalId]);
  }

  return res.rows[0];
}
