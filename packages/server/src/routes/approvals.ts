import { Router } from 'express';
import { db } from '../db/client.js';
import { z } from 'zod';

const router: Router = Router();

const policySchema = z.object({
  company_id: z.string().uuid(),
  name: z.string().min(1),
  description: z.string().optional(),
  type: z.enum(['approval_required', 'budget_threshold', 'delegation_limit', 'rate_limit', 'tool_restriction']),
  rules: z.record(z.any()).optional(),
});

// List approvals (filtered by company)
router.get('/', async (req, res, next) => {
  try {
    const { company_id } = req.query;
    let q = 'SELECT * FROM approvals';
    let params: any[] = [];
    if (company_id) {
      q += ' WHERE company_id = $1';
      params.push(company_id);
    }
    q += ' ORDER BY created_at DESC';
    const result = await db.query(q, params);
    res.json(result.rows);
  } catch (err) { next(err); }
});

// Resolve approval
router.post('/:id/resolve', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status, notes } = req.body;
    const result = await db.query(
      "UPDATE approvals SET status = $1, resolution_notes = $2, resolved_at = now() WHERE id = $3 RETURNING *",
      [status, notes, id]
    );
    res.json(result.rows[0]);
  } catch (err) { next(err); }
});

export default router;
