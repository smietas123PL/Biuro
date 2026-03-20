import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db/client.js';

const router: Router = Router();

const auditQuerySchema = z.object({
  company_id: z.string().uuid(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

router.get('/', async (req, res, next) => {
  try {
    const parsed = auditQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error });
    }

    const result = await db.query(
      'SELECT * FROM audit_log WHERE company_id = $1 ORDER BY created_at DESC LIMIT $2',
      [parsed.data.company_id, parsed.data.limit]
    );
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
});

export default router;
