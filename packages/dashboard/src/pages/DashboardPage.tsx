import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Activity,
  ArrowRight,
  BrainCircuit,
  CheckCircle2,
  Clock3,
  ListTodo,
  ShieldAlert,
  Users,
  WalletCards,
} from 'lucide-react';
import { clsx } from 'clsx';
import { useApi, useWebSocket, type ApiTraceSnapshot } from '../hooks/useApi';
import { useAuth } from '../context/AuthContext';
import { useCompany } from '../context/CompanyContext';
import { useOnboarding } from '../context/OnboardingContext';
import { buildGrafanaTraceExploreUrl } from '../lib/grafana';
import { getChecklistDismissedKey } from '../lib/onboarding';
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

type UnifiedStreamItem = ThoughtStreamItem | ActivityItem;

function isThoughtStreamItem(
  item: UnifiedStreamItem
): item is ThoughtStreamItem {
  return 'source' in item;
}

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

function normalizeThoughtText(
  item: Pick<ActivityItem, 'type' | 'summary' | 'thought'>
) {
  const explicitThought =
    typeof item.thought === 'string' ? item.thought.trim() : '';
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

  if (
    summary === 'Completed a heartbeat cycle.' ||
    summary.startsWith('Heartbeat status:')
  ) {
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

export default function DashboardPage() {
  const { request, loading, error, lastTrace } = useApi();
  const { user } = useAuth();
  const { selectedCompany, selectedCompanyId } = useCompany();
  const { hasCompleted, startTutorial, status: onboardingStatus } =
    useOnboarding();
  const [stats, setStats] = useState<CompanyStats>(emptyStats);
  const [budgetTotals, setBudgetTotals] =
    useState<BudgetTotals>(emptyBudgetTotals);
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [liveThoughts, setLiveThoughts] = useState<ThoughtStreamItem[]>([]);
  const [traceDetail, setTraceDetail] = useState<TraceDetail | null>(null);
  const [traceError, setTraceError] = useState<string | null>(null);
  const [costPulse, setCostPulse] = useState<number | null>(null);
  const [budgetToasts, setBudgetToasts] = useState<BudgetToast[]>([]);
  const [checklistDismissed, setChecklistDismissed] = useState(false);
  const [streamFilter, setStreamFilter] = useState<'all' | 'thoughts' | 'actions' | 'errors'>('all');
  const lastEvent = useWebSocket(selectedCompanyId ?? undefined) as {
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
  } | null;

  const refreshBudgetTotals = async () => {
    if (!selectedCompanyId) {
      setBudgetTotals(emptyBudgetTotals);
      return;
    }

    const summary = (await request(
      `/companies/${selectedCompanyId}/budgets-summary`,
      undefined,
      {
        suppressError: true,
        trackTrace: false,
      }
    )) as { totals: BudgetTotals };
    setBudgetTotals(summary.totals);
  };

  useEffect(() => {
    const fetchDashboardData = async () => {
      if (!selectedCompanyId) {
        setStats(emptyStats);
        setBudgetTotals(emptyBudgetTotals);
        setActivity([]);
        setLiveThoughts([]);
        return;
      }

      const statsData = (await request(
        `/companies/${selectedCompanyId}/stats`
      )) as CompanyStats;
      const [
        activityResult,
        budgetResult,
      ] = await Promise.allSettled([
        request(
          `/companies/${selectedCompanyId}/activity-feed?limit=20`,
          undefined,
          { suppressError: true }
        ) as Promise<ActivityItem[]>,
        request(`/companies/${selectedCompanyId}/budgets-summary`, undefined, {
          suppressError: true,
          trackTrace: false,
        }) as Promise<{ totals: BudgetTotals }>,
      ]);

      setStats(statsData);
      setActivity(
        activityResult.status === 'fulfilled' ? activityResult.value : []
      );
      setLiveThoughts(
        activityResult.status === 'fulfilled'
          ? buildThoughtStreamFromActivity(activityResult.value)
          : []
      );
      setBudgetTotals(
        budgetResult.status === 'fulfilled'
          ? budgetResult.value.totals
          : emptyBudgetTotals
      );
    };

    void fetchDashboardData();
  }, [request, selectedCompanyId]);

  const unifiedStream = useMemo(() => {
    const combined: UnifiedStreamItem[] = [
      ...activity,
      ...liveThoughts.filter(lt => !activity.some(a => a.id === lt.id))
    ];
    
    const sorted = combined.sort((a, b) => 
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );

    if (streamFilter === 'all') return sorted.slice(0, 20);
    
    return sorted
      .filter((item) => {
        const isThought = isThoughtStreamItem(item);
        if (streamFilter === 'thoughts') return isThought;
        if (streamFilter === 'errors') {
          return !isThought && item.type.includes('error');
        }
        if (streamFilter === 'actions') {
          return !isThought && !item.type.includes('error');
        }
        return true;
      })
      .slice(0, 20);
  }, [activity, liveThoughts, streamFilter]);

  useEffect(() => {
    if (!lastTrace?.traceId) {
      setTraceDetail(null);
      setTraceError(null);
      return;
    }

    const loadTraceDetail = async () => {
      try {
        const detail = (await request(
          `/observability/traces/${lastTrace.traceId}`,
          undefined,
          {
            suppressError: true,
            trackTrace: false,
          }
        )) as TraceDetail;
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
      typeof lastEvent.data?.message === 'string' &&
      lastEvent.data.message.trim().length > 0
        ? lastEvent.data.message.trim()
        : typeof lastEvent.data?.thought === 'string' &&
            lastEvent.data.thought.trim().length > 0
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
      task_id: lastEvent.data?.taskId ?? lastEvent.data?.task_id ?? null,
      task_title:
        lastEvent.data?.taskTitle ?? lastEvent.data?.task_title ?? null,
      thought,
      created_at: lastEvent.timestamp,
      source: 'live',
    };

    setLiveThoughts((current) => {
      const next = [
        liveThought,
        ...current.filter((item) => item.agent_id !== liveThought.agent_id),
      ];
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
        typeof lastEvent.data?.delta_cost_usd === 'number'
          ? lastEvent.data.delta_cost_usd
          : null;

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

  useEffect(() => {
    if (!user?.id || !selectedCompanyId) {
      setChecklistDismissed(false);
      return;
    }

    const dismissed =
      localStorage.getItem(getChecklistDismissedKey(user.id, selectedCompanyId)) ===
      'dismissed';
    setChecklistDismissed(dismissed);
  }, [selectedCompanyId, user?.id]);

  const checklistItems = useMemo(
    () => [
      {
        id: 'agent',
        label: 'Hire your first agent',
        description: 'Create a teammate who can execute workstreams.',
        done: stats.agent_count > 0,
        href: '/agents',
        cta: 'Open agents',
        icon: Users,
      },
      {
        id: 'task',
        label: 'Create a first task',
        description: 'Turn the first workflow into an assignable item.',
        done: stats.task_count > 0,
        href: '/tasks',
        cta: 'Open tasks',
        icon: ListTodo,
      },
      {
        id: 'budget',
        label: 'Set an operating budget',
        description: 'Define a spending cap before agents scale up usage.',
        done: budgetTotals.limit_usd > 0,
        href: '/budgets',
        cta: 'Open budgets',
        icon: WalletCards,
      },
      {
        id: 'approvals',
        label: 'Clear pending approvals',
        description: 'Review queued governance decisions that need a human.',
        done: stats.pending_approvals === 0,
        href: '/approvals',
        cta: 'Review approvals',
        icon: ShieldAlert,
      },
    ],
    [
      budgetTotals.limit_usd,
      stats.agent_count,
      stats.pending_approvals,
      stats.task_count,
    ]
  );
  const remainingChecklistCount = checklistItems.filter((item) => !item.done).length;
  const showChecklist =
    hasCompleted &&
    onboardingStatus !== 'active' &&
    !checklistDismissed &&
    selectedCompany;

  if (!selectedCompany) {
    return (
      <div
        className="rounded-xl border border-dashed p-8 text-sm text-muted-foreground"
        data-onboarding-target="dashboard-empty-state"
      >
        Choose a company to see live metrics.
      </div>
    );
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
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
          <TraceLinkCallout
            trace={lastTrace}
            title="Debug This Error"
            body="Open the most recent API trace in Grafana Explore to inspect the failure path."
            compact
          />
        </div>
      ) : null}

      {showChecklist ? (
        <div
          className="checklist-enter rounded-[28px] border border-sky-200 bg-gradient-to-br from-sky-50 via-white to-cyan-50 p-6 shadow-sm"
          data-onboarding-target="post-onboarding-checklist"
        >
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.22em] text-sky-700">
                Next Steps
              </div>
              <h3 className="mt-2 text-2xl font-semibold tracking-tight text-foreground">
                Turn the walkthrough into your first working setup
              </h3>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
                The product tour is done. This checklist adapts to the current
                company state so the next action is obvious, even in a fresh
                workspace.
              </p>
            </div>
            <div className="rounded-2xl border border-sky-200 bg-white/80 px-4 py-3 text-right">
              <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                Progress
              </div>
              <div className="mt-1 text-2xl font-semibold text-foreground">
                {checklistItems.length - remainingChecklistCount}/{checklistItems.length}
              </div>
              <div className="text-sm text-muted-foreground">
                {remainingChecklistCount === 0
                  ? 'Workspace looks ready'
                  : `${remainingChecklistCount} step${remainingChecklistCount === 1 ? '' : 's'} left`}
              </div>
            </div>
          </div>

          <div className="mt-5 grid gap-3 lg:grid-cols-2">
            {checklistItems.map((item, index) => (
              <div
                key={item.id}
                className="checklist-item-enter rounded-2xl border bg-white/80 p-4 shadow-sm"
                style={{
                  animationDelay: `${index * 60}ms`,
                }}
              >
                <div className="flex items-start gap-3">
                  <div
                    className={`mt-0.5 flex h-10 w-10 items-center justify-center rounded-2xl border ${
                      item.done
                        ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                        : 'border-sky-200 bg-sky-50 text-sky-700'
                    }`}
                  >
                    {item.done ? (
                      <CheckCircle2 className="h-5 w-5" />
                    ) : (
                      <item.icon className="h-5 w-5" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="font-medium text-foreground">
                        {item.label}
                      </div>
                      <span
                        className={`rounded-full px-2 py-1 text-[11px] font-medium uppercase tracking-wide ${
                          item.done
                            ? 'bg-emerald-100 text-emerald-700'
                            : 'bg-sky-100 text-sky-700'
                        }`}
                      >
                        {item.done ? 'Done' : 'Next'}
                      </span>
                    </div>
                    <p className="mt-1 text-sm leading-6 text-muted-foreground">
                      {item.description}
                    </p>
                    <div className="mt-3">
                      <Link
                        to={item.href}
                        className="inline-flex items-center gap-2 text-sm font-medium text-foreground transition-colors hover:text-primary"
                      >
                        {item.done ? 'Review' : item.cta}
                        <ArrowRight className="h-4 w-4" />
                      </Link>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => startTutorial()}
              className="rounded-full border px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
            >
              Replay tutorial
            </button>
            <button
              type="button"
              onClick={() => {
                if (user?.id && selectedCompanyId) {
                  localStorage.setItem(
                    getChecklistDismissedKey(user.id, selectedCompanyId),
                    'dismissed'
                  );
                }
                setChecklistDismissed(true);
              }}
              className="rounded-full px-4 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              Hide checklist
            </button>
          </div>
        </div>
      ) : null}

      <div
        className="grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)]"
        data-onboarding-target="dashboard-metrics"
      >
        <div className="rounded-2xl border bg-card p-6 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
                Live Cost Ticker
              </div>
              <div className="mt-2 text-4xl font-semibold tracking-tight">
                ${stats.daily_cost_usd.toFixed(4)} today
              </div>
              <div className="mt-2 text-sm text-muted-foreground">
                Streaming directly from heartbeat cost events without a manual
                refresh.
              </div>
            </div>
            <div
              className={`rounded-full border px-3 py-1 text-xs font-medium ${
                costPulse && costPulse > 0
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                  : 'border-muted bg-muted/30 text-muted-foreground'
              }`}
            >
              {costPulse && costPulse > 0
                ? `+ $${costPulse.toFixed(4)} latest heartbeat`
                : 'Waiting for next heartbeat'}
            </div>
          </div>
        </div>

        <div className="rounded-2xl border bg-card p-6 shadow-sm">
          <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
            Budget Gauge
          </div>
          <div className="mt-2 flex items-end justify-between gap-4">
            <div className="text-4xl font-semibold tracking-tight">
              {budgetTotals.utilization_pct === null
                ? 'No cap'
                : `${budgetTotals.utilization_pct.toFixed(0)}%`}
            </div>
            <div className="text-right text-sm text-muted-foreground">
              <div>${budgetTotals.spent_usd.toFixed(2)} spent</div>
              <div>${budgetTotals.limit_usd.toFixed(2)} allocated</div>
            </div>
          </div>
          <div className="mt-4 h-3 overflow-hidden rounded-full bg-muted/30">
            <div
              className={`h-full rounded-full transition-all ${
                budgetTotals.utilization_pct !== null &&
                budgetTotals.utilization_pct >= 95
                  ? 'bg-red-500'
                  : budgetTotals.utilization_pct !== null &&
                      budgetTotals.utilization_pct >= 80
                    ? 'bg-amber-400'
                    : 'bg-emerald-500'
              }`}
              style={{
                width: `${budgetTotals.utilization_pct === null ? 0 : Math.max(Math.min(budgetTotals.utilization_pct, 100), 4)}%`,
              }}
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
          <div
            key={card.title}
            className={`rounded-2xl border p-5 shadow-sm ${card.tone}`}
          >
            <div className="mb-6 flex items-center justify-between">
              <span className="text-sm font-medium">{card.title}</span>
              <card.icon className="h-5 w-5" />
            </div>
            <div className="text-3xl font-bold tracking-tight">
              {card.value}
            </div>
            <div className="mt-2 text-sm opacity-80">{card.detail}</div>
          </div>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <div className="rounded-2xl border bg-card p-6 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-lg font-semibold">Operations Snapshot</h3>
            {loading && (
              <span className="text-xs text-muted-foreground">
                Refreshing...
              </span>
            )}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Metric
              label="All Tasks"
              value={stats.task_count}
              helper="Open and completed work combined"
            />
            <Metric
              label="Goals"
              value={stats.goal_count}
              helper="Strategic objectives in the system"
            />
            <Metric
              label="Paused Agents"
              value={stats.paused_agents}
              helper="Requires manual follow-up"
            />
            <Metric
              label="Completed Today"
              value={stats.completed_tasks}
              helper="Tasks marked done so far"
            />
          </div>
        </div>

        <div className="rounded-2xl border bg-card p-6 shadow-sm">
          <h3 className="text-lg font-semibold">What To Watch</h3>
          <div className="mt-4 space-y-3 text-sm text-muted-foreground">
            <Insight
              title="Task flow"
              body={
                stats.pending_tasks > 0
                  ? `${stats.pending_tasks} tasks are still in motion.`
                  : 'Backlog is clear right now.'
              }
            />
            <Insight
              title="Agent utilization"
              body={
                stats.active_agents > 0
                  ? `${stats.active_agents} agents are currently working.`
                  : 'No agents are actively processing work.'
              }
            />
            <Insight
              title="Governance"
              body={
                stats.pending_approvals > 0
                  ? `${stats.pending_approvals} approval requests need attention.`
                  : 'No approval bottlenecks at the moment.'
              }
            />
            <TraceInsight
              trace={lastTrace}
              detail={traceDetail}
              error={traceError}
            />
          </div>
        </div>
      </div>

      <div className="grid gap-4">
        <div className="rounded-2xl border bg-card p-6 shadow-sm">
          <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
            <div>
              <h3 className="text-xl font-bold tracking-tight">Live Operations Stream</h3>
              <p className="text-sm text-muted-foreground mt-1">
                Real-time thoughts, heartbeats and task updates from your agent team.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-4">
              <div className="flex bg-muted/50 p-1 rounded-xl border text-xs font-medium">
                <button
                  onClick={() => setStreamFilter('all')}
                  className={clsx(
                    "px-3 py-1.5 rounded-lg transition-all",
                    streamFilter === 'all' ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  All
                </button>
                <button
                  onClick={() => setStreamFilter('thoughts')}
                  className={clsx(
                    "px-3 py-1.5 rounded-lg transition-all",
                    streamFilter === 'thoughts' ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  Thoughts
                </button>
                <button
                  onClick={() => setStreamFilter('actions')}
                  className={clsx(
                    "px-3 py-1.5 rounded-lg transition-all",
                    streamFilter === 'actions' ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  Actions
                </button>
                <button
                  onClick={() => setStreamFilter('errors')}
                  className={clsx(
                    "px-3 py-1.5 rounded-lg transition-all",
                    streamFilter === 'errors' ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  Errors
                </button>
              </div>
              <Link
                to="/audit"
                className="inline-flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium transition-colors hover:bg-accent"
              >
                Full Audit Log
                <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          </div>

          <div className="space-y-4 max-h-[800px] overflow-y-auto pr-2 scrollbar-hide">
            {unifiedStream.map((item) => (
              <StreamItem key={item.id} item={item} />
            ))}

            {unifiedStream.length === 0 && !loading && (
              <div className="rounded-2xl border border-dashed p-12 text-center text-sm text-muted-foreground">
                No activity detected. The stream will populate as soon as agents start their heartbeat cycles.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function StreamItem({ item }: { item: UnifiedStreamItem }) {
  const isThought = isThoughtStreamItem(item);
  
  return (
    <div className={clsx(
      "relative flex gap-4 p-4 rounded-2xl border transition-all hover:shadow-md",
      isThought ? "bg-gradient-to-br from-sky-50/50 to-white border-sky-100" : "bg-muted/10"
    )}>
      <div className="flex-shrink-0 mt-1">
        {isThought ? (
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-sky-100 text-sky-600 ring-4 ring-white">
            <BrainCircuit className="h-5 w-5" />
          </div>
        ) : (
          <div className={clsx(
            "flex h-10 w-10 items-center justify-center rounded-full ring-4 ring-white",
            item.type === 'heartbeat.error' ? "bg-rose-100 text-rose-600" : "bg-emerald-100 text-emerald-600"
          )}>
            <Activity className="h-5 w-5" />
          </div>
        )}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 mb-1">
          <div className="flex items-center gap-2">
            <span className="font-bold text-sm text-foreground">
              {item.agent_name || 'System'}
            </span>
            {item.task_title && (
              <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground/70 truncate max-w-[200px]">
                • {item.task_title}
              </span>
            )}
          </div>
          <span className="text-[11px] text-muted-foreground font-medium">
            {formatThoughtAge(item.created_at)}
          </span>
        </div>

        <div className="text-sm leading-relaxed text-foreground/90">
          {isThought ? item.thought : item.summary}
        </div>

        <div className="mt-3 flex items-center gap-4">
          {item.task_id && (
            <Link to={`/tasks/${item.task_id}`} className="text-[11px] font-semibold text-primary hover:underline underline-offset-2">
              View Task
            </Link>
          )}
          {item.agent_id && (
            <Link to={`/agents/${item.agent_id}`} className="text-[11px] font-semibold text-primary hover:underline underline-offset-2">
              Agent Profile
            </Link>
          )}
          {!isThought && item.cost_usd > 0 && (
              <span className="ml-auto text-[11px] font-mono font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded">
                +${item.cost_usd.toFixed(4)}
              </span>
          )}
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
    trace.traceId.length > 16
      ? `${trace.traceId.slice(0, 8)}...${trace.traceId.slice(-8)}`
      : trace.traceId;
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
        Latest trace{' '}
        <span className="font-mono text-foreground">{traceIdLabel}</span> for{' '}
        {trace.path}
      </div>
      {detail && (
        <div className="mt-3 space-y-2">
          <div className="text-xs text-muted-foreground">
            {detail.summary.span_count} spans across{' '}
            {Math.round(detail.summary.duration_ms)} ms
          </div>
          {topSpans.map((span) => (
            <div
              key={span.span_id}
              className="rounded-lg bg-background/60 px-3 py-2"
            >
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className="font-medium text-foreground">{span.name}</span>
                <span className="text-xs text-muted-foreground">
                  {Math.round(span.duration_ms)} ms
                </span>
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                {formatSpanHighlight(span.attributes)}
              </div>
            </div>
          ))}
        </div>
      )}
      {!detail && error && (
        <div className="mt-3 text-xs text-amber-700">{error}</div>
      )}
    </div>
  );
}

function formatSpanHighlight(attributes: Record<string, unknown>) {
  const interestingEntries = [
    'http.route',
    'task.id',
    'tool.name',
    'heartbeat.status',
  ]
    .map((key) => [key, attributes[key]] as const)
    .filter(([, value]) => typeof value === 'string' && value.length > 0)
    .slice(0, 2);

  if (interestingEntries.length === 0) {
    return 'Detailed span attributes are available for this trace.';
  }

  return interestingEntries
    .map(([key, value]) => `${key}: ${value}`)
    .join(' | ');
}

function Metric({
  label,
  value,
  helper,
}: {
  label: string;
  value: number | string;
  helper: string;
}) {
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
