import { Router } from 'express';
import { db } from '../db/client.js';
import { z } from 'zod';
import { requireRole } from '../middleware/auth.js';
import { broadcastCollaborationSignal, getTaskCollaborationSnapshot } from '../services/collaboration.js';
import { enqueueCompanyWakeup } from '../orchestrator/schedulerQueue.js';

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

// Create
router.post('/', requireRole(['owner', 'admin', 'member']), async (req, res, next) => {
  try {
    const parsed = createTaskSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error });

    const { company_id, goal_id, parent_id, title, description, assigned_to, priority } = parsed.data;
    const status = assigned_to ? 'assigned' : 'backlog';
    const result = await db.query(
      `INSERT INTO tasks (company_id, goal_id, parent_id, title, description, assigned_to, priority, status) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [company_id, goal_id, parent_id, title, description, assigned_to, priority, status]
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

    res.status(201).json(task);
  } catch (err) { next(err); }
});

// Get by ID
router.get('/:id', requireRole(['owner', 'admin', 'member', 'viewer']), async (req, res, next) => {
  try {
    if (!req.params.id || req.params.id === 'undefined') return res.status(400).json({ error: 'Invalid ID' });
    const result = await db.query(
      `SELECT
         t.*,
         a.name AS assigned_to_name,
         a.role AS assigned_to_role,
         a.status AS assigned_to_status
       FROM tasks t
       LEFT JOIN agents a ON a.id = t.assigned_to
       WHERE t.id = $1`,
      [req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Task not found' });
    res.json(result.rows[0]);
  } catch (err) { next(err); }
});

// Post message to task
router.post('/:id/messages', requireRole(['owner', 'admin', 'member']), async (req, res, next) => {
  try {
    const taskId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    if (!taskId || taskId === 'undefined') return res.status(400).json({ error: 'Invalid ID' });
    const taskRes = await db.query('SELECT company_id FROM tasks WHERE id = $1', [taskId]);
    if (taskRes.rows.length === 0) return res.status(404).json({ error: 'Task not found' });
    const { content, from_agent, to_agent } = req.body;
    const result = await db.query(
      `INSERT INTO messages (company_id, task_id, from_agent, to_agent, content, type)
       VALUES ($1, $2, $3, $4, $5, 'message') RETURNING *`,
      [taskRes.rows[0].company_id, taskId, from_agent || null, to_agent || null, content]
    );
    await broadcastCollaborationSignal(taskRes.rows[0].company_id, taskId, from_agent ? 'message' : 'supervisor_message', {
      from_agent_id: from_agent || null,
      to_agent_id: to_agent || null,
      message_id: result.rows[0].id,
    });
    res.status(201).json(result.rows[0]);
  } catch (err) { next(err); }
});

// Get messages for task
router.get('/:id/messages', requireRole(['owner', 'admin', 'member', 'viewer']), async (req, res, next) => {
  try {
    if (!req.params.id || req.params.id === 'undefined') return res.status(400).json({ error: 'Invalid ID' });
    const result = await db.query(
      'SELECT * FROM messages WHERE task_id = $1 ORDER BY created_at ASC',
      [req.params.id]
    );
    res.json(result.rows);
  } catch (err) { next(err); }
});

router.get('/:id/collaboration', requireRole(['owner', 'admin', 'member', 'viewer']), async (req, res, next) => {
  try {
    const taskId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    if (!taskId || taskId === 'undefined') {
      return res.status(400).json({ error: 'Invalid ID' });
    }

    const snapshot = await getTaskCollaborationSnapshot(taskId);
    if (!snapshot) {
      return res.status(404).json({ error: 'Task not found' });
    }

    res.json(snapshot);
  } catch (err) {
    next(err);
  }
});

// List (with filters)
router.get('/', requireRole(['owner', 'admin', 'member', 'viewer']), async (req, res, next) => {
  try {
    const { company_id, assigned_to, status } = req.query;
    if (!company_id) return res.status(400).json({ error: 'Missing company_id' });
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
  } catch (err) { next(err); }
});

// Update Status
router.patch('/:id/status', requireRole(['owner', 'admin', 'member']), async (req, res, next) => {
  try {
    const { status } = req.body;
    const result = await db.query(
      'UPDATE tasks SET status = $1, updated_at = now() WHERE id = $2 RETURNING *',
      [status, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Task not found' });
    const task = result.rows[0];
    if (['backlog', 'assigned', 'in_progress'].includes(String(task.status))) {
      await enqueueCompanyWakeup(task.company_id, 'task_status_changed', {
        taskId: task.id,
        agentId: task.assigned_to ?? null,
      });
    }
    res.json(task);
  } catch (err) { next(err); }
});

// Update Assignment
router.patch('/:id/assign', requireRole(['owner', 'admin', 'member']), async (req, res, next) => {
  try {
    const { assigned_to } = req.body;
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
       RETURNING *`,
      [assigned_to, req.params.id]
    );
    const task = result.rows[0];
    if (task) {
      await enqueueCompanyWakeup(task.company_id, 'task_assignment_changed', {
        taskId: task.id,
        agentId: task.assigned_to ?? null,
      });
    }
    res.json(task);
  } catch (err) { next(err); }
});

export default router;
