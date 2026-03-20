import { Router } from 'express';
import { z } from 'zod';
import { BillingService } from '../services/billing.js';
import { requireRole } from '../middleware/auth.js';
import type { AuthRequest } from '../utils/context.js';

const router: Router = Router();

const topUpSchema = z.object({
  amount: z.coerce.number().positive(),
  paymentMethodId: z.string().min(1).max(255).optional(),
});

function getCompanyId(req: AuthRequest) {
  return (
    req.user?.companyId ||
    (typeof req.headers['x-company-id'] === 'string'
      ? req.headers['x-company-id']
      : undefined)
  );
}

// 1. Get current balance
router.get(
  '/balance',
  requireRole(['owner', 'admin', 'member', 'viewer']),
  async (req: AuthRequest, res) => {
    const companyId = getCompanyId(req);
    if (!companyId) {
      return res.status(400).json({ error: 'Missing company context' });
    }

    const balance = await BillingService.getBalance(companyId);
    res.json({ balance });
  }
);

// 2. Mock Top-Up (Stripe simulation)
router.post(
  '/top-up',
  requireRole(['owner', 'admin']),
  async (req: AuthRequest, res) => {
    const parsed = topUpSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error });
    }

    const companyId = getCompanyId(req);
    if (!companyId) {
      return res.status(400).json({ error: 'Missing company context' });
    }

    const { amount, paymentMethodId } = parsed.data;

    // Simulate Stripe processing
    const stripeId = `ch_${Math.random().toString(36).substring(7)}`;

    try {
      await BillingService.addCredits(
        companyId,
        amount,
        'top-up',
        `Credit top-up via Stripe (${paymentMethodId || 'mock_card'})`,
        stripeId
      );
      res.json({ success: true, stripeId, amount });
    } catch (err) {
      res.status(500).json({ error: 'Top-up failed' });
    }
  }
);

export default router;
