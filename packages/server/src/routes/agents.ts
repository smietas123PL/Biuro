import { Router } from 'express';
import { db } from '../db/client.js';
import { z } from 'zod';
import { requireRole } from '../middleware/auth.js';
import { defaultModelsByRuntime } from '../runtime/defaultModels.js';

const router: Router = Router();

const hireSchema = z.object({
  company_id: z.string().uuid(),
  name: z.string().min(1),
  role: z.string().min(1),
  title: z.string().optional(),
  runtime: z.enum(['claude', 'openai', 'gemini']).default('claude'),
  model: z.string().min(1).optional(),
  system_prompt: z.string().optional(),
  config: z.record(z.any()).optional(),
  reports_to: z.string().uuid().optional(),
  monthly_budget_usd: z.number().optional(),
});

// Hire
router.post('/', requireRole(['owner', 'admin', 'member']), async (req, res, next) => {
  try {
    const parsed = hireSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error });

    const { company_id, name, role, title, runtime, model, system_prompt, config, reports_to, monthly_budget_usd } = parsed.data;
    const monthlyBudgetUsd = monthly_budget_usd ?? 0;
    const agent = await db.transaction(async (client) => {
      const result = await client.query(
        `INSERT INTO agents (company_id, name, role, title, runtime, model, system_prompt, config, reports_to, monthly_budget_usd) 
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
        [company_id, name, role, title, runtime, model ?? defaultModelsByRuntime[runtime], system_prompt, JSON.stringify(config || {}), reports_to || null, monthlyBudgetUsd]
      );
      const createdAgent = result.rows[0];

      await client.query(
        `INSERT INTO budgets (agent_id, month, limit_usd, spent_usd)
         VALUES ($1, date_trunc('month', now())::date, $2, 0)
         ON CONFLICT (agent_id, month) DO UPDATE
         SET limit_usd = EXCLUDED.limit_usd`,
        [createdAgent.id, monthlyBudgetUsd]
      );

      await client.query(
        "INSERT INTO audit_log (company_id, agent_id, action, entity_type, entity_id) VALUES ($1, $2, 'agent.hired', 'agent', $2)",
        [company_id, createdAgent.id]
      );

      return createdAgent;
    });

    res.status(201).json(agent);
  } catch (err) {
    next(err);
  }
});

// List
router.get('/', requireRole(['owner', 'admin', 'member', 'viewer']), async (req, res, next) => {
  try {
    const { company_id } = req.query;
    if (!company_id || typeof company_id !== 'string') return res.status(400).json({ error: 'Missing company_id' });
    const result = await db.query(
      'SELECT * FROM agents WHERE company_id = $1 ORDER BY created_at ASC',
      [company_id]
    );
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
});

// Get Detail
router.get('/:id', requireRole(['owner', 'admin', 'member', 'viewer']), async (req, res, next) => {
  try {
    if (!req.params.id || req.params.id === 'undefined') return res.status(400).json({ error: 'Invalid ID' });
    const result = await db.query('SELECT * FROM agents WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Agent not found' });
    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

// Org Chart (flat list for now)
router.get('/org-chart/:companyId', requireRole(['owner', 'admin', 'member', 'viewer']), async (req, res, next) => {
  try {
    if (!req.params.companyId || req.params.companyId === 'undefined') return res.status(400).json({ error: 'Invalid ID' });
    const result = await db.query(
      'SELECT id, name, role, title, reports_to FROM agents WHERE company_id = $1',
      [req.params.companyId]
    );
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
});

// Status Actions
router.post('/:id/pause', requireRole(['owner', 'admin']), async (req, res, next) => {
  try {
    if (!req.params.id || req.params.id === 'undefined') return res.status(400).json({ error: 'Invalid ID' });
    await db.query("UPDATE agents SET status = 'paused' WHERE id = $1", [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/resume', requireRole(['owner', 'admin']), async (req, res, next) => {
  try {
    if (!req.params.id || req.params.id === 'undefined') return res.status(400).json({ error: 'Invalid ID' });
    await db.query("UPDATE agents SET status = 'idle' WHERE id = $1", [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/terminate', requireRole(['owner', 'admin']), async (req, res, next) => {
  try {
    if (!req.params.id || req.params.id === 'undefined') return res.status(400).json({ error: 'Invalid ID' });
    await db.query("UPDATE agents SET status = 'terminated' WHERE id = $1", [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.get('/:id/heartbeats', requireRole(['owner', 'admin', 'member', 'viewer']), async (req, res, next) => {
  try {
    if (!req.params.id || req.params.id === 'undefined') return res.status(400).json({ error: 'Invalid ID' });
    const result = await db.query(
      `SELECT status, created_at AS timestamp, duration_ms, cost_usd, details
       FROM heartbeats
       WHERE agent_id = $1
       ORDER BY created_at DESC
       LIMIT 10`,
      [req.params.id]
    );
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
});

router.get('/:id/budgets', requireRole(['owner', 'admin', 'member', 'viewer']), async (req, res, next) => {
    try {
      if (!req.params.id || req.params.id === 'undefined') return res.status(400).json({ error: 'Invalid ID' });
      const agentCheck = await db.query('SELECT id FROM agents WHERE id = $1', [req.params.id]);
      if (agentCheck.rows.length === 0) return res.status(404).json({ error: 'Agent not found' });

      const result = await db.query(
        `SELECT agent_id, month, limit_usd, spent_usd, created_at
         FROM budgets
         WHERE agent_id = $1
         ORDER BY month DESC, created_at DESC`,
        [req.params.id]
      );
      res.json(result.rows);
    } catch (err) {
      next(err);
    }
});

router.post('/:id/tools/:toolId', requireRole(['owner', 'admin']), async (req, res, next) => {
    try {
        const { id, toolId } = req.params;
        if (!id || id === 'undefined' || !toolId || toolId === 'undefined') return res.status(400).json({ error: 'Invalid ID' });
        
        // Verify tool exists
        const toolCheck = await db.query('SELECT id FROM tools WHERE id = $1', [toolId]);
        if (toolCheck.rows.length === 0) return res.status(404).json({ error: 'Tool not found' });

        // Verify agent exists
        const agentCheck = await db.query('SELECT id FROM agents WHERE id = $1', [id]);
        if (agentCheck.rows.length === 0) return res.status(404).json({ error: 'Agent not found' });

        // Assign tool
        await db.query(
            'INSERT INTO agent_tools (agent_id, tool_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
            [id, toolId]
        );

        res.status(201).json({ id: toolId, agent_id: id });
    } catch (err) {
        next(err);
    }
});

export default router;
