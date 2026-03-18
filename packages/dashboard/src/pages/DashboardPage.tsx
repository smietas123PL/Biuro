import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Activity, Clock3, ShieldAlert, Users } from 'lucide-react';
import { useApi, useWebSocket } from '../hooks/useApi';
import { useCompany } from '../context/CompanyContext';

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
  summary: string;
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

export default function DashboardPage() {
  const { request, loading, error } = useApi();
  const { selectedCompany, selectedCompanyId } = useCompany();
  const [stats, setStats] = useState<CompanyStats>(emptyStats);
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [retrievalMetrics, setRetrievalMetrics] = useState<RetrievalMetricsSummary | null>(null);
  const lastEvent = useWebSocket(selectedCompanyId ?? undefined) as
    | { event: string; data?: { agentId?: string; agentName?: string; taskId?: string; taskTitle?: string }; timestamp: string }
    | null;

  useEffect(() => {
    const fetchDashboardData = async () => {
      if (!selectedCompanyId) {
        setStats(emptyStats);
        setActivity([]);
        setRetrievalMetrics(null);
        return;
      }

      const statsData = (await request(`/companies/${selectedCompanyId}/stats`)) as CompanyStats;
      const [activityResult, retrievalMetricsResult] = await Promise.allSettled([
        request(`/companies/${selectedCompanyId}/activity-feed?limit=12`, undefined, { suppressError: true }) as Promise<ActivityItem[]>,
        request(`/companies/${selectedCompanyId}/retrieval-metrics?days=7`, undefined, { suppressError: true }) as Promise<RetrievalMetricsSummary>,
      ]);

      setStats(statsData);
      setActivity(activityResult.status === 'fulfilled' ? activityResult.value : []);
      setRetrievalMetrics(retrievalMetricsResult.status === 'fulfilled' ? retrievalMetricsResult.value : null);
    };

    void fetchDashboardData();
  }, [request, selectedCompanyId]);

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
  const topSources = retrievalMetrics?.by_source.slice(0, 3) ?? [];
  const topConsumers = retrievalMetrics?.by_consumer.slice(0, 3) ?? [];
  const recentRetrievals = retrievalMetrics?.recent.slice(0, 4) ?? [];

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h2 className="text-3xl font-bold tracking-tight">Overview</h2>
        <p className="text-sm text-muted-foreground">
          Live operating snapshot for {selectedCompany.name}
        </p>
      </div>

      {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

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
  );
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
