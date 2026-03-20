export type ReplayEvent = {
  id: string;
  type: 'heartbeat' | 'audit' | 'message' | 'session';
  action: string;
  timestamp: string;
  summary: string;
  task_id?: string | null;
  task_title?: string | null;
  status?: string | null;
  direction?: 'inbound' | 'outbound';
  duration_ms?: number | null;
  cost_usd?: number | string | null;
  details?: Record<string, any>;
};

export type ReplayRoutingDetails = {
  selected_runtime: string;
  selected_model: string;
  attempts: Array<{
    runtime: string;
    model: string;
    status: 'success' | 'fallback' | 'failed';
    reason?: string;
  }>;
};

export type ReplayFilters = {
  applied?: {
    task_id?: string | null;
    types?: ReplayEvent['type'][];
  };
  available_types?: ReplayEvent['type'][];
  tasks?: Array<{
    task_id: string;
    task_title: string;
    event_count: number;
  }>;
};

export type ReplayResponse = {
  items: ReplayEvent[];
  filters?: ReplayFilters;
};

export type ReplayDiffSide = {
  task_id: string;
  task_title: string;
  event_count: number;
  total_duration_ms: number;
  total_cost_usd: number;
  first_event_at: string | null;
  last_event_at: string | null;
  type_counts: Record<ReplayEvent['type'], number>;
  highlights: string[];
};

export type ReplayDiffResponse = {
  left: ReplayDiffSide;
  right: ReplayDiffSide;
  delta: {
    event_count: number;
    total_duration_ms: number;
    total_cost_usd: number;
  };
};

export type ReplayForkResponse = {
  ok: true;
  task_id: string;
  task_title: string;
  source_task_id: string;
  source_event_id: string;
  restored_message_count: number;
  seeded_session: boolean;
  prompt_override_applied: boolean;
};

export type FailureExplanationResponse = {
  target_event: {
    id: string;
    action: string;
    timestamp: string;
    task_id: string | null;
    task_title: string | null;
    summary: string;
  };
  explanation: {
    headline: string;
    summary: string;
    likely_cause: string;
    evidence: string[];
    recommended_actions: string[];
    severity: 'high' | 'medium' | 'low';
  };
  planner: {
    mode: 'llm' | 'rules';
    runtime?: string;
    model?: string;
    fallback_reason?:
      | 'llm_unavailable'
      | 'llm_failed'
      | 'invalid_llm_output'
      | null;
  };
};

export const playbackSpeeds = [1, 2, 4];
export const replayEventTypes: ReplayEvent['type'][] = [
  'heartbeat',
  'audit',
  'message',
  'session',
];

export function formatReplayTimestamp(value: string) {
  return new Date(value).toLocaleString();
}

export function formatCurrency(value: number | string | null | undefined) {
  if (value === null || value === undefined || value === '') {
    return '$0.00';
  }

  const numericValue = typeof value === 'string' ? Number(value) : value;
  if (Number.isNaN(numericValue)) {
    return '$0.00';
  }

  return `$${numericValue.toFixed(2)}`;
}

export function getReplayRouting(
  details?: Record<string, any> | null
): ReplayRoutingDetails | null {
  const routing = details?.llm_routing;
  if (!routing || typeof routing !== 'object') {
    return null;
  }

  if (
    typeof routing.selected_runtime !== 'string' ||
    typeof routing.selected_model !== 'string'
  ) {
    return null;
  }

  const attempts = Array.isArray(routing.attempts) ? routing.attempts : [];
  return {
    selected_runtime: routing.selected_runtime,
    selected_model: routing.selected_model,
    attempts: attempts.filter(
      (attempt: { runtime?: unknown; model?: unknown } | null | undefined) =>
        attempt &&
        typeof attempt.runtime === 'string' &&
        typeof attempt.model === 'string'
    ) as ReplayRoutingDetails['attempts'],
  };
}

export function getFallbackCount(routing: ReplayRoutingDetails | null) {
  if (!routing) {
    return 0;
  }

  return routing.attempts.filter((attempt) => attempt.status === 'fallback')
    .length;
}

export function parseReplayTypes(value: string | null): ReplayEvent['type'][] {
  if (!value) {
    return [];
  }

  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry): entry is ReplayEvent['type'] =>
      replayEventTypes.includes(entry as ReplayEvent['type'])
    );
}

export function isReplayFailureEvent(event: ReplayEvent | null) {
  if (!event) {
    return false;
  }

  const action = event.action.toLowerCase();
  const status =
    typeof event.status === 'string' ? event.status.toLowerCase() : '';
  const summary = event.summary.toLowerCase();
  const error =
    typeof event.details?.error === 'string'
      ? event.details.error.toLowerCase()
      : '';

  return (
    status === 'error' ||
    status === 'blocked' ||
    status === 'budget_exceeded' ||
    /(error|failed|timeout|blocked|budget_exceeded)/.test(action) ||
    /(error|failed|timeout|exception)/.test(summary) ||
    Boolean(error)
  );
}
