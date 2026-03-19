import { z } from 'zod';
import { db } from '../db/client.js';
import { env } from '../env.js';
import { extractCompanyRuntimeSettings, type RuntimeName } from '../runtime/preferences.js';
import { runtimeRegistry } from '../runtime/registry.js';
import type { AgentAction, AgentContext } from '../types/agent.js';
import { logger } from '../utils/logger.js';

type PlannerRole = 'owner' | 'admin' | 'member' | 'viewer' | string | undefined;

type PlannerCompany = {
  id: string;
  name: string;
  mission?: string | null;
  config?: unknown;
};

type PlannerAgent = {
  id: string;
  name: string;
  role: string;
  title?: string | null;
  status: string;
};

type PlannerApproval = {
  id: string;
  reason: string;
  status: string;
};

type PlannerResources = {
  company: PlannerCompany;
  agents: PlannerAgent[];
  approvals: PlannerApproval[];
};

type UseToolAction = {
  type: 'use_tool';
  tool_name: string;
  params: Record<string, unknown>;
};

type PlannerContext = {
  companyId: string;
  role?: PlannerRole;
};

type PlannerAttempt = {
  runtime: string;
  model: string;
  status: 'success' | 'fallback' | 'failed';
  reason?: string;
};

type PlannerFallbackReason = 'llm_unavailable' | 'llm_failed' | 'invalid_llm_plan';

export type NLCommandPlannerMetadata = {
  mode: 'llm' | 'rules';
  runtime?: string;
  model?: string;
  attempts?: PlannerAttempt[];
  fallback_reason?: PlannerFallbackReason | null;
};

type PlanActionMethod = 'GET' | 'POST' | 'PATCH';

export type NLCommandPlanAction =
  | {
      id: string;
      type: 'navigate';
      label: string;
      description: string;
      path: string;
      requires_confirmation: boolean;
    }
  | {
      id: string;
      type: 'api_request';
      label: string;
      description: string;
      endpoint: string;
      method: PlanActionMethod;
      body?: Record<string, unknown>;
      requires_confirmation: boolean;
      success_message: string;
    };

export type NLCommandPlan = {
  source: 'rules' | 'llm';
  original_input: string;
  summary: string;
  reasoning: string;
  warnings: string[];
  can_execute: boolean;
  actions: NLCommandPlanAction[];
  planner: NLCommandPlannerMetadata;
};

type PageDestination = {
  path: string;
  label: string;
  keywords: string[];
};

const PAGE_DESTINATIONS: PageDestination[] = [
  { path: '/', label: 'Dashboard', keywords: ['dashboard', 'overview', 'home', 'metrics', 'panel glowny'] },
  { path: '/agents', label: 'Agents', keywords: ['agents', 'agent', 'team', 'zespol', 'org chart'] },
  { path: '/tasks', label: 'Tasks', keywords: ['tasks', 'task', 'zadania', 'zadanie', 'backlog'] },
  { path: '/goals', label: 'Goals', keywords: ['goals', 'goal', 'cele', 'cel', 'objectives'] },
  { path: '/approvals', label: 'Approvals', keywords: ['approvals', 'approval', 'akceptacje', 'zgody', 'governance'] },
  { path: '/tools', label: 'Tools', keywords: ['tools', 'tool', 'narzedzia', 'narzedzie'] },
  { path: '/integrations', label: 'Integrations', keywords: ['integrations', 'integration', 'slack', 'discord'] },
  { path: '/budgets', label: 'Budgets', keywords: ['budgets', 'budget', 'costs', 'koszty', 'budzet'] },
  { path: '/observability', label: 'Observability', keywords: ['observability', 'trace', 'traces', 'logs', 'logi'] },
];

const stopWords = new Set([
  'the',
  'a',
  'an',
  'to',
  'for',
  'of',
  'and',
  'go',
  'open',
  'show',
  'navigate',
  'please',
  'mi',
  'mnie',
  'na',
  'do',
  'i',
  'oraz',
  'prosze',
  'pokaz',
  'otworz',
  'przejdz',
  'idz',
  'idzmy',
  'agent',
  'agenta',
  'task',
  'zadanie',
  'goal',
  'cel',
  'approval',
  'zgode',
  'akceptacje',
]);

const NavigateToolSchema = z.object({
  path: z.string().min(1),
});

const PauseAgentToolSchema = z.object({
  agent_id: z.string().min(1),
});

const ResumeAgentToolSchema = z.object({
  agent_id: z.string().min(1),
});

const ResolveApprovalToolSchema = z.object({
  approval_id: z.string().min(1),
  status: z.enum(['approved', 'rejected']),
});

const CreateTaskToolSchema = z.object({
  title: z.string().min(1).max(200),
  assigned_to: z.string().min(1).optional(),
});

const CreateGoalToolSchema = z.object({
  title: z.string().min(1).max(200),
});

function normalizeText(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s/-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenize(value: string) {
  return normalizeText(value)
    .split(' ')
    .map((token) => token.trim())
    .filter((token) => token.length > 1 && !stopWords.has(token));
}

function canManageCompany(role?: PlannerRole) {
  return role === 'owner' || role === 'admin';
}

function canContribute(role?: PlannerRole) {
  return role === 'owner' || role === 'admin' || role === 'member';
}

async function loadPlannerResources(companyId: string, role?: PlannerRole): Promise<PlannerResources> {
  const companyPromise = db.query(
    `SELECT id, name, mission, config
     FROM companies
     WHERE id = $1`,
    [companyId]
  );

  const agentsPromise = db.query(
    `SELECT id, name, role, title, status
     FROM agents
     WHERE company_id = $1
     ORDER BY created_at ASC`,
    [companyId]
  );

  const approvalsPromise = canManageCompany(role)
    ? db.query(
        `SELECT id, reason, status
         FROM approvals
         WHERE company_id = $1 AND status = 'pending'
         ORDER BY created_at DESC`,
        [companyId]
      )
    : Promise.resolve({ rows: [] as PlannerApproval[] });

  const [companyRes, agentsRes, approvalsRes] = await Promise.all([companyPromise, agentsPromise, approvalsPromise]);
  if (companyRes.rows.length === 0) {
    throw new Error(`Company ${companyId} not found`);
  }

  return {
    company: companyRes.rows[0] as PlannerCompany,
    agents: agentsRes.rows as PlannerAgent[],
    approvals: approvalsRes.rows as PlannerApproval[],
  };
}

function toNavigateAction(id: string, label: string, description: string, path: string): NLCommandPlanAction {
  return {
    id,
    type: 'navigate',
    label,
    description,
    path,
    requires_confirmation: false,
  };
}

function scoreMatch(query: string, candidate: string) {
  const normalizedQuery = normalizeText(query);
  const normalizedCandidate = normalizeText(candidate);
  if (!normalizedQuery || !normalizedCandidate) {
    return 0;
  }

  if (normalizedCandidate.includes(normalizedQuery)) {
    return normalizedQuery.length + 10;
  }

  const queryTokens = tokenize(query);
  if (queryTokens.length === 0) {
    return 0;
  }

  const candidateTokens = new Set(tokenize(candidate));
  let score = 0;
  for (const token of queryTokens) {
    if (candidateTokens.has(token)) {
      score += token.length;
    }
  }
  return score;
}

function findBestMatch<T>(query: string, items: T[], getText: (item: T) => string) {
  let bestScore = 0;
  let bestMatch: T | null = null;

  for (const item of items) {
    const score = scoreMatch(query, getText(item));
    if (score > bestScore) {
      bestScore = score;
      bestMatch = item;
    }
  }

  return bestScore > 1 ? bestMatch : null;
}

function findPageDestination(input: string) {
  const normalizedInput = normalizeText(input);
  const isNavigationIntent =
    /^(open|show|go to|navigate|otworz|pokaz|przejdz do|idz do)\b/.test(normalizedInput) ||
    PAGE_DESTINATIONS.some((page) => page.keywords.includes(normalizedInput));

  if (!isNavigationIntent) {
    return null;
  }

  return findBestMatch(normalizedInput, PAGE_DESTINATIONS, (page) => `${page.label} ${page.keywords.join(' ')}`);
}

function extractTail(input: string, patterns: RegExp[]) {
  for (const pattern of patterns) {
    const match = input.match(pattern);
    if (match?.[1]) {
      return match[1].trim();
    }
  }
  return null;
}

function extractAssignee(input: string) {
  const match = input.match(/\s+(?:and\s+assign\s+to|assign\s+to|i\s+przypisz\s+do|przypisz\s+do)\s+(.+)$/i);
  if (!match?.[1]) {
    return { title: input.trim(), assigneeQuery: null as string | null };
  }

  const title = input.slice(0, match.index).trim();
  return {
    title,
    assigneeQuery: match[1].trim(),
  };
}

function selectAgentFromIntent(input: string, agents: PlannerAgent[], preferredStatuses?: string[]) {
  const filteredAgents = preferredStatuses?.length
    ? agents.filter((agent) => preferredStatuses.includes(agent.status))
    : agents;

  const nameTail = extractTail(normalizeText(input), [
    /(?:pause|resume|wstrzymaj|zapauzuj|wznow|odpauzuj)\s+(.+)$/i,
  ]);

  if (nameTail) {
    const matchedAgent = findBestMatch(nameTail, filteredAgents, (agent) => `${agent.name} ${agent.role} ${agent.title || ''}`);
    if (matchedAgent) {
      return matchedAgent;
    }
  }

  if (filteredAgents.length === 1) {
    return filteredAgents[0];
  }

  return null;
}

function selectApprovalFromIntent(input: string, approvals: PlannerApproval[]) {
  if (approvals.length === 0) {
    return null;
  }

  const normalizedInput = normalizeText(input);
  if (normalizedInput.includes('latest') || normalizedInput.includes('ostatn')) {
    return approvals[0];
  }

  const tail = extractTail(normalizeText(input), [
    /(?:approve|reject|zaakceptuj|akceptuj|odrzuc)\s+(.+)$/i,
  ]);

  if (tail) {
    const matchedApproval = findBestMatch(tail, approvals, (approval) => approval.reason);
    if (matchedApproval) {
      return matchedApproval;
    }
  }

  if (approvals.length === 1) {
    return approvals[0];
  }

  return null;
}

function getConfiguredRuntimeNames() {
  const configured: RuntimeName[] = [];

  if (env.GOOGLE_API_KEY && env.GOOGLE_API_KEY !== 'your_key_here') {
    configured.push('gemini');
  }
  if (env.ANTHROPIC_API_KEY && env.ANTHROPIC_API_KEY !== 'your_key_here') {
    configured.push('claude');
  }
  if (env.OPENAI_API_KEY && env.OPENAI_API_KEY !== 'your_key_here') {
    configured.push('openai');
  }

  return configured;
}

function resolvePlannerRuntimeSelection(config: unknown) {
  const configuredRuntimes = getConfiguredRuntimeNames();
  if (configuredRuntimes.length === 0) {
    return null;
  }

  const settings = extractCompanyRuntimeSettings(config);
  const desiredOrder: RuntimeName[] = [];
  const seen = new Set<RuntimeName>();

  for (const runtime of [settings.primaryRuntime, ...settings.fallbackOrder]) {
    if (!seen.has(runtime)) {
      desiredOrder.push(runtime);
      seen.add(runtime);
    }
  }

  const availableOrder = desiredOrder.filter((runtime) => configuredRuntimes.includes(runtime));
  if (availableOrder.length === 0) {
    return null;
  }

  return {
    preferredRuntime: availableOrder[0],
    fallbackOrder: availableOrder.slice(1),
  };
}

function buildPlannerContext(
  context: PlannerContext,
  input: string,
  resources: PlannerResources
): AgentContext {
  const availablePages = PAGE_DESTINATIONS.map((page) => `- ${page.path}: ${page.label}`).join('\n');
  const availableAgents = resources.agents.length > 0
    ? resources.agents
        .map((agent) => `- ${agent.id}: ${agent.name} (${agent.role}${agent.title ? `, ${agent.title}` : ''}) [${agent.status}]`)
        .join('\n')
    : '- none';
  const pendingApprovals = resources.approvals.length > 0
    ? resources.approvals
        .map((approval) => `- ${approval.id}: ${approval.reason} [${approval.status}]`)
        .join('\n')
    : '- none';

  const rolePolicy = canManageCompany(context.role)
    ? 'You may plan navigation, create_task, create_goal, pause_agent, resume_agent, and resolve_approval.'
    : canContribute(context.role)
      ? 'You may only plan navigation, create_task, and create_goal. Do not plan pause_agent, resume_agent, or resolve_approval.'
      : 'You may only plan navigation. Do not plan create_task, create_goal, pause_agent, resume_agent, or resolve_approval.';

  return {
    company_name: resources.company.name,
    company_mission: resources.company.mission || 'Operate the company safely and efficiently.',
    agent_name: 'Biuro Control Panel',
    agent_role: 'Operations Planner',
    agent_system_prompt: `
You translate natural-language dashboard commands into a safe execution plan.
You do not execute anything directly.
Return only actions that can be mapped to the allowed control tools below.

Allowed control tools via use_tool:
- navigate { "path": string }
- pause_agent { "agent_id": string }
- resume_agent { "agent_id": string }
- resolve_approval { "approval_id": string, "status": "approved" | "rejected" }
- create_task { "title": string, "assigned_to"?: string }
- create_goal { "title": string }

Rules:
- Use exact IDs from the provided context. Never invent IDs.
- If the command is ambiguous, unsafe, or unsupported, return a single continue action explaining why.
- Prefer a short ordered plan. Add navigate when it helps the user land on the updated view.
- ${rolePolicy}
    `.trim(),
    additional_context: `
USER ROLE: ${context.role || 'unknown'}

AVAILABLE PAGES:
${availablePages}

AVAILABLE AGENTS:
${availableAgents}

PENDING APPROVALS:
${pendingApprovals}
    `.trim(),
    goal_hierarchy: ['Natural Language Control Panel'],
    current_task: {
      title: 'Interpret dashboard command',
      description: `User command: ${input}`,
    },
    history: [
      {
        role: 'user',
        content: `Plan this dashboard command as safe control actions: ${input}`,
      },
    ],
  };
}

function buildLLMSummary(actions: NLCommandPlanAction[]) {
  if (actions.length === 1 && actions[0].type === 'navigate') {
    return `${actions[0].label}.`;
  }

  return `Prepared a ${actions.length}-step execution plan.`;
}

function isUseToolAction(action: AgentAction): action is UseToolAction {
  return action.type === 'use_tool';
}

function transformUseToolAction(
  context: PlannerContext,
  resources: PlannerResources,
  action: UseToolAction
) {
  const params = action.params || {};

  if (action.tool_name === 'navigate') {
    const parsed = NavigateToolSchema.safeParse(params);
    if (!parsed.success) {
      return null;
    }

    const destination = PAGE_DESTINATIONS.find((page) => page.path === parsed.data.path);
    if (!destination) {
      return null;
    }

    return toNavigateAction(
      `navigate-${destination.path.replace(/\W+/g, '-')}`,
      `Open ${destination.label}`,
      `Navigate to the ${destination.label.toLowerCase()} view.`,
      destination.path
    );
  }

  if (action.tool_name === 'pause_agent') {
    if (!canManageCompany(context.role)) {
      return null;
    }

    const parsed = PauseAgentToolSchema.safeParse(params);
    if (!parsed.success) {
      return null;
    }

    const agent = resources.agents.find((item) => item.id === parsed.data.agent_id);
    if (!agent) {
      return null;
    }

    return {
      id: `pause-agent-${agent.id}`,
      type: 'api_request' as const,
      label: `Pause ${agent.name}`,
      description: `Set ${agent.name} to paused status.`,
      endpoint: `/agents/${agent.id}/pause`,
      method: 'POST' as const,
      requires_confirmation: true,
      success_message: `${agent.name} was paused.`,
    };
  }

  if (action.tool_name === 'resume_agent') {
    if (!canManageCompany(context.role)) {
      return null;
    }

    const parsed = ResumeAgentToolSchema.safeParse(params);
    if (!parsed.success) {
      return null;
    }

    const agent = resources.agents.find((item) => item.id === parsed.data.agent_id);
    if (!agent) {
      return null;
    }

    return {
      id: `resume-agent-${agent.id}`,
      type: 'api_request' as const,
      label: `Resume ${agent.name}`,
      description: `Set ${agent.name} back to idle status.`,
      endpoint: `/agents/${agent.id}/resume`,
      method: 'POST' as const,
      requires_confirmation: true,
      success_message: `${agent.name} was resumed.`,
    };
  }

  if (action.tool_name === 'resolve_approval') {
    if (!canManageCompany(context.role)) {
      return null;
    }

    const parsed = ResolveApprovalToolSchema.safeParse(params);
    if (!parsed.success) {
      return null;
    }

    const approval = resources.approvals.find((item) => item.id === parsed.data.approval_id);
    if (!approval) {
      return null;
    }

    return {
      id: `${parsed.data.status}-${approval.id}`,
      type: 'api_request' as const,
      label: `${parsed.data.status === 'approved' ? 'Approve' : 'Reject'} ${approval.reason}`,
      description: `Resolve the pending approval as ${parsed.data.status}.`,
      endpoint: `/approvals/${approval.id}/resolve`,
      method: 'POST' as const,
      body: {
        status: parsed.data.status,
        notes: 'Resolved via Natural Language Control Panel',
      },
      requires_confirmation: true,
      success_message: `Approval marked as ${parsed.data.status}.`,
    };
  }

  if (action.tool_name === 'create_task') {
    if (!canContribute(context.role)) {
      return null;
    }

    const parsed = CreateTaskToolSchema.safeParse(params);
    if (!parsed.success) {
      return null;
    }

    if (parsed.data.assigned_to) {
      const assignedAgent = resources.agents.find((item) => item.id === parsed.data.assigned_to);
      if (!assignedAgent) {
        return null;
      }

      return {
        id: `create-task-${parsed.data.title.toLowerCase().replace(/\W+/g, '-')}`,
        type: 'api_request' as const,
        label: `Create task: ${parsed.data.title}`,
        description: `Create a new task and assign it to ${assignedAgent.name}.`,
        endpoint: `/companies/${context.companyId}/tasks`,
        method: 'POST' as const,
        body: {
          title: parsed.data.title,
          assigned_to: assignedAgent.id,
        },
        requires_confirmation: true,
        success_message: `Task "${parsed.data.title}" created.`,
      };
    }

    return {
      id: `create-task-${parsed.data.title.toLowerCase().replace(/\W+/g, '-')}`,
      type: 'api_request' as const,
      label: `Create task: ${parsed.data.title}`,
      description: 'Create a new task in the backlog.',
      endpoint: `/companies/${context.companyId}/tasks`,
      method: 'POST' as const,
      body: {
        title: parsed.data.title,
      },
      requires_confirmation: true,
      success_message: `Task "${parsed.data.title}" created.`,
    };
  }

  if (action.tool_name === 'create_goal') {
    if (!canContribute(context.role)) {
      return null;
    }

    const parsed = CreateGoalToolSchema.safeParse(params);
    if (!parsed.success) {
      return null;
    }

    return {
      id: `create-goal-${parsed.data.title.toLowerCase().replace(/\W+/g, '-')}`,
      type: 'api_request' as const,
      label: `Create goal: ${parsed.data.title}`,
      description: 'Create a new top-level goal.',
      endpoint: `/companies/${context.companyId}/goals`,
      method: 'POST' as const,
      body: {
        title: parsed.data.title,
      },
      requires_confirmation: true,
      success_message: `Goal "${parsed.data.title}" created.`,
    };
  }

  return null;
}

async function tryPlanNaturalLanguageCommandWithLLM(
  context: PlannerContext,
  input: string,
  resources: PlannerResources
): Promise<
  | {
      status: 'success';
      plan: NLCommandPlan;
    }
  | {
      status: 'fallback';
      reason: PlannerFallbackReason;
      planner: NLCommandPlannerMetadata;
    }
> {
  const runtimeSelection = resolvePlannerRuntimeSelection(resources.company.config);
  if (!runtimeSelection) {
    return {
      status: 'fallback',
      reason: 'llm_unavailable',
      planner: {
        mode: 'rules',
        fallback_reason: 'llm_unavailable',
      },
    };
  }

  try {
    const runtime = runtimeRegistry.getRuntime(runtimeSelection.preferredRuntime, {
      fallbackOrder: runtimeSelection.fallbackOrder,
    });
    const response = await runtime.execute(buildPlannerContext(context, input, resources));

    const actions = response.actions
      .filter(isUseToolAction)
      .map((action) => transformUseToolAction(context, resources, action))
      .filter((action): action is NLCommandPlanAction => action !== null);

    if (actions.length === 0) {
      return {
        status: 'fallback',
        reason: 'invalid_llm_plan',
        planner: {
          mode: 'rules',
          runtime: response.routing?.selected_runtime,
          model: response.routing?.selected_model,
          attempts: response.routing?.attempts,
          fallback_reason: 'invalid_llm_plan',
        },
      };
    }

    return {
      status: 'success',
      plan: {
        source: 'llm',
        original_input: input.trim(),
        summary: buildLLMSummary(actions),
        reasoning: response.thought,
        warnings: [],
        can_execute: true,
        actions,
        planner: {
          mode: 'llm',
          runtime: response.routing?.selected_runtime,
          model: response.routing?.selected_model,
          attempts: response.routing?.attempts,
          fallback_reason: null,
        },
      },
    };
  } catch (error) {
    logger.warn(
      {
        error,
        companyId: context.companyId,
        command: input,
      },
      'Natural language planner failed over to rule-based fallback'
    );
    return {
      status: 'fallback',
      reason: 'llm_failed',
      planner: {
        mode: 'rules',
        fallback_reason: 'llm_failed',
      },
    };
  }
}

function buildRuleBasedPlan(
  context: PlannerContext,
  input: string,
  resources: PlannerResources,
  planner: NLCommandPlannerMetadata
): NLCommandPlan {
  const trimmedInput = input.trim();
  const normalizedInput = normalizeText(trimmedInput);
  const warnings: string[] = [];
  const actions: NLCommandPlanAction[] = [];

  const page = findPageDestination(trimmedInput);
  if (page) {
    actions.push(
      toNavigateAction(
        'navigate-page',
        `Open ${page.label}`,
        `Navigate to the ${page.label.toLowerCase()} view.`,
        page.path
      )
    );
    return {
      source: 'rules',
      original_input: trimmedInput,
      summary: `Open ${page.label}.`,
      reasoning: 'Matched the request to an existing dashboard destination.',
      warnings,
      can_execute: true,
      actions,
      planner,
    };
  }

  if (/(pause|wstrzymaj|zapauzuj)\b/.test(normalizedInput)) {
    if (!canManageCompany(context.role)) {
      warnings.push('Pausing agents requires owner or admin access.');
    } else {
      const agent = selectAgentFromIntent(trimmedInput, resources.agents, ['idle', 'working', 'running', 'in_progress']);
      if (!agent) {
        warnings.push('I could not match that pause request to a single active agent.');
      } else {
        actions.push({
          id: `pause-agent-${agent.id}`,
          type: 'api_request',
          label: `Pause ${agent.name}`,
          description: `Set ${agent.name} to paused status.`,
          endpoint: `/agents/${agent.id}/pause`,
          method: 'POST',
          requires_confirmation: true,
          success_message: `${agent.name} was paused.`,
        });
        actions.push(
          toNavigateAction('navigate-agents', 'Open Agents', 'Navigate to the agents roster after the update.', '/agents')
        );
      }
    }
  } else if (/(resume|wznow|odpauzuj)\b/.test(normalizedInput)) {
    if (!canManageCompany(context.role)) {
      warnings.push('Resuming agents requires owner or admin access.');
    } else {
      const agent = selectAgentFromIntent(trimmedInput, resources.agents, ['paused']);
      if (!agent) {
        warnings.push('I could not match that resume request to a paused agent.');
      } else {
        actions.push({
          id: `resume-agent-${agent.id}`,
          type: 'api_request',
          label: `Resume ${agent.name}`,
          description: `Set ${agent.name} back to idle status.`,
          endpoint: `/agents/${agent.id}/resume`,
          method: 'POST',
          requires_confirmation: true,
          success_message: `${agent.name} was resumed.`,
        });
        actions.push(
          toNavigateAction('navigate-agents', 'Open Agents', 'Navigate to the agents roster after the update.', '/agents')
        );
      }
    }
  } else if (/(approve|zaakceptuj|akceptuj)\b/.test(normalizedInput)) {
    if (!canManageCompany(context.role)) {
      warnings.push('Approvals can only be resolved by owners or admins.');
    } else {
      const approval = selectApprovalFromIntent(trimmedInput, resources.approvals);
      if (!approval) {
        warnings.push('I could not match that approval request to a single pending item.');
      } else {
        actions.push({
          id: `approve-${approval.id}`,
          type: 'api_request',
          label: `Approve ${approval.reason}`,
          description: 'Resolve the pending approval as approved.',
          endpoint: `/approvals/${approval.id}/resolve`,
          method: 'POST',
          body: {
            status: 'approved',
            notes: 'Resolved via Natural Language Control Panel',
          },
          requires_confirmation: true,
          success_message: 'Approval marked as approved.',
        });
        actions.push(
          toNavigateAction('navigate-approvals', 'Open Approvals', 'Navigate to the approvals page after the update.', '/approvals')
        );
      }
    }
  } else if (/(reject|odrzuc)\b/.test(normalizedInput)) {
    if (!canManageCompany(context.role)) {
      warnings.push('Approvals can only be resolved by owners or admins.');
    } else {
      const approval = selectApprovalFromIntent(trimmedInput, resources.approvals);
      if (!approval) {
        warnings.push('I could not match that rejection request to a single pending item.');
      } else {
        actions.push({
          id: `reject-${approval.id}`,
          type: 'api_request',
          label: `Reject ${approval.reason}`,
          description: 'Resolve the pending approval as rejected.',
          endpoint: `/approvals/${approval.id}/resolve`,
          method: 'POST',
          body: {
            status: 'rejected',
            notes: 'Resolved via Natural Language Control Panel',
          },
          requires_confirmation: true,
          success_message: 'Approval marked as rejected.',
        });
        actions.push(
          toNavigateAction('navigate-approvals', 'Open Approvals', 'Navigate to the approvals page after the update.', '/approvals')
        );
      }
    }
  } else if (/(create|add|new|utworz|dodaj)\s+(task|zadanie)\b/.test(normalizedInput)) {
    if (!canContribute(context.role)) {
      warnings.push('Creating tasks requires owner, admin, or member access.');
    } else {
      const rawTitle = extractTail(trimmedInput, [
        /(?:create|add|new)\s+(?:task)\s+(.+)$/i,
        /(?:utworz|dodaj)\s+(?:zadanie)\s+(.+)$/i,
      ]);
      if (!rawTitle) {
        warnings.push('I need a task title to build this plan.');
      } else {
        const { title, assigneeQuery } = extractAssignee(rawTitle);
        const assignedAgent = assigneeQuery
          ? findBestMatch(assigneeQuery, resources.agents, (agent) => `${agent.name} ${agent.role} ${agent.title || ''}`)
          : null;

        if (assigneeQuery && !assignedAgent) {
          warnings.push(`I could not find an agent matching "${assigneeQuery}". The task will stay unassigned.`);
        }

        actions.push({
          id: 'create-task',
          type: 'api_request',
          label: `Create task: ${title}`,
          description: assignedAgent
            ? `Create a new task and assign it to ${assignedAgent.name}.`
            : 'Create a new task in the backlog.',
          endpoint: `/companies/${context.companyId}/tasks`,
          method: 'POST',
          body: {
            title,
            ...(assignedAgent ? { assigned_to: assignedAgent.id } : {}),
          },
          requires_confirmation: true,
          success_message: `Task "${title}" created.`,
        });
        actions.push(
          toNavigateAction('navigate-tasks', 'Open Tasks', 'Navigate to the tasks page after creation.', '/tasks')
        );
      }
    }
  } else if (/(create|add|new|utworz|dodaj)\s+(goal|cel)\b/.test(normalizedInput)) {
    if (!canContribute(context.role)) {
      warnings.push('Creating goals requires owner, admin, or member access.');
    } else {
      const title = extractTail(trimmedInput, [
        /(?:create|add|new)\s+(?:goal)\s+(.+)$/i,
        /(?:utworz|dodaj)\s+(?:cel)\s+(.+)$/i,
      ]);
      if (!title) {
        warnings.push('I need a goal title to build this plan.');
      } else {
        actions.push({
          id: 'create-goal',
          type: 'api_request',
          label: `Create goal: ${title}`,
          description: 'Create a new top-level goal.',
          endpoint: `/companies/${context.companyId}/goals`,
          method: 'POST',
          body: {
            title,
          },
          requires_confirmation: true,
          success_message: `Goal "${title}" created.`,
        });
        actions.push(
          toNavigateAction('navigate-goals', 'Open Goals', 'Navigate to the goals page after creation.', '/goals')
        );
      }
    }
  }

  if (actions.length === 0) {
    warnings.push('I could not turn that request into a safe execution plan yet.');
    warnings.push('Try a direct command such as "pause Ada", "create task Prepare launch doc", or "open approvals".');
  }

  return {
    source: 'rules',
    original_input: trimmedInput,
    summary: actions.length > 0 ? `Prepared a ${actions.length}-step execution plan.` : 'No executable plan found.',
    reasoning:
      actions.length > 0
        ? 'Matched the request against safe dashboard actions and existing company records.'
        : 'The parser only enables commands it can map to explicit dashboard actions.',
    warnings,
    can_execute: actions.length > 0,
    actions,
    planner,
  };
}

export async function planNaturalLanguageCommand(
  context: PlannerContext,
  input: string
): Promise<NLCommandPlan> {
  const resources = await loadPlannerResources(context.companyId, context.role);
  const llmAttempt = await tryPlanNaturalLanguageCommandWithLLM(context, input, resources);
  if (llmAttempt.status === 'success') {
    return llmAttempt.plan;
  }

  return buildRuleBasedPlan(context, input, resources, llmAttempt.planner);
}
