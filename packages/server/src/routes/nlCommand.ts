import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db/client.js';
import { requireRole } from '../middleware/auth.js';
import type { AuthRequest } from '../utils/context.js';
import { planNaturalLanguageCommand } from '../services/nlCommandPlanner.js';

const router: Router = Router();

const interpretSchema = z.object({
  input: z.string().min(3).max(500),
});

function isCompanyNotFoundError(error: unknown) {
  return (
    error instanceof Error &&
    /^Company\s.+\snot found$/.test(error.message.trim())
  );
}

router.post(
  '/',
  requireRole(['owner', 'admin', 'member', 'viewer']),
  async (req: AuthRequest, res, next) => {
    try {
      const parsed = interpretSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error });
      }

      const companyId = req.user?.companyId;
      if (!companyId) {
        return res.status(400).json({
          error: 'Missing company context for natural language command',
        });
      }

      const plan = await planNaturalLanguageCommand(
        {
          companyId,
          role: req.user?.role,
        },
        parsed.data.input
      );

      await db.query(
        `INSERT INTO audit_log (company_id, action, details)
       VALUES ($1, 'nl_command.planned', $2)`,
        [
          companyId,
          JSON.stringify({
            input: parsed.data.input,
            source: plan.source,
            can_execute: plan.can_execute,
            action_count: plan.actions.length,
            action_types: plan.actions.map((action) => action.type),
            planner: plan.planner,
            user_id: req.user?.id ?? null,
          }),
        ]
      );

      res.json(plan);
    } catch (err) {
      if (isCompanyNotFoundError(err)) {
        return res.status(404).json({ error: 'Company not found' });
      }
      next(err);
    }
  }
);

export default router;
