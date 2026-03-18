import { Router } from 'express';
import { db } from '../db/client.js';
import { z } from 'zod';
import { requireRole } from '../middleware/auth.js';

const router: Router = Router({ mergeParams: true });

const toolSchema = z.object({
  company_id: z.string().uuid(),
  name: z.string().min(1),
  description: z.string().optional(),
  type: z.enum(['builtin', 'http', 'bash', 'mcp']).default('builtin'),
  config: z.record(z.any()).optional(),
});

// Create tool
router.post('/', requireRole(['owner', 'admin']), async (req, res, next) => {
  try {
    const parsed = toolSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error });
    const { company_id, name, description, type, config } = parsed.data;
    const result = await db.query(
      'INSERT INTO tools (company_id, name, description, type, config) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [company_id, name, description, type, JSON.stringify(config || {})]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) { next(err); }
});

// List tools for company
router.get('/', requireRole(['owner', 'admin', 'member', 'viewer']), async (req, res, next) => {
  try {
    const companyId =
      (typeof req.params.companyId === 'string' && req.params.companyId) ||
      (typeof req.query.company_id === 'string' && req.query.company_id);
    if (!companyId) return res.status(400).json({ error: 'Missing company_id' });
    const result = await db.query(
      `SELECT t.*, COUNT(at.agent_id)::int as agent_count
       FROM tools t
       LEFT JOIN agent_tools at ON at.tool_id = t.id
       WHERE t.company_id = $1
       GROUP BY t.id
       ORDER BY t.created_at ASC`,
      [companyId]
    );
    res.json(result.rows);
  } catch (err) { next(err); }
});

export default router;
