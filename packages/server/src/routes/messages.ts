import { Router } from 'express';
import { db } from '../db/client.js';
import { z } from 'zod';
import { requireRole } from '../middleware/auth.js';

const router: Router = Router();

// Create Message (manual or by system)
router.post(
  '/',
  requireRole(['owner', 'admin', 'member']),
  async (req, res) => {
    const {
      company_id,
      task_id,
      from_agent,
      to_agent,
      content,
      type,
      metadata,
    } = req.body;
    const result = await db.query(
      `INSERT INTO messages (company_id, task_id, from_agent, to_agent, content, type, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [
        company_id,
        task_id,
        from_agent,
        to_agent,
        content,
        type || 'message',
        JSON.stringify(metadata || {}),
      ]
    );
    res.status(201).json(result.rows[0]);
  }
);

// List for Task
router.get(
  '/task/:taskId',
  requireRole(['owner', 'admin', 'member', 'viewer']),
  async (req, res) => {
    const result = await db.query(
      'SELECT * FROM messages WHERE task_id = $1 ORDER BY created_at ASC',
      [req.params.taskId]
    );
    res.json(result.rows);
  }
);

export default router;
