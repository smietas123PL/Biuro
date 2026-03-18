import { Router } from 'express';
import { db } from '../db/client.js';
import { z } from 'zod';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { AuthRequest } from '../utils/context.js';

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
router.get('/policies', requireRole(['owner', 'admin', 'member', 'viewer']), async (req, res, next) => {
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

router.post('/policies', requireRole(['owner', 'admin']), async (req, res, next) => {
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
router.post('/', requireAuth(), async (req: AuthRequest, res, next) => {
  try {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error });

    const { name, mission } = parsed.data;
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const company = await db.transaction(async (client) => {
      const result = await client.query(
        'INSERT INTO companies (name, mission) VALUES ($1, $2) RETURNING *',
        [name, mission]
      );
      const createdCompany = result.rows[0];

      await client.query(
        "INSERT INTO audit_log (company_id, action, entity_type, entity_id, details) VALUES ($1, 'company.created', 'company', $1, '{}')",
        [createdCompany.id]
      );

      await client.query(
        "INSERT INTO user_roles (user_id, company_id, role) VALUES ($1, $2, 'owner') ON CONFLICT (user_id, company_id) DO NOTHING",
        [userId, createdCompany.id]
      );

      return createdCompany;
    });

    res.status(201).json(company);
  } catch (err) { next(err); }
});

// List
router.get('/', requireAuth(), async (req: AuthRequest, res, next) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const result = await db.query(
      `SELECT c.*, ur.role
       FROM companies c
       JOIN user_roles ur ON ur.company_id = c.id
       WHERE ur.user_id = $1
       ORDER BY c.created_at DESC`,
      [userId]
    );
    res.json(result.rows);
  } catch (err) { next(err); }
});

// Get
router.get('/:id', requireRole(['owner', 'admin', 'member', 'viewer']), async (req, res, next) => {
  try {
    const result = await db.query('SELECT * FROM companies WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Company not found' });
    res.json(result.rows[0]);
  } catch (err) { next(err); }
});

// Stats
router.get('/:id/stats', requireRole(['owner', 'admin', 'member', 'viewer']), async (req, res, next) => {
  try {
    const companyId = req.params.id;
    const [agents, tasks, goals, pendingApprovals, dailyCost] = await Promise.all([
      db.query(
        `SELECT
           COUNT(*)::int AS total,
           COUNT(*) FILTER (WHERE status = 'working')::int AS working,
           COUNT(*) FILTER (WHERE status = 'idle')::int AS idle,
           COUNT(*) FILTER (WHERE status = 'paused')::int AS paused
         FROM agents
         WHERE company_id = $1 AND status != 'terminated'`,
        [companyId]
      ),
      db.query(
        `SELECT
           COUNT(*)::int AS total,
           COUNT(*) FILTER (WHERE status IN ('backlog', 'assigned', 'in_progress', 'review'))::int AS pending,
           COUNT(*) FILTER (WHERE status = 'done')::int AS completed,
           COUNT(*) FILTER (WHERE status = 'blocked')::int AS blocked
         FROM tasks
         WHERE company_id = $1`,
        [companyId]
      ),
      db.query('SELECT COUNT(*)::int AS total FROM goals WHERE company_id = $1', [companyId]),
      db.query("SELECT COUNT(*)::int AS total FROM approvals WHERE company_id = $1 AND status = 'pending'", [companyId]),
      db.query(
        `SELECT COALESCE(SUM(cost_usd), 0)::float AS total
         FROM audit_log
         WHERE company_id = $1 AND created_at >= date_trunc('day', now())`,
        [companyId]
      ),
    ]);

    const agentStats = agents.rows[0];
    const taskStats = tasks.rows[0];

    res.json({
      agent_count: agentStats.total,
      active_agents: agentStats.working,
      idle_agents: agentStats.idle,
      paused_agents: agentStats.paused,
      task_count: taskStats.total,
      pending_tasks: taskStats.pending,
      completed_tasks: taskStats.completed,
      blocked_tasks: taskStats.blocked,
      goal_count: goals.rows[0].total,
      pending_approvals: pendingApprovals.rows[0].total,
      daily_cost_usd: dailyCost.rows[0].total,
    });
  } catch (err) { next(err); }
});

// Org Chart
router.get('/:id/org-chart', requireRole(['owner', 'admin', 'member', 'viewer']), async (req, res, next) => {
  try {
    const result = await db.query(
      "SELECT id, name, role, title, reports_to, status FROM agents WHERE company_id = $1 AND status != 'terminated' ORDER BY created_at ASC",
      [req.params.id]
    );
    res.json(result.rows);
  } catch (err) { next(err); }
});

// Audit Log
router.get('/:id/audit-log', requireRole(['owner', 'admin']), async (req, res, next) => {
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
router.post('/:id/policies', requireRole(['owner', 'admin']), async (req, res, next) => {
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
router.get('/:id/policies', requireRole(['owner', 'admin', 'member', 'viewer']), async (req, res, next) => {
  try {
    const result = await db.query(
      'SELECT * FROM policies WHERE company_id = $1 ORDER BY created_at DESC',
      [req.params.id]
    );
    res.json(result.rows);
  } catch (err) { next(err); }
});

export default router;
