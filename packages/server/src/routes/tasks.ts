import { Router } from 'express';
import { db } from '../db/client.js';
import { z } from 'zod';
import { requireRole } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { AppError, NotFoundError, ForbiddenError, wrapAsync } from '../utils/errors.js';
import type { AuthRequest } from '../utils/context.js';
import {
  broadcastCollaborationSignal,
  deriveCollaborationSignalKind,
  getTaskCollaborationSnapshot,
} from '../services/collaboration.js';
import { enqueueCompanyWakeup } from '../orchestrator/schedulerQueue.js';
import { broadcastCompanyEvent } from '../realtime/eventBus.js';

const router: Router = Router();

const createTaskSchema = z.object({
  company_id: z.string().uuid(),
  goal_id: z.string().uuid().optional(),
  parent_id: z.string().uuid().optional(),
  title: z.string().min(1),
  description: z.string().optional(),
  assigned_to: z.string().uuid().optional(),
  priority: z.number().default(0),
});

const taskMessageSchema = z.object({
  content: z.string().trim().min(1),
  from_agent: z.string().uuid().optional(),
  to_agent: z.string().uuid().optional(),
});

function getScopedCompanyId(req: AuthRequest) {
  return req.user?.companyId ?? null;
}

// Create
router.post(
  '/',
  requireRole(['owner', 'admin', 'member']),
  validate({ body: createTaskSchema }),
  wrapAsync(async (req: AuthRequest, res) => {
    const {
      company_id,
      goal_id,
      parent_id,
      title,
      description,
      assigned_to,
      priority,
    } = req.body;

    const scopedCompanyId = getScopedCompanyId(req);
    if (!scopedCompanyId || scopedCompanyId !== company_id) {
      throw new ForbiddenError('Company access denied');
    }

    if (assigned_to) {
      const agentRes = await db.query(
        'SELECT id FROM agents WHERE id = $1 AND company_id = $2',
        [assigned_to, scopedCompanyId]
      );
      if (agentRes.rows.length === 0) {
        throw new NotFoundError('Assigned agent not found in this company');
      }
    }

    const status = assigned_to ? 'assigned' : 'backlog';
    const result = await db.query(
      `INSERT INTO tasks (company_id, goal_id, parent_id, title, description, assigned_to, created_by, priority, status) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [
        company_id,
        goal_id,
        parent_id,
        title,
        description,
        assigned_to,
        req.user?.id ?? null,
        priority,
        status,
      ]
    );
    const task = result.rows[0];

    // Audit log
    await db.query(
      "INSERT INTO audit_log (company_id, action, entity_type, entity_id, details) VALUES ($1, 'task.created', 'task', $2, '{}')",
      [company_id, task.id]
    );

    await enqueueCompanyWakeup(company_id, 'task_created', {
      taskId: task.id,
      agentId: task.assigned_to ?? null,
    });

    await broadcastCompanyEvent(
      company_id,
      'task.updated',
      {
        company_id,
        task_id: task.id,
        status: task.status,
        assigned_to: task.assigned_to ?? null,
        source: 'task_created',
      },
      'api'
    );

    res.status(201).json(task);
  })
);

// Get by ID
router.get(
  '/:id',
  requireRole(['owner', 'admin', 'member', 'viewer']),
  wrapAsync(async (req: AuthRequest, res) => {
    const { id } = req.params;
    if (!id || id === 'undefined') {
      throw new AppError('Invalid ID', 400);
    }

    const scopedCompanyId = getScopedCompanyId(req);
    if (!scopedCompanyId) {
      throw new ForbiddenError('Company access denied');
    }

    const result = await db.query(
      `SELECT
         t.*,
         a.name AS assigned_to_name,
         a.role AS assigned_to_role,
         a.status AS assigned_to_status
       FROM tasks t
       LEFT JOIN agents a ON a.id = t.assigned_to
       WHERE t.id = $1
         AND t.company_id = $2`,
      [id, scopedCompanyId]
    );

    if (result.rows.length === 0) {
      throw new NotFoundError('Task not found');
    }

    res.json(result.rows[0]);
  })
);

// Post message to task
router.post(
  '/:id/messages',
  requireRole(['owner', 'admin', 'member']),
  async (req: AuthRequest, res, next) => {
    try {
      const taskId = Array.isArray(req.params.id)
        ? req.params.id[0]
        : req.params.id;
      if (!taskId || taskId === 'undefined')
        return res.status(400).json({ error: 'Invalid ID' });
      const scopedCompanyId = getScopedCompanyId(req);
      if (!scopedCompanyId) {
        return res.status(403).json({ error: 'Forbidden: Company access denied' });
      }
      const taskRes = await db.query(
        'SELECT company_id FROM tasks WHERE id = $1 AND company_id = $2',
        [taskId, scopedCompanyId]
      );
      if (taskRes.rows.length === 0)
        return res.status(404).json({ error: 'Task not found' });
      const parsed = taskMessageSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error });
      }
      const { content, from_agent, to_agent } = parsed.data;
      if (from_agent) {
        const fromAgentRes = await db.query(
          'SELECT id FROM agents WHERE id = $1 AND company_id = $2',
          [from_agent, scopedCompanyId]
        );
        if (fromAgentRes.rows.length === 0) {
          return res.status(404).json({ error: 'Sender agent not found' });
        }
      }
      if (to_agent) {
        const toAgentRes = await db.query(
          'SELECT id FROM agents WHERE id = $1 AND company_id = $2',
          [to_agent, scopedCompanyId]
        );
        if (toAgentRes.rows.length === 0) {
          return res.status(404).json({ error: 'Recipient agent not found' });
        }
      }
      const result = await db.query(
        `INSERT INTO messages (company_id, task_id, from_agent, to_agent, content, type)
       VALUES ($1, $2, $3, $4, $5, 'message') RETURNING *`,
        [
          taskRes.rows[0].company_id,
          taskId,
          from_agent || null,
          to_agent || null,
          content,
        ]
      );
      await broadcastCollaborationSignal(
        taskRes.rows[0].company_id,
        taskId,
        deriveCollaborationSignalKind('message', from_agent ?? null),
        {
          from_agent_id: from_agent || null,
          to_agent_id: to_agent || null,
          message_id: result.rows[0].id,
        }
      );
      res.status(201).json(result.rows[0]);
    } catch (err) {
      next(err);
    }
  }
);

// Get messages for task
router.get(
  '/:id/messages',
  requireRole(['owner', 'admin', 'member', 'viewer']),
  async (req: AuthRequest, res, next) => {
    try {
      if (!req.params.id || req.params.id === 'undefined')
        return res.status(400).json({ error: 'Invalid ID' });
      const scopedCompanyId = getScopedCompanyId(req);
      if (!scopedCompanyId) {
        return res.status(403).json({ error: 'Forbidden: Company access denied' });
      }
      const result = await db.query(
        `SELECT m.*
         FROM messages m
         JOIN tasks t ON t.id = m.task_id
         WHERE m.task_id = $1
           AND t.company_id = $2
         ORDER BY m.created_at ASC`,
        [req.params.id, scopedCompanyId]
      );
      res.json(result.rows);
    } catch (err) {
      next(err);
    }
  }
);

router.get(
  '/:id/collaboration',
  requireRole(['owner', 'admin', 'member', 'viewer']),
  async (req: AuthRequest, res, next) => {
    try {
      const taskId = Array.isArray(req.params.id)
        ? req.params.id[0]
        : req.params.id;
      if (!taskId || taskId === 'undefined') {
        return res.status(400).json({ error: 'Invalid ID' });
      }
      const scopedCompanyId = getScopedCompanyId(req);
      if (!scopedCompanyId) {
        return res.status(403).json({ error: 'Forbidden: Company access denied' });
      }
      const taskRes = await db.query(
        'SELECT id FROM tasks WHERE id = $1 AND company_id = $2',
        [taskId, scopedCompanyId]
      );
      if (taskRes.rows.length === 0) {
        return res.status(404).json({ error: 'Task not found' });
      }

      const snapshot = await getTaskCollaborationSnapshot(taskId);
      if (!snapshot) {
        return res.status(404).json({ error: 'Task not found' });
      }

      res.json(snapshot);
    } catch (err) {
      next(err);
    }
  }
);

// List (with filters)
router.get(
  '/',
  requireRole(['owner', 'admin', 'member', 'viewer']),
  async (req: AuthRequest, res, next) => {
    try {
      const { assigned_to, status } = req.query;
      const company_id = getScopedCompanyId(req);
      if (!company_id) {
        return res.status(400).json({ error: 'Missing company_id' });
      }
      let q = 'SELECT * FROM tasks WHERE company_id = $1';
      let params: any[] = [company_id];

      if (assigned_to) {
        q += ' AND assigned_to = $' + (params.length + 1);
        params.push(assigned_to);
      }
      if (status) {
        q += ' AND status = $' + (params.length + 1);
        params.push(status);
      }

      q += ' ORDER BY priority DESC, created_at ASC';
      const result = await db.query(q, params);
      res.json(result.rows);
    } catch (err) {
      next(err);
    }
  }
);

// Update Status
router.patch(
  '/:id/status',
  requireRole(['owner', 'admin', 'member']),
  async (req: AuthRequest, res, next) => {
    try {
      const { status } = req.body;
      const scopedCompanyId = getScopedCompanyId(req);
      if (!scopedCompanyId) {
        return res.status(403).json({ error: 'Forbidden: Company access denied' });
      }
      const result = await db.query(
        'UPDATE tasks SET status = $1, updated_at = now() WHERE id = $2 AND company_id = $3 RETURNING *',
        [status, req.params.id, scopedCompanyId]
      );
      if (result.rows.length === 0)
        return res.status(404).json({ error: 'Task not found' });
      const task = result.rows[0];
      if (
        ['backlog', 'assigned', 'in_progress'].includes(String(task.status))
      ) {
        await enqueueCompanyWakeup(task.company_id, 'task_status_changed', {
          taskId: task.id,
          agentId: task.assigned_to ?? null,
        });
      }
      await broadcastCompanyEvent(
        task.company_id,
        'task.updated',
        {
          company_id: task.company_id,
          task_id: task.id,
          status: task.status,
          assigned_to: task.assigned_to ?? null,
          source: 'status_patch',
        },
        'api'
      );
      res.json(task);
    } catch (err) {
      next(err);
    }
  }
);

// Update Assignment
router.patch(
  '/:id/assign',
  requireRole(['owner', 'admin', 'member']),
  async (req: AuthRequest, res, next) => {
    try {
      const { assigned_to } = req.body;
      const scopedCompanyId = getScopedCompanyId(req);
      if (!scopedCompanyId) {
        return res.status(403).json({ error: 'Forbidden: Company access denied' });
      }
      if (assigned_to) {
        const agentRes = await db.query(
          'SELECT id FROM agents WHERE id = $1 AND company_id = $2',
          [assigned_to, scopedCompanyId]
        );
        if (agentRes.rows.length === 0) {
          return res
            .status(404)
            .json({ error: 'Assigned agent not found in this company' });
        }
      }
      const result = await db.query(
        `UPDATE tasks
       SET assigned_to = $1,
           status = CASE
             WHEN $1 IS NOT NULL AND status = 'backlog' THEN 'assigned'
             WHEN $1 IS NULL AND status = 'assigned' THEN 'backlog'
             ELSE status
           END,
           updated_at = now()
       WHERE id = $2
         AND company_id = $3
       RETURNING *`,
        [assigned_to, req.params.id, scopedCompanyId]
      );
      const task = result.rows[0];
      if (!task) {
        return res.status(404).json({ error: 'Task not found' });
      }
      if (task) {
        await enqueueCompanyWakeup(task.company_id, 'task_assignment_changed', {
          taskId: task.id,
          agentId: task.assigned_to ?? null,
        });
      }
      await broadcastCompanyEvent(
        task.company_id,
        'task.updated',
        {
          company_id: task.company_id,
          task_id: task.id,
          status: task.status,
          assigned_to: task.assigned_to ?? null,
          source: 'assignment_patch',
        },
        'api'
      );
      res.json(task);
    } catch (err) {
      next(err);
    }
  }
);

export default router;
