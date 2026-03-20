import { Router } from 'express';
import { z } from 'zod';
import type {
  GoalDecompositionApplyResponse,
  GoalDecompositionSuggestResponse,
  GoalDecompositionSuggestion,
} from '@biuro/shared';
import { db } from '../db/client.js';
import { requireRole } from '../middleware/auth.js';
import type { AuthRequest } from '../utils/context.js';
import { extractCompanyRuntimeSettings } from '../runtime/preferences.js';
import { runtimeRegistry } from '../runtime/registry.js';

const router: Router = Router({ mergeParams: true });

const createGoalSchema = z.object({
  company_id: z.string().uuid(),
  parent_id: z.string().uuid().optional(),
  title: z.string().min(1),
  description: z.string().optional(),
});

const aiDecomposeSchema = z.object({
  prompt: z.string().min(8).max(3_000),
});

const draftGoalSchema = z.object({
  ref: z.string().min(2).max(64),
  parent_ref: z.string().min(2).max(64).nullable().optional(),
  title: z.string().min(3).max(160),
  description: z.string().min(1).max(3_000),
  status: z.enum(['active', 'achieved', 'abandoned']).default('active'),
});

const draftTaskSchema = z.object({
  ref: z.string().min(2).max(64),
  goal_ref: z.string().min(2).max(64),
  title: z.string().min(3).max(160),
  description: z.string().min(1).max(3_000),
  priority: z.number().int().min(0).max(100).default(50),
  suggested_agent_id: z.string().uuid().nullable().default(null),
  suggested_agent_name: z.string().min(1).max(120).nullable().default(null),
});

const aiDecompositionSuggestionSchema = z.object({
  title: z.string().min(3).max(160),
  description: z.string().min(1).max(3_000),
  goals: z.array(draftGoalSchema).min(1).max(8),
  starter_tasks: z.array(draftTaskSchema).max(12).default([]),
  confidence: z.enum(['high', 'medium', 'low']).default('medium'),
  warnings: z.array(z.string().min(1).max(240)).max(6).default([]),
});

const applyDecompositionSchema = z.object({
  suggestion: aiDecompositionSuggestionSchema,
});

type GoalDraft = z.infer<typeof draftGoalSchema>;
type TaskDraft = z.infer<typeof draftTaskSchema>;
type GoalSuggestAgent = {
  id: string;
  name: string;
  role: string;
  title: string | null;
  status: string;
};

function getCompanyId(req: AuthRequest) {
  return (
    req.user?.companyId ||
    (typeof req.params.companyId === 'string' && req.params.companyId) ||
    req.header('x-company-id') ||
    (typeof req.body?.company_id === 'string' ? req.body.company_id : null)
  );
}

function normalizeText(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s/-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildGoalTitle(prompt: string) {
  const cleaned = prompt.trim().replace(/\s+/g, ' ');
  if (!cleaned) {
    return 'Drive the next milestone';
  }

  const words = cleaned.split(' ').slice(0, 9);
  const sentence = words.join(' ');
  return sentence.charAt(0).toUpperCase() + sentence.slice(1);
}

function inferGoalTheme(prompt: string) {
  const normalized = normalizeText(prompt);
  if (/(launch|ship|release|wdro|premier)/.test(normalized)) {
    return {
      rootDescription:
        'Coordinate the launch path, remove blockers, and keep the release path visible.',
      subgoals: [
        [
          'goal-scope',
          'Lock launch scope',
          'Define what must ship now versus what can wait for the next release.',
        ],
        [
          'goal-execution',
          'Deliver the critical path',
          'Move the highest-risk launch workstream from planning into execution.',
        ],
        [
          'goal-readiness',
          'Confirm launch readiness',
          'Review quality, messaging, and ownership before go-live.',
        ],
      ] as const,
    };
  }

  if (/(sales|pipeline|partner|revenue|deal)/.test(normalized)) {
    return {
      rootDescription:
        'Turn the broad commercial goal into a short set of visible, owned workstreams.',
      subgoals: [
        [
          'goal-focus',
          'Define the target segment',
          'Clarify which accounts, partners, or opportunities matter most first.',
        ],
        [
          'goal-motion',
          'Run the core outreach motion',
          'Create a repeatable sequence for outreach, follow-up, and qualification.',
        ],
        [
          'goal-review',
          'Inspect pipeline quality weekly',
          'Review results, blockers, and conversion signals on a steady cadence.',
        ],
      ] as const,
    };
  }

  if (/(pricing|compet|research|audit|analysis|analiz)/.test(normalized)) {
    return {
      rootDescription:
        'Break the research goal into a sequence that gathers signal, synthesizes insight, and drives action.',
      subgoals: [
        [
          'goal-signal',
          'Collect the strongest signals',
          'Gather the most relevant evidence, examples, or market inputs first.',
        ],
        [
          'goal-synthesis',
          'Synthesize the main insight',
          'Turn raw findings into a compact explanation of what changed and why it matters.',
        ],
        [
          'goal-action',
          'Decide the next move',
          'Translate the analysis into a recommendation, decision, or follow-up experiment.',
        ],
      ] as const,
    };
  }

  return {
    rootDescription:
      'Turn the broad objective into a small hierarchy with clear sequencing and visible ownership.',
    subgoals: [
      [
        'goal-clarify',
        'Clarify the outcome',
        'Define the success condition, scope, and constraints for this objective.',
      ],
      [
        'goal-execute',
        'Execute the first milestone',
        'Focus the team on the highest-leverage first slice of work.',
      ],
      [
        'goal-review',
        'Review and adapt',
        'Inspect progress, capture learnings, and decide the next branch of execution.',
      ],
    ] as const,
  };
}

function scoreAgent(input: string, agent: GoalSuggestAgent) {
  const query = normalizeText(input);
  const candidate = normalizeText(
    `${agent.name} ${agent.role} ${agent.title ?? ''}`
  );
  if (!query || !candidate) {
    return 0;
  }

  let score = 0;
  for (const token of query.split(' ')) {
    if (token.length < 3) {
      continue;
    }
    if (candidate.includes(token)) {
      score += token.length;
    }
  }

  return score;
}

function pickSuggestedAgent(input: string, agents: GoalSuggestAgent[]) {
  const matched = agents
    .map((agent) => ({ agent, score: scoreAgent(input, agent) }))
    .sort((left, right) => right.score - left.score)[0];

  return matched && matched.score > 0 ? matched.agent : null;
}

function buildHeuristicDecomposition(
  prompt: string,
  agents: GoalSuggestAgent[]
): GoalDecompositionSuggestion {
  const title = buildGoalTitle(prompt);
  const themed = inferGoalTheme(prompt);
  const goals: GoalDecompositionSuggestion['goals'] = [
    {
      ref: 'goal-root',
      parent_ref: null,
      title,
      description: `${prompt.trim()}\n\n${themed.rootDescription}`,
      status: 'active',
    },
    ...themed.subgoals.map(([ref, goalTitle, description]) => ({
      ref,
      parent_ref: 'goal-root',
      title: goalTitle,
      description,
      status: 'active' as const,
    })),
  ];

  return {
    title,
    description: `${prompt.trim()}\n\n${themed.rootDescription}`,
    goals,
    starter_tasks: goals
      .filter((goal) => goal.parent_ref === 'goal-root')
      .map((goal, index) => {
        const titleValue = `Starter: ${goal.title}`;
        const description = `Create the first visible execution step for "${goal.title}". ${goal.description}`;
        const selectedAgent = pickSuggestedAgent(
          `${prompt} ${goal.title} ${description}`,
          agents
        );
        return {
          ref: `task-${index + 1}`,
          goal_ref: goal.ref,
          title: titleValue,
          description,
          priority: index === 0 ? 75 : 60,
          suggested_agent_id: selectedAgent?.id ?? null,
          suggested_agent_name: selectedAgent?.name ?? null,
        };
      }),
    confidence: 'low',
    warnings: ['AI decomposition used a deterministic fallback plan.'],
  };
}

function extractJsonObject(raw: string) {
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }

  const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]+?)```/i);
  const candidate = fencedMatch?.[1]?.trim() || trimmed;
  const firstBrace = candidate.indexOf('{');
  const lastBrace = candidate.lastIndexOf('}');
  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    return null;
  }

  return candidate.slice(firstBrace, lastBrace + 1);
}

function validateDraftGoals(goals: GoalDraft[]) {
  const refs = new Set<string>();
  for (const goal of goals) {
    if (refs.has(goal.ref)) {
      throw new Error(`Duplicate goal ref: ${goal.ref}`);
    }
    refs.add(goal.ref);
  }

  const rootGoals = goals.filter((goal) => !goal.parent_ref);
  if (rootGoals.length !== 1) {
    throw new Error('Goal decomposition must include exactly one root goal.');
  }

  for (const goal of goals) {
    if (goal.parent_ref && !refs.has(goal.parent_ref)) {
      throw new Error(`Unknown parent ref: ${goal.parent_ref}`);
    }
  }
}

function validateDraftTasks(
  goals: GoalDraft[],
  tasks: TaskDraft[],
  validAgentIds?: Set<string>
) {
  const goalRefs = new Set(goals.map((goal) => goal.ref));
  const taskRefs = new Set<string>();

  for (const task of tasks) {
    if (taskRefs.has(task.ref)) {
      throw new Error(`Duplicate task ref: ${task.ref}`);
    }
    taskRefs.add(task.ref);

    if (!goalRefs.has(task.goal_ref)) {
      throw new Error(`Unknown task goal ref: ${task.goal_ref}`);
    }

    if (
      task.suggested_agent_id &&
      validAgentIds &&
      !validAgentIds.has(task.suggested_agent_id)
    ) {
      throw new Error(`Unknown suggested agent id: ${task.suggested_agent_id}`);
    }
  }
}

async function generateGoalDecomposition(
  company: { name: string; mission: string | null; config?: unknown },
  prompt: string,
  agents: GoalSuggestAgent[]
): Promise<GoalDecompositionSuggestResponse> {
  const runtimeSettings = extractCompanyRuntimeSettings(company.config);

  try {
    const runtime = runtimeRegistry.getRuntime(runtimeSettings.primaryRuntime, {
      fallbackOrder: runtimeSettings.fallbackOrder,
    });

    const response = await runtime.execute({
      company_name: company.name,
      company_mission: company.mission ?? 'No mission provided.',
      agent_name: 'Goal Strategist',
      agent_role: 'AI goal decomposition assistant',
      current_task: {
        title: 'Decompose a broad goal into a compact hierarchy',
        description:
          'Return one valid JSON object that breaks a broad goal into a root objective plus subgoals.',
      },
      goal_hierarchy: [],
      additional_context: [
        'Return ONLY a valid JSON object in the `thought` field with this exact shape:',
        '{"title":"string","description":"string","goals":[{"ref":"goal-root","parent_ref":null,"title":"string","description":"string","status":"active"}],"starter_tasks":[{"ref":"task-1","goal_ref":"goal-child","title":"string","description":"string","priority":50}],"confidence":"high|medium|low","warnings":["string"]}',
        'Rules:',
        '- include exactly one root goal with parent_ref null',
        '- include 3 to 6 goals total, including the root',
        '- child goals should decompose the root into concrete workstreams',
        '- add 0 to 2 starter tasks per subgoal when there is an obvious first execution step',
        '- every starter task must point to an existing goal_ref and should usually target a child goal, not the root goal',
        '- if there is a clear owner, set suggested_agent_id and suggested_agent_name from the available agents list, otherwise return null',
        '- keep titles concise and action-oriented',
        '- descriptions should explain intent and expected outcome',
        '- starter task priority must be an integer from 0 to 100',
        '- statuses should normally be "active"',
        '- warnings should call out ambiguity or missing context',
        '',
        'Available agents:',
        ...agents.map(
          (agent) =>
            `- ${agent.id} | ${agent.name} | role=${agent.role} | title=${agent.title ?? 'n/a'} | status=${agent.status}`
        ),
      ].join('\n'),
      history: [
        {
          role: 'user',
          content: `Decompose this broad goal into a practical hierarchy:\n${prompt.trim()}`,
        },
      ],
    });

    const rawJson = extractJsonObject(response.thought);
    if (!rawJson) {
      throw new Error('Missing JSON object in runtime response');
    }

    const parsed = aiDecompositionSuggestionSchema.safeParse(
      JSON.parse(rawJson)
    );
    if (!parsed.success) {
      throw new Error(parsed.error.message);
    }

    const normalizedSuggestion: GoalDecompositionSuggestion = {
      title: parsed.data.title,
      description: parsed.data.description,
      goals: parsed.data.goals.map((goal) => ({
        ref: goal.ref,
        parent_ref: goal.parent_ref ?? null,
        title: goal.title,
        description: goal.description,
        status: goal.status,
      })),
      starter_tasks: parsed.data.starter_tasks.map((task) => ({
        ref: task.ref,
        goal_ref: task.goal_ref,
        title: task.title,
        description: task.description,
        priority: task.priority,
        suggested_agent_id:
          task.suggested_agent_id &&
          agents.some((agent) => agent.id === task.suggested_agent_id)
            ? task.suggested_agent_id
            : null,
        suggested_agent_name:
          task.suggested_agent_id &&
          agents.some((agent) => agent.id === task.suggested_agent_id)
            ? task.suggested_agent_name
            : null,
      })),
      confidence: parsed.data.confidence,
      warnings: parsed.data.warnings,
    };

    validateDraftGoals(normalizedSuggestion.goals);
    validateDraftTasks(
      normalizedSuggestion.goals,
      normalizedSuggestion.starter_tasks,
      new Set(agents.map((agent) => agent.id))
    );

    return {
      suggestion: normalizedSuggestion,
      planner: {
        mode: 'llm',
        runtime: response.routing?.selected_runtime,
        model: response.routing?.selected_model,
        fallback_reason: null,
      },
    };
  } catch (error) {
    return {
      suggestion: buildHeuristicDecomposition(prompt, agents),
      planner: {
        mode: 'rules',
        fallback_reason:
          error instanceof Error &&
          /json|duplicate goal ref|root goal|parent ref/i.test(error.message)
            ? 'invalid_llm_output'
            : 'llm_failed',
      },
    };
  }
}

async function insertGoalHierarchy(
  companyId: string,
  suggestion: GoalDecompositionSuggestion,
  validAgentIds: Set<string>
) {
  validateDraftGoals(suggestion.goals);
  validateDraftTasks(suggestion.goals, suggestion.starter_tasks, validAgentIds);

  return db.transaction(async (client) => {
    const goalIdByRef = new Map<string, string>();
    let remainingGoals = [...suggestion.goals];

    while (remainingGoals.length > 0) {
      const insertableGoals = remainingGoals.filter(
        (goal) => !goal.parent_ref || goalIdByRef.has(goal.parent_ref)
      );
      if (insertableGoals.length === 0) {
        throw new Error(
          'Goal decomposition contains an unresolved parent reference.'
        );
      }

      for (const goal of insertableGoals) {
        const result = await client.query(
          `INSERT INTO goals (company_id, parent_id, title, description, status)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING id`,
          [
            companyId,
            goal.parent_ref ? (goalIdByRef.get(goal.parent_ref) ?? null) : null,
            goal.title,
            goal.description,
            goal.status,
          ]
        );
        goalIdByRef.set(goal.ref, result.rows[0].id as string);
      }

      const insertedRefs = new Set(insertableGoals.map((goal) => goal.ref));
      remainingGoals = remainingGoals.filter(
        (goal) => !insertedRefs.has(goal.ref)
      );
    }

    const createdTaskIds: string[] = [];
    for (const task of suggestion.starter_tasks) {
      const result = await client.query(
        `INSERT INTO tasks (company_id, goal_id, parent_id, title, description, assigned_to, priority, status)
         VALUES ($1, $2, NULL, $3, $4, $5, $6, $7)
         RETURNING id`,
        [
          companyId,
          goalIdByRef.get(task.goal_ref) ?? null,
          task.title,
          task.description,
          task.suggested_agent_id && validAgentIds.has(task.suggested_agent_id)
            ? task.suggested_agent_id
            : null,
          task.priority,
          task.suggested_agent_id && validAgentIds.has(task.suggested_agent_id)
            ? 'assigned'
            : 'backlog',
        ]
      );
      createdTaskIds.push(result.rows[0].id as string);
    }

    return {
      rootGoalId:
        goalIdByRef.get(
          suggestion.goals.find((goal) => !goal.parent_ref)?.ref ?? ''
        ) ?? '',
      createdGoalIds: Array.from(goalIdByRef.values()),
      createdTaskIds,
    };
  });
}

// Create
router.post(
  '/',
  requireRole(['owner', 'admin', 'member']),
  async (req: AuthRequest, res, next) => {
    try {
      const parsed = createGoalSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: parsed.error });

      const { company_id, parent_id, title, description } = parsed.data;
      const scopedCompanyId = getCompanyId(req);
      if (!scopedCompanyId || scopedCompanyId !== company_id) {
        return res.status(403).json({ error: 'Forbidden: Company access denied' });
      }

      if (parent_id) {
        const parentGoalRes = await db.query(
          'SELECT id FROM goals WHERE id = $1 AND company_id = $2',
          [parent_id, scopedCompanyId]
        );
        if (parentGoalRes.rows.length === 0) {
          return res.status(404).json({ error: 'Parent goal not found' });
        }
      }

      const result = await db.query(
        'INSERT INTO goals (company_id, parent_id, title, description) VALUES ($1, $2, $3, $4) RETURNING *',
        [company_id, parent_id, title, description]
      );
      res.status(201).json(result.rows[0]);
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/ai-decompose',
  requireRole(['owner', 'admin', 'member', 'viewer']),
  async (req: AuthRequest, res) => {
    const companyId = getCompanyId(req);
    if (!companyId) {
      return res.status(400).json({ error: 'Missing company ID' });
    }

    const parsed = aiDecomposeSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error });
    }

    try {
      const companyRes = await db.query(
        `SELECT id, name, mission, config
       FROM companies
       WHERE id = $1`,
        [companyId]
      );
      const agentsRes = await db.query(
        `SELECT id, name, role, title, status
       FROM agents
       WHERE company_id = $1
         AND status != 'terminated'
       ORDER BY created_at ASC`,
        [companyId]
      );

      if (companyRes.rows.length === 0) {
        return res.status(404).json({ error: 'Company not found' });
      }

      const result = await generateGoalDecomposition(
        companyRes.rows[0] as {
          name: string;
          mission: string | null;
          config?: unknown;
        },
        parsed.data.prompt,
        agentsRes.rows as GoalSuggestAgent[]
      );

      await db.query(
        `INSERT INTO audit_log (company_id, action, entity_type, details)
       VALUES ($1, 'goal.ai_decomposed', 'goal_decomposition', $2)`,
        [
          companyId,
          JSON.stringify({
            prompt: parsed.data.prompt,
            requested_by_user_id: req.user?.id ?? null,
            requested_by_role: req.user?.role ?? null,
            planner: result.planner,
            suggestion: result.suggestion,
          }),
        ]
      );

      res.json(result);
    } catch (err: any) {
      res
        .status(500)
        .json({ error: err.message || 'AI goal decomposition failed' });
    }
  }
);

router.post(
  '/ai-decompose/apply',
  requireRole(['owner', 'admin', 'member']),
  async (req: AuthRequest, res) => {
    const companyId = getCompanyId(req);
    if (!companyId) {
      return res.status(400).json({ error: 'Missing company ID' });
    }

    const parsed = applyDecompositionSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error });
    }

    try {
      const normalizedSuggestion: GoalDecompositionSuggestion = {
        title: parsed.data.suggestion.title,
        description: parsed.data.suggestion.description,
        goals: parsed.data.suggestion.goals.map((goal) => ({
          ref: goal.ref,
          parent_ref: goal.parent_ref ?? null,
          title: goal.title,
          description: goal.description,
          status: goal.status,
        })),
        starter_tasks: parsed.data.suggestion.starter_tasks.map((task) => ({
          ref: task.ref,
          goal_ref: task.goal_ref,
          title: task.title,
          description: task.description,
          priority: task.priority,
          suggested_agent_id: task.suggested_agent_id,
          suggested_agent_name: task.suggested_agent_name,
        })),
        confidence: parsed.data.suggestion.confidence,
        warnings: parsed.data.suggestion.warnings,
      };
      const agentsRes = await db.query(
        `SELECT id
       FROM agents
       WHERE company_id = $1`,
        [companyId]
      );
      const inserted = await insertGoalHierarchy(
        companyId,
        normalizedSuggestion,
        new Set(agentsRes.rows.map((row) => String(row.id)))
      );
      const response: GoalDecompositionApplyResponse = {
        ok: true,
        root_goal_id: inserted.rootGoalId,
        created_goal_ids: inserted.createdGoalIds,
        created_goal_count: inserted.createdGoalIds.length,
        created_task_ids: inserted.createdTaskIds,
        created_task_count: inserted.createdTaskIds.length,
      };

      await db.query(
        `INSERT INTO audit_log (company_id, action, entity_type, entity_id, details)
       VALUES ($1, 'goal.decomposition_applied', 'goal_decomposition', $2, $3)`,
        [
          companyId,
          inserted.rootGoalId,
          JSON.stringify({
            requested_by_user_id: req.user?.id ?? null,
            requested_by_role: req.user?.role ?? null,
            created_goal_count: response.created_goal_count,
            created_goal_ids: response.created_goal_ids,
            created_task_count: response.created_task_count,
            created_task_ids: response.created_task_ids,
            suggestion: normalizedSuggestion,
          }),
        ]
      );

      res.status(201).json(response);
    } catch (err: any) {
      res
        .status(500)
        .json({ error: err.message || 'Applying goal decomposition failed' });
    }
  }
);

// List
router.get(
  '/',
  requireRole(['owner', 'admin', 'member', 'viewer']),
  async (req: AuthRequest, res, next) => {
    try {
      const companyId = getCompanyId(req);
      if (!companyId) {
        return res.status(400).json({ error: 'Missing company_id' });
      }

      const result = await db.query(
        'SELECT * FROM goals WHERE company_id = $1 ORDER BY created_at ASC',
        [companyId]
      );
      res.json(result.rows);
    } catch (err) {
      next(err);
    }
  }
);

// Update
router.patch(
  '/:id',
  requireRole(['owner', 'admin', 'member']),
  async (req: AuthRequest, res, next) => {
    try {
      const { status, title, description } = req.body;
      const companyId = getCompanyId(req);
      if (!companyId) {
        return res.status(400).json({ error: 'Missing company_id' });
      }
      const result = await db.query(
        `UPDATE goals SET 
        status = COALESCE($1, status),
        title = COALESCE($2, title),
        description = COALESCE($3, description),
        updated_at = now()
       WHERE id = $4
         AND company_id = $5
       RETURNING *`,
        [status, title, description, req.params.id, companyId]
      );
      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Goal not found' });
      }
      res.json(result.rows[0]);
    } catch (err) {
      next(err);
    }
  }
);

export default router;
