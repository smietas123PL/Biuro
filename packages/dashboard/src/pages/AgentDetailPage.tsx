import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useApi } from '../hooks/useApi';
import {
  Bot,
  Activity,
  Wrench,
  Shield,
  PauseCircle,
  PlayCircle,
} from 'lucide-react';
import { getAuthToken, getSelectedCompanyId } from '../lib/session';
import { TraceLinkCallout } from '../components/TraceLinkCallout';

type ReplayEvent = {
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

type ReplayRoutingDetails = {
  selected_runtime: string;
  selected_model: string;
  attempts: Array<{
    runtime: string;
    model: string;
    status: 'success' | 'fallback' | 'failed';
    reason?: string;
  }>;
};

type ReplayFilters = {
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

type ReplayResponse = {
  items: ReplayEvent[];
  filters?: ReplayFilters;
};

type ReplayDiffSide = {
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

type ReplayDiffResponse = {
  left: ReplayDiffSide;
  right: ReplayDiffSide;
  delta: {
    event_count: number;
    total_duration_ms: number;
    total_cost_usd: number;
  };
};

type ReplayForkResponse = {
  ok: true;
  task_id: string;
  task_title: string;
  source_task_id: string;
  source_event_id: string;
  restored_message_count: number;
  seeded_session: boolean;
  prompt_override_applied: boolean;
};

type FailureExplanationResponse = {
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

const playbackSpeeds = [1, 2, 4];
const replayEventTypes: ReplayEvent['type'][] = [
  'heartbeat',
  'audit',
  'message',
  'session',
];

function formatReplayTimestamp(value: string) {
  return new Date(value).toLocaleString();
}

function formatCurrency(value: number | string | null | undefined) {
  if (value === null || value === undefined || value === '') {
    return '$0.00';
  }

  const numericValue = typeof value === 'string' ? Number(value) : value;
  if (Number.isNaN(numericValue)) {
    return '$0.00';
  }

  return `$${numericValue.toFixed(2)}`;
}

function getReplayRouting(
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

function getFallbackCount(routing: ReplayRoutingDetails | null) {
  if (!routing) {
    return 0;
  }

  return routing.attempts.filter((attempt) => attempt.status === 'fallback')
    .length;
}

function parseReplayTypes(value: string | null): ReplayEvent['type'][] {
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

function isReplayFailureEvent(event: ReplayEvent | null) {
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

export default function AgentDetailPage() {
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const { request, lastTrace } = useApi();
  const [agent, setAgent] = useState<any>(null);
  const [budget, setBudget] = useState<any>(null);
  const [replayEvents, setReplayEvents] = useState<ReplayEvent[]>([]);
  const [replayFilters, setReplayFilters] = useState<ReplayFilters | null>(
    null
  );
  const [currentReplayIndex, setCurrentReplayIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const replayTaskParam = searchParams.get('task_id')?.trim() || 'all';
  const replayEventParam = searchParams.get('event_id')?.trim() || null;
  const replayTypesParam = searchParams.get('types');
  const [selectedTaskId, setSelectedTaskId] = useState(replayTaskParam);
  const [selectedTypes, setSelectedTypes] = useState<ReplayEvent['type'][]>(
    () => parseReplayTypes(replayTypesParam)
  );
  const [isExporting, setIsExporting] = useState(false);
  const [exportStatus, setExportStatus] = useState<string | null>(null);
  const [forkPrompt, setForkPrompt] = useState('');
  const [isForking, setIsForking] = useState(false);
  const [forkStatus, setForkStatus] = useState<string | null>(null);
  const [forkResult, setForkResult] = useState<ReplayForkResponse | null>(null);
  const [isExplainingFailure, setIsExplainingFailure] = useState(false);
  const [failureExplanation, setFailureExplanation] =
    useState<FailureExplanationResponse | null>(null);
  const [failureExplanationStatus, setFailureExplanationStatus] = useState<
    string | null
  >(null);
  const [compareLeftTaskId, setCompareLeftTaskId] = useState('');
  const [compareRightTaskId, setCompareRightTaskId] = useState('');
  const [replayDiff, setReplayDiff] = useState<ReplayDiffResponse | null>(null);

  const replayQuery = (() => {
    const params = new URLSearchParams({ limit: '120' });
    if (selectedTaskId !== 'all') {
      params.set('task_id', selectedTaskId);
    }
    if (selectedTypes.length > 0) {
      params.set('types', selectedTypes.join(','));
    }
    return params.toString();
  })();

  const replayDiffQuery = (() => {
    if (
      !compareLeftTaskId ||
      !compareRightTaskId ||
      compareLeftTaskId === compareRightTaskId
    ) {
      return null;
    }

    const params = new URLSearchParams({
      left_task_id: compareLeftTaskId,
      right_task_id: compareRightTaskId,
      limit: '120',
    });

    if (selectedTypes.length > 0) {
      params.set('types', selectedTypes.join(','));
    }

    return params.toString();
  })();
  const availableTypes = replayFilters?.available_types?.length
    ? replayFilters.available_types
    : replayEventTypes;
  const taskOptions = replayFilters?.tasks ?? [];
  const canCompareTasks = taskOptions.length >= 2;

  useEffect(() => {
    const fetchAgent = async () => {
      const data = await request(`/agents/${id}`);
      setAgent(data);

      const budgetData = await request(`/agents/${id}/budgets`);
      setBudget(
        Array.isArray(budgetData) ? (budgetData[0] ?? null) : budgetData
      );
    };

    void fetchAgent();
  }, [id, request]);

  useEffect(() => {
    setSelectedTaskId(replayTaskParam);
    setSelectedTypes(parseReplayTypes(replayTypesParam));
    setForkPrompt('');
    setForkStatus(null);
    setForkResult(null);
    setFailureExplanation(null);
    setFailureExplanationStatus(null);
    setCompareLeftTaskId('');
    setCompareRightTaskId('');
    setReplayDiff(null);
  }, [id, replayTaskParam, replayTypesParam]);

  useEffect(() => {
    const fetchReplay = async () => {
      const replayData = (await request(
        `/agents/${id}/replay?${replayQuery}`
      )) as ReplayResponse;
      setReplayEvents(Array.isArray(replayData?.items) ? replayData.items : []);
      setReplayFilters(replayData?.filters ?? null);
      setCurrentReplayIndex(0);
      setIsPlaying(false);
    };

    void fetchReplay();
  }, [id, replayQuery, request, selectedTaskId, selectedTypes]);

  useEffect(() => {
    if (taskOptions.length < 2) {
      setCompareLeftTaskId(taskOptions[0]?.task_id ?? '');
      setCompareRightTaskId('');
      setReplayDiff(null);
      return;
    }

    setCompareLeftTaskId((current) => {
      if (current && taskOptions.some((task) => task.task_id === current)) {
        return current;
      }
      return taskOptions[0]?.task_id ?? '';
    });

    setCompareRightTaskId((current) => {
      if (
        current &&
        taskOptions.some((task) => task.task_id === current) &&
        current !== (taskOptions[0]?.task_id ?? '')
      ) {
        return current;
      }
      return taskOptions[1]?.task_id ?? '';
    });
  }, [taskOptions]);

  useEffect(() => {
    if (!replayDiffQuery) {
      setReplayDiff(null);
      return;
    }

    const fetchReplayDiff = async () => {
      const diffData = (await request(
        `/agents/${id}/replay/diff?${replayDiffQuery}`
      )) as ReplayDiffResponse;
      setReplayDiff(diffData);
    };

    void fetchReplayDiff();
  }, [id, replayDiffQuery, request]);

  useEffect(() => {
    if (!isPlaying || replayEvents.length === 0) {
      return;
    }

    if (currentReplayIndex >= replayEvents.length - 1) {
      setIsPlaying(false);
      return;
    }

    const timeout = window.setTimeout(
      () => {
        setCurrentReplayIndex((index) =>
          Math.min(index + 1, replayEvents.length - 1)
        );
      },
      Math.max(350, 1400 / playbackSpeed)
    );

    return () => window.clearTimeout(timeout);
  }, [currentReplayIndex, isPlaying, playbackSpeed, replayEvents]);

  useEffect(() => {
    if (replayEvents.length === 0) {
      return;
    }

    if (!replayEventParam) {
      setCurrentReplayIndex(0);
      return;
    }

    const focusedIndex = replayEvents.findIndex(
      (event) => event.id === replayEventParam
    );
    setCurrentReplayIndex(focusedIndex >= 0 ? focusedIndex : 0);
    setIsPlaying(false);
  }, [replayEventParam, replayEvents]);

  if (!agent) return <div className="p-8">Loading...</div>;

  const hasReplay = replayEvents.length > 0;
  const hasReplayFilters = selectedTaskId !== 'all' || selectedTypes.length > 0;
  const clampedReplayIndex = hasReplay
    ? Math.min(currentReplayIndex, replayEvents.length - 1)
    : 0;
  const currentReplayEvent = hasReplay
    ? replayEvents[clampedReplayIndex]
    : null;
  const currentReplayRouting = getReplayRouting(currentReplayEvent?.details);
  const revealedEvents = hasReplay
    ? replayEvents.slice(0, clampedReplayIndex + 1).reverse()
    : [];

  const handleExportReport = async () => {
    setIsExporting(true);
    setExportStatus(null);

    try {
      const token = getAuthToken();
      const companyId = getSelectedCompanyId();
      const response = await fetch(
        `/api/agents/${id}/replay/report?${replayQuery}`,
        {
          headers: {
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            ...(companyId ? { 'x-company-id': companyId } : {}),
          },
        }
      );

      if (!response.ok) {
        throw new Error('Replay report export failed.');
      }

      const blob = await response.blob();
      const objectUrl = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = objectUrl;
      link.download = `agent-replay-${id}.html`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(objectUrl);
      setExportStatus('Replay report downloaded.');
    } catch (err) {
      setExportStatus(
        err instanceof Error ? err.message : 'Replay report export failed.'
      );
    } finally {
      setIsExporting(false);
    }
  };

  const handleForkReplay = async () => {
    if (!currentReplayEvent?.id || !currentReplayEvent.task_id) {
      return;
    }

    setIsForking(true);
    setForkStatus(null);
    setForkResult(null);

    try {
      const result = (await request(`/agents/${id}/replay/fork`, {
        method: 'POST',
        body: JSON.stringify({
          replay_event_id: currentReplayEvent.id,
          task_id: selectedTaskId !== 'all' ? selectedTaskId : undefined,
          types: selectedTypes.length > 0 ? selectedTypes : undefined,
          prompt_override: forkPrompt.trim() || undefined,
        }),
      })) as ReplayForkResponse;

      setForkResult(result);
      setForkStatus(`Fork created as ${result.task_title}.`);
    } catch (err) {
      setForkStatus(err instanceof Error ? err.message : 'Replay fork failed.');
    } finally {
      setIsForking(false);
    }
  };

  const handleExplainFailure = async () => {
    setIsExplainingFailure(true);
    setFailureExplanationStatus(null);
    setFailureExplanation(null);

    try {
      const result = (await request(`/agents/${id}/failure-explanation`, {
        method: 'POST',
        body: JSON.stringify({
          task_id: selectedTaskId !== 'all' ? selectedTaskId : undefined,
          event_id: isReplayFailureEvent(currentReplayEvent)
            ? currentReplayEvent?.id
            : undefined,
          types: selectedTypes.length > 0 ? selectedTypes : undefined,
        }),
      })) as FailureExplanationResponse;

      setFailureExplanation(result);
      setFailureExplanationStatus('Failure explanation ready.');
    } catch (err) {
      setFailureExplanationStatus(
        err instanceof Error ? err.message : 'Failure explanation failed.'
      );
    } finally {
      setIsExplainingFailure(false);
    }
  };

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex justify-between items-start">
        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <Bot className="w-8 h-8 text-primary" />
            <h2 className="text-3xl font-bold tracking-tight">{agent.name}</h2>
            <span
              className={`px-2 py-1 rounded-md text-xs font-medium ${
                agent.status === 'active'
                  ? 'bg-green-500/10 text-green-500'
                  : 'bg-yellow-500/10 text-yellow-500'
              }`}
            >
              {agent.status.toUpperCase()}
            </span>
          </div>
          <p className="text-muted-foreground">{agent.role}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="md:col-span-2 space-y-6">
          <div className="border rounded-xl bg-card p-6 space-y-4">
            <h3 className="font-semibold flex items-center gap-2">
              <Activity className="w-4 h-4 text-primary" />
              Live Agent Replay
            </h3>

            <div className="rounded-xl border bg-muted/20 p-4 space-y-4">
              <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
                <label className="space-y-2 text-sm">
                  <span className="block text-xs uppercase tracking-[0.16em] text-muted-foreground">
                    Session scope
                  </span>
                  <select
                    aria-label="Replay task filter"
                    value={selectedTaskId}
                    onChange={(event) => setSelectedTaskId(event.target.value)}
                    className="min-w-[220px] rounded-lg border bg-card px-3 py-2 text-sm"
                  >
                    <option value="all">All tasks</option>
                    {taskOptions.map((task) => (
                      <option key={task.task_id} value={task.task_id}>
                        {task.task_title} ({task.event_count})
                      </option>
                    ))}
                  </select>
                </label>

                {hasReplayFilters ? (
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={handleExportReport}
                      className="rounded-lg border px-3 py-2 text-sm hover:bg-accent transition-colors"
                      disabled={isExporting}
                    >
                      {isExporting ? 'Exporting...' : 'Export report'}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedTaskId('all');
                        setSelectedTypes([]);
                      }}
                      className="rounded-lg border px-3 py-2 text-sm hover:bg-accent transition-colors"
                    >
                      Clear filters
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={handleExportReport}
                    className="rounded-lg border px-3 py-2 text-sm hover:bg-accent transition-colors"
                    disabled={isExporting}
                  >
                    {isExporting ? 'Exporting...' : 'Export report'}
                  </button>
                )}
              </div>

              <div className="space-y-2">
                <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
                  Event types
                </p>
                <div className="flex flex-wrap gap-2">
                  {availableTypes.map((type) => {
                    const selected = selectedTypes.includes(type);
                    return (
                      <button
                        key={type}
                        type="button"
                        onClick={() => {
                          setSelectedTypes((current) =>
                            current.includes(type)
                              ? current.filter((value) => value !== type)
                              : [...current, type]
                          );
                        }}
                        className={`rounded-full border px-3 py-1.5 text-xs uppercase tracking-[0.12em] transition-colors ${
                          selected
                            ? 'bg-primary text-primary-foreground border-primary'
                            : 'hover:bg-accent'
                        }`}
                      >
                        {type}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            {exportStatus ? (
              <p className="text-sm text-muted-foreground">{exportStatus}</p>
            ) : null}

            <div className="rounded-xl border bg-muted/20 p-4 space-y-4">
              <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
                <div>
                  <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
                    Timeline diff
                  </p>
                  <p className="text-sm text-muted-foreground">
                    Compare two task sessions for this agent using the current
                    event-type filter.
                  </p>
                </div>
              </div>

              {canCompareTasks ? (
                <>
                  <div className="grid gap-4 md:grid-cols-2">
                    <label className="space-y-2 text-sm">
                      <span className="block text-xs uppercase tracking-[0.16em] text-muted-foreground">
                        Left task
                      </span>
                      <select
                        aria-label="Replay diff left task"
                        value={compareLeftTaskId}
                        onChange={(event) =>
                          setCompareLeftTaskId(event.target.value)
                        }
                        className="w-full rounded-lg border bg-card px-3 py-2 text-sm"
                      >
                        {taskOptions.map((task) => (
                          <option key={task.task_id} value={task.task_id}>
                            {task.task_title}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="space-y-2 text-sm">
                      <span className="block text-xs uppercase tracking-[0.16em] text-muted-foreground">
                        Right task
                      </span>
                      <select
                        aria-label="Replay diff right task"
                        value={compareRightTaskId}
                        onChange={(event) =>
                          setCompareRightTaskId(event.target.value)
                        }
                        className="w-full rounded-lg border bg-card px-3 py-2 text-sm"
                      >
                        {taskOptions.map((task) => (
                          <option key={task.task_id} value={task.task_id}>
                            {task.task_title}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>

                  {replayDiff ? (
                    <div className="grid gap-4 md:grid-cols-3">
                      <div className="rounded-xl border bg-card p-4 space-y-2">
                        <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
                          Event delta
                        </p>
                        <p className="text-2xl font-semibold">
                          {replayDiff.delta.event_count}
                        </p>
                        <p className="text-sm text-muted-foreground">
                          {replayDiff.left.task_title} vs{' '}
                          {replayDiff.right.task_title}
                        </p>
                      </div>

                      <div className="rounded-xl border bg-card p-4 space-y-2">
                        <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
                          Duration delta
                        </p>
                        <p className="text-2xl font-semibold">
                          {replayDiff.delta.total_duration_ms} ms
                        </p>
                        <p className="text-sm text-muted-foreground">
                          {replayDiff.left.total_duration_ms} ms vs{' '}
                          {replayDiff.right.total_duration_ms} ms
                        </p>
                      </div>

                      <div className="rounded-xl border bg-card p-4 space-y-2">
                        <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
                          Cost delta
                        </p>
                        <p className="text-2xl font-semibold">
                          {formatCurrency(replayDiff.delta.total_cost_usd)}
                        </p>
                        <p className="text-sm text-muted-foreground">
                          {formatCurrency(replayDiff.left.total_cost_usd)} vs{' '}
                          {formatCurrency(replayDiff.right.total_cost_usd)}
                        </p>
                      </div>

                      <div className="rounded-xl border bg-card p-4 space-y-3 md:col-span-3">
                        <div className="grid gap-4 md:grid-cols-2">
                          <div className="space-y-2">
                            <p className="text-sm font-semibold">
                              {replayDiff.left.task_title}
                            </p>
                            {replayDiff.left.highlights.map((highlight) => (
                              <p
                                key={highlight}
                                className="text-sm text-muted-foreground"
                              >
                                {highlight}
                              </p>
                            ))}
                          </div>
                          <div className="space-y-2">
                            <p className="text-sm font-semibold">
                              {replayDiff.right.task_title}
                            </p>
                            {replayDiff.right.highlights.map((highlight) => (
                              <p
                                key={highlight}
                                className="text-sm text-muted-foreground"
                              >
                                {highlight}
                              </p>
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      Choose two different tasks to compare their timelines.
                    </p>
                  )}
                </>
              ) : (
                <p className="text-sm text-muted-foreground">
                  At least two task timelines are needed before a diff becomes
                  useful.
                </p>
              )}
            </div>

            {hasReplay ? (
              <div className="space-y-5">
                <div className="rounded-xl border bg-muted/30 p-4 space-y-3">
                  <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <div>
                      <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
                        Current frame
                      </p>
                      <p className="text-lg font-semibold">
                        {currentReplayEvent?.summary}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {currentReplayEvent?.action} |{' '}
                        {currentReplayEvent
                          ? formatReplayTimestamp(currentReplayEvent.timestamp)
                          : ''}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          if (clampedReplayIndex >= replayEvents.length - 1) {
                            setCurrentReplayIndex(0);
                          }
                          setIsPlaying((value) => !value);
                        }}
                        className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm hover:bg-accent transition-colors"
                      >
                        {isPlaying ? (
                          <PauseCircle className="w-4 h-4" />
                        ) : (
                          <PlayCircle className="w-4 h-4" />
                        )}
                        {isPlaying ? 'Pause' : 'Play'}
                      </button>
                      {playbackSpeeds.map((speed) => (
                        <button
                          key={speed}
                          type="button"
                          onClick={() => setPlaybackSpeed(speed)}
                          className={`rounded-lg border px-3 py-2 text-sm transition-colors ${
                            playbackSpeed === speed
                              ? 'bg-primary text-primary-foreground border-primary'
                              : 'hover:bg-accent'
                          }`}
                        >
                          {speed}x
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-2">
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>
                        Event {clampedReplayIndex + 1} of {replayEvents.length}
                      </span>
                      <span>
                        {currentReplayEvent?.task_title ||
                          'Cross-agent activity'}
                      </span>
                    </div>
                    {replayEventParam &&
                    currentReplayEvent?.id === replayEventParam ? (
                      <div className="inline-flex items-center rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-xs font-medium text-sky-700">
                        Source fork event
                      </div>
                    ) : null}
                    <input
                      aria-label="Replay scrubber"
                      className="w-full accent-primary"
                      type="range"
                      min={0}
                      max={Math.max(replayEvents.length - 1, 0)}
                      step={1}
                      value={clampedReplayIndex}
                      onChange={(event) => {
                        setIsPlaying(false);
                        setCurrentReplayIndex(Number(event.target.value));
                      }}
                    />
                  </div>

                  <div className="grid gap-3 text-sm text-muted-foreground md:grid-cols-3">
                    <div className="rounded-lg border bg-card px-3 py-2">
                      <span className="block text-[11px] uppercase tracking-[0.16em]">
                        Type
                      </span>
                      <span className="text-foreground">
                        {currentReplayEvent?.type || 'n/a'}
                      </span>
                    </div>
                    <div className="rounded-lg border bg-card px-3 py-2">
                      <span className="block text-[11px] uppercase tracking-[0.16em]">
                        Duration
                      </span>
                      <span className="text-foreground">
                        {currentReplayEvent?.duration_ms
                          ? `${currentReplayEvent.duration_ms} ms`
                          : 'n/a'}
                      </span>
                    </div>
                    <div className="rounded-lg border bg-card px-3 py-2">
                      <span className="block text-[11px] uppercase tracking-[0.16em]">
                        Cost
                      </span>
                      <span className="text-foreground">
                        {formatCurrency(currentReplayEvent?.cost_usd)}
                      </span>
                    </div>
                  </div>

                  {currentReplayRouting ? (
                    <div className="rounded-xl border bg-card p-4 space-y-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
                          Provider: {currentReplayRouting.selected_runtime}
                        </span>
                        <span className="rounded-full bg-muted px-3 py-1 text-xs text-muted-foreground">
                          Model: {currentReplayRouting.selected_model}
                        </span>
                        {getFallbackCount(currentReplayRouting) > 0 ? (
                          <span className="rounded-full bg-amber-500/10 px-3 py-1 text-xs font-medium text-amber-700">
                            Fallbacks: {getFallbackCount(currentReplayRouting)}
                          </span>
                        ) : (
                          <span className="rounded-full bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-700">
                            Direct hit
                          </span>
                        )}
                      </div>
                      <div className="space-y-2 text-xs text-muted-foreground">
                        {currentReplayRouting.attempts.map((attempt, index) => (
                          <div
                            key={`${attempt.runtime}-${attempt.model}-${index}`}
                            className="flex flex-wrap items-center gap-2"
                          >
                            <span className="font-medium text-foreground">
                              {attempt.runtime} / {attempt.model}
                            </span>
                            <span
                              className={`rounded-full px-2 py-0.5 ${
                                attempt.status === 'success'
                                  ? 'bg-emerald-500/10 text-emerald-700'
                                  : attempt.status === 'fallback'
                                    ? 'bg-amber-500/10 text-amber-700'
                                    : 'bg-red-500/10 text-red-700'
                              }`}
                            >
                              {attempt.status}
                            </span>
                            {attempt.reason ? (
                              <span>{attempt.reason}</span>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  <div className="rounded-xl border bg-card p-4 space-y-3">
                    <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                      <div>
                        <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
                          Time-travel fork
                        </p>
                        <p className="text-sm text-muted-foreground">
                          Clone the task from this replay frame, restore visible
                          history, and optionally steer the rerun with a new
                          supervisor prompt.
                        </p>
                      </div>
                      {forkResult ? (
                        <Link
                          to={`/tasks/${forkResult.task_id}`}
                          className="inline-flex items-center justify-center rounded-lg border px-3 py-2 text-sm hover:bg-accent transition-colors"
                        >
                          Open forked task
                        </Link>
                      ) : null}
                    </div>

                    {currentReplayEvent?.task_id ? (
                      <>
                        <textarea
                          aria-label="Fork prompt override"
                          value={forkPrompt}
                          onChange={(event) =>
                            setForkPrompt(event.target.value)
                          }
                          placeholder="Optional: add a new steering prompt for this rerun branch."
                          className="min-h-[88px] w-full rounded-lg border bg-card px-3 py-2 text-sm"
                        />
                        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                          <p className="text-xs text-muted-foreground">
                            Fork point:{' '}
                            {currentReplayEvent.task_title || 'Current task'}{' '}
                            via {currentReplayEvent.action}
                          </p>
                          <button
                            type="button"
                            onClick={handleForkReplay}
                            className="inline-flex items-center justify-center rounded-lg border px-3 py-2 text-sm hover:bg-accent transition-colors disabled:cursor-not-allowed disabled:opacity-60"
                            disabled={isForking}
                          >
                            {isForking ? 'Forking...' : 'Fork from this point'}
                          </button>
                        </div>
                      </>
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        This frame is not scoped to a task, so there is nothing
                        stable to fork from here yet.
                      </p>
                    )}

                    {forkStatus ? (
                      <p className="text-sm text-muted-foreground">
                        {forkStatus}
                      </p>
                    ) : null}
                    {forkResult ? (
                      <p className="text-xs text-muted-foreground">
                        Restored {forkResult.restored_message_count} message
                        {forkResult.restored_message_count === 1 ? '' : 's'}
                        {forkResult.seeded_session
                          ? ' and seeded a session snapshot.'
                          : ' and started with a synthetic fork checkpoint.'}
                        {forkResult.prompt_override_applied
                          ? ' Prompt override included.'
                          : ''}
                      </p>
                    ) : null}
                  </div>

                  <div className="rounded-xl border bg-card p-4 space-y-3">
                    <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                      <div>
                        <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
                          Failure explanation
                        </p>
                        <p className="text-sm text-muted-foreground">
                          Ask the system to diagnose the latest failure in scope
                          and translate it into a plain-language explanation
                          with next steps.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={handleExplainFailure}
                        className="inline-flex items-center justify-center rounded-lg border px-3 py-2 text-sm hover:bg-accent transition-colors disabled:cursor-not-allowed disabled:opacity-60"
                        disabled={isExplainingFailure || !hasReplay}
                      >
                        {isExplainingFailure
                          ? 'Explaining...'
                          : isReplayFailureEvent(currentReplayEvent)
                            ? 'Explain failure'
                            : 'Explain latest failure'}
                      </button>
                    </div>

                    {failureExplanationStatus ? (
                      <p className="text-sm text-muted-foreground">
                        {failureExplanationStatus}
                      </p>
                    ) : null}

                    {failureExplanation ? (
                      <div className="rounded-xl border bg-muted/20 p-4 space-y-4">
                        <div className="flex flex-wrap items-center gap-2">
                          <span
                            className={`rounded-full px-3 py-1 text-xs font-medium ${
                              failureExplanation.explanation.severity === 'high'
                                ? 'bg-rose-100 text-rose-700'
                                : failureExplanation.explanation.severity ===
                                    'medium'
                                  ? 'bg-amber-100 text-amber-700'
                                  : 'bg-slate-100 text-slate-700'
                            }`}
                          >
                            {failureExplanation.explanation.severity} severity
                          </span>
                          <span className="rounded-full border bg-background px-3 py-1 text-xs text-muted-foreground">
                            {failureExplanation.planner.mode === 'llm'
                              ? `Planned by ${failureExplanation.planner.runtime || 'LLM'}`
                              : 'Fallback diagnosis'}
                          </span>
                        </div>

                        <div>
                          <p className="text-lg font-semibold">
                            {failureExplanation.explanation.headline}
                          </p>
                          <p className="mt-2 text-sm text-muted-foreground">
                            {failureExplanation.explanation.summary}
                          </p>
                        </div>

                        <div className="rounded-lg border bg-card px-4 py-3">
                          <span className="block text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                            Likely cause
                          </span>
                          <span className="text-sm text-foreground">
                            {failureExplanation.explanation.likely_cause}
                          </span>
                        </div>

                        <div className="grid gap-4 md:grid-cols-2">
                          <div className="space-y-2">
                            <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
                              Evidence
                            </p>
                            {failureExplanation.explanation.evidence.map(
                              (entry) => (
                                <p
                                  key={entry}
                                  className="text-sm text-muted-foreground"
                                >
                                  {entry}
                                </p>
                              )
                            )}
                          </div>
                          <div className="space-y-2">
                            <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
                              Recommended actions
                            </p>
                            {failureExplanation.explanation.recommended_actions.map(
                              (entry) => (
                                <p
                                  key={entry}
                                  className="text-sm text-muted-foreground"
                                >
                                  {entry}
                                </p>
                              )
                            )}
                          </div>
                        </div>

                        <div className="text-xs text-muted-foreground">
                          Focus event: {failureExplanation.target_event.action}{' '}
                          on{' '}
                          {failureExplanation.target_event.task_title ||
                            'unknown task'}{' '}
                          at{' '}
                          {formatReplayTimestamp(
                            failureExplanation.target_event.timestamp
                          )}
                        </div>
                      </div>
                    ) : null}
                  </div>
                </div>

                <div className="space-y-4">
                  {revealedEvents.map((event, index) => (
                    <div
                      key={event.id}
                      className={`border-l-2 pl-4 py-1 space-y-1 ${
                        index === 0 ? 'border-primary' : 'border-primary/20'
                      }`}
                    >
                      <div className="flex justify-between text-xs text-muted-foreground gap-4">
                        <span>{event.action}</span>
                        <span>{formatReplayTimestamp(event.timestamp)}</span>
                      </div>
                      <p className="text-sm">{event.summary}</p>
                      {event.task_title ? (
                        <p className="text-xs text-muted-foreground">
                          Task: {event.task_title}
                        </p>
                      ) : null}
                      {getReplayRouting(event.details) ? (
                        <p className="text-xs text-muted-foreground">
                          LLM route:{' '}
                          {getReplayRouting(event.details)?.selected_runtime} /{' '}
                          {getReplayRouting(event.details)?.selected_model}
                          {getFallbackCount(getReplayRouting(event.details)) > 0
                            ? ` • fallbacks ${getFallbackCount(getReplayRouting(event.details))}`
                            : ''}
                        </p>
                      ) : null}
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="rounded-xl border border-dashed p-6 text-sm text-muted-foreground">
                {hasReplayFilters
                  ? 'No events match the current replay filters. Try another task or re-enable more event types.'
                  : 'No replay events yet. The timeline will populate as this agent works.'}
              </div>
            )}
          </div>
        </div>

        <div className="space-y-6">
          <div className="border rounded-xl bg-card p-6 space-y-4">
            <h3 className="font-semibold flex items-center gap-2">
              <Wrench className="w-4 h-4 text-primary" />
              Tool Capabilities
            </h3>
            <div className="flex flex-wrap gap-2">
              {agent.tools?.map((t: any) => (
                <span
                  key={t.id}
                  className="px-2 py-1 bg-accent rounded text-xs"
                >
                  {t.name}
                </span>
              )) || (
                <p className="text-xs text-muted-foreground italic">
                  No specialized tools
                </p>
              )}
            </div>
          </div>

          <div className="border rounded-xl bg-card p-6 space-y-4">
            <h3 className="font-semibold flex items-center gap-2">
              <Shield className="w-4 h-4 text-primary" />
              Governance
            </h3>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Budget Limit</span>
                <span>
                  ${budget?.limit_usd || agent.monthly_budget_usd || '0.00'}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Spent This Month</span>
                <span>${budget?.spent_usd || '0.00'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Runtime</span>
                <span>{agent.runtime}</span>
              </div>
            </div>
          </div>

          <TraceLinkCallout
            trace={lastTrace}
            title="Inspect Agent Trace"
            body="Jump into Grafana Explore for the latest agent detail or replay request."
          />
        </div>
      </div>
    </div>
  );
}
