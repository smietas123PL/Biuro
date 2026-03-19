import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Activity,
  BrainCircuit,
  Building2,
  Clock3,
  GitBranchPlus,
  Network,
  PauseCircle,
  PlayCircle,
  RadioTower,
  UserRound,
  UsersRound,
} from 'lucide-react';
import { clsx } from 'clsx';
import { useApi, useWebSocket } from '../hooks/useApi';
import { useCompany } from '../context/CompanyContext';

type AgentRecord = {
  id: string;
  name: string;
  role: string;
  title?: string | null;
  reports_to?: string | null;
  runtime?: string | null;
  model?: string | null;
  status: 'idle' | 'working' | 'paused' | 'terminated' | string;
};

type AgentNode = AgentRecord & {
  children: AgentNode[];
};

type ActivityItem = {
  id: string;
  type: string;
  created_at: string;
  cost_usd: number;
  agent_id?: string | null;
  task_id?: string | null;
  task_title?: string | null;
  thought?: string | null;
  summary: string;
};

type HeartbeatItem = {
  status: string;
  timestamp: string;
  duration_ms?: number | null;
  cost_usd?: number | null;
  details?: Record<string, unknown> | null;
};

type BudgetItem = {
  agent_id: string;
  month: string;
  limit_usd: number;
  spent_usd: number;
  created_at: string;
};

type LiveOrgEvent = {
  event: string;
  data?: {
    agentId?: string;
    agent_id?: string;
    taskId?: string;
    task_id?: string;
    taskTitle?: string;
    task_title?: string;
    thought?: string;
    message?: string;
  };
  timestamp: string;
};

type LiveAgentSnapshot = {
  lastWorkingAt?: string | null;
  currentTaskId?: string | null;
  currentTaskTitle?: string | null;
  thought?: string | null;
  lastHeartbeatAt?: string | null;
  stickyStatus?: AgentRecord['status'] | null;
};

type AgentDisplayState = {
  status: AgentRecord['status'];
  pulseActive: boolean;
  currentTaskId: string | null;
  currentTaskTitle: string | null;
  thought: string | null;
  lastHeartbeatAt: string | null;
};

const LIVE_PULSE_WINDOW_MS = 90_000;

function buildAgentTree(agents: AgentRecord[]) {
  const nodeMap = new Map<string, AgentNode>();
  for (const agent of agents) {
    nodeMap.set(agent.id, { ...agent, children: [] });
  }

  const roots: AgentNode[] = [];
  for (const agent of agents) {
    const node = nodeMap.get(agent.id);
    if (!node) {
      continue;
    }

    if (agent.reports_to) {
      const manager = nodeMap.get(agent.reports_to);
      if (manager) {
        manager.children.push(node);
        continue;
      }
    }

    roots.push(node);
  }

  return roots;
}

function countLeaves(nodes: AgentNode[]): number {
  return nodes.reduce((sum, node) => {
    if (node.children.length === 0) {
      return sum + 1;
    }
    return sum + countLeaves(node.children);
  }, 0);
}

function maxDepth(nodes: AgentNode[], depth = 0): number {
  if (nodes.length === 0) {
    return depth;
  }

  return Math.max(...nodes.map((node) => maxDepth(node.children, depth + 1)));
}

function getStatusTone(status: AgentRecord['status']) {
  if (status === 'working') {
    return {
      badge: 'bg-sky-100 text-sky-700',
      border: 'border-sky-300 bg-sky-50/70',
      dot: 'bg-sky-500',
      label: 'Working',
    };
  }

  if (status === 'paused') {
    return {
      badge: 'bg-amber-100 text-amber-700',
      border: 'border-amber-300 bg-amber-50/70',
      dot: 'bg-amber-500',
      label: 'Paused',
    };
  }

  if (status === 'idle') {
    return {
      badge: 'bg-emerald-100 text-emerald-700',
      border: 'border-emerald-300 bg-emerald-50/70',
      dot: 'bg-emerald-500',
      label: 'Idle',
    };
  }

  return {
    badge: 'bg-slate-200 text-slate-700',
    border: 'border-slate-300 bg-slate-50/70',
    dot: 'bg-slate-500',
    label: String(status),
  };
}

function normalizeThought(
  item: Pick<ActivityItem, 'type' | 'summary' | 'thought'>
) {
  const explicitThought =
    typeof item.thought === 'string' ? item.thought.trim() : '';
  if (explicitThought) {
    return explicitThought;
  }

  const summary = item.summary.trim();
  if (!summary || item.type !== 'heartbeat.worked') {
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

function formatCurrency(value: number | null | undefined) {
  const amount =
    typeof value === 'number' && Number.isFinite(value) ? value : 0;
  return `$${amount.toFixed(2)}`;
}

function formatDuration(durationMs?: number | null) {
  if (!durationMs || durationMs <= 0) {
    return 'n/a';
  }

  if (durationMs >= 60_000) {
    return `${(durationMs / 60_000).toFixed(1)} min`;
  }

  if (durationMs >= 1_000) {
    return `${(durationMs / 1_000).toFixed(1)} s`;
  }

  return `${durationMs} ms`;
}

function formatRelativeTime(value?: string | null, now = Date.now()) {
  if (!value) {
    return 'No signal yet';
  }

  const timestamp = new Date(value).getTime();
  if (Number.isNaN(timestamp)) {
    return 'Unknown time';
  }

  const deltaSeconds = Math.max(0, Math.round((now - timestamp) / 1000));
  if (deltaSeconds < 10) return 'Just now';
  if (deltaSeconds < 60) return `${deltaSeconds}s ago`;
  if (deltaSeconds < 3_600) return `${Math.round(deltaSeconds / 60)}m ago`;
  if (deltaSeconds < 86_400) return `${Math.round(deltaSeconds / 3_600)}h ago`;
  return `${Math.round(deltaSeconds / 86_400)}d ago`;
}

function getBudgetUtilization(budget: BudgetItem | null) {
  if (!budget || !budget.limit_usd || budget.limit_usd <= 0) {
    return null;
  }

  return Math.min(
    100,
    Math.max(0, (budget.spent_usd / budget.limit_usd) * 100)
  );
}

export default function OrgChartPage() {
  const { request, loading, error } = useApi();
  const { selectedCompany, selectedCompanyId } = useCompany();
  const [agents, setAgents] = useState<AgentRecord[]>([]);
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [selectedAgentDetail, setSelectedAgentDetail] =
    useState<AgentRecord | null>(null);
  const [selectedHeartbeats, setSelectedHeartbeats] = useState<HeartbeatItem[]>(
    []
  );
  const [selectedBudget, setSelectedBudget] = useState<BudgetItem | null>(null);
  const [panelLoading, setPanelLoading] = useState(false);
  const [panelError, setPanelError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<'pause' | 'resume' | null>(
    null
  );
  const [liveSnapshots, setLiveSnapshots] = useState<
    Record<string, LiveAgentSnapshot>
  >({});
  const [now, setNow] = useState(Date.now());
  const lastEvent = useWebSocket(
    selectedCompanyId ?? undefined
  ) as LiveOrgEvent | null;

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNow(Date.now());
    }, 15_000);

    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const fetchOrgChart = async () => {
      if (!selectedCompanyId) {
        setAgents([]);
        setActivity([]);
        setSelectedAgentId(null);
        setSelectedAgentDetail(null);
        setSelectedHeartbeats([]);
        setSelectedBudget(null);
        setLiveSnapshots({});
        return;
      }

      setLiveSnapshots({});

      const [orgChartResult, activityResult] = await Promise.allSettled([
        request(`/companies/${selectedCompanyId}/org-chart`) as Promise<
          AgentRecord[]
        >,
        request(
          `/companies/${selectedCompanyId}/activity-feed?limit=24`,
          undefined,
          {
            suppressError: true,
          }
        ) as Promise<ActivityItem[]>,
      ]);

      if (orgChartResult.status === 'fulfilled') {
        setAgents(orgChartResult.value);
        setSelectedAgentId((current) =>
          current && orgChartResult.value.some((agent) => agent.id === current)
            ? current
            : null
        );
      }

      setActivity(
        activityResult.status === 'fulfilled' ? activityResult.value : []
      );
    };

    void fetchOrgChart();
  }, [request, selectedCompanyId]);

  useEffect(() => {
    if (!selectedAgentId) {
      setSelectedAgentDetail(null);
      setSelectedHeartbeats([]);
      setSelectedBudget(null);
      setPanelError(null);
      return;
    }

    const fetchSelectedAgent = async () => {
      setPanelLoading(true);
      setPanelError(null);

      try {
        const [agentResult, heartbeatsResult, budgetsResult] =
          await Promise.allSettled([
            request(`/agents/${selectedAgentId}`) as Promise<AgentRecord>,
            request(`/agents/${selectedAgentId}/heartbeats`, undefined, {
              suppressError: true,
            }) as Promise<HeartbeatItem[]>,
            request(`/agents/${selectedAgentId}/budgets`, undefined, {
              suppressError: true,
            }) as Promise<BudgetItem[]>,
          ]);

        if (agentResult.status !== 'fulfilled') {
          throw agentResult.reason;
        }

        setSelectedAgentDetail(agentResult.value);
        setSelectedHeartbeats(
          heartbeatsResult.status === 'fulfilled' ? heartbeatsResult.value : []
        );
        setSelectedBudget(
          budgetsResult.status === 'fulfilled' &&
            Array.isArray(budgetsResult.value)
            ? (budgetsResult.value[0] ?? null)
            : null
        );
      } catch (err) {
        setPanelError(
          err instanceof Error
            ? err.message
            : 'Unable to load agent live details.'
        );
      } finally {
        setPanelLoading(false);
      }
    };

    void fetchSelectedAgent();
  }, [request, selectedAgentId]);

  useEffect(() => {
    if (!lastEvent) {
      return;
    }

    const agentId = lastEvent.data?.agentId ?? lastEvent.data?.agent_id;
    if (!agentId) {
      return;
    }

    if (lastEvent.event === 'agent.working') {
      setLiveSnapshots((current) => ({
        ...current,
        [agentId]: {
          ...current[agentId],
          currentTaskId:
            lastEvent.data?.taskId ??
            lastEvent.data?.task_id ??
            current[agentId]?.currentTaskId ??
            null,
          currentTaskTitle:
            lastEvent.data?.taskTitle ??
            lastEvent.data?.task_title ??
            current[agentId]?.currentTaskTitle ??
            null,
          lastWorkingAt: lastEvent.timestamp,
          stickyStatus: null,
        },
      }));
      return;
    }

    if (lastEvent.event === 'agent.thought') {
      const nextThought =
        typeof lastEvent.data?.message === 'string' &&
        lastEvent.data.message.trim().length > 0
          ? lastEvent.data.message.trim()
          : typeof lastEvent.data?.thought === 'string' &&
              lastEvent.data.thought.trim().length > 0
            ? lastEvent.data.thought.trim()
            : null;

      if (!nextThought) {
        return;
      }

      setLiveSnapshots((current) => ({
        ...current,
        [agentId]: {
          ...current[agentId],
          currentTaskId:
            lastEvent.data?.taskId ??
            lastEvent.data?.task_id ??
            current[agentId]?.currentTaskId ??
            null,
          currentTaskTitle:
            lastEvent.data?.taskTitle ??
            lastEvent.data?.task_title ??
            current[agentId]?.currentTaskTitle ??
            null,
          thought: nextThought,
          lastHeartbeatAt: lastEvent.timestamp,
        },
      }));
    }
  }, [lastEvent]);

  const activityByAgent = useMemo(() => {
    const snapshot = new Map<string, LiveAgentSnapshot>();
    for (const item of activity) {
      if (!item.agent_id || snapshot.has(item.agent_id)) {
        continue;
      }

      snapshot.set(item.agent_id, {
        currentTaskId: item.task_id ?? null,
        currentTaskTitle: item.task_title ?? null,
        thought: normalizeThought(item),
        lastHeartbeatAt: item.created_at,
      });
    }
    return snapshot;
  }, [activity]);

  const displayStateByAgent = useMemo(() => {
    const state = new Map<string, AgentDisplayState>();

    for (const agent of agents) {
      const activitySnapshot = activityByAgent.get(agent.id);
      const liveSnapshot = liveSnapshots[agent.id];
      const lastWorkingAt = liveSnapshot?.lastWorkingAt
        ? new Date(liveSnapshot.lastWorkingAt).getTime()
        : null;
      const pulseActive =
        agent.status === 'working' ||
        (typeof lastWorkingAt === 'number' && Number.isFinite(lastWorkingAt)
          ? now - lastWorkingAt <= LIVE_PULSE_WINDOW_MS
          : false);
      const status =
        liveSnapshot?.stickyStatus ?? (pulseActive ? 'working' : agent.status);

      state.set(agent.id, {
        status,
        pulseActive,
        currentTaskId:
          liveSnapshot?.currentTaskId ??
          activitySnapshot?.currentTaskId ??
          null,
        currentTaskTitle:
          liveSnapshot?.currentTaskTitle ??
          activitySnapshot?.currentTaskTitle ??
          null,
        thought: liveSnapshot?.thought ?? activitySnapshot?.thought ?? null,
        lastHeartbeatAt:
          liveSnapshot?.lastHeartbeatAt ??
          activitySnapshot?.lastHeartbeatAt ??
          null,
      });
    }

    return state;
  }, [activityByAgent, agents, liveSnapshots, now]);

  const agentTree = useMemo(() => buildAgentTree(agents), [agents]);
  const managerCount = useMemo(
    () =>
      agents.filter((agent) =>
        agents.some((candidate) => candidate.reports_to === agent.id)
      ).length,
    [agents]
  );
  const contributorCount = useMemo(() => countLeaves(agentTree), [agentTree]);
  const depth = useMemo(() => Math.max(maxDepth(agentTree), 0), [agentTree]);

  const selectedAgentRecord = useMemo(
    () => agents.find((agent) => agent.id === selectedAgentId) ?? null,
    [agents, selectedAgentId]
  );
  const selectedAgent = selectedAgentDetail ?? selectedAgentRecord;
  const selectedState = selectedAgentId
    ? (displayStateByAgent.get(selectedAgentId) ?? null)
    : null;
  const latestHeartbeat = selectedHeartbeats[0] ?? null;
  const budgetUtilization = getBudgetUtilization(selectedBudget);
  const canManageAgents =
    selectedCompany?.role === 'owner' || selectedCompany?.role === 'admin';

  const handleAgentAction = async (action: 'pause' | 'resume') => {
    if (!selectedAgentId) {
      return;
    }

    setActionLoading(action);
    setPanelError(null);

    try {
      await request(`/agents/${selectedAgentId}/${action}`, {
        method: 'POST',
      });

      const nextStatus = action === 'pause' ? 'paused' : 'idle';
      setAgents((current) =>
        current.map((agent) =>
          agent.id === selectedAgentId
            ? { ...agent, status: nextStatus }
            : agent
        )
      );
      setSelectedAgentDetail((current) =>
        current ? { ...current, status: nextStatus } : current
      );
      setLiveSnapshots((current) => ({
        ...current,
        [selectedAgentId]: {
          ...current[selectedAgentId],
          stickyStatus: nextStatus,
        },
      }));
    } catch (err) {
      setPanelError(
        err instanceof Error ? err.message : 'Unable to update agent status.'
      );
    } finally {
      setActionLoading(null);
    }
  };

  if (!selectedCompany) {
    return (
      <div className="rounded-xl border border-dashed p-8 text-sm text-muted-foreground">
        Choose a company to view its reporting structure.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-2">
          <div className="inline-flex items-center gap-2 rounded-full border bg-muted/30 px-3 py-1 text-xs uppercase tracking-wide text-muted-foreground">
            <Network className="h-3.5 w-3.5" />
            Organization View
          </div>
          <h2 className="text-3xl font-bold tracking-tight">Org Chart</h2>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Reporting structure for {selectedCompany.name}, now with live pulse,
            agent drill-down, and direct pause or resume controls from the graph
            itself.
          </p>
        </div>

        <Link
          to="/agents"
          className="inline-flex items-center gap-2 rounded-md border bg-background px-4 py-2 text-sm text-foreground transition-colors hover:bg-accent"
        >
          <UsersRound className="h-4 w-4" />
          Manage Agents
        </Link>
      </div>

      {error && (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard
          icon={<UserRound className="h-5 w-5 text-sky-700" />}
          label="Active seats"
          value={agents.length}
          helper="All non-terminated agents in the current company"
          tone="border-sky-200 bg-sky-50"
        />
        <StatCard
          icon={<Building2 className="h-5 w-5 text-emerald-700" />}
          label="Managers"
          value={managerCount}
          helper="Agents with at least one direct report"
          tone="border-emerald-200 bg-emerald-50"
        />
        <StatCard
          icon={<UsersRound className="h-5 w-5 text-amber-700" />}
          label="Individual contributors"
          value={contributorCount}
          helper="Leaf nodes in the current reporting tree"
          tone="border-amber-200 bg-amber-50"
        />
        <StatCard
          icon={<GitBranchPlus className="h-5 w-5 text-violet-700" />}
          label="Org depth"
          value={depth}
          helper="Longest chain from top-level lead to contributor"
          tone="border-violet-200 bg-violet-50"
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_24rem]">
        <section className="rounded-3xl border bg-card p-6 shadow-sm">
          <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
            <div className="space-y-2">
              <h3 className="text-lg font-semibold">Live Reporting Map</h3>
              <p className="text-sm text-muted-foreground">
                Active agents pulse from websocket activity. Click any node to
                inspect its current task, recent thought, and heartbeat posture.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="inline-flex items-center gap-2 rounded-full border bg-muted/20 px-3 py-1 text-xs text-muted-foreground">
                <span className="relative flex h-2.5 w-2.5">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-sky-400 opacity-75" />
                  <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-sky-500" />
                </span>
                Live pulse
              </div>
              <div className="rounded-full border bg-muted/20 px-3 py-1 text-xs text-muted-foreground">
                {loading
                  ? 'Refreshing structure...'
                  : `${agentTree.length} root ${agentTree.length === 1 ? 'leader' : 'leaders'}`}
              </div>
            </div>
          </div>

          {agentTree.length > 0 ? (
            <div className="space-y-6">
              {agentTree.map((node) => (
                <OrgChartBranch
                  key={node.id}
                  node={node}
                  depth={0}
                  selectedAgentId={selectedAgentId}
                  displayStateByAgent={displayStateByAgent}
                  onSelect={setSelectedAgentId}
                />
              ))}
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed p-10 text-center text-sm text-muted-foreground">
              No reporting lines yet. Assign managers in the Agents page to turn
              the team list into a real org chart.
            </div>
          )}
        </section>

        <aside className="rounded-3xl border bg-card p-6 shadow-sm xl:sticky xl:top-24 xl:self-start">
          <div className="mb-5 flex items-start justify-between gap-3">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border bg-muted/20 px-3 py-1 text-xs uppercase tracking-wide text-muted-foreground">
                <RadioTower className="h-3.5 w-3.5" />
                Live Agent Console
              </div>
              <h3 className="mt-3 text-lg font-semibold">Command Sidepanel</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Pick an org node to inspect live state and intervene without
                leaving the map.
              </p>
            </div>
            {selectedAgentId && (
              <button
                type="button"
                onClick={() => setSelectedAgentId(null)}
                className="rounded-md border px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent"
              >
                Clear
              </button>
            )}
          </div>

          {selectedAgent ? (
            <div className="space-y-5">
              <div className="rounded-2xl border p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="text-lg font-semibold">
                        {selectedAgent.name}
                      </div>
                      {selectedState && (
                        <span
                          className={clsx(
                            'rounded-full px-2 py-1 text-[11px] uppercase tracking-wide',
                            getStatusTone(selectedState.status).badge
                          )}
                        >
                          {getStatusTone(selectedState.status).label}
                        </span>
                      )}
                    </div>
                    <div className="text-sm text-muted-foreground">
                      {selectedAgent.title || selectedAgent.role}
                    </div>
                    <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                      <span>{selectedAgent.runtime ?? 'runtime n/a'}</span>
                      <span>{selectedAgent.model ?? 'model n/a'}</span>
                    </div>
                  </div>
                  <Link
                    to={`/agents/${selectedAgent.id}`}
                    className="rounded-md border px-3 py-1.5 text-xs transition-colors hover:bg-accent"
                  >
                    Full profile
                  </Link>
                </div>
              </div>

              {panelError && (
                <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  {panelError}
                </div>
              )}

              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
                <MetricCard
                  icon={<Activity className="h-4 w-4 text-sky-600" />}
                  label={
                    selectedState?.status === 'working'
                      ? 'Current task'
                      : 'Latest task'
                  }
                  value={
                    selectedState?.currentTaskTitle ?? 'No task signal yet'
                  }
                  helper={
                    selectedState?.currentTaskId ? (
                      <Link
                        to={`/tasks/${selectedState.currentTaskId}`}
                        className="text-sky-700 hover:underline"
                      >
                        Open task
                      </Link>
                    ) : (
                      'Waiting for a live task assignment.'
                    )
                  }
                />
                <MetricCard
                  icon={<Clock3 className="h-4 w-4 text-emerald-600" />}
                  label="Last heartbeat"
                  value={formatRelativeTime(
                    latestHeartbeat?.timestamp ??
                      selectedState?.lastHeartbeatAt,
                    now
                  )}
                  helper={
                    latestHeartbeat
                      ? latestHeartbeat.status
                      : 'No heartbeat persisted yet'
                  }
                />
                <MetricCard
                  icon={<BrainCircuit className="h-4 w-4 text-violet-600" />}
                  label="Latest thought"
                  value={selectedState?.thought ?? 'No thought captured yet'}
                  helper={
                    selectedState?.pulseActive
                      ? 'Live pulse detected in the last 90 seconds.'
                      : 'Based on recent heartbeats.'
                  }
                />
                <MetricCard
                  icon={<Building2 className="h-4 w-4 text-amber-600" />}
                  label="Monthly budget"
                  value={
                    selectedBudget
                      ? `${formatCurrency(selectedBudget.spent_usd)} / ${formatCurrency(selectedBudget.limit_usd)}`
                      : 'No budget row yet'
                  }
                  helper={
                    budgetUtilization !== null
                      ? `${budgetUtilization.toFixed(0)}% utilized this month`
                      : 'Set a budget to track utilization.'
                  }
                />
              </div>

              {budgetUtilization !== null && (
                <div className="rounded-2xl border p-4">
                  <div className="mb-2 flex items-center justify-between text-sm">
                    <span className="font-medium">Budget utilization</span>
                    <span className="text-muted-foreground">
                      {budgetUtilization.toFixed(0)}%
                    </span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-muted">
                    <div
                      className={clsx(
                        'h-full rounded-full transition-all',
                        budgetUtilization >= 90
                          ? 'bg-rose-500'
                          : budgetUtilization >= 70
                            ? 'bg-amber-500'
                            : 'bg-emerald-500'
                      )}
                      style={{ width: `${budgetUtilization}%` }}
                    />
                  </div>
                </div>
              )}

              <div className="rounded-2xl border p-4">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div>
                    <h4 className="font-medium">Direct control</h4>
                    <p className="text-sm text-muted-foreground">
                      Pause or resume this agent directly from the org graph.
                    </p>
                  </div>
                </div>

                {canManageAgents ? (
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => void handleAgentAction('pause')}
                      disabled={
                        actionLoading !== null ||
                        selectedState?.status === 'paused'
                      }
                      className="inline-flex items-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800 transition-colors hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <PauseCircle className="h-4 w-4" />
                      {actionLoading === 'pause' ? 'Pausing...' : 'Pause agent'}
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleAgentAction('resume')}
                      disabled={
                        actionLoading !== null ||
                        selectedState?.status === 'working' ||
                        selectedState?.status === 'idle'
                      }
                      className="inline-flex items-center gap-2 rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 transition-colors hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <PlayCircle className="h-4 w-4" />
                      {actionLoading === 'resume'
                        ? 'Resuming...'
                        : 'Resume agent'}
                    </button>
                  </div>
                ) : (
                  <div className="rounded-xl border border-dashed px-3 py-3 text-sm text-muted-foreground">
                    Only owners and admins can pause or resume agents from the
                    graph.
                  </div>
                )}
              </div>

              <div className="rounded-2xl border p-4">
                <h4 className="font-medium">Heartbeat detail</h4>
                {panelLoading ? (
                  <p className="mt-3 text-sm text-muted-foreground">
                    Loading live agent detail...
                  </p>
                ) : latestHeartbeat ? (
                  <div className="mt-3 space-y-3">
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      <span
                        className={clsx(
                          'rounded-full px-2 py-1 text-[11px] uppercase tracking-wide',
                          getStatusTone(
                            (latestHeartbeat.status as AgentRecord['status']) ??
                              'idle'
                          ).badge
                        )}
                      >
                        {latestHeartbeat.status}
                      </span>
                      <span className="text-muted-foreground">
                        {new Date(latestHeartbeat.timestamp).toLocaleString()}
                      </span>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
                      <div className="rounded-xl bg-muted/40 px-3 py-2 text-sm">
                        Duration:{' '}
                        <span className="font-medium">
                          {formatDuration(latestHeartbeat.duration_ms)}
                        </span>
                      </div>
                      <div className="rounded-xl bg-muted/40 px-3 py-2 text-sm">
                        Cost:{' '}
                        <span className="font-medium">
                          {formatCurrency(latestHeartbeat.cost_usd)}
                        </span>
                      </div>
                    </div>
                    <div className="rounded-xl bg-muted/40 px-3 py-3 text-sm text-muted-foreground">
                      {typeof latestHeartbeat.details?.thought === 'string' &&
                      latestHeartbeat.details.thought.trim().length > 0
                        ? latestHeartbeat.details.thought
                        : 'No reasoning note stored on the last heartbeat.'}
                    </div>
                  </div>
                ) : (
                  <p className="mt-3 text-sm text-muted-foreground">
                    This agent has not persisted a heartbeat yet. The panel will
                    fill in after the first run.
                  </p>
                )}
              </div>
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed p-6 text-sm text-muted-foreground">
              Click an org node to open the live sidepanel. You will see the
              latest task, recent thought, heartbeat timing, budget posture, and
              direct pause or resume controls.
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  helper,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  helper: string;
  tone: string;
}) {
  return (
    <div className={`rounded-2xl border p-5 shadow-sm ${tone}`}>
      <div className="mb-5 flex items-center justify-between">
        <span className="text-sm font-medium">{label}</span>
        {icon}
      </div>
      <div className="text-3xl font-bold tracking-tight">{value}</div>
      <div className="mt-2 text-sm text-muted-foreground">{helper}</div>
    </div>
  );
}

function MetricCard({
  icon,
  label,
  value,
  helper,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  helper: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border p-4">
      <div className="mb-3 flex items-center gap-2 text-sm text-muted-foreground">
        {icon}
        <span>{label}</span>
      </div>
      <div className="text-sm font-medium text-foreground">{value}</div>
      <div className="mt-2 text-xs text-muted-foreground">{helper}</div>
    </div>
  );
}

function OrgChartBranch({
  node,
  depth,
  selectedAgentId,
  displayStateByAgent,
  onSelect,
}: {
  node: AgentNode;
  depth: number;
  selectedAgentId: string | null;
  displayStateByAgent: Map<string, AgentDisplayState>;
  onSelect: (agentId: string) => void;
}) {
  const displayState = displayStateByAgent.get(node.id) ?? {
    status: node.status,
    pulseActive: node.status === 'working',
    currentTaskId: null,
    currentTaskTitle: null,
    thought: null,
    lastHeartbeatAt: null,
  };
  const tone = getStatusTone(displayState.status);
  const isSelected = selectedAgentId === node.id;

  return (
    <div className="space-y-4">
      <div className="relative">
        {depth > 0 && (
          <div
            className="absolute left-5 top-[-18px] h-[18px] w-px bg-border"
            aria-hidden="true"
          />
        )}

        <div
          className={clsx(
            'rounded-2xl border bg-background p-4 shadow-sm transition-all',
            tone.border,
            isSelected && 'ring-2 ring-primary/25'
          )}
          style={{ marginLeft: `${depth * 28}px` }}
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <button
              type="button"
              onClick={() => onSelect(node.id)}
              className="min-w-0 flex-1 space-y-2 text-left"
              aria-label={`Inspect ${node.name}`}
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="relative flex h-3 w-3 items-center justify-center">
                  {displayState.pulseActive && (
                    <span
                      className={clsx(
                        'absolute inline-flex h-3 w-3 animate-ping rounded-full opacity-75',
                        tone.dot
                      )}
                    />
                  )}
                  <span
                    className={clsx(
                      'relative inline-flex h-3 w-3 rounded-full',
                      tone.dot
                    )}
                  />
                </span>
                <span className="font-semibold text-foreground transition-colors hover:text-primary">
                  {node.name}
                </span>
                <span
                  className={clsx(
                    'rounded-full px-2 py-1 text-[11px] uppercase tracking-wide',
                    tone.badge
                  )}
                >
                  {tone.label}
                </span>
                {depth === 0 && (
                  <span className="rounded-full bg-slate-100 px-2 py-1 text-[11px] uppercase tracking-wide text-slate-700">
                    top level
                  </span>
                )}
              </div>
              <div className="text-sm text-muted-foreground">
                {node.title || node.role}
              </div>
              {displayState.currentTaskTitle && (
                <div className="text-sm text-foreground">
                  <span className="font-medium">
                    {displayState.status === 'working'
                      ? 'Current task:'
                      : 'Latest task:'}
                  </span>{' '}
                  {displayState.currentTaskTitle}
                </div>
              )}
              {displayState.thought && (
                <div className="line-clamp-2 text-sm text-muted-foreground">
                  {displayState.thought}
                </div>
              )}
            </button>

            <div className="flex flex-col items-end gap-2">
              <div className="rounded-full border bg-muted/20 px-3 py-1 text-xs text-muted-foreground">
                {node.children.length} direct report
                {node.children.length === 1 ? '' : 's'}
              </div>
              <Link
                to={`/agents/${node.id}`}
                className="rounded-md border px-3 py-1.5 text-xs transition-colors hover:bg-accent"
              >
                Profile
              </Link>
            </div>
          </div>
        </div>
      </div>

      {node.children.length > 0 && (
        <div className="space-y-4">
          {node.children.map((child) => (
            <OrgChartBranch
              key={child.id}
              node={child}
              depth={depth + 1}
              selectedAgentId={selectedAgentId}
              displayStateByAgent={displayStateByAgent}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}
    </div>
  );
}
