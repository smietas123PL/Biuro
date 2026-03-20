import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db/client.js';
import { requireRole } from '../middleware/auth.js';
import type { AuthRequest } from '../utils/context.js';
import {
  broadcastCollaborationSignal,
  deriveCollaborationSignalKind,
} from '../services/collaboration.js';

const router: Router = Router();

const createMessageSchema = z.object({
  task_id: z.string().uuid(),
  from_agent: z.string().uuid().optional(),
  to_agent: z.string().uuid().optional(),
  content: z.string().trim().min(1),
  type: z
    .enum([
      'message',
      'delegation',
      'status_update',
      'approval_request',
      'tool_call',
      'tool_result',
      'heartbeat_log',
    ])
    .optional(),
  metadata: z.record(z.any()).optional(),
});

function getScopedCompanyId(req: AuthRequest) {
  return req.user?.companyId ?? null;
}

// Create Message (manual or by system)
router.post(
  '/',
  requireRole(['owner', 'admin', 'member']),
  async (req: AuthRequest, res) => {
    const parsed = createMessageSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error });
    }

    const { task_id, from_agent, to_agent, content, type, metadata } =
      parsed.data;
    const companyId = getScopedCompanyId(req);
    if (!companyId) {
      return res.status(403).json({ error: 'Forbidden: Company access denied' });
    }
    const taskCheck = await db.query(
      'SELECT id FROM tasks WHERE id = $1 AND company_id = $2',
      [task_id, companyId]
    );
    if (taskCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Task not found' });
    }
    if (from_agent) {
      const fromAgentCheck = await db.query(
        'SELECT id FROM agents WHERE id = $1 AND company_id = $2',
        [from_agent, companyId]
      );
      if (fromAgentCheck.rows.length === 0) {
        return res.status(404).json({ error: 'Sender agent not found' });
      }
    }
    if (to_agent) {
      const toAgentCheck = await db.query(
        'SELECT id FROM agents WHERE id = $1 AND company_id = $2',
        [to_agent, companyId]
      );
      if (toAgentCheck.rows.length === 0) {
        return res.status(404).json({ error: 'Recipient agent not found' });
      }
    }
    const result = await db.query(
      `INSERT INTO messages (company_id, task_id, from_agent, to_agent, content, type, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [
        companyId,
        task_id,
        from_agent ?? null,
        to_agent ?? null,
        content,
        type || 'message',
        JSON.stringify(metadata || {}),
      ]
    );
    await broadcastCollaborationSignal(
      companyId,
      task_id,
      deriveCollaborationSignalKind(type, from_agent ?? null),
      {
        from_agent_id: from_agent ?? null,
        to_agent_id: to_agent ?? null,
        message_id: result.rows[0].id,
      }
    );
    res.status(201).json(result.rows[0]);
  }
);

// List for Task
router.get(
  '/task/:taskId',
  requireRole(['owner', 'admin', 'member', 'viewer']),
  async (req: AuthRequest, res) => {
    const companyId = getScopedCompanyId(req);
    if (!companyId) {
      return res.status(403).json({ error: 'Forbidden: Company access denied' });
    }
    const result = await db.query(
      `SELECT m.*
       FROM messages m
       JOIN tasks t ON t.id = m.task_id
       WHERE m.task_id = $1
         AND t.company_id = $2
       ORDER BY m.created_at ASC`,
      [req.params.taskId, companyId]
    );
    res.json(result.rows);
  }
);

export default router;
