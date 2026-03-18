import { Router } from 'express';
import { db } from '../db/client.js';
import { z } from 'zod';
import { requireRole } from '../middleware/auth.js';

const router: Router = Router({ mergeParams: true });

const createGoalSchema = z.object({
  company_id: z.string().uuid(),
  parent_id: z.string().uuid().optional(),
  title: z.string().min(1),
  description: z.string().optional(),
});

// Create
router.post('/', requireRole(['owner', 'admin', 'member']), async (req, res, next) => {
  try {
    const parsed = createGoalSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error });

    const { company_id, parent_id, title, description } = parsed.data;
    const result = await db.query(
      'INSERT INTO goals (company_id, parent_id, title, description) VALUES ($1, $2, $3, $4) RETURNING *',
      [company_id, parent_id, title, description]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

// List
router.get('/', requireRole(['owner', 'admin', 'member', 'viewer']), async (req, res, next) => {
  try {
    const companyId =
      (typeof req.params.companyId === 'string' && req.params.companyId) ||
      (typeof req.query.company_id === 'string' && req.query.company_id);
    if (!companyId) {
      return res.status(400).json({ error: 'Missing company_id' });
    }

    const result = await db.query(
      'SELECT * FROM goals WHERE company_id = $1 ORDER BY created_at ASC',
      [companyId]
    );
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
});

// Update
router.patch('/:id', requireRole(['owner', 'admin', 'member']), async (req, res, next) => {
  try {
    const { status, title, description } = req.body;
    const result = await db.query(
      `UPDATE goals SET 
        status = COALESCE($1, status),
        title = COALESCE($2, title),
        description = COALESCE($3, description),
        updated_at = now()
       WHERE id = $4 RETURNING *`,
      [status, title, description, req.params.id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

export default router;
