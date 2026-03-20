import { db } from '../db/client.js';
import { v4 as uuidv4 } from 'uuid';

export const BillingService = {
  async getBalance(companyId: string): Promise<number> {
    const res = await db.query(
      'SELECT balance FROM company_credits WHERE company_id = $1',
      [companyId]
    );
    return Number(res.rows[0]?.balance ?? 0);
  },

  async addCredits(
    companyId: string,
    amount: number,
    type: string,
    description: string,
    stripeId?: string
  ) {
    return db.transaction(async (client) => {
      // 1. Update or Insert balance
      await client.query(
        `INSERT INTO company_credits (company_id, balance) 
         VALUES ($1, $2)
         ON CONFLICT (company_id) DO UPDATE SET balance = company_credits.balance + $2, updated_at = now()`,
        [companyId, amount]
      );

      // 2. Record transaction
      await client.query(
        `INSERT INTO billing_transactions (company_id, amount, type, description, stripe_payment_id)
         VALUES ($1, $2, $3, $4, $5)`,
        [companyId, amount, type, description, stripeId]
      );
    });
  },

  async recordUsage(companyId: string, amount: number, description: string) {
    // Usage is negative amount
    return this.addCredits(companyId, -Math.abs(amount), 'usage', description);
  },
};
