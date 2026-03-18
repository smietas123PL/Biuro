import { Router } from 'express';
import { BillingService } from '../services/billing.js';
import { requireRole } from '../middleware/auth.js';

const router: Router = Router();

// 1. Get current balance
router.get('/balance', requireRole(['owner', 'admin', 'member', 'viewer']), async (req, res) => {
  const companyId = req.headers['x-company-id'] as string;
  const balance = await BillingService.getBalance(companyId);
  res.json({ balance });
});

// 2. Mock Top-Up (Stripe simulation)
router.post('/top-up', requireRole(['owner', 'admin']), async (req, res) => {
  const { amount, paymentMethodId } = req.body;
  const companyId = req.headers['x-company-id'] as string;

  if (!amount || amount <= 0) {
    return res.status(400).json({ error: 'Invalid amount' });
  }

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
});

export default router;
