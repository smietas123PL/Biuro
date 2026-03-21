import { z } from 'zod';
import { db } from '../db/client.js';
import { defaultModelsByRuntime } from '../runtime/defaultModels.js';
import {
  extractCompanyRuntimeSettings,
  isRuntimeName,
  type RuntimeName,
} from '../runtime/preferences.js';
import { runtimeRegistry } from '../runtime/registry.js';
import type { AgentAction, AgentContext, AgentResponse } from '../types/agent.js';
import { logger } from '../utils/logger.js';

const DEFAULT_TOTAL_VOTERS = 3;
const DEFAULT_MIN_APPROVALS = 2;
const PAYMENT_KEYWORD_PATTERN =
  /\b(payment|pay|payout|invoice|refund|charge|billing|transfer|withdraw|wire|bank|stripe|wallet)\b/i;

const ConsensusVoteSchema = z.object({
  approve: z.boolean(),
  confidence: z.enum(['high', 'medium', 'low']).default('low'),
  rationale: z
    .string()
    .trim()
    .min(1)
    .max(400)
    .default('Consensus runtime did not provide a detailed rationale.'),
  risk_flags: z.array(z.string().trim().min(1).max(80)).max(10).default([]),
});

type ConsensusVotePayload = z.infer<typeof ConsensusVoteSchema>;

type CompanyConsensusConfig = {
  name: string;
  mission: string | null;
  config: unknown;
};

type ConsensusTool = {
  id?: string;
  name: string;
  description?: string | null;
  type?: string;
  config?: unknown;
};

type ConsensusDefinition = {
  required: boolean;
  source: 'tool_config' | 'heuristic' | 'none';
  decisionType: string;
  minimumApprovals: number;
  totalVoters: number;
  requestedRuntimes: RuntimeName[];
  fallbackToApproval: boolean;
  reason: string;
};

export type CriticalToolConsensusVote = {
  runtime: RuntimeName;
  model: string;
  approve: boolean;
  confidence: 'high' | 'medium' | 'low';
  rationale: string;
  risk_flags: string[];
  error: string | null;
};

export type CriticalToolConsensusResult = {
  required: boolean;
  accepted: boolean;
  approvals: number;
  minimumApprovals: number;
  totalVotes: number;
  decisionType: string | null;
  source: 'tool_config' | 'heuristic' | 'none';
  fallbackToApproval: boolean;
  reason: string;
  votes: CriticalToolConsensusVote[];
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

function asPositiveInteger(value: unknown): number | null {
  const numeric = Number(value);
  return Number.isInteger(numeric) && numeric > 0 ? numeric : null;
}

function asNonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : null;
}

function parseRequestedRuntimes(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  const unique = new Set<RuntimeName>();
  for (const item of value) {
    if (isRuntimeName(item)) {
      unique.add(item);
    }
  }

  return Array.from(unique);
}

function normalizeTextForMatch(value: unknown) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ');
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

function getActionThought(action: AgentAction) {
  return action.type === 'continue' ? action.thought : null;
}

function isLikelyPaymentTool(tool: ConsensusTool) {
  const config = asRecord(tool.config);
  const candidates = [
    tool.name,
    tool.description,
    config.url,
    config.endpoint,
    config.path,
    config.provider,
    ...(Array.isArray(config.tags) ? config.tags : []),
  ];

  return candidates.some((value) =>
    PAYMENT_KEYWORD_PATTERN.test(normalizeTextForMatch(value))
  );
}

function getConsensusDefinition(tool: ConsensusTool): ConsensusDefinition {
  const config = asRecord(tool.config);
  const governance = asRecord(config.governance);
  const consensus = asRecord(governance.consensus ?? config.consensus);
  const critical =
    asBoolean(governance.critical) ?? asBoolean(config.critical) ?? false;

  if (critical || (asBoolean(consensus.enabled) ?? false)) {
    return {
      required: true,
      source: 'tool_config',
      decisionType:
        asNonEmptyString(consensus.decision_type) ??
        'critical_tool_execution',
      minimumApprovals:
        asPositiveInteger(consensus.min_approvals) ?? DEFAULT_MIN_APPROVALS,
      totalVoters:
        asPositiveInteger(consensus.total_voters) ?? DEFAULT_TOTAL_VOTERS,
      requestedRuntimes: parseRequestedRuntimes(
        consensus.voter_runtimes ?? consensus.runtimes
      ),
      fallbackToApproval:
        asBoolean(consensus.fallback_to_approval) ?? true,
      reason: `Tool ${tool.name} requires multi-model consensus.`,
    };
  }

  if (isLikelyPaymentTool(tool)) {
    return {
      required: true,
      source: 'heuristic',
      decisionType: 'payment_execution',
      minimumApprovals: DEFAULT_MIN_APPROVALS,
      totalVoters: DEFAULT_TOTAL_VOTERS,
      requestedRuntimes: [],
      fallbackToApproval: true,
      reason: `Tool ${tool.name} looks like a payment or transfer action.`,
    };
  }

  return {
    required: false,
    source: 'none',
    decisionType: 'critical_tool_execution',
    minimumApprovals: DEFAULT_MIN_APPROVALS,
    totalVoters: DEFAULT_TOTAL_VOTERS,
    requestedRuntimes: [],
    fallbackToApproval: false,
    reason: 'Consensus not required for this tool.',
  };
}

function resolveConsensusRuntimes(
  definition: ConsensusDefinition,
  companyConfig: unknown
) {
  const availableRuntimes = runtimeRegistry.getAvailableRuntimeNames();
  const runtimeSettings = extractCompanyRuntimeSettings(companyConfig);
  const ordered = new Set<RuntimeName>();

  for (const runtime of definition.requestedRuntimes) {
    if (availableRuntimes.includes(runtime)) {
      ordered.add(runtime);
    }
  }

  if (availableRuntimes.includes(runtimeSettings.primaryRuntime)) {
    ordered.add(runtimeSettings.primaryRuntime);
  }
  for (const runtime of runtimeSettings.fallbackOrder) {
    if (availableRuntimes.includes(runtime)) {
      ordered.add(runtime);
    }
  }
  for (const runtime of availableRuntimes) {
    ordered.add(runtime);
  }

  return Array.from(ordered).slice(0, definition.totalVoters);
}

function buildConsensusContext(args: {
  company: CompanyConsensusConfig;
  task: { id: string; title: string; description?: string | null };
  tool: ConsensusTool;
  params: Record<string, unknown>;
  definition: ConsensusDefinition;
  runtime: RuntimeName;
}): AgentContext {
  const { company, task, tool, params, definition, runtime } = args;
  const toolConfig = asRecord(tool.config);

  return {
    company_name: company.name || 'Consensus Council',
    company_mission:
      company.mission || 'Approve only critical tool executions that are safe.',
    agent_name: `Consensus voter (${runtime})`,
    agent_role: 'Critical action reviewer',
    agent_model: defaultModelsByRuntime[runtime],
    current_task: {
      title: `Consensus vote for ${tool.name}`,
      description:
        'Review a critical tool invocation and decide whether execution should proceed.',
    },
    goal_hierarchy: [definition.decisionType, `task:${task.id}`],
    additional_context: [
      'Return exactly one continue action and no other action types.',
      'Put the same JSON object in the top-level thought field and continue.thought.',
      'Decision JSON schema:',
      '{"approve":true,"confidence":"high|medium|low","rationale":"<=240 chars","risk_flags":["machine_readable_flag"]}',
      'Reject when the request is ambiguous or missing critical payment details.',
      `Decision type: ${definition.decisionType}`,
      `Tool name: ${tool.name}`,
      `Tool description: ${tool.description ?? 'n/a'}`,
      `Tool type: ${tool.type ?? 'n/a'}`,
      `Tool config excerpt: ${JSON.stringify({
        url: toolConfig.url ?? null,
        provider: toolConfig.provider ?? null,
      })}`,
      `Invocation params: ${JSON.stringify(params)}`,
      `Task title: ${task.title}`,
      `Task description: ${task.description ?? 'n/a'}`,
    ].join('\n'),
    history: [
      {
        role: 'user',
        content:
          'Vote on whether this critical tool invocation should execute right now. Fail closed when uncertain.',
      },
    ],
  };
}

function parseConsensusVote(response: AgentResponse): ConsensusVotePayload {
  const rawCandidates = [
    response.thought,
    ...response.actions.map((action) => getActionThought(action)),
  ].filter((value): value is string => typeof value === 'string');

  for (const candidate of rawCandidates) {
    const rawJson = extractJsonObject(candidate);
    if (!rawJson) {
      continue;
    }

    try {
      const parsed = ConsensusVoteSchema.safeParse(JSON.parse(rawJson));
      if (parsed.success) {
        return parsed.data;
      }
    } catch {
      continue;
    }
  }

  throw new Error('Consensus runtime did not return a valid vote payload');
}

async function loadCompanyConsensusConfig(companyId: string) {
  const result = await db.query(
    'SELECT name, mission, config FROM companies WHERE id = $1',
    [companyId]
  );

  return (result.rows[0] as CompanyConsensusConfig | undefined) ?? {
    name: 'Consensus Council',
    mission: null,
    config: {},
  };
}

async function collectConsensusVote(args: {
  company: CompanyConsensusConfig;
  task: { id: string; title: string; description?: string | null };
  tool: ConsensusTool;
  params: Record<string, unknown>;
  definition: ConsensusDefinition;
  runtime: RuntimeName;
}): Promise<CriticalToolConsensusVote> {
  const { runtime } = args;

  try {
    const response = await runtimeRegistry
      .getDirectRuntime(runtime)
      .execute(buildConsensusContext(args));
    const vote = parseConsensusVote(response);

    return {
      runtime,
      model: defaultModelsByRuntime[runtime],
      approve: vote.approve,
      confidence: vote.confidence,
      rationale: vote.rationale,
      risk_flags: vote.risk_flags,
      error: null,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn(
      { runtime, tool: args.tool.name, error: message },
      'Consensus vote collection failed'
    );
    return {
      runtime,
      model: defaultModelsByRuntime[runtime],
      approve: false,
      confidence: 'low',
      rationale: `Vote unavailable for ${runtime}.`,
      risk_flags: ['runtime_unavailable'],
      error: message,
    };
  }
}

export function requiresCriticalConsensus(tool: ConsensusTool) {
  return getConsensusDefinition(tool);
}

export async function evaluateCriticalToolConsensus(args: {
  companyId: string;
  task: { id: string; title: string; description?: string | null };
  tool: ConsensusTool;
  params?: Record<string, unknown>;
}): Promise<CriticalToolConsensusResult> {
  const definition = getConsensusDefinition(args.tool);
  if (!definition.required) {
    return {
      required: false,
      accepted: true,
      approvals: 0,
      minimumApprovals: definition.minimumApprovals,
      totalVotes: 0,
      decisionType: null,
      source: 'none',
      fallbackToApproval: false,
      reason: definition.reason,
      votes: [],
    };
  }

  const company = await loadCompanyConsensusConfig(args.companyId);
  const runtimes = resolveConsensusRuntimes(definition, company.config);
  if (runtimes.length < definition.totalVoters) {
    return {
      required: true,
      accepted: false,
      approvals: 0,
      minimumApprovals: definition.minimumApprovals,
      totalVotes: runtimes.length,
      decisionType: definition.decisionType,
      source: definition.source,
      fallbackToApproval: definition.fallbackToApproval,
      reason: `Consensus requires ${definition.totalVoters} distinct runtimes, but only ${runtimes.length} are available.`,
      votes: [],
    };
  }

  const params = args.params ?? {};
  const votes = await Promise.all(
    runtimes.map((runtime) =>
      collectConsensusVote({
        company,
        task: args.task,
        tool: args.tool,
        params,
        definition,
        runtime,
      })
    )
  );
  const approvals = votes.filter((vote) => vote.approve).length;
  const accepted = approvals >= definition.minimumApprovals;

  return {
    required: true,
    accepted,
    approvals,
    minimumApprovals: definition.minimumApprovals,
    totalVotes: votes.length,
    decisionType: definition.decisionType,
    source: definition.source,
    fallbackToApproval: definition.fallbackToApproval,
    reason: accepted
      ? `Consensus approved by ${approvals}/${votes.length} runtimes.`
      : `Consensus rejected with ${approvals}/${votes.length} approvals.`,
    votes,
  };
}
