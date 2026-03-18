import { Router } from 'express';
import { db } from '../db/client.js';

const router: Router = Router();

router.get('/', async (req, res, next) => {
  try {
    const { company_id } = req.query;
    const limit = req.query.limit ? parseInt(req.query.limit as string) : 100;
    if (!company_id) {
      const result = await db.query('SELECT * FROM audit_log ORDER BY created_at DESC LIMIT $1', [limit]);
      return res.json(result.rows);
    }
    const result = await db.query(
      'SELECT * FROM audit_log WHERE company_id = $1 ORDER BY created_at DESC LIMIT $2',
      [company_id, limit]
    );
    res.json(result.rows);
  } catch (err) { next(err); }
});

export default router;
