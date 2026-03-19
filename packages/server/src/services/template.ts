import type pg from 'pg';
import type { TemplateImportDryRun as SharedTemplateImportDryRun } from '@biuro/shared';
import { z } from 'zod';
import { db } from '../db/client.js';

const JsonObjectSchema = z.record(z.unknown());
const SupportedRuntimeSchema = z.enum(['claude', 'openai', 'gemini']);
type SupportedRuntime = z.infer<typeof SupportedRuntimeSchema>;
const defaultTemplateRuntime: SupportedRuntime = 'gemini';
const supportedTemplateRuntimeSet = new Set<SupportedRuntime>(
  SupportedRuntimeSchema.options
);

function normalizeTemplateRuntime(value: unknown): SupportedRuntime {
  if (typeof value !== 'string') {
    return defaultTemplateRuntime;
  }

  return supportedTemplateRuntimeSet.has(value as SupportedRuntime)
    ? (value as SupportedRuntime)
    : defaultTemplateRuntime;
}

const GoalTemplateSchema = z.object({
  ref: z.string().min(1),
  parent_ref: z.string().min(1).nullable().optional(),
  title: z.string().min(1),
  description: z.string().nullable().optional(),
  status: z.enum(['active', 'achieved', 'abandoned']).default('active'),
});

const PolicyTemplateSchema = z.object({
  name: z.string().min(1),
  description: z.string().nullable().optional(),
  type: z.enum([
    'approval_required',
    'budget_threshold',
    'delegation_limit',
    'rate_limit',
    'tool_restriction',
  ]),
  rules: JsonObjectSchema.default({}),
  is_active: z.boolean().default(true),
});

const ToolTemplateSchema = z.object({
  ref: z.string().min(1),
  name: z.string().min(1),
  description: z.string().nullable().optional(),
  type: z.enum(['builtin', 'http', 'bash', 'mcp']),
  config: JsonObjectSchema.default({}),
});

const AgentToolAssignmentSchema = z.object({
  tool_ref: z.string().min(1),
  can_execute: z.boolean().default(true),
  config: JsonObjectSchema.default({}),
});

const AgentTemplateSchema = z.object({
  ref: z.string().min(1),
  name: z.string().min(1),
  role: z.string().min(1),
  title: z.string().nullable().optional(),
  runtime: z.unknown().optional().transform(normalizeTemplateRuntime),
  model: z.string().min(1).nullable().optional(),
  system_prompt: z.string().nullable().optional(),
  config: JsonObjectSchema.default({}),
  reports_to_ref: z.string().min(1).nullable().optional(),
  monthly_budget_usd: z.coerce.number().min(0).default(0),
  tools: z.array(AgentToolAssignmentSchema).default([]),
});

const BudgetTemplateSchema = z.object({
  agent_ref: z.string().min(1),
  limit_usd: z.coerce.number().min(0),
  spent_usd: z.coerce.number().min(0).default(0),
});

export const CompanyTemplateSchema = z.object({
  version: z.string().min(1),
  company: z.object({
    name: z.string().min(1),
    mission: z.string().nullable().optional(),
  }),
  roles: z.array(z.enum(['owner', 'admin', 'member', 'viewer'])).default([]),
  goals: z.array(GoalTemplateSchema).default([]),
  policies: z.array(PolicyTemplateSchema).default([]),
  tools: z.array(ToolTemplateSchema).default([]),
  agents: z.array(AgentTemplateSchema).default([]),
  budgets: z.array(BudgetTemplateSchema).default([]),
});

export type CompanyTemplate = z.infer<typeof CompanyTemplateSchema>;
export type TemplateImportOptions = {
  preserveCompanyIdentity?: boolean;
};
export type TemplateImportExistingState = {
  company: {
    name: string;
    mission: string | null;
  };
  goals: Array<{ title: string }>;
  agents: Array<{ name: string }>;
  tools: Array<{ name: string }>;
  policies: Array<{ name: string }>;
  budgets: Array<{ agent_id: string; agent_name: string }>;
};
export type TemplateImportDryRun = SharedTemplateImportDryRun;
export type TemplatePreviewAuditDetails = {
  preset_id: string;
  preset_name: string;
  requested_by_user_id: string | null;
  requested_by_role: string | null;
  preserve_company_identity: boolean;
  changes: TemplateImportDryRun['changes'];
  projected_counts: {
    goals: number;
    agents: number;
    tools: number;
    policies: number;
    budgets: number;
  };
  collision_counts: {
    agent_names: number;
    goal_titles: number;
    policy_names: number;
    tool_names: number;
  };
  sample_changes: {
    goals_to_add: string[];
    agents_to_add: string[];
    policies_to_add: string[];
    tools_to_create: string[];
    tools_to_update: string[];
  };
};

function numericToNumber(value: unknown) {
  if (typeof value === 'number') {
    return value;
  }

  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  return 0;
}

function normalizeName(value: string) {
  return value.trim().toLowerCase();
}

function getUniqueCollisions(incoming: string[], existing: string[]) {
  const existingNames = new Set(
    existing
      .map((value) => normalizeName(value))
      .filter((value) => value.length > 0)
  );
  const seen = new Set<string>();

  return incoming.filter((value) => {
    const normalized = normalizeName(value);
    if (!normalized || !existingNames.has(normalized) || seen.has(normalized)) {
      return false;
    }

    seen.add(normalized);
    return true;
  });
}

function splitIncomingNames(incoming: string[], existing: string[]) {
  const existingNames = new Set(
    existing
      .map((value) => normalizeName(value))
      .filter((value) => value.length > 0)
  );
  const create: string[] = [];
  const update: string[] = [];
  const seen = new Set<string>();

  for (const value of incoming) {
    const normalized = normalizeName(value);
    if (!normalized || seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    if (existingNames.has(normalized)) {
      update.push(value);
    } else {
      create.push(value);
    }
  }

  return { create, update };
}

function combineNames(existing: string[], incoming: string[]) {
  return [
    ...existing.filter((value) => value.trim().length > 0),
    ...incoming.filter((value) => value.trim().length > 0),
  ];
}

function getBudgetsToImport(template: CompanyTemplate) {
  return template.budgets.length > 0
    ? template.budgets
    : template.agents.map((agent) => ({
        agent_ref: agent.ref,
        limit_usd: agent.monthly_budget_usd,
        spent_usd: 0,
      }));
}

export function buildTemplateImportDryRun(
  existingState: TemplateImportExistingState,
  template: CompanyTemplate,
  options: TemplateImportOptions = {}
): TemplateImportDryRun {
  const preserveCompanyIdentity = options.preserveCompanyIdentity ?? false;
  const budgetsToImport = getBudgetsToImport(template);
  const budgetChanges = budgetsToImport.map((budget) => {
    const relatedAgent = template.agents.find(
      (agent) => agent.ref === budget.agent_ref
    );
    return {
      agent_name: relatedAgent?.name ?? budget.agent_ref,
      limit_usd: budget.limit_usd,
      spent_usd: budget.spent_usd,
    };
  });
  const toolChanges = splitIncomingNames(
    template.tools.map((tool) => tool.name),
    existingState.tools.map((tool) => tool.name)
  );
  const toolNameCollisions = getUniqueCollisions(
    template.tools.map((tool) => tool.name),
    existingState.tools.map((tool) => tool.name)
  );
  const agentNameCollisions = getUniqueCollisions(
    template.agents.map((agent) => agent.name),
    existingState.agents.map((agent) => agent.name)
  );
  const goalTitleCollisions = getUniqueCollisions(
    template.goals.map((goal) => goal.title),
    existingState.goals.map((goal) => goal.title)
  );
  const policyNameCollisions = getUniqueCollisions(
    template.policies.map((policy) => policy.name),
    existingState.policies.map((policy) => policy.name)
  );
  const warnings = [
    'Import is additive and does not remove existing goals, agents, tools, policies or budgets.',
    preserveCompanyIdentity
      ? 'Current company name and mission will be preserved during import.'
      : 'Company name and mission will be replaced by the template values.',
  ];

  if (
    existingState.goals.length > 0 ||
    existingState.agents.length > 0 ||
    existingState.tools.length > 0 ||
    existingState.policies.length > 0
  ) {
    warnings.push(
      'This company already contains records, so importing a preset will layer more structure on top of the current setup.'
    );
  }

  if (toolNameCollisions.length > 0) {
    warnings.push(
      `${toolNameCollisions.length} tool name match(es) will update existing tools instead of creating new ones.`
    );
  }

  if (agentNameCollisions.length > 0) {
    warnings.push(
      `${agentNameCollisions.length} agent name match(es) already exist and importing will create additional agent records with those names.`
    );
  }

  if (goalTitleCollisions.length > 0) {
    warnings.push(
      `${goalTitleCollisions.length} goal title match(es) already exist and importing will add more goals with those titles.`
    );
  }

  if (policyNameCollisions.length > 0) {
    warnings.push(
      `${policyNameCollisions.length} policy name match(es) already exist and importing will add more policy rows with those names.`
    );
  }

  return {
    preserve_company_identity: preserveCompanyIdentity,
    company: {
      current_name: existingState.company.name,
      current_mission: existingState.company.mission,
      incoming_name: template.company.name,
      incoming_mission: template.company.mission ?? null,
      resulting_name: preserveCompanyIdentity
        ? existingState.company.name
        : template.company.name,
      resulting_mission: preserveCompanyIdentity
        ? existingState.company.mission
        : (template.company.mission ?? null),
    },
    current: {
      goals: existingState.goals.length,
      agents: existingState.agents.length,
      tools: existingState.tools.length,
      policies: existingState.policies.length,
      budgets: existingState.budgets.length,
    },
    incoming: {
      goals: template.goals.length,
      agents: template.agents.length,
      tools: template.tools.length,
      policies: template.policies.length,
      budgets: budgetsToImport.length,
    },
    changes: {
      goals_to_add: template.goals.length,
      agents_to_add: template.agents.length,
      policies_to_add: template.policies.length,
      budgets_to_add: budgetsToImport.length,
      tools_to_create: toolChanges.create.length,
      tools_to_update: toolChanges.update.length,
      total_new_records:
        template.goals.length +
        template.agents.length +
        template.policies.length +
        budgetsToImport.length +
        toolChanges.create.length,
    },
    collisions: {
      agent_names: agentNameCollisions,
      goal_titles: goalTitleCollisions,
      policy_names: policyNameCollisions,
      tool_names: toolNameCollisions,
    },
    record_changes: {
      goals_to_add: template.goals.map((goal) => goal.title),
      agents_to_add: template.agents.map((agent) => agent.name),
      policies_to_add: template.policies.map((policy) => policy.name),
      tools_to_create: toolChanges.create,
      tools_to_update: toolChanges.update,
      budgets_to_add: budgetChanges,
    },
    projected: {
      goals: {
        count: existingState.goals.length + template.goals.length,
        names: combineNames(
          existingState.goals.map((goal) => goal.title),
          template.goals.map((goal) => goal.title)
        ),
      },
      agents: {
        count: existingState.agents.length + template.agents.length,
        names: combineNames(
          existingState.agents.map((agent) => agent.name),
          template.agents.map((agent) => agent.name)
        ),
      },
      tools: {
        count: existingState.tools.length + toolChanges.create.length,
        names: combineNames(
          existingState.tools.map((tool) => tool.name),
          toolChanges.create
        ),
      },
      policies: {
        count: existingState.policies.length + template.policies.length,
        names: combineNames(
          existingState.policies.map((policy) => policy.name),
          template.policies.map((policy) => policy.name)
        ),
      },
      budgets: {
        count: existingState.budgets.length + budgetChanges.length,
        agent_names: combineNames(
          existingState.budgets.map((budget) => budget.agent_name),
          budgetChanges.map((budget) => budget.agent_name)
        ),
      },
    },
    warnings,
  };
}

export function buildTemplatePreviewAuditDetails(args: {
  presetId: string;
  presetName: string;
  preview: TemplateImportDryRun;
  userId?: string;
  role?: string;
}): TemplatePreviewAuditDetails {
  const { presetId, presetName, preview, userId, role } = args;

  return {
    preset_id: presetId,
    preset_name: presetName,
    requested_by_user_id: userId ?? null,
    requested_by_role: role ?? null,
    preserve_company_identity: preview.preserve_company_identity,
    changes: preview.changes,
    projected_counts: {
      goals: preview.projected.goals.count,
      agents: preview.projected.agents.count,
      tools: preview.projected.tools.count,
      policies: preview.projected.policies.count,
      budgets: preview.projected.budgets.count,
    },
    collision_counts: {
      agent_names: preview.collisions.agent_names.length,
      goal_titles: preview.collisions.goal_titles.length,
      policy_names: preview.collisions.policy_names.length,
      tool_names: preview.collisions.tool_names.length,
    },
    sample_changes: {
      goals_to_add: preview.record_changes.goals_to_add.slice(0, 5),
      agents_to_add: preview.record_changes.agents_to_add.slice(0, 5),
      policies_to_add: preview.record_changes.policies_to_add.slice(0, 5),
      tools_to_create: preview.record_changes.tools_to_create.slice(0, 5),
      tools_to_update: preview.record_changes.tools_to_update.slice(0, 5),
    },
  };
}

async function insertGoals(
  client: pg.PoolClient,
  companyId: string,
  goals: CompanyTemplate['goals']
) {
  const goalIdByRef = new Map<string, string>();
  let remainingGoals = [...goals];

  while (remainingGoals.length > 0) {
    const insertableGoals = remainingGoals.filter(
      (goal) => !goal.parent_ref || goalIdByRef.has(goal.parent_ref)
    );
    if (insertableGoals.length === 0) {
      throw new Error(
        'Goal hierarchy contains missing or circular parent references'
      );
    }

    for (const goal of insertableGoals) {
      const insertedGoal = await client.query(
        `INSERT INTO goals (company_id, parent_id, title, description, status)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id`,
        [
          companyId,
          goal.parent_ref ? (goalIdByRef.get(goal.parent_ref) ?? null) : null,
          goal.title,
          goal.description ?? null,
          goal.status,
        ]
      );
      goalIdByRef.set(goal.ref, insertedGoal.rows[0].id);
    }

    const insertedRefs = new Set(insertableGoals.map((goal) => goal.ref));
    remainingGoals = remainingGoals.filter(
      (goal) => !insertedRefs.has(goal.ref)
    );
  }

  return goalIdByRef;
}

export const TemplateService = {
  async exportCompany(companyId: string): Promise<CompanyTemplate> {
    const company = (
      await db.query('SELECT name, mission FROM companies WHERE id = $1', [
        companyId,
      ])
    ).rows[0];

    if (!company) {
      throw new Error('Company not found');
    }

    const [
      rolesRes,
      goalsRes,
      policiesRes,
      toolsRes,
      agentsRes,
      agentToolsRes,
      budgetsRes,
    ] = await Promise.all([
      db.query(
        'SELECT DISTINCT role FROM user_roles WHERE company_id = $1 ORDER BY role ASC',
        [companyId]
      ),
      db.query(
        'SELECT id, parent_id, title, description, status FROM goals WHERE company_id = $1 ORDER BY created_at ASC',
        [companyId]
      ),
      db.query(
        'SELECT name, description, type, rules, is_active FROM policies WHERE company_id = $1 ORDER BY created_at ASC',
        [companyId]
      ),
      db.query(
        'SELECT id, name, description, type, config FROM tools WHERE company_id = $1 ORDER BY created_at ASC',
        [companyId]
      ),
      db.query(
        `SELECT id, name, role, title, runtime, model, system_prompt, config, reports_to, monthly_budget_usd
         FROM agents
         WHERE company_id = $1
         ORDER BY created_at ASC`,
        [companyId]
      ),
      db.query(
        `SELECT at.agent_id, at.tool_id, at.can_execute, at.config
         FROM agent_tools at
         JOIN agents a ON a.id = at.agent_id
         WHERE a.company_id = $1`,
        [companyId]
      ),
      db.query(
        `SELECT b.agent_id, b.limit_usd, b.spent_usd
         FROM budgets b
         JOIN agents a ON a.id = b.agent_id
         WHERE a.company_id = $1
           AND b.month = date_trunc('month', now())::date
         ORDER BY b.created_at ASC`,
        [companyId]
      ),
    ]);

    const goalRefById = new Map(
      goalsRes.rows.map((goal, index) => [
        goal.id as string,
        `goal-${index + 1}`,
      ])
    );
    const toolRefById = new Map(
      toolsRes.rows.map((tool, index) => [
        tool.id as string,
        `tool-${index + 1}`,
      ])
    );
    const agentRefById = new Map(
      agentsRes.rows.map((agent, index) => [
        agent.id as string,
        `agent-${index + 1}`,
      ])
    );

    const toolAssignmentsByAgent = new Map<
      string,
      CompanyTemplate['agents'][number]['tools']
    >();
    for (const assignment of agentToolsRes.rows) {
      const toolRef = toolRefById.get(assignment.tool_id);
      if (!toolRef) {
        continue;
      }

      const assignments = toolAssignmentsByAgent.get(assignment.agent_id) ?? [];
      assignments.push({
        tool_ref: toolRef,
        can_execute: assignment.can_execute ?? true,
        config: assignment.config ?? {},
      });
      toolAssignmentsByAgent.set(assignment.agent_id, assignments);
    }

    return {
      version: '1.1',
      company: {
        name: company.name,
        mission: company.mission ?? null,
      },
      roles: rolesRes.rows.map((row) => row.role),
      goals: goalsRes.rows.map((goal) => ({
        ref: goalRefById.get(goal.id)!,
        parent_ref: goal.parent_id
          ? (goalRefById.get(goal.parent_id) ?? null)
          : null,
        title: goal.title,
        description: goal.description ?? null,
        status: goal.status,
      })),
      policies: policiesRes.rows.map((policy) => ({
        name: policy.name,
        description: policy.description ?? null,
        type: policy.type,
        rules: policy.rules ?? {},
        is_active: policy.is_active ?? true,
      })),
      tools: toolsRes.rows.map((tool) => ({
        ref: toolRefById.get(tool.id)!,
        name: tool.name,
        description: tool.description ?? null,
        type: tool.type,
        config: tool.config ?? {},
      })),
      agents: agentsRes.rows.map((agent) => ({
        ref: agentRefById.get(agent.id)!,
        name: agent.name,
        role: agent.role,
        title: agent.title ?? null,
        runtime: agent.runtime,
        model: agent.model ?? null,
        system_prompt: agent.system_prompt ?? null,
        config: agent.config ?? {},
        reports_to_ref: agent.reports_to
          ? (agentRefById.get(agent.reports_to) ?? null)
          : null,
        monthly_budget_usd: numericToNumber(agent.monthly_budget_usd),
        tools: toolAssignmentsByAgent.get(agent.id) ?? [],
      })),
      budgets: budgetsRes.rows
        .map((budget) => {
          const agentRef = agentRefById.get(budget.agent_id);
          if (!agentRef) {
            return null;
          }

          return {
            agent_ref: agentRef,
            limit_usd: numericToNumber(budget.limit_usd),
            spent_usd: numericToNumber(budget.spent_usd),
          };
        })
        .filter(
          (budget): budget is NonNullable<typeof budget> => budget !== null
        ),
    };
  },

  async importCompany(
    companyId: string,
    template: CompanyTemplate,
    options: TemplateImportOptions = {}
  ) {
    return db.transaction(async (client) => {
      const currentCompanyRes = await client.query(
        'SELECT name, mission FROM companies WHERE id = $1',
        [companyId]
      );
      const currentCompany = currentCompanyRes.rows[0];
      if (!currentCompany) {
        throw new Error('Company not found');
      }

      const nextCompanyName = options.preserveCompanyIdentity
        ? currentCompany.name
        : template.company.name;
      const nextCompanyMission = options.preserveCompanyIdentity
        ? (currentCompany.mission ?? null)
        : (template.company.mission ?? null);

      await client.query(
        'UPDATE companies SET name = $1, mission = $2 WHERE id = $3',
        [nextCompanyName, nextCompanyMission, companyId]
      );

      await insertGoals(client, companyId, template.goals);

      const toolIdByRef = new Map<string, string>();
      for (const tool of template.tools) {
        const toolRes = await client.query(
          `INSERT INTO tools (company_id, name, description, type, config)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (company_id, name) DO UPDATE
           SET description = EXCLUDED.description,
               type = EXCLUDED.type,
               config = EXCLUDED.config
           RETURNING id`,
          [
            companyId,
            tool.name,
            tool.description ?? null,
            tool.type,
            JSON.stringify(tool.config ?? {}),
          ]
        );
        toolIdByRef.set(tool.ref, toolRes.rows[0].id);
      }

      const agentIdByRef = new Map<string, string>();
      for (const agent of template.agents) {
        const agentRes = await client.query(
          `INSERT INTO agents (
             company_id, name, role, title, runtime, model, system_prompt, config, reports_to, monthly_budget_usd
           )
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NULL, $9)
           RETURNING id`,
          [
            companyId,
            agent.name,
            agent.role,
            agent.title ?? null,
            agent.runtime,
            agent.model ?? null,
            agent.system_prompt ?? null,
            JSON.stringify(agent.config ?? {}),
            agent.monthly_budget_usd,
          ]
        );
        agentIdByRef.set(agent.ref, agentRes.rows[0].id);
      }

      for (const agent of template.agents) {
        if (!agent.reports_to_ref) {
          continue;
        }

        const agentId = agentIdByRef.get(agent.ref);
        const managerId = agentIdByRef.get(agent.reports_to_ref);
        if (!agentId || !managerId) {
          throw new Error(
            `Agent reference "${agent.ref}" has an unknown manager reference`
          );
        }

        await client.query('UPDATE agents SET reports_to = $1 WHERE id = $2', [
          managerId,
          agentId,
        ]);
      }

      for (const agent of template.agents) {
        const agentId = agentIdByRef.get(agent.ref);
        if (!agentId) {
          throw new Error(`Missing inserted agent for ref "${agent.ref}"`);
        }

        for (const assignment of agent.tools) {
          const toolId = toolIdByRef.get(assignment.tool_ref);
          if (!toolId) {
            throw new Error(
              `Agent "${agent.name}" references missing tool "${assignment.tool_ref}"`
            );
          }

          await client.query(
            `INSERT INTO agent_tools (agent_id, tool_id, can_execute, config)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (agent_id, tool_id) DO UPDATE
             SET can_execute = EXCLUDED.can_execute,
                 config = EXCLUDED.config`,
            [
              agentId,
              toolId,
              assignment.can_execute,
              JSON.stringify(assignment.config ?? {}),
            ]
          );
        }
      }

      const budgetsToImport = getBudgetsToImport(template);

      for (const budget of budgetsToImport) {
        const agentId = agentIdByRef.get(budget.agent_ref);
        if (!agentId) {
          throw new Error(
            `Budget references missing agent "${budget.agent_ref}"`
          );
        }

        await client.query(
          `INSERT INTO budgets (agent_id, month, limit_usd, spent_usd)
           VALUES ($1, date_trunc('month', now())::date, $2, $3)
           ON CONFLICT (agent_id, month) DO UPDATE
           SET limit_usd = EXCLUDED.limit_usd,
               spent_usd = EXCLUDED.spent_usd`,
          [agentId, budget.limit_usd, budget.spent_usd]
        );
      }

      for (const policy of template.policies) {
        await client.query(
          `INSERT INTO policies (company_id, name, description, type, rules, is_active)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            companyId,
            policy.name,
            policy.description ?? null,
            policy.type,
            JSON.stringify(policy.rules ?? {}),
            policy.is_active,
          ]
        );
      }

      return {
        success: true,
        goalsImported: template.goals.length,
        toolsImported: template.tools.length,
        policiesImported: template.policies.length,
        agentsImported: template.agents.length,
        budgetsImported: budgetsToImport.length,
      };
    });
  },

  async previewImport(
    companyId: string,
    template: CompanyTemplate,
    options: TemplateImportOptions = {}
  ) {
    const [companyRes, goalsRes, agentsRes, toolsRes, policiesRes, budgetsRes] =
      await Promise.all([
        db.query('SELECT name, mission FROM companies WHERE id = $1', [
          companyId,
        ]),
        db.query('SELECT title FROM goals WHERE company_id = $1', [companyId]),
        db.query('SELECT name FROM agents WHERE company_id = $1', [companyId]),
        db.query('SELECT name FROM tools WHERE company_id = $1', [companyId]),
        db.query('SELECT name FROM policies WHERE company_id = $1', [
          companyId,
        ]),
        db.query(
          `SELECT b.agent_id, a.name AS agent_name
         FROM budgets b
         JOIN agents a ON a.id = b.agent_id
         WHERE a.company_id = $1
           AND b.month = date_trunc('month', now())::date`,
          [companyId]
        ),
      ]);

    const company = companyRes.rows[0];
    if (!company) {
      throw new Error('Company not found');
    }

    return buildTemplateImportDryRun(
      {
        company: {
          name: company.name,
          mission: company.mission ?? null,
        },
        goals: goalsRes.rows,
        agents: agentsRes.rows,
        tools: toolsRes.rows,
        policies: policiesRes.rows,
        budgets: budgetsRes.rows,
      },
      template,
      options
    );
  },
};
