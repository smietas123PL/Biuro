import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db/client.js';
import { requireRole } from '../middleware/auth.js';
import { executeStandaloneTool } from '../tools/executor.js';
import { seedDefaultTools } from '../tools/seed.js';
import type { AuthRequest } from '../utils/context.js';

const router: Router = Router({ mergeParams: true });

const toolTypeSchema = z.enum(['builtin', 'http', 'bash', 'mcp']);

const toolSchema = z.object({
  company_id: z.string().uuid(),
  name: z.string().min(1),
  description: z.string().optional(),
  type: toolTypeSchema.default('builtin'),
  config: z.record(z.any()).optional(),
});

const updateToolSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  type: toolTypeSchema.optional(),
  config: z.record(z.any()).optional(),
});

const toolCallsQuerySchema = z.object({
  status: z.enum(['success', 'error']).optional(),
  agent_id: z.string().min(1).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

const assignToolSchema = z.object({
  agent_id: z.string().min(1),
});

const testToolSchema = z.object({
  input: z.record(z.any()).optional(),
});

function getCompanyId(
  req: Pick<AuthRequest, 'user' | 'params' | 'query' | 'body'>
) {
  return (
    (typeof req.user?.companyId === 'string' && req.user.companyId) ||
    (typeof req.params.companyId === 'string' && req.params.companyId) ||
    (typeof req.query.company_id === 'string' && req.query.company_id) ||
    (typeof req.body?.company_id === 'string' && req.body.company_id) ||
    null
  );
}

function mapToolCallRow(row: Record<string, any>) {
  return {
    id: row.id,
    task_id: row.task_id ?? null,
    agent_id: row.agent_id ?? null,
    task_title: row.task_title ?? null,
    agent_name: row.agent_name ?? null,
    status: row.status as 'success' | 'error',
    duration_ms: row.duration_ms ?? null,
    created_at: row.created_at,
    input: row.input ?? null,
    output: row.output ?? null,
  };
}

async function getToolOr404(toolId: string, companyId: string) {
  const result = await db.query(
    `SELECT t.id, t.company_id, t.name, t.description, t.type, t.config, t.created_at
     FROM tools t
     WHERE t.id = $1 AND t.company_id = $2`,
    [toolId, companyId]
  );

  return result.rows[0] ?? null;
}

async function listAgentsForTool(toolIds: string[]) {
  if (toolIds.length === 0) {
    return new Map<string, Array<{ agent_id: string; agent_name: string }>>();
  }

  const result = await db.query(
    `SELECT at.tool_id, a.id AS agent_id, a.name AS agent_name
     FROM agent_tools at
     JOIN agents a ON a.id = at.agent_id
     WHERE at.tool_id = ANY($1::uuid[])
     ORDER BY a.name ASC`,
    [toolIds]
  );

  const assignments = new Map<
    string,
    Array<{ agent_id: string; agent_name: string }>
  >();
  for (const row of result.rows) {
    const items = assignments.get(row.tool_id as string) ?? [];
    items.push({
      agent_id: row.agent_id as string,
      agent_name: row.agent_name as string,
    });
    assignments.set(row.tool_id as string, items);
  }

  return assignments;
}

// Create tool
router.post(
  '/',
  requireRole(['owner', 'admin']),
  async (req: AuthRequest, res, next) => {
  try {
    const companyId = getCompanyId(req);
    if (!companyId)
      return res.status(400).json({ error: 'Missing company_id' });

    const parsed = toolSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error });
    if (parsed.data.company_id !== companyId) {
      return res.status(400).json({
        error: 'Tool company_id must match the authenticated company context',
      });
    }

    const { name, description, type, config } = parsed.data;
    const result = await db.query(
      `INSERT INTO tools (company_id, name, description, type, config)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [
        companyId,
        name,
        description ?? null,
        type,
        JSON.stringify(config || {}),
      ]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    next(err);
  }
  }
);

router.post(
  '/seed',
  requireRole(['owner', 'admin']),
  async (req, res, next) => {
    try {
      const companyId = getCompanyId(req);
      if (!companyId)
        return res.status(400).json({ error: 'Missing company_id' });

      const summary = await db.transaction((client) =>
        seedDefaultTools(client, companyId)
      );
      res.status(201).json(summary);
    } catch (err) {
      next(err);
    }
  }
);

// List tools for company
router.get(
  '/',
  requireRole(['owner', 'admin', 'member', 'viewer']),
  async (req, res, next) => {
    try {
      const companyId = getCompanyId(req);
      if (!companyId)
        return res.status(400).json({ error: 'Missing company_id' });

      const result = await db.query(
        `SELECT t.*, COUNT(at.agent_id)::int AS agent_count
       FROM tools t
       LEFT JOIN agent_tools at ON at.tool_id = t.id
       WHERE t.company_id = $1
       GROUP BY t.id
       ORDER BY t.created_at ASC`,
        [companyId]
      );

      const toolIds = result.rows.map((row) => row.id as string);
      if (toolIds.length === 0) {
        return res.json([]);
      }

      const [callResult, assignmentMap] = await Promise.all([
        db.query(
          `SELECT
           tc.id,
           tc.tool_id,
           tc.task_id,
           tc.agent_id,
           tc.input,
           tc.output,
           tc.status,
           tc.duration_ms,
           tc.created_at,
           tsk.title AS task_title,
           a.name AS agent_name
         FROM tool_calls tc
         JOIN tools t ON t.id = tc.tool_id
         LEFT JOIN tasks tsk ON tsk.id = tc.task_id
         LEFT JOIN agents a ON a.id = tc.agent_id
         WHERE t.company_id = $1
         ORDER BY tc.created_at DESC`,
          [companyId]
        ),
        listAgentsForTool(toolIds),
      ]);

      const callsByToolId = new Map<
        string,
        Array<ReturnType<typeof mapToolCallRow>>
      >();

      for (const row of callResult.rows) {
        const toolId = row.tool_id as string;
        const entries = callsByToolId.get(toolId) ?? [];
        entries.push(mapToolCallRow(row));
        callsByToolId.set(toolId, entries);
      }

      const payload = result.rows.map((tool) => {
        const toolCalls = callsByToolId.get(tool.id as string) ?? [];
        const successCount = toolCalls.filter(
          (entry) => entry.status === 'success'
        ).length;
        const errorCount = toolCalls.filter(
          (entry) => entry.status === 'error'
        ).length;
        const lastCall = toolCalls[0] ?? null;

        return {
          ...tool,
          assigned_agents: assignmentMap.get(tool.id as string) ?? [],
          usage: {
            total_calls: toolCalls.length,
            success_count: successCount,
            error_count: errorCount,
            last_called_at: lastCall?.created_at ?? null,
            last_status: lastCall?.status ?? null,
          },
          recent_calls: toolCalls.slice(0, 5),
        };
      });

      res.json(payload);
    } catch (err) {
      next(err);
    }
  }
);

router.patch(
  '/:toolId',
  requireRole(['owner', 'admin']),
  async (req, res, next) => {
    try {
      const companyId = getCompanyId(req);
      if (!companyId)
        return res.status(400).json({ error: 'Missing company_id' });

      const parsed = updateToolSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: parsed.error });

      const toolId =
        typeof req.params.toolId === 'string' ? req.params.toolId : '';
      const current = await getToolOr404(toolId, companyId);
      if (!current) return res.status(404).json({ error: 'Tool not found' });

      const nextValues = parsed.data;
      const result = await db.query(
        `UPDATE tools
       SET name = $3,
           description = $4,
           type = $5,
           config = $6
       WHERE id = $1 AND company_id = $2
       RETURNING *`,
        [
          toolId,
          companyId,
          nextValues.name ?? current.name,
          nextValues.description === undefined
            ? (current.description ?? null)
            : nextValues.description,
          nextValues.type ?? current.type,
          JSON.stringify(nextValues.config ?? current.config ?? {}),
        ]
      );

      res.json(result.rows[0]);
    } catch (err) {
      next(err);
    }
  }
);

router.delete(
  '/:toolId',
  requireRole(['owner', 'admin']),
  async (req, res, next) => {
    try {
      const companyId = getCompanyId(req);
      if (!companyId)
        return res.status(400).json({ error: 'Missing company_id' });

      const toolId =
        typeof req.params.toolId === 'string' ? req.params.toolId : '';
      const current = await getToolOr404(toolId, companyId);
      if (!current) return res.status(404).json({ error: 'Tool not found' });

      await db.transaction(async (client) => {
        await client.query('DELETE FROM agent_tools WHERE tool_id = $1', [
          toolId,
        ]);
        await client.query('DELETE FROM tool_calls WHERE tool_id = $1', [
          toolId,
        ]);
        await client.query(
          'DELETE FROM tools WHERE id = $1 AND company_id = $2',
          [toolId, companyId]
        );
      });

      res.json({ ok: true, deleted_tool_id: toolId });
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/:toolId/test',
  requireRole(['owner', 'admin']),
  async (req, res, next) => {
    try {
      const companyId = getCompanyId(req);
      if (!companyId)
        return res.status(400).json({ error: 'Missing company_id' });

      const parsed = testToolSchema.safeParse(req.body ?? {});
      if (!parsed.success) return res.status(400).json({ error: parsed.error });

      const toolId =
        typeof req.params.toolId === 'string' ? req.params.toolId : '';
      const tool = await getToolOr404(toolId, companyId);
      if (!tool) return res.status(404).json({ error: 'Tool not found' });

      const startedAt = Date.now();

      try {
        const output = await executeStandaloneTool(
          tool,
          parsed.data.input ?? {}
        );
        res.json({
          ok: true,
          tool_id: toolId,
          duration_ms: Date.now() - startedAt,
          output,
        });
      } catch (err: any) {
        res.status(502).json({
          ok: false,
          tool_id: toolId,
          duration_ms: Date.now() - startedAt,
          error: err.message || 'Tool test failed',
          output: err.output ?? null,
          status: err.status ?? null,
        });
      }
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/:toolId/assign',
  requireRole(['owner', 'admin']),
  async (req, res, next) => {
    try {
      const companyId = getCompanyId(req);
      if (!companyId)
        return res.status(400).json({ error: 'Missing company_id' });

      const parsed = assignToolSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: parsed.error });

      const toolId =
        typeof req.params.toolId === 'string' ? req.params.toolId : '';
      const tool = await getToolOr404(toolId, companyId);
      if (!tool) return res.status(404).json({ error: 'Tool not found' });

      const agentResult = await db.query(
        'SELECT id, name FROM agents WHERE id = $1 AND company_id = $2',
        [parsed.data.agent_id, companyId]
      );
      if (agentResult.rows.length === 0)
        return res.status(404).json({ error: 'Agent not found' });

      await db.query(
        `INSERT INTO agent_tools (agent_id, tool_id, can_execute, config)
       VALUES ($1, $2, true, '{}'::jsonb)
       ON CONFLICT (agent_id, tool_id) DO NOTHING`,
        [parsed.data.agent_id, toolId]
      );

      res.status(201).json({
        ok: true,
        tool_id: toolId,
        agent: agentResult.rows[0],
      });
    } catch (err) {
      next(err);
    }
  }
);

router.delete(
  '/:toolId/assign/:agentId',
  requireRole(['owner', 'admin']),
  async (req, res, next) => {
    try {
      const companyId = getCompanyId(req);
      if (!companyId)
        return res.status(400).json({ error: 'Missing company_id' });

      const toolId =
        typeof req.params.toolId === 'string' ? req.params.toolId : '';
      const agentId =
        typeof req.params.agentId === 'string' ? req.params.agentId : '';

      const tool = await getToolOr404(toolId, companyId);
      if (!tool) return res.status(404).json({ error: 'Tool not found' });

      const agentResult = await db.query(
        'SELECT id FROM agents WHERE id = $1 AND company_id = $2',
        [agentId, companyId]
      );
      if (agentResult.rows.length === 0)
        return res.status(404).json({ error: 'Agent not found' });

      await db.query(
        'DELETE FROM agent_tools WHERE tool_id = $1 AND agent_id = $2',
        [toolId, agentId]
      );
      res.json({ ok: true, tool_id: toolId, agent_id: agentId });
    } catch (err) {
      next(err);
    }
  }
);

router.get(
  '/:toolId/calls',
  requireRole(['owner', 'admin', 'member', 'viewer']),
  async (req, res, next) => {
    try {
      const companyId = getCompanyId(req);
      if (!companyId)
        return res.status(400).json({ error: 'Missing company_id' });

      const parsedQuery = toolCallsQuerySchema.safeParse(req.query);
      if (!parsedQuery.success) {
        return res.status(400).json({ error: parsedQuery.error });
      }

      const toolId =
        typeof req.params.toolId === 'string' ? req.params.toolId : '';
      if (!toolId) {
        return res.status(400).json({ error: 'Missing tool_id' });
      }

      const toolResult = await db.query(
        `SELECT id, company_id, name, description, type, created_at
       FROM tools
       WHERE id = $1 AND company_id = $2`,
        [toolId, companyId]
      );

      if (toolResult.rows.length === 0) {
        return res.status(404).json({ error: 'Tool not found' });
      }

      const { status, agent_id, page, limit } = parsedQuery.data;
      const filters: string[] = ['tc.tool_id = $1'];
      const params: any[] = [toolId];

      if (status) {
        params.push(status);
        filters.push(`tc.status = $${params.length}`);
      }

      if (agent_id) {
        params.push(agent_id);
        filters.push(`tc.agent_id = $${params.length}`);
      }

      const whereClause = filters.join(' AND ');

      const countResult = await db.query(
        `SELECT
         COUNT(*)::int AS total,
         COUNT(*) FILTER (WHERE tc.status = 'success')::int AS success_count,
         COUNT(*) FILTER (WHERE tc.status = 'error')::int AS error_count,
         MAX(tc.created_at) AS last_called_at
       FROM tool_calls tc
       WHERE ${whereClause}`,
        params
      );

      const offset = (page - 1) * limit;
      const listParams = [...params, limit, offset];
      const callResult = await db.query(
        `SELECT
         tc.id,
         tc.task_id,
         tc.agent_id,
         tc.input,
         tc.output,
         tc.status,
         tc.duration_ms,
         tc.created_at,
         t.title AS task_title,
         a.name AS agent_name
       FROM tool_calls tc
       LEFT JOIN tasks t ON t.id = tc.task_id
       LEFT JOIN agents a ON a.id = tc.agent_id
       WHERE ${whereClause}
       ORDER BY tc.created_at DESC
       LIMIT $${listParams.length - 1} OFFSET $${listParams.length}`,
        listParams
      );

      const summaryRow = countResult.rows[0] ?? {
        total: 0,
        success_count: 0,
        error_count: 0,
        last_called_at: null,
      };
      const total = Number(summaryRow.total ?? 0);

      res.json({
        tool: toolResult.rows[0],
        filters: {
          status: status ?? null,
          agent_id: agent_id ?? null,
        },
        pagination: {
          page,
          limit,
          total,
          total_pages: total === 0 ? 0 : Math.ceil(total / limit),
          has_more: offset + callResult.rows.length < total,
        },
        summary: {
          total_calls: total,
          success_count: Number(summaryRow.success_count ?? 0),
          error_count: Number(summaryRow.error_count ?? 0),
          last_called_at: summaryRow.last_called_at ?? null,
        },
        items: callResult.rows.map((row) => mapToolCallRow(row)),
      });
    } catch (err) {
      next(err);
    }
  }
);

export default router;
