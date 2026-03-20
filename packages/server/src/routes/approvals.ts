import { Router } from 'express';
import { db } from '../db/client.js';
import { z } from 'zod';
import { requireRole } from '../middleware/auth.js';
import { resolveApproval } from '../governance/approvals.js';
import type { AuthRequest } from '../utils/context.js';

const router: Router = Router();

const policySchema = z.object({
  company_id: z.string().uuid(),
  name: z.string().min(1),
  description: z.string().optional(),
  type: z.enum([
    'approval_required',
    'budget_threshold',
    'delegation_limit',
    'rate_limit',
    'tool_restriction',
  ]),
  rules: z.record(z.any()).optional(),
});

// List approvals (filtered by company)
router.get(
  '/',
  requireRole(['owner', 'admin']),
  async (req: AuthRequest, res, next) => {
    try {
      const companyId = req.user?.companyId;
      if (!companyId) {
        return res
          .status(403)
          .json({ error: 'Forbidden: Company access denied' });
      }

      const result = await db.query(
        'SELECT * FROM approvals WHERE company_id = $1 ORDER BY created_at DESC',
        [companyId]
      );
      res.json(result.rows);
    } catch (err) {
      next(err);
    }
  }
);

// Resolve approval
router.post(
  '/:id/resolve',
  requireRole(['owner', 'admin']),
  async (req: AuthRequest, res, next) => {
    try {
      const id = Array.isArray(req.params.id)
        ? req.params.id[0]
        : req.params.id;
      const companyId = req.user?.companyId;
      if (!companyId) {
        return res
          .status(403)
          .json({ error: 'Forbidden: Company access denied' });
      }
      const { status, notes } = req.body;
      const result = await resolveApproval(id, status, notes, {
        companyId,
        source: 'dashboard',
        resolvedBy: req.user?.id ?? 'dashboard-user',
      });
      if (!result) return res.status(404).json({ error: 'Approval not found' });
      res.json(result);
    } catch (err) {
      next(err);
    }
  }
);

export default router;
