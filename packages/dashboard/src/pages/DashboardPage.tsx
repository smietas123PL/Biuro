import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Activity, BrainCircuit, Clock3, RadioTower, ShieldAlert, Users } from 'lucide-react';
import { useApi, useWebSocket, type ApiTraceSnapshot } from '../hooks/useApi';
import { useCompany } from '../context/CompanyContext';
import { buildGrafanaTraceExploreUrl } from '../lib/grafana';
import { TraceLinkCallout } from '../components/TraceLinkCallout';

type CompanyStats = {
  agent_count: number;
  active_agents: number;
  idle_agents: number;
  paused_agents: number;
  task_count: number;
  pending_tasks: number;
  completed_tasks: number;
  blocked_tasks: number;
  goal_count: number;
  pending_approvals: number;
  daily_cost_usd: number;
};

type ActivityItem = {
  id: string;
  type: string;
  created_at: string;
  cost_usd: number;
  agent_id?: string | null;
  agent_name?: string | null;
  task_id?: string | null;
  task_title?: string | null;
  thought?: string | null;
  summary: string;
};

type ThoughtStreamItem = {
  id: string;
  agent_id: string | null;
  agent_name: string;
  task_id: string | null;
  task_title: string | null;
  thought: string;
  created_at: string;
  source: 'feed' | 'live';
};

type BudgetTotals = {
  limit_usd: number;
  spent_usd: number;
  remaining_usd: number;
  utilization_pct: number | null;
};

type BudgetToast = {
  id: string;
  tone: 'warning' | 'critical';
  title: string;
  body: string;
};

type RetrievalMetricsSummary = {
  range_days: number;
  totals: {
    searches: number;
    knowledge_searches: number;
    memory_searches: number;
    avg_latency_ms: number;
    avg_result_count: number;
    avg_overlap_count: number;
    zero_result_rate_pct: number;
  };
  by_source: Array<{
    embedding_source: string;
    total: number;
  }>;
  by_consumer: Array<{
    consumer: string;
    total: number;
  }>;
  recent: Array<{
    scope: string;
    consumer: string;
    result_count: number;
    overlap_count: number;
    top_distance?: number | null;
    embedding_source: string;
    created_at: string;
  }>;
};

type MemoryInsightsSummary = {
  range_days: number;
  summary: {
    total_memories: number;
    recent_memories: number;
    agents_with_memories: number;
    tasks_with_memories: number;
    memory_reuse_searches: number;
  };
  recurring_topics: Array<{
    label: string;
    count: number;
  }>;
  top_agents: Array<{
    agent_id: string;
    agent_name: string;
    total_memories: number;
    latest_memory_at: string;
  }>;
  revisited_queries: Array<{
    query: string;
    total: number;
  }>;
  recent_lessons: Array<{
    id: string;
    content: string;
    created_at: string;
    agent_id: string;
    agent_name: string;
    task_id: string | null;
    task_title: string | null;
  }>;
};

type TraceDetail = {
  trace_id: string;
  service: string;
  summary: {
    span_count: number;
    started_at: string;
    ended_at: string;
    duration_ms: number;
  };
  items: Array<{
    span_id: string;
    parent_span_id?: string;
    name: string;
    duration_ms: number;
    status_code: string;
    start_time: string;
    attributes: Record<string, unknown>;
  }>;
};

const emptyStats: CompanyStats = {
  agent_count: 0,
  active_agents: 0,
  idle_agents: 0,
  paused_agents: 0,
  task_count: 0,
  pending_tasks: 0,
  completed_tasks: 0,
  blocked_tasks: 0,
  goal_count: 0,
  pending_approvals: 0,
  daily_cost_usd: 0,
};

const emptyBudgetTotals: BudgetTotals = {
  limit_usd: 0,
  spent_usd: 0,
  remaining_usd: 0,
  utilization_pct: null,
};

function normalizeThoughtText(item: Pick<ActivityItem, 'type' | 'summary' | 'thought'>) {
  const explicitThought = typeof item.thought === 'string' ? item.thought.trim() : '';
  if (explicitThought) {
    return explicitThought;
  }

  const summary = item.summary.trim();
  if (!summary) {
    return null;
  }

  if (item.type !== 'heartbeat.worked') {
    return null;
  }

  if (summary === 'Completed a heartbeat cycle.' || summary.startsWith('Heartbeat status:')) {
    return null;
  }

  return summary;
}

function buildThoughtStreamFromActivity(items: ActivityItem[]) {
  const seenAgentIds = new Set<string>();
  const stream: ThoughtStreamItem[] = [];

  for (const item of items) {
    const thought = normalizeThoughtText(item);
    if (!thought) {
      continue;
    }

    const agentKey = item.agent_id ?? `unknown-${item.id}`;
    if (seenAgentIds.has(agentKey)) {
      continue;
    }
    seenAgentIds.add(agentKey);

    stream.push({
      id: item.id,
      agent_id: item.agent_id ?? null,
      agent_name: item.agent_name || 'Agent',
      task_id: item.task_id ?? null,
      task_title: item.task_title ?? null,
      thought,
      created_at: item.created_at,
      source: 'feed',
    });
  }

  return stream.slice(0, 6);
}

function formatThoughtAge(value: string) {
  const deltaMs = Date.now() - new Date(value).getTime();
  if (!Number.isFinite(deltaMs) || deltaMs < 0) {
    return 'just now';
  }

  const deltaSeconds = Math.round(deltaMs / 1000);
  if (deltaSeconds < 45) {
    return 'just now';
  }
  if (deltaSeconds < 3600) {
    return `${Math.round(deltaSeconds / 60)}m ago`;
  }
  if (deltaSeconds < 86_400) {
    return `${Math.round(deltaSeconds / 3600)}h ago`;
  }
  return `${Math.round(deltaSeconds / 86_400)}d ago`;
}

function summarizeMemoryLesson(content: string) {
  const normalized = content.trim().replace(/\s+/g, ' ');
  if (!normalized) {
    return 'No lesson text recorded.';
  }

  const sentence = normalized.split(/(?<=[.!?])\s+/)[0] ?? normalized;
  if (sentence.length <= 160) {
    return sentence;
  }

  return `${sentence.slice(0, 157).trimEnd()}...`;
}

export default function DashboardPage() {
  const { request, loading, error, lastTrace } = useApi();
  const { selectedCompany, selectedCompanyId } = useCompany();
  const [stats, setStats] = useState<CompanyStats>(emptyStats);
  const [budgetTotals, setBudgetTotals] = useState<BudgetTotals>(emptyBudgetTotals);
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [liveThoughts, setLiveThoughts] = useState<ThoughtStreamItem[]>([]);
  const [retrievalMetrics, setRetrievalMetrics] = useState<RetrievalMetricsSummary | null>(null);
  const [memoryInsights, setMemoryInsights] = useState<MemoryInsightsSummary | null>(null);
  const [traceDetail, setTraceDetail] = useState<TraceDetail | null>(null);
  const [traceError, setTraceError] = useState<string | null>(null);
  const [costPulse, setCostPulse] = useState<number | null>(null);
  const [budgetToasts, setBudgetToasts] = useState<BudgetToast[]>([]);
  const lastEvent = useWebSocket(selectedCompanyId ?? undefined) as
    | {
        event: string;
        data?: {
          agentId?: string;
          agent_id?: string;
          agentName?: string;
          agent_name?: string;
          taskId?: string;
          task_id?: string;
          taskTitle?: string;
          task_title?: string;
          thought?: string;
          delta_cost_usd?: number;
          daily_cost_usd?: number;
          threshold_pct?: number;
          utilization_pct?: number;
          tone?: 'warning' | 'critical';
          message?: string;
        };
        timestamp: string;
      }
    | null;

  const refreshBudgetTotals = async () => {
    if (!selectedCompanyId) {
      setBudgetTotals(emptyBudgetTotals);
      return;
    }

    const summary = (await request(`/companies/${selectedCompanyId}/budgets-summary`, undefined, {
      suppressError: true,
      trackTrace: false,
    })) as { totals: BudgetTotals };
    setBudgetTotals(summary.totals);
  };

  useEffect(() => {
    const fetchDashboardData = async () => {
      if (!selectedCompanyId) {
        setStats(emptyStats);
        setBudgetTotals(emptyBudgetTotals);
        setActivity([]);
        setLiveThoughts([]);
        setRetrievalMetrics(null);
        setMemoryInsights(null);
        return;
      }

      const statsData = (await request(`/companies/${selectedCompanyId}/stats`)) as CompanyStats;
      const [activityResult, retrievalMetricsResult, memoryInsightsResult, budgetResult] = await Promise.allSettled([
        request(`/companies/${selectedCompanyId}/activity-feed?limit=12`, undefined, { suppressError: true }) as Promise<ActivityItem[]>,
        request(`/companies/${selectedCompanyId}/retrieval-metrics?days=7`, undefined, { suppressError: true }) as Promise<RetrievalMetricsSummary>,
        request(`/companies/${selectedCompanyId}/memory-insights?days=30`, undefined, { suppressError: true }) as Promise<MemoryInsightsSummary>,
        request(`/companies/${selectedCompanyId}/budgets-summary`, undefined, { suppressError: true, trackTrace: false }) as Promise<{ totals: BudgetTotals }>,
      ]);

      setStats(statsData);
      setActivity(activityResult.status === 'fulfilled' ? activityResult.value : []);
      setLiveThoughts(
        activityResult.status === 'fulfilled' ? buildThoughtStreamFromActivity(activityResult.value) : []
      );
      setRetrievalMetrics(retrievalMetricsResult.status === 'fulfilled' ? retrievalMetricsResult.value : null);
      setMemoryInsights(memoryInsightsResult.status === 'fulfilled' ? memoryInsightsResult.value : null);
      setBudgetTotals(budgetResult.status === 'fulfilled' ? budgetResult.value.totals : emptyBudgetTotals);
    };

    void fetchDashboardData();
  }, [request, selectedCompanyId]);

  useEffect(() => {
    if (!lastTrace?.traceId) {
      setTraceDetail(null);
      setTraceError(null);
      return;
    }

    const loadTraceDetail = async () => {
      try {
        const detail = (await request(`/observability/traces/${lastTrace.traceId}`, undefined, {
          suppressError: true,
          trackTrace: false,
        })) as TraceDetail;
        setTraceDetail(detail);
        setTraceError(null);
      } catch (traceDetailError) {
        setTraceDetail(null);
        setTraceError(
          traceDetailError instanceof Error
            ? traceDetailError.message
            : 'Trace detail is unavailable for this session.'
        );
      }
    };

    void loadTraceDetail();
  }, [lastTrace, request]);

  useEffect(() => {
    if (!lastEvent || lastEvent.event !== 'agent.working') {
      return;
    }

    const realtimeItem: ActivityItem = {
      id: `realtime-${lastEvent.timestamp}-${lastEvent.data?.agentId ?? 'unknown'}`,
      type: 'agent.working',
      created_at: lastEvent.timestamp,
      cost_usd: 0,
      agent_id: lastEvent.data?.agentId ?? null,
      agent_name: lastEvent.data?.agentName ?? 'Agent',
      task_id: lastEvent.data?.taskId ?? null,
      task_title: lastEvent.data?.taskTitle ?? 'Current task',
      summary: `Started working on ${lastEvent.data?.taskTitle ?? 'a task'}.`,
    };

    setActivity((current) => [realtimeItem, ...current].slice(0, 12));
  }, [lastEvent]);

  useEffect(() => {
    if (!lastEvent || lastEvent.event !== 'agent.thought') {
      return;
    }

    const thought =
      typeof lastEvent.data?.message === 'string' && lastEvent.data.message.trim().length > 0
        ? lastEvent.data.message.trim()
        : typeof lastEvent.data?.thought === 'string' && lastEvent.data.thought.trim().length > 0
          ? lastEvent.data.thought.trim()
          : null;

    if (!thought) {
      return;
    }

    const liveThought: ThoughtStreamItem = {
      id: `thought-${lastEvent.timestamp}-${lastEvent.data?.agentId ?? lastEvent.data?.agent_id ?? 'agent'}`,
      agent_id: lastEvent.data?.agentId ?? lastEvent.data?.agent_id ?? null,
      agent_name:
        lastEvent.data?.agentName ?? lastEvent.data?.agent_name ?? 'Agent',
      task_id:
        lastEvent.data?.taskId ?? lastEvent.data?.task_id ?? null,
      task_title:
        lastEvent.data?.taskTitle ?? lastEvent.data?.task_title ?? null,
      thought,
      created_at: lastEvent.timestamp,
      source: 'live',
    };

    setLiveThoughts((current) => {
      const next = [liveThought, ...current.filter((item) => item.agent_id !== liveThought.agent_id)];
      return next.slice(0, 6);
    });
  }, [lastEvent]);

  useEffect(() => {
    if (!lastEvent || !selectedCompanyId) {
      return;
    }

    if (lastEvent.event === 'cost.updated') {
      const nextDailyCost =
        typeof lastEvent.data?.daily_cost_usd === 'number'
          ? lastEvent.data.daily_cost_usd
          : stats.daily_cost_usd;
      const deltaCost =
        typeof lastEvent.data?.delta_cost_usd === 'number' ? lastEvent.data.delta_cost_usd : null;

      setStats((current) => ({
        ...current,
        daily_cost_usd: nextDailyCost,
      }));
      setCostPulse(deltaCost);
      void refreshBudgetTotals();

      if (deltaCost !== null) {
        const timeout = window.setTimeout(() => {
          setCostPulse((current) => (current === deltaCost ? null : current));
        }, 3500);
        return () => window.clearTimeout(timeout);
      }
    }

    if (lastEvent.event === 'budget.threshold') {
      setBudgetToasts((current) => {
        const nextToast: BudgetToast = {
          id: `${lastEvent.timestamp}-${lastEvent.data?.agentId ?? 'agent'}-${lastEvent.data?.threshold_pct ?? 'threshold'}`,
          tone: lastEvent.data?.tone === 'critical' ? 'critical' : 'warning',
          title: `Budget ${lastEvent.data?.threshold_pct ?? 80}% alert`,
          body:
            lastEvent.data?.message ??
            `${lastEvent.data?.agentName ?? 'Agent'} reached a budget threshold.`,
        };
        return [nextToast, ...current].slice(0, 3);
      });
      void refreshBudgetTotals();
    }
  }, [lastEvent, selectedCompanyId, stats.daily_cost_usd]);

  useEffect(() => {
    if (budgetToasts.length === 0) {
      return;
    }

    const timeout = window.setTimeout(() => {
      setBudgetToasts((current) => current.slice(0, -1));
    }, 5000);

    return () => window.clearTimeout(timeout);
  }, [budgetToasts]);

  const topSources = retrievalMetrics?.by_source.slice(0, 3) ?? [];
  const topConsumers = retrievalMetrics?.by_consumer.slice(0, 3) ?? [];
  const recentRetrievals = retrievalMetrics?.recent.slice(0, 4) ?? [];
  const recentLessons = memoryInsights?.recent_lessons.slice(0, 4) ?? [];
  const thoughtStream = useMemo(
    () =>
      [...liveThoughts]
        .sort((left, right) => new Date(right.created_at).getTime() - new Date(left.created_at).getTime()),
    [liveThoughts]
  );

  if (!selectedCompany) {
    return <div className="rounded-xl border border-dashed p-8 text-sm text-muted-foreground">Choose a company to see live metrics.</div>;
  }

  const cards = [
    {
      title: 'Active Agents',
      value: stats.active_agents,
      detail: `${stats.agent_count} total, ${stats.idle_agents} idle`,
      icon: Users,
      tone: 'text-sky-700 bg-sky-50 border-sky-200',
    },
    {
      title: 'Pending Tasks',
      value: stats.pending_tasks,
      detail: `${stats.completed_tasks} completed, ${stats.blocked_tasks} blocked`,
      icon: Clock3,
      tone: 'text-amber-700 bg-amber-50 border-amber-200',
    },
    {
      title: 'Daily Cost',
      value: `$${stats.daily_cost_usd.toFixed(4)}`,
      detail: "Usage from today's audit log",
      icon: Activity,
      tone: 'text-emerald-700 bg-emerald-50 border-emerald-200',
    },
    {
      title: 'Approvals Waiting',
      value: stats.pending_approvals,
      detail: `${stats.goal_count} goals tracked`,
      icon: ShieldAlert,
      tone: 'text-rose-700 bg-rose-50 border-rose-200',
    },
  ];

  return (
    <div className="space-y-6">
      {budgetToasts.length > 0 && (
        <div className="fixed right-4 top-4 z-40 space-y-3">
          {budgetToasts.map((toast) => (
            <div
              key={toast.id}
              className={`w-[320px] rounded-2xl border px-4 py-3 shadow-lg ${
                toast.tone === 'critical'
                  ? 'border-red-200 bg-red-50 text-red-800'
                  : 'border-amber-200 bg-amber-50 text-amber-800'
              }`}
            >
              <div className="text-sm font-semibold">{toast.title}</div>
              <div className="mt-1 text-sm">{toast.body}</div>
            </div>
          ))}
        </div>
      )}

      <div className="space-y-2">
        <h2 className="text-3xl font-bold tracking-tight">Overview</h2>
        <p className="text-sm text-muted-foreground">
          Live operating snapshot for {selectedCompany.name}
        </p>
      </div>

      {error ? (
        <div className="space-y-3">
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
          <TraceLinkCallout
            trace={lastTrace}
            title="Debug This Error"
            body="Open the most recent API trace in Grafana Explore to inspect the failure path."
            compact
          />
        </div>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)]">
        <div className="rounded-2xl border bg-card p-6 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Live Cost Ticker</div>
              <div className="mt-2 text-4xl font-semibold tracking-tight">${stats.daily_cost_usd.toFixed(4)} today</div>
              <div className="mt-2 text-sm text-muted-foreground">
                Streaming directly from heartbeat cost events without a manual refresh.
              </div>
            </div>
            <div className={`rounded-full border px-3 py-1 text-xs font-medium ${
              costPulse && costPulse > 0 ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-muted bg-muted/30 text-muted-foreground'
            }`}>
              {costPulse && costPulse > 0 ? `+ $${costPulse.toFixed(4)} latest heartbeat` : 'Waiting for next heartbeat'}
            </div>
          </div>
        </div>

        <div className="rounded-2xl border bg-card p-6 shadow-sm">
          <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Budget Gauge</div>
          <div className="mt-2 flex items-end justify-between gap-4">
            <div className="text-4xl font-semibold tracking-tight">
              {budgetTotals.utilization_pct === null ? 'No cap' : `${budgetTotals.utilization_pct.toFixed(0)}%`}
            </div>
            <div className="text-right text-sm text-muted-foreground">
              <div>${budgetTotals.spent_usd.toFixed(2)} spent</div>
              <div>${budgetTotals.limit_usd.toFixed(2)} allocated</div>
            </div>
          </div>
          <div className="mt-4 h-3 overflow-hidden rounded-full bg-muted/30">
            <div
              className={`h-full rounded-full transition-all ${
                budgetTotals.utilization_pct !== null && budgetTotals.utilization_pct >= 95
                  ? 'bg-red-500'
                  : budgetTotals.utilization_pct !== null && budgetTotals.utilization_pct >= 80
                    ? 'bg-amber-400'
                    : 'bg-emerald-500'
              }`}
              style={{ width: `${budgetTotals.utilization_pct === null ? 0 : Math.max(Math.min(budgetTotals.utilization_pct, 100), 4)}%` }}
            />
          </div>
          <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
            <span>Thresholds: 80% warning, 95% critical</span>
            <span>${budgetTotals.remaining_usd.toFixed(2)} remaining</span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        {cards.map((card) => (
          <div key={card.title} className={`rounded-2xl border p-5 shadow-sm ${card.tone}`}>
            <div className="mb-6 flex items-center justify-between">
              <span className="text-sm font-medium">{card.title}</span>
              <card.icon className="h-5 w-5" />
            </div>
            <div className="text-3xl font-bold tracking-tight">{card.value}</div>
            <div className="mt-2 text-sm opacity-80">{card.detail}</div>
          </div>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <div className="rounded-2xl border bg-card p-6 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-lg font-semibold">Operations Snapshot</h3>
            {loading && <span className="text-xs text-muted-foreground">Refreshing...</span>}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Metric label="All Tasks" value={stats.task_count} helper="Open and completed work combined" />
            <Metric label="Goals" value={stats.goal_count} helper="Strategic objectives in the system" />
            <Metric label="Paused Agents" value={stats.paused_agents} helper="Requires manual follow-up" />
            <Metric label="Completed Today" value={stats.completed_tasks} helper="Tasks marked done so far" />
          </div>
        </div>

        <div className="rounded-2xl border bg-card p-6 shadow-sm">
          <h3 className="text-lg font-semibold">What To Watch</h3>
          <div className="mt-4 space-y-3 text-sm text-muted-foreground">
            <Insight
              title="Task flow"
              body={stats.pending_tasks > 0 ? `${stats.pending_tasks} tasks are still in motion.` : 'Backlog is clear right now.'}
            />
            <Insight
              title="Agent utilization"
              body={stats.active_agents > 0 ? `${stats.active_agents} agents are currently working.` : 'No agents are actively processing work.'}
            />
            <Insight
              title="Governance"
              body={stats.pending_approvals > 0 ? `${stats.pending_approvals} approval requests need attention.` : 'No approval bottlenecks at the moment.'}
            />
            <TraceInsight trace={lastTrace} detail={traceDetail} error={traceError} />
          </div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
        <div className="rounded-2xl border bg-card p-6 shadow-sm">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-lg font-semibold">Retrieval Quality</h3>
              <p className="text-sm text-muted-foreground">
                Last {retrievalMetrics?.range_days ?? 7} days of RAG effectiveness across knowledge and memory lookups.
              </p>
            </div>
            <span className="rounded-full border bg-muted/30 px-3 py-1 text-xs text-muted-foreground">
              {retrievalMetrics?.totals.searches ?? 0} searches
            </span>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Metric
              label="Zero-result rate"
              value={`${(retrievalMetrics?.totals.zero_result_rate_pct ?? 0).toFixed(1)}%`}
              helper="Lower is better for healthy retrieval coverage"
            />
            <Metric
              label="Avg latency"
              value={`${Math.round(retrievalMetrics?.totals.avg_latency_ms ?? 0)}ms`}
              helper="Mean end-to-end retrieval time"
            />
            <Metric
              label="Avg results"
              value={(retrievalMetrics?.totals.avg_result_count ?? 0).toFixed(1)}
              helper="Average number of returned candidates"
            />
            <Metric
              label="Avg overlap"
              value={(retrievalMetrics?.totals.avg_overlap_count ?? 0).toFixed(1)}
              helper="How often lexical and vector hits agree"
            />
          </div>

          <div className="mt-5 grid gap-4 md:grid-cols-2">
            <SummaryGroup
              title="Embedding sources"
              empty="No retrieval data yet."
              items={topSources.map((item) => ({
                label: item.embedding_source,
                value: `${item.total}`,
              }))}
            />
            <SummaryGroup
              title="Top consumers"
              empty="No active retrieval consumers yet."
              items={topConsumers.map((item) => ({
                label: item.consumer.replace(/_/g, ' '),
                value: `${item.total}`,
              }))}
            />
          </div>
        </div>

        <div className="rounded-2xl border bg-card p-6 shadow-sm">
          <h3 className="text-lg font-semibold">Recent Retrievals</h3>
          <div className="mt-4 space-y-3">
            {recentRetrievals.map((item, index) => (
              <div key={`${item.created_at}-${item.consumer}-${index}`} className="rounded-xl border bg-muted/20 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="font-medium text-foreground">
                    {item.scope} - {item.consumer.replace(/_/g, ' ')}
                  </div>
                  <div className="text-xs text-muted-foreground">{new Date(item.created_at).toLocaleString()}</div>
                </div>
                <div className="mt-2 text-sm text-muted-foreground">
                  {item.result_count} results, overlap {item.overlap_count}, source {item.embedding_source}
                  {typeof item.top_distance === 'number' ? `, top distance ${item.top_distance.toFixed(3)}` : ''}
                </div>
              </div>
            ))}

            {recentRetrievals.length === 0 && (
              <div className="rounded-2xl border border-dashed p-10 text-center text-sm text-muted-foreground">
                Retrieval metrics will appear after the first knowledge or memory lookups.
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="rounded-2xl border bg-card p-6 shadow-sm">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-lg font-semibold">Memory Insights</h3>
              <p className="text-sm text-muted-foreground">
                What agents learned from history over the last {memoryInsights?.range_days ?? 30} days.
              </p>
            </div>
            <span className="rounded-full border bg-muted/30 px-3 py-1 text-xs text-muted-foreground">
              {memoryInsights?.summary.recent_memories ?? 0} new lessons
            </span>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Metric
              label="Total memory"
              value={memoryInsights?.summary.total_memories ?? 0}
              helper="All saved experiences across agents"
            />
            <Metric
              label="Agents learning"
              value={memoryInsights?.summary.agents_with_memories ?? 0}
              helper="Unique agents who stored memory recently"
            />
            <Metric
              label="Tasks covered"
              value={memoryInsights?.summary.tasks_with_memories ?? 0}
              helper="Distinct tasks represented in memory"
            />
            <Metric
              label="Reuse searches"
              value={memoryInsights?.summary.memory_reuse_searches ?? 0}
              helper="Times agents searched past memory"
            />
          </div>

          <div className="mt-5 grid gap-4 md:grid-cols-2">
            <SummaryGroup
              title="Recurring lessons"
              empty="Recurring themes will appear after several similar memories are stored."
              items={(memoryInsights?.recurring_topics ?? []).map((item) => ({
                label: item.label,
                value: `${item.count}x`,
              }))}
            />
            <SummaryGroup
              title="Top learning agents"
              empty="No agents have stored memory in this window yet."
              items={(memoryInsights?.top_agents ?? []).map((item) => ({
                label: item.agent_name,
                value: `${item.total_memories} lessons`,
              }))}
            />
          </div>

          <div className="mt-5 rounded-xl border bg-muted/20 p-4">
            <div className="text-sm font-medium text-foreground">Most revisited questions</div>
            <div className="mt-3 space-y-2">
              {(memoryInsights?.revisited_queries ?? []).length > 0 ? (
                memoryInsights!.revisited_queries.map((item) => (
                  <div key={`${item.query}-${item.total}`} className="flex items-center justify-between gap-3 rounded-lg bg-background/60 px-3 py-2 text-sm">
                    <span className="truncate text-muted-foreground">{item.query}</span>
                    <span className="font-medium text-foreground">{item.total}</span>
                  </div>
                ))
              ) : (
                <div className="text-sm text-muted-foreground">
                  Memory reuse patterns will show up here after agents start querying history.
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="rounded-2xl border bg-card p-6 shadow-sm">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-lg font-semibold">Recent Lessons</h3>
              <p className="text-sm text-muted-foreground">
                Fresh experience captures that can shape future decisions.
              </p>
            </div>
          </div>

          <div className="space-y-3">
            {recentLessons.map((item) => (
              <div key={item.id} className="rounded-xl border bg-muted/20 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="font-medium text-foreground">{item.agent_name}</div>
                    <div className="mt-1 text-xs uppercase tracking-[0.16em] text-muted-foreground">
                      {item.task_title || 'No linked task'}
                    </div>
                  </div>
                  <div className="text-right text-xs text-muted-foreground">
                    <div>{formatThoughtAge(item.created_at)}</div>
                    <div>{new Date(item.created_at).toLocaleTimeString()}</div>
                  </div>
                </div>
                <p className="mt-3 text-sm leading-6 text-foreground">
                  {summarizeMemoryLesson(item.content)}
                </p>
                <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                  <Link className="text-foreground underline-offset-2 hover:underline" to={`/agents/${item.agent_id}`}>
                    Open agent
                  </Link>
                  {item.task_id ? (
                    <Link className="text-foreground underline-offset-2 hover:underline" to={`/tasks/${item.task_id}`}>
                      Open task
                    </Link>
                  ) : null}
                </div>
              </div>
            ))}

            {recentLessons.length === 0 && (
              <div className="rounded-2xl border border-dashed p-10 text-center text-sm text-muted-foreground">
                Memory lessons will appear here after agents store their first experience.
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="rounded-2xl border bg-card p-6 shadow-sm">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-lg font-semibold">Live Thought Stream</h3>
              <p className="text-sm text-muted-foreground">What active agents are thinking right now, updated from heartbeats and live worker events.</p>
            </div>
            <div className="inline-flex items-center gap-2 rounded-full border bg-sky-50 px-3 py-1 text-xs text-sky-700">
              <RadioTower className="h-3.5 w-3.5" />
              {thoughtStream.length > 0 ? `${thoughtStream.length} minds visible` : 'Waiting for the next thought'}
            </div>
          </div>

          <div className="space-y-3">
            {thoughtStream.map((item) => (
              <div key={item.id} className="rounded-[24px] border bg-gradient-to-br from-sky-50 via-white to-cyan-50 p-4 shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-foreground">{item.agent_name}</span>
                      <span className="rounded-full border bg-white/80 px-2 py-1 text-[11px] uppercase tracking-wide text-sky-700">
                        {item.source === 'live' ? 'Live now' : 'Recent heartbeat'}
                      </span>
                    </div>
                    <div className="mt-1 text-xs uppercase tracking-[0.16em] text-muted-foreground">
                      {item.task_title || 'No active task recorded'}
                    </div>
                  </div>
                  <div className="text-right text-xs text-muted-foreground">
                    <div>{formatThoughtAge(item.created_at)}</div>
                    <div>{new Date(item.created_at).toLocaleTimeString()}</div>
                  </div>
                </div>
                <div className="mt-4 flex gap-3">
                  <div className="mt-1 flex h-9 w-9 items-center justify-center rounded-full border border-sky-200 bg-white text-sky-700">
                    <BrainCircuit className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm leading-7 text-foreground">{item.thought}</p>
                    <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                      {item.task_id ? (
                        <Link className="text-foreground underline-offset-2 hover:underline" to={`/tasks/${item.task_id}`}>
                          Open task
                        </Link>
                      ) : null}
                      {item.agent_id ? (
                        <Link className="text-foreground underline-offset-2 hover:underline" to={`/agents/${item.agent_id}`}>
                          Open agent
                        </Link>
                      ) : null}
                    </div>
                  </div>
                </div>
              </div>
            ))}

            {thoughtStream.length === 0 && !loading && (
              <div className="rounded-2xl border border-dashed p-10 text-center text-sm text-muted-foreground">
                No live thoughts yet. The panel will light up after the next heartbeat with a parsed thought.
              </div>
            )}
          </div>
        </div>

        <div className="rounded-2xl border bg-card p-6 shadow-sm">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-lg font-semibold">Live Activity Feed</h3>
              <p className="text-sm text-muted-foreground">Recent heartbeats plus real-time task starts from the worker stream.</p>
            </div>
            <Link to="/audit" className="text-sm font-medium text-primary transition-colors hover:text-primary/80">
              Open full audit log
            </Link>
          </div>

          <div className="space-y-3">
            {activity.map((item) => (
              <div key={item.id} className="flex gap-4 rounded-2xl border bg-muted/20 p-4">
                <div className={`mt-1 h-3 w-3 rounded-full ${item.type === 'agent.working' ? 'bg-sky-500' : item.type === 'heartbeat.error' ? 'bg-rose-500' : 'bg-emerald-500'}`} />
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="font-medium text-foreground">
                      {item.agent_name || 'System'}
                      {item.task_title ? ` - ${item.task_title}` : ''}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {new Date(item.created_at).toLocaleString()}
                    </div>
                  </div>
                  <div className="text-sm text-muted-foreground">{item.summary}</div>
                </div>
                <div className="text-right text-xs text-muted-foreground">
                  {item.cost_usd > 0 ? `$${item.cost_usd.toFixed(4)}` : 'live'}
                </div>
              </div>
            ))}

            {activity.length === 0 && !loading && (
              <div className="rounded-2xl border border-dashed p-10 text-center text-sm text-muted-foreground">
                No activity yet. The feed will populate as agents start heartbeats.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function TraceInsight({
  trace,
  detail,
  error,
}: {
  trace: ApiTraceSnapshot | null;
  detail: TraceDetail | null;
  error: string | null;
}) {
  if (!trace) {
    return (
      <Insight
        title="Observability"
        body="Trace drilldown will appear after the next API request completes."
      />
    );
  }

  const traceIdLabel =
    trace.traceId.length > 16 ? `${trace.traceId.slice(0, 8)}...${trace.traceId.slice(-8)}` : trace.traceId;
  const topSpans = detail?.items.slice(0, 3) ?? [];
  const grafanaTraceUrl = buildGrafanaTraceExploreUrl(trace);

  return (
    <div className="rounded-xl border bg-muted/20 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="font-medium text-foreground">Trace Drilldown</div>
        <div className="flex items-center gap-2">
          <div className="rounded-full border bg-background/70 px-2 py-1 text-[11px] uppercase tracking-wide text-muted-foreground">
            {trace.method} {trace.status}
          </div>
          <a
            href={grafanaTraceUrl}
            target="_blank"
            rel="noreferrer"
            className="rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-[11px] font-medium uppercase tracking-wide text-sky-700 transition-colors hover:bg-sky-100"
          >
            Open in Grafana
          </a>
        </div>
      </div>
      <div className="mt-2 text-sm text-muted-foreground">
        Latest trace <span className="font-mono text-foreground">{traceIdLabel}</span> for {trace.path}
      </div>
      {detail && (
        <div className="mt-3 space-y-2">
          <div className="text-xs text-muted-foreground">
            {detail.summary.span_count} spans across {Math.round(detail.summary.duration_ms)} ms
          </div>
          {topSpans.map((span) => (
            <div key={span.span_id} className="rounded-lg bg-background/60 px-3 py-2">
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className="font-medium text-foreground">{span.name}</span>
                <span className="text-xs text-muted-foreground">{Math.round(span.duration_ms)} ms</span>
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                {formatSpanHighlight(span.attributes)}
              </div>
            </div>
          ))}
        </div>
      )}
      {!detail && error && <div className="mt-3 text-xs text-amber-700">{error}</div>}
    </div>
  );
}

function formatSpanHighlight(attributes: Record<string, unknown>) {
  const interestingEntries = ['http.route', 'task.id', 'tool.name', 'heartbeat.status']
    .map((key) => [key, attributes[key]] as const)
    .filter(([, value]) => typeof value === 'string' && value.length > 0)
    .slice(0, 2);

  if (interestingEntries.length === 0) {
    return 'Detailed span attributes are available for this trace.';
  }

  return interestingEntries.map(([key, value]) => `${key}: ${value}`).join(' | ');
}

function Metric({ label, value, helper }: { label: string; value: number | string; helper: string }) {
  return (
    <div className="rounded-xl border bg-muted/20 p-4">
      <div className="text-sm text-muted-foreground">{label}</div>
      <div className="mt-2 text-2xl font-semibold">{value}</div>
      <div className="mt-1 text-xs text-muted-foreground">{helper}</div>
    </div>
  );
}

function Insight({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-xl border bg-muted/20 p-4">
      <div className="font-medium text-foreground">{title}</div>
      <div className="mt-1">{body}</div>
    </div>
  );
}

function SummaryGroup({
  title,
  items,
  empty,
}: {
  title: string;
  items: Array<{ label: string; value: string }>;
  empty: string;
}) {
  return (
    <div className="rounded-xl border bg-muted/20 p-4">
      <div className="text-sm font-medium text-foreground">{title}</div>
      <div className="mt-3 space-y-2">
        {items.length > 0 ? (
          items.map((item) => (
            <div key={item.label} className="flex items-center justify-between gap-3 rounded-lg bg-background/60 px-3 py-2 text-sm">
              <span className="truncate text-muted-foreground">{item.label}</span>
              <span className="font-medium text-foreground">{item.value}</span>
            </div>
          ))
        ) : (
          <div className="text-sm text-muted-foreground">{empty}</div>
        )}
      </div>
    </div>
  );
}
