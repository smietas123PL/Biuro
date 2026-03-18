import { Router } from 'express';
import { db } from '../db/client.js';
import { z } from 'zod';

const router: Router = Router();

const createSchema = z.object({
  name: z.string().min(1),
  mission: z.string().optional(),
});

const policySchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  type: z.enum(['approval_required', 'budget_threshold', 'delegation_limit', 'rate_limit', 'tool_restriction']),
  rules: z.record(z.any()).optional(),
});

// Policies Root (4.4/4.5)
router.get('/policies', async (req, res, next) => {
  try {
    const { company_id } = req.query;
    let q = 'SELECT * FROM policies';
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

router.post('/policies', async (req, res, next) => {
  try {
    const parsed = policySchema.extend({ company_id: z.string().uuid() }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error });
    const { company_id, name, description, type, rules } = parsed.data;
    const result = await db.query(
      'INSERT INTO policies (company_id, name, description, type, rules) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [company_id, name, description, type, JSON.stringify(rules || {})]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) { next(err); }
});

// Create
router.post('/', async (req, res, next) => {
  try {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error });

    const { name, mission } = parsed.data;
    const result = await db.query(
      'INSERT INTO companies (name, mission) VALUES ($1, $2) RETURNING *',
      [name, mission]
    );
    const company = result.rows[0];
    
    // Audit log company creation
    await db.query(
      "INSERT INTO audit_log (company_id, action, entity_type, entity_id, details) VALUES ($1, 'company.created', 'company', $1, '{}')",
      [company.id]
    );

    res.status(201).json(company);
  } catch (err) { next(err); }
});

// List
router.get('/', async (req, res, next) => {
  try {
    const result = await db.query('SELECT * FROM companies ORDER BY created_at DESC');
    res.json(result.rows);
  } catch (err) { next(err); }
});

// Get
router.get('/:id', async (req, res, next) => {
  try {
    const result = await db.query('SELECT * FROM companies WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Company not found' });
    res.json(result.rows[0]);
  } catch (err) { next(err); }
});

// Stats
router.get('/:id/stats', async (req, res, next) => {
  try {
    const agents = await db.query("SELECT COUNT(*) FROM agents WHERE company_id = $1 AND status != 'terminated'", [req.params.id]);
    const tasks = await db.query('SELECT COUNT(*) FROM tasks WHERE company_id = $1', [req.params.id]);
    const goals = await db.query('SELECT COUNT(*) FROM goals WHERE company_id = $1', [req.params.id]);

    res.json({
      agent_count: parseInt(agents.rows[0].count),
      task_count: parseInt(tasks.rows[0].count),
      goal_count: parseInt(goals.rows[0].count),
    });
  } catch (err) { next(err); }
});

// Org Chart
router.get('/:id/org-chart', async (req, res, next) => {
  try {
    const result = await db.query(
      "SELECT id, name, role, title, reports_to, status FROM agents WHERE company_id = $1 AND status != 'terminated' ORDER BY created_at ASC",
      [req.params.id]
    );
    res.json(result.rows);
  } catch (err) { next(err); }
});

// Audit Log
router.get('/:id/audit-log', async (req, res, next) => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit as string) : 100;
    const result = await db.query(
      'SELECT * FROM audit_log WHERE company_id = $1 ORDER BY created_at DESC LIMIT $2',
      [req.params.id, limit]
    );
    res.json(result.rows);
  } catch (err) { next(err); }
});

// Create Policy
router.post('/:id/policies', async (req, res, next) => {
  try {
    const parsed = policySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error });
    const { name, description, type, rules } = parsed.data;
    const result = await db.query(
      'INSERT INTO policies (company_id, name, description, type, rules) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [req.params.id, name, description, type, JSON.stringify(rules || {})]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) { next(err); }
});

// List Policies
router.get('/:id/policies', async (req, res, next) => {
  try {
    const result = await db.query(
      'SELECT * FROM policies WHERE company_id = $1 ORDER BY created_at DESC',
      [req.params.id]
    );
    res.json(result.rows);
  } catch (err) { next(err); }
});

export default router;
