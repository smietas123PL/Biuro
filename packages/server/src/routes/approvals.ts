import { Router } from 'express';
import { db } from '../db/client.js';
import { z } from 'zod';
import { requireRole } from '../middleware/auth.js';
import { resolveApproval } from '../governance/approvals.js';

const router: Router = Router();

const policySchema = z.object({
  company_id: z.string().uuid(),
  name: z.string().min(1),
  description: z.string().optional(),
  type: z.enum(['approval_required', 'budget_threshold', 'delegation_limit', 'rate_limit', 'tool_restriction']),
  rules: z.record(z.any()).optional(),
});

// List approvals (filtered by company)
router.get('/', requireRole(['owner', 'admin']), async (req, res, next) => {
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
router.post('/:id/resolve', requireRole(['owner', 'admin']), async (req, res, next) => {
  try {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const { status, notes } = req.body;
    const result = await resolveApproval(id, status, notes, {
      source: 'dashboard',
      resolvedBy: 'dashboard-user',
    });
    if (!result) return res.status(404).json({ error: 'Approval not found' });
    res.json(result);
  } catch (err) { next(err); }
});

export default router;
