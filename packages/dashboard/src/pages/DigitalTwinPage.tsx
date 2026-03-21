import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  Activity,
  BrainCircuit,
  Clock3,
  Network,
  Radar,
  WalletCards,
  Zap,
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
  monthly_budget_usd?: number | null;
  status: 'idle' | 'working' | 'paused' | 'terminated' | string;
};

type TaskRecord = {
  id: string;
  title: string;
  description?: string | null;
  assigned_to?: string | null;
  priority: number;
  status: string;
  created_at: string;
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

type BudgetSummary = {
  totals: {
    limit_usd: number;
    spent_usd: number;
    remaining_usd: number;
    utilization_pct: number | null;
  };
};

type LiveEvent = {
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
    message?: string;
    delta_cost_usd?: number;
    daily_cost_usd?: number;
    threshold_pct?: number;
    assigned_to?: string | null;
  };
  timestamp: string;
} | null;

type GraphNode = {
  key: string;
  id: string;
  kind: 'agent' | 'task' | 'system';
  label: string;
  subtitle: string;
  x: number;
  y: number;
  z: number;
  tone: 'sky' | 'emerald' | 'amber' | 'violet' | 'rose' | 'slate';
};

type GraphEdge = {
  id: string;
  source: string;
  target: string;
  kind: 'command' | 'task' | 'data' | 'cost';
  intensity: number;
};

type Packet = {
  id: string;
  edgeId: string;
  label: string;
  detail: string;
  color: string;
  createdAt: number;
  durationMs: number;
};

type RailEvent = {
  id: string;
  label: string;
  detail: string;
  timestamp: string;
  tone: 'sky' | 'emerald' | 'amber' | 'violet' | 'rose';
};

type AgentOverlay = {
  currentTaskId?: string | null;
  currentTaskTitle?: string | null;
  latestThought?: string | null;
  lastWorkingAt?: string | null;
  lastCostAt?: string | null;
};

type SelectedNode =
  | { kind: 'system'; id: 'command' | 'memory' | 'budget' }
  | { kind: 'agent'; id: string }
  | { kind: 'task'; id: string };

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

const emptyBudget: BudgetSummary = {
  totals: {
    limit_usd: 0,
    spent_usd: 0,
    remaining_usd: 0,
    utilization_pct: null,
  },
};

const LIVE_WINDOW_MS = 90_000;

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function formatRelativeTime(value: string, now: number) {
  const deltaMs = now - new Date(value).getTime();
  if (!Number.isFinite(deltaMs) || deltaMs < 0) return 'just now';
  const seconds = Math.round(deltaMs / 1000);
  if (seconds < 45) return 'just now';
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.round(seconds / 3600)}h ago`;
  return `${Math.round(seconds / 86_400)}d ago`;
}

function getStatusView(status: string) {
  if (status === 'working') {
    return { label: 'Working', badge: 'bg-sky-100 text-sky-700', tone: 'sky' as const };
  }
  if (status === 'paused') {
    return { label: 'Paused', badge: 'bg-amber-100 text-amber-700', tone: 'amber' as const };
  }
  if (status === 'idle') {
    return { label: 'Idle', badge: 'bg-emerald-100 text-emerald-700', tone: 'emerald' as const };
  }
  return { label: status, badge: 'bg-slate-100 text-slate-700', tone: 'slate' as const };
}

function summarizeTaskStatus(status: string) {
  if (status === 'in_progress') return 'In progress';
  if (status === 'assigned') return 'Assigned';
  if (status === 'blocked') return 'Blocked';
  if (status === 'review') return 'In review';
  if (status === 'done') return 'Done';
  return 'Backlog';
}

function packetColor(kind: GraphEdge['kind']) {
  if (kind === 'task') return '#0ea5e9';
  if (kind === 'data') return '#8b5cf6';
  if (kind === 'cost') return '#10b981';
  return '#f59e0b';
}

function buildAgentLayouts(agents: AgentRecord[]) {
  const active = agents.filter((agent) => agent.status !== 'terminated');
  const childrenByParent = new Map<string | null, AgentRecord[]>();

  for (const agent of active) {
    const parentId = agent.reports_to ?? null;
    const group = childrenByParent.get(parentId) ?? [];
    group.push(agent);
    childrenByParent.set(parentId, group);
  }

  const roots = childrenByParent.get(null) ?? [];
  const ordered: Array<{ agent: AgentRecord; depth: number; path: string }> = [];
  const seen = new Set<string>();

  const visit = (agent: AgentRecord, depth: number, path: string) => {
    if (seen.has(agent.id)) return;
    seen.add(agent.id);
    ordered.push({ agent, depth, path });
    const children = childrenByParent.get(agent.id) ?? [];
    children.forEach((child, index) => visit(child, depth + 1, `${path}.${index}`));
  };

  roots.forEach((root, index) => visit(root, 0, String(index)));
  active.forEach((agent) => {
    if (!seen.has(agent.id)) {
      visit(agent, 0, `orphan.${agent.id}`);
    }
  });

  const maxDepth = Math.max(...ordered.map((item) => item.depth), 0);
  const byDepth = new Map<number, typeof ordered>();
  for (const item of ordered) {
    const group = byDepth.get(item.depth) ?? [];
    group.push(item);
    byDepth.set(item.depth, group);
  }

  const layouts = new Map<
    string,
    { x: number; y: number; z: number; depth: number; agent: AgentRecord }
  >();
  for (const [depth, group] of byDepth.entries()) {
    group
      .sort((left, right) => left.path.localeCompare(right.path))
      .forEach((item, index) => {
        const x = ((index + 1) / (group.length + 1)) * 100;
        const y = maxDepth === 0 ? 34 : 22 + (depth / Math.max(maxDepth, 1)) * 34;
        layouts.set(item.agent.id, {
          x,
          y,
          z: Math.max(18, 44 - depth * 7),
          depth,
          agent: item.agent,
        });
      });
  }

  return { layouts, roots, depth: maxDepth };
}

function railEventFromActivity(item: ActivityItem): RailEvent {
  if (typeof item.thought === 'string' && item.thought.trim().length > 0) {
    return {
      id: `rail-${item.id}`,
      label: `Thought uplink from ${item.agent_name ?? 'Agent'}`,
      detail: item.thought.trim(),
      timestamp: item.created_at,
      tone: 'violet',
    };
  }

  return {
    id: `rail-${item.id}`,
    label: `Heartbeat on ${item.agent_name ?? 'Agent'}`,
    detail: item.task_title ?? item.summary,
    timestamp: item.created_at,
    tone: item.type.includes('error') ? 'rose' : 'sky',
  };
}

function railEventFromLiveEvent(event: LiveEvent): RailEvent | null {
  if (!event) return null;

  const agentName = event.data?.agentName ?? event.data?.agent_name ?? 'Agent';
  const taskTitle = event.data?.taskTitle ?? event.data?.task_title ?? 'Task';

  if (event.event === 'agent.working') {
    return {
      id: `rail-${event.timestamp}-working`,
      label: `Task current routed to ${agentName}`,
      detail: taskTitle,
      timestamp: event.timestamp,
      tone: 'sky',
    };
  }

  if (event.event === 'agent.thought') {
    return {
      id: `rail-${event.timestamp}-thought`,
      label: `Thought uplink from ${agentName}`,
      detail:
        event.data?.message ??
        event.data?.thought ??
        'Fresh reasoning telemetry received.',
      timestamp: event.timestamp,
      tone: 'violet',
    };
  }

  if (event.event === 'cost.updated') {
    return {
      id: `rail-${event.timestamp}-cost`,
      label: `Cost telemetry from ${agentName}`,
      detail:
        typeof event.data?.delta_cost_usd === 'number'
          ? `+$${event.data.delta_cost_usd.toFixed(4)} on ${taskTitle}`
          : taskTitle,
      timestamp: event.timestamp,
      tone: 'emerald',
    };
  }

  if (event.event === 'budget.threshold') {
    return {
      id: `rail-${event.timestamp}-budget`,
      label: `Budget threshold raised for ${agentName}`,
      detail:
        typeof event.data?.threshold_pct === 'number'
          ? `${event.data.threshold_pct}% utilization threshold reached`
          : 'Budget warning emitted',
      timestamp: event.timestamp,
      tone: 'rose',
    };
  }

  if (event.event === 'task.updated') {
    return {
      id: `rail-${event.timestamp}-task`,
      label: 'Task circuit updated',
      detail: taskTitle,
      timestamp: event.timestamp,
      tone: 'amber',
    };
  }

  return null;
}

export default function DigitalTwinPage() {
  const { request, error } = useApi();
  const { selectedCompany, selectedCompanyId } = useCompany();
  const [agents, setAgents] = useState<AgentRecord[]>([]);
  const [tasks, setTasks] = useState<TaskRecord[]>([]);
  const [stats, setStats] = useState<CompanyStats>(emptyStats);
  const [budget, setBudget] = useState<BudgetSummary>(emptyBudget);
  const [overlay, setOverlay] = useState<Record<string, AgentOverlay>>({});
  const [packets, setPackets] = useState<Packet[]>([]);
  const [railEvents, setRailEvents] = useState<RailEvent[]>([]);
  const [selectedNode, setSelectedNode] = useState<SelectedNode>({
    kind: 'system',
    id: 'command',
  });
  const [now, setNow] = useState(Date.now());
  const lastEvent = useWebSocket(selectedCompanyId ?? undefined) as LiveEvent;

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNow(Date.now());
      setPackets((current) =>
        current.filter((packet) => Date.now() - packet.createdAt < packet.durationMs)
      );
    }, 120);

    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const load = async () => {
      if (!selectedCompanyId) {
        setAgents([]);
        setTasks([]);
        setStats(emptyStats);
        setBudget(emptyBudget);
        setOverlay({});
        setPackets([]);
        setRailEvents([]);
        return;
      }

      const [agentsResult, tasksResult, activityResult, statsResult, budgetResult] =
        await Promise.allSettled([
          request(`/companies/${selectedCompanyId}/agents`) as Promise<AgentRecord[]>,
          request(`/companies/${selectedCompanyId}/tasks`) as Promise<TaskRecord[]>,
          request(`/companies/${selectedCompanyId}/activity-feed?limit=30`, undefined, {
            suppressError: true,
          }) as Promise<ActivityItem[]>,
          request(`/companies/${selectedCompanyId}/stats`, undefined, {
            suppressError: true,
            trackTrace: false,
          }) as Promise<CompanyStats>,
          request(`/companies/${selectedCompanyId}/budgets-summary`, undefined, {
            suppressError: true,
            trackTrace: false,
          }) as Promise<BudgetSummary>,
        ]);

      const nextAgents =
        agentsResult.status === 'fulfilled' ? agentsResult.value : [];
      const nextTasks = tasksResult.status === 'fulfilled' ? tasksResult.value : [];
      const nextActivity =
        activityResult.status === 'fulfilled' ? activityResult.value : [];

      setAgents(nextAgents);
      setTasks(nextTasks);
      setStats(statsResult.status === 'fulfilled' ? statsResult.value : emptyStats);
      setBudget(budgetResult.status === 'fulfilled' ? budgetResult.value : emptyBudget);
      setRailEvents(nextActivity.slice(0, 6).map(railEventFromActivity));

      const nextOverlay: Record<string, AgentOverlay> = {};
      for (const item of nextActivity) {
        if (!item.agent_id || nextOverlay[item.agent_id]) continue;
        nextOverlay[item.agent_id] = {
          currentTaskId: item.task_id ?? null,
          currentTaskTitle: item.task_title ?? null,
          latestThought:
            typeof item.thought === 'string' && item.thought.trim().length > 0
              ? item.thought.trim()
              : null,
          lastCostAt: item.cost_usd > 0 ? item.created_at : null,
        };
      }
      setOverlay(nextOverlay);
    };

    void load();
  }, [request, selectedCompanyId]);

  useEffect(() => {
    if (!lastEvent) return;

    const agentId = lastEvent.data?.agentId ?? lastEvent.data?.agent_id ?? null;
    const taskId = lastEvent.data?.taskId ?? lastEvent.data?.task_id ?? null;
    const taskTitle = lastEvent.data?.taskTitle ?? lastEvent.data?.task_title ?? null;

    if (lastEvent.event === 'agent.working' && agentId) {
      setOverlay((current) => ({
        ...current,
        [agentId]: {
          ...current[agentId],
          currentTaskId: taskId,
          currentTaskTitle: taskTitle,
          lastWorkingAt: lastEvent.timestamp,
        },
      }));
    }

    if (lastEvent.event === 'agent.thought' && agentId) {
      const thought =
        typeof lastEvent.data?.message === 'string' &&
        lastEvent.data.message.trim().length > 0
          ? lastEvent.data.message.trim()
          : typeof lastEvent.data?.thought === 'string' &&
              lastEvent.data.thought.trim().length > 0
            ? lastEvent.data.thought.trim()
            : null;

      if (thought) {
        setOverlay((current) => ({
          ...current,
          [agentId]: {
            ...current[agentId],
            currentTaskId: taskId,
            currentTaskTitle: taskTitle,
            latestThought: thought,
          },
        }));
      }
    }

    if (lastEvent.event === 'cost.updated') {
      setStats((current) => ({
        ...current,
        daily_cost_usd:
          typeof lastEvent.data?.daily_cost_usd === 'number'
            ? lastEvent.data.daily_cost_usd
            : current.daily_cost_usd,
      }));
    }

    if (lastEvent.event === 'task.updated' && selectedCompanyId) {
      void request(`/companies/${selectedCompanyId}/tasks`, undefined, {
        suppressError: true,
      })
        .then((data) => setTasks(data as TaskRecord[]))
        .catch(() => undefined);
    }

    const rail = railEventFromLiveEvent(lastEvent);
    if (rail) {
      setRailEvents((current) => [rail, ...current].slice(0, 10));
    }
  }, [lastEvent, request, selectedCompanyId]);

  const { layouts, roots, depth } = useMemo(() => buildAgentLayouts(agents), [agents]);

  const liveAgentIds = useMemo(() => {
    const ids = new Set<string>();
    for (const agent of agents) {
      const liveAt = overlay[agent.id]?.lastWorkingAt
        ? new Date(overlay[agent.id]!.lastWorkingAt!).getTime()
        : null;
      if (
        agent.status === 'working' ||
        (typeof liveAt === 'number' && now - liveAt <= LIVE_WINDOW_MS)
      ) {
        ids.add(agent.id);
      }
    }
    return ids;
  }, [agents, now, overlay]);

  const visibleTasks = useMemo(() => {
    return [...tasks]
      .filter((task) => task.status !== 'done')
      .sort((left, right) => {
        const leftWeight =
          (left.status === 'in_progress' ? 30 : 0) +
          (left.status === 'assigned' ? 20 : 0) +
          left.priority;
        const rightWeight =
          (right.status === 'in_progress' ? 30 : 0) +
          (right.status === 'assigned' ? 20 : 0) +
          right.priority;
        return rightWeight - leftWeight;
      })
      .slice(0, 9);
  }, [tasks]);

  const taskNodes = useMemo(() => {
    const nodes = new Map<string, GraphNode>();
    const tasksByAgent = new Map<string | null, TaskRecord[]>();

    for (const task of visibleTasks) {
      const key = task.assigned_to ?? null;
      const group = tasksByAgent.get(key) ?? [];
      group.push(task);
      tasksByAgent.set(key, group);
    }

    const unassigned = tasksByAgent.get(null) ?? [];

    for (const task of visibleTasks) {
      const siblings = tasksByAgent.get(task.assigned_to ?? null) ?? [task];
      const siblingIndex = siblings.findIndex((candidate) => candidate.id === task.id);
      const anchor = task.assigned_to ? layouts.get(task.assigned_to) : null;
      const baseX = anchor
        ? anchor.x
        : ((unassigned.indexOf(task) + 1) / (unassigned.length + 1 || 1)) * 100;
      const spread = siblings.length > 1 ? (siblingIndex - (siblings.length - 1) / 2) * 6.5 : 0;

      nodes.set(task.id, {
        key: `task:${task.id}`,
        id: task.id,
        kind: 'task',
        label: task.title,
        subtitle: summarizeTaskStatus(task.status),
        x: clamp(baseX + spread, 8, 92),
        y: 77 + Math.floor(Math.max(siblingIndex, 0) / 3) * 7,
        z: 16,
        tone:
          task.status === 'blocked'
            ? 'rose'
            : task.status === 'in_progress'
              ? 'sky'
              : task.status === 'assigned'
                ? 'amber'
                : 'slate',
      });
    }

    return nodes;
  }, [layouts, visibleTasks]);

  const graphNodes = useMemo(() => {
    const nodes = new Map<string, GraphNode>();
    nodes.set('system:command', {
      key: 'system:command',
      id: 'command',
      kind: 'system',
      label: 'Command Mesh',
      subtitle: `${roots.length} root lanes`,
      x: 50,
      y: 10,
      z: 54,
      tone: 'amber',
    });
    nodes.set('system:memory', {
      key: 'system:memory',
      id: 'memory',
      kind: 'system',
      label: 'Memory Fabric',
      subtitle: 'Thought uplinks',
      x: 16,
      y: 33,
      z: 30,
      tone: 'violet',
    });
    nodes.set('system:budget', {
      key: 'system:budget',
      id: 'budget',
      kind: 'system',
      label: 'Budget Rail',
      subtitle: 'Cost telemetry',
      x: 84,
      y: 33,
      z: 28,
      tone: 'emerald',
    });

    for (const [agentId, layout] of layouts.entries()) {
      const status = getStatusView(liveAgentIds.has(agentId) ? 'working' : layout.agent.status);
      nodes.set(`agent:${agentId}`, {
        key: `agent:${agentId}`,
        id: agentId,
        kind: 'agent',
        label: layout.agent.name,
        subtitle:
          overlay[agentId]?.currentTaskTitle ??
          layout.agent.title ??
          layout.agent.role,
        x: layout.x,
        y: layout.y,
        z: layout.z,
        tone: status.tone,
      });
    }

    for (const node of taskNodes.values()) {
      nodes.set(node.key, node);
    }

    return nodes;
  }, [layouts, liveAgentIds, overlay, roots.length, taskNodes]);

  const graphEdges = useMemo(() => {
    const edges: GraphEdge[] = [];

    roots.forEach((root) => {
      edges.push({
        id: `command-root-${root.id}`,
        source: 'system:command',
        target: `agent:${root.id}`,
        kind: 'command',
        intensity: liveAgentIds.has(root.id) ? 1 : 0.45,
      });
    });

    agents
      .filter((agent) => agent.status !== 'terminated')
      .forEach((agent) => {
        if (agent.reports_to) {
          edges.push({
            id: `report-${agent.reports_to}-${agent.id}`,
            source: `agent:${agent.reports_to}`,
            target: `agent:${agent.id}`,
            kind: 'command',
            intensity:
              liveAgentIds.has(agent.id) || liveAgentIds.has(agent.reports_to)
                ? 0.9
                : 0.42,
          });
        }

        if (overlay[agent.id]?.latestThought) {
          edges.push({
            id: `memory-${agent.id}`,
            source: `agent:${agent.id}`,
            target: 'system:memory',
            kind: 'data',
            intensity: 0.86,
          });
        }

        if (
          overlay[agent.id]?.lastCostAt ||
          typeof agent.monthly_budget_usd === 'number'
        ) {
          edges.push({
            id: `budget-${agent.id}`,
            source: `agent:${agent.id}`,
            target: 'system:budget',
            kind: 'cost',
            intensity: 0.72,
          });
        }
      });

    visibleTasks.forEach((task) => {
      if (!task.assigned_to || !graphNodes.has(`agent:${task.assigned_to}`)) return;
      edges.push({
        id: `task-${task.id}-${task.assigned_to}`,
        source: `task:${task.id}`,
        target: `agent:${task.assigned_to}`,
        kind: 'task',
        intensity: task.status === 'in_progress' ? 0.96 : 0.6,
      });
    });

    return edges.filter(
      (edge) => graphNodes.has(edge.source) && graphNodes.has(edge.target)
    );
  }, [agents, graphNodes, liveAgentIds, overlay, roots, visibleTasks]);

  const edgeById = useMemo(() => {
    const map = new Map<string, GraphEdge>();
    graphEdges.forEach((edge) => map.set(edge.id, edge));
    return map;
  }, [graphEdges]);

  useEffect(() => {
    if (!lastEvent) return;

    const agentId = lastEvent.data?.agentId ?? lastEvent.data?.agent_id ?? null;
    const taskId = lastEvent.data?.taskId ?? lastEvent.data?.task_id ?? null;
    const timestamp = new Date(lastEvent.timestamp).getTime();
    const nextPackets: Packet[] = [];

    if (lastEvent.event === 'agent.working' && agentId) {
      if (taskId && edgeById.has(`task-${taskId}-${agentId}`)) {
        nextPackets.push({
          id: `packet-${lastEvent.timestamp}-${agentId}-task`,
          edgeId: `task-${taskId}-${agentId}`,
          label: 'Execution current',
          detail: lastEvent.data?.taskTitle ?? lastEvent.data?.task_title ?? 'Live task current',
          color: packetColor('task'),
          createdAt: timestamp,
          durationMs: 2600,
        });
      }

      const parentId = agents.find((agent) => agent.id === agentId)?.reports_to;
      const commandEdgeId = parentId
        ? `report-${parentId}-${agentId}`
        : `command-root-${agentId}`;
      if (edgeById.has(commandEdgeId)) {
        nextPackets.push({
          id: `packet-${lastEvent.timestamp}-${agentId}-command`,
          edgeId: commandEdgeId,
          label: 'Command signal',
          detail: 'Hierarchy lane accepted new work.',
          color: packetColor('command'),
          createdAt: timestamp,
          durationMs: 3200,
        });
      }
    }

    if (lastEvent.event === 'agent.thought' && agentId && edgeById.has(`memory-${agentId}`)) {
      nextPackets.push({
        id: `packet-${lastEvent.timestamp}-${agentId}-thought`,
        edgeId: `memory-${agentId}`,
        label: 'Thought uplink',
        detail:
          lastEvent.data?.message ??
          lastEvent.data?.thought ??
          'Reasoning packet stored in memory.',
        color: packetColor('data'),
        createdAt: timestamp,
        durationMs: 3000,
      });
    }

    if (
      (lastEvent.event === 'cost.updated' || lastEvent.event === 'budget.threshold') &&
      agentId &&
      edgeById.has(`budget-${agentId}`)
    ) {
      nextPackets.push({
        id: `packet-${lastEvent.timestamp}-${agentId}-budget`,
        edgeId: `budget-${agentId}`,
        label: 'Budget telemetry',
        detail: 'Cost signal moved onto the budget rail.',
        color: packetColor('cost'),
        createdAt: timestamp,
        durationMs: 2800,
      });
    }

    if (nextPackets.length > 0) {
      setPackets((current) => [...nextPackets, ...current].slice(0, 24));
    }
  }, [agents, edgeById, lastEvent]);

  const selectedAgent =
    selectedNode.kind === 'agent'
      ? agents.find((agent) => agent.id === selectedNode.id) ?? null
      : null;
  const selectedTask =
    selectedNode.kind === 'task'
      ? tasks.find((task) => task.id === selectedNode.id) ?? null
      : null;

  if (!selectedCompany) {
    return (
      <div className="rounded-xl border border-dashed p-8 text-sm text-muted-foreground">
        Choose a company to open the digital twin.
      </div>
    );
  }

  const metrics = [
    {
      label: 'Live current',
      value: String(liveAgentIds.size),
      helper: 'Agents with a fresh work pulse in the last 90s',
      icon: Zap,
      tone: 'border-sky-200 bg-sky-50 text-sky-900',
    },
    {
      label: 'Task circuits',
      value: String(visibleTasks.filter((task) => task.assigned_to).length),
      helper: 'Active task-to-agent execution lanes',
      icon: Network,
      tone: 'border-amber-200 bg-amber-50 text-amber-950',
    },
    {
      label: 'Thought uplinks',
      value: String(railEvents.filter((event) => event.tone === 'violet').length),
      helper: 'Reasoning telemetry captured from heartbeats',
      icon: BrainCircuit,
      tone: 'border-violet-200 bg-violet-50 text-violet-950',
    },
    {
      label: 'Budget rail',
      value:
        budget.totals.utilization_pct === null
          ? 'No cap'
          : `${budget.totals.utilization_pct.toFixed(0)}%`,
      helper: `${packets.length} packets moving now`,
      icon: WalletCards,
      tone: 'border-emerald-200 bg-emerald-50 text-emerald-950',
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-2">
          <div className="inline-flex items-center gap-2 rounded-full border bg-muted/25 px-3 py-1 text-xs uppercase tracking-[0.18em] text-muted-foreground">
            <Zap className="h-3.5 w-3.5 text-sky-600" />
            Live orchestration layer
          </div>
          <h2 className="text-3xl font-bold tracking-tight">Digital Twin</h2>
          <p className="max-w-3xl text-sm text-muted-foreground">
            Animated 3D-style graph of live task current, data uplinks, and budget telemetry moving across the agent network in real time.
          </p>
        </div>

        <div className="rounded-[24px] border bg-card px-4 py-3 shadow-sm">
          <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
            Graph depth
          </div>
          <div className="mt-1 text-2xl font-semibold text-foreground">
            {depth + 1} layers
          </div>
          <div className="text-sm text-muted-foreground">
            {agents.filter((agent) => agent.status !== 'terminated').length} agents, {visibleTasks.length} live tasks
          </div>
        </div>
      </div>

      {error && (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {metrics.map((metric) => (
          <div key={metric.label} className={`rounded-[26px] border p-5 shadow-sm ${metric.tone}`}>
            <div className="mb-5 flex items-center justify-between gap-4">
              <span className="text-sm font-medium">{metric.label}</span>
              <metric.icon className="h-5 w-5" />
            </div>
            <div className="text-3xl font-bold tracking-tight">{metric.value}</div>
            <div className="mt-2 text-sm opacity-80">{metric.helper}</div>
          </div>
        ))}
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <section className="rounded-[32px] border bg-card p-5 shadow-sm">
          <div className="mb-5 flex flex-wrap items-center justify-between gap-4">
            <div>
              <h3 className="text-lg font-semibold">Twin Mesh</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Hierarchy lanes, task circuits, reasoning uplinks, and cost signals rendered on one animated plane.
              </p>
            </div>
            <div className="flex flex-wrap gap-2 text-xs">
              <LegendPill label="Command" tone="amber" />
              <LegendPill label="Task current" tone="sky" />
              <LegendPill label="Thoughts" tone="violet" />
              <LegendPill label="Budget" tone="emerald" />
            </div>
          </div>

          <div className="overflow-x-auto">
            <div className="relative min-h-[640px] min-w-[960px] overflow-hidden rounded-[30px] border border-slate-200 bg-[radial-gradient(circle_at_top,_rgba(14,165,233,0.12),_transparent_34%),linear-gradient(180deg,_rgba(248,250,252,0.98),_rgba(255,255,255,1))]" style={{ perspective: '1600px' }}>
              <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(rgba(148,163,184,0.12)_1px,transparent_1px),linear-gradient(90deg,rgba(148,163,184,0.12)_1px,transparent_1px)] bg-[size:64px_64px] opacity-50" />
              <div className="pointer-events-none absolute inset-x-[12%] top-[8%] h-36 rounded-full bg-sky-200/20 blur-3xl" />

              <div className="absolute inset-0" style={{ transform: 'rotateX(57deg) translateY(-2%)', transformStyle: 'preserve-3d' }}>
                <svg viewBox="0 0 100 100" className="absolute inset-0 h-full w-full overflow-visible" aria-hidden="true">
                  {graphEdges.map((edge) => {
                    const source = graphNodes.get(edge.source);
                    const target = graphNodes.get(edge.target);
                    if (!source || !target) return null;

                    return (
                      <g key={edge.id}>
                        <line x1={source.x} y1={source.y} x2={target.x} y2={target.y} stroke={packetColor(edge.kind)} strokeOpacity={0.14 + edge.intensity * 0.34} strokeWidth={0.34 + edge.intensity * 0.42} />
                        <line className="twin-flow-line" x1={source.x} y1={source.y} x2={target.x} y2={target.y} stroke={packetColor(edge.kind)} strokeOpacity={0.4 + edge.intensity * 0.35} strokeWidth={0.18 + edge.intensity * 0.22} style={{ animationDuration: `${7 - edge.intensity * 2.4}s` }} />
                      </g>
                    );
                  })}
                </svg>

                {packets.map((packet) => {
                  const edge = edgeById.get(packet.edgeId);
                  const source = edge ? graphNodes.get(edge.source) : null;
                  const target = edge ? graphNodes.get(edge.target) : null;
                  if (!edge || !source || !target) return null;

                  const progress = clamp((now - packet.createdAt) / packet.durationMs, 0, 1);
                  const left = source.x + (target.x - source.x) * progress;
                  const top = source.y + (target.y - source.y) * progress;

                  return (
                    <div key={packet.id} className="pointer-events-none absolute" style={{ left: `calc(${left}% - 7px)`, top: `calc(${top}% - 7px)`, transform: `translateZ(${Math.max(source.z, target.z) + 6}px)` }}>
                      <div className="twin-packet-glow h-3.5 w-3.5 rounded-full border border-white/80" style={{ backgroundColor: packet.color, boxShadow: `0 0 18px ${packet.color}, 0 0 34px ${packet.color}66` }} title={packet.label} />
                    </div>
                  );
                })}

                {Array.from(graphNodes.values()).map((node, index) => {
                  const isSelected =
                    (node.kind === 'agent' && selectedNode.kind === 'agent' && selectedNode.id === node.id) ||
                    (node.kind === 'task' && selectedNode.kind === 'task' && selectedNode.id === node.id) ||
                    (node.kind === 'system' && selectedNode.kind === 'system' && selectedNode.id === node.id);

                  const classes =
                    node.tone === 'sky'
                      ? 'border-sky-200/80 bg-sky-50/85'
                      : node.tone === 'emerald'
                        ? 'border-emerald-200/80 bg-emerald-50/85'
                        : node.tone === 'amber'
                          ? 'border-amber-200/80 bg-amber-50/85'
                          : node.tone === 'violet'
                            ? 'border-violet-200/80 bg-violet-50/85'
                            : node.tone === 'rose'
                              ? 'border-rose-200/80 bg-rose-50/85'
                              : 'border-slate-200/80 bg-white/90';

                  return (
                    <button
                      key={node.key}
                      type="button"
                      aria-label={node.kind === 'agent' ? `Inspect agent ${node.label}` : node.kind === 'task' ? `Inspect task ${node.label}` : `Inspect ${node.label}`}
                      onClick={() =>
                        setSelectedNode(
                          node.kind === 'agent'
                            ? { kind: 'agent', id: node.id }
                            : node.kind === 'task'
                              ? { kind: 'task', id: node.id }
                              : { kind: 'system', id: node.id as 'command' | 'memory' | 'budget' }
                        )
                      }
                      className={clsx('absolute rounded-[26px] border px-4 py-3 text-left shadow-lg transition-all duration-300 twin-node-float', classes, isSelected && 'ring-2 ring-sky-300 ring-offset-2 ring-offset-white')}
                      style={{ left: `${node.x}%`, top: `${node.y}%`, width: node.kind === 'task' ? '200px' : node.kind === 'system' ? '190px' : '220px', transform: `translate(-50%, -50%) translateZ(${node.z}px) ${isSelected ? 'scale(1.04)' : ''}`, animationDelay: `${index * 120}ms` }}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-semibold text-foreground">{node.label}</div>
                          <div className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">{node.subtitle}</div>
                        </div>
                        {node.kind === 'agent' && liveAgentIds.has(node.id) && (
                          <span className="relative mt-0.5 flex h-3 w-3 flex-shrink-0">
                            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-sky-400 opacity-80" />
                            <span className="relative inline-flex h-3 w-3 rounded-full bg-sky-500" />
                          </span>
                        )}
                      </div>

                      {node.kind === 'agent' && (
                        <div className="mt-3 flex items-center gap-2 text-[11px]">
                          <span className={clsx('rounded-full px-2 py-1 uppercase tracking-wide', getStatusView(liveAgentIds.has(node.id) ? 'working' : agents.find((agent) => agent.id === node.id)?.status ?? 'idle').badge)}>
                            {getStatusView(liveAgentIds.has(node.id) ? 'working' : agents.find((agent) => agent.id === node.id)?.status ?? 'idle').label}
                          </span>
                          <span className="rounded-full border bg-white/70 px-2 py-1 uppercase tracking-wide text-muted-foreground">
                            {agents.find((agent) => agent.id === node.id)?.runtime ?? 'runtime'}
                          </span>
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>

              <div className="absolute inset-x-6 bottom-5 flex items-center justify-between gap-4 rounded-[24px] border border-slate-200/80 bg-white/80 px-5 py-3 backdrop-blur">
                <div>
                  <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Packet stream</div>
                  <div className="mt-1 text-sm text-foreground">
                    {railEvents[0]?.label ?? 'Waiting for first live packet'}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Daily spend</div>
                  <div className="mt-1 text-sm font-semibold text-foreground">${stats.daily_cost_usd.toFixed(4)}</div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <aside className="space-y-6">
          <section className="rounded-[30px] border bg-card p-5 shadow-sm">
            <div className="mb-4 flex items-center gap-2 text-lg font-semibold">
              <Radar className="h-5 w-5 text-sky-600" />
              Circuit Inspector
            </div>
            {selectedAgent ? (
              <div className="space-y-4">
                <InspectorMetric icon={<Activity className="h-4 w-4 text-sky-600" />} label="Agent" value={selectedAgent.name} helper={selectedAgent.title || selectedAgent.role} />
                <InspectorMetric icon={<Clock3 className="h-4 w-4 text-amber-600" />} label="Current task" value={overlay[selectedAgent.id]?.currentTaskTitle ?? 'No task signal'} helper={liveAgentIds.has(selectedAgent.id) ? 'Live work pulse detected.' : 'Waiting for next heartbeat.'} />
                <InspectorMetric icon={<BrainCircuit className="h-4 w-4 text-violet-600" />} label="Latest thought" value={overlay[selectedAgent.id]?.latestThought ?? 'No thought uplink yet'} helper={selectedAgent.runtime ?? 'Runtime not set'} />
                <div className="flex flex-wrap gap-3 text-sm">
                  <Link to={`/agents/${selectedAgent.id}`} className="rounded-full border bg-background px-4 py-2 transition-colors hover:bg-accent">Open agent profile</Link>
                  {overlay[selectedAgent.id]?.currentTaskId && (
                    <Link to={`/tasks/${overlay[selectedAgent.id]?.currentTaskId}`} className="rounded-full border bg-background px-4 py-2 transition-colors hover:bg-accent">Open current task</Link>
                  )}
                </div>
              </div>
            ) : selectedTask ? (
              <div className="space-y-4">
                <InspectorMetric icon={<Activity className="h-4 w-4 text-sky-600" />} label="Task" value={selectedTask.title} helper={summarizeTaskStatus(selectedTask.status)} />
                <InspectorMetric icon={<Clock3 className="h-4 w-4 text-amber-600" />} label="Priority" value={String(selectedTask.priority)} helper={`Created ${new Date(selectedTask.created_at).toLocaleDateString()}`} />
                <InspectorMetric icon={<BrainCircuit className="h-4 w-4 text-violet-600" />} label="Assignment" value={selectedTask.assigned_to ? agents.find((agent) => agent.id === selectedTask.assigned_to)?.name ?? 'Assigned' : 'Unassigned'} helper={selectedTask.description || 'No additional task brief recorded.'} />
                <Link to={`/tasks/${selectedTask.id}`} className="inline-flex rounded-full border bg-background px-4 py-2 text-sm transition-colors hover:bg-accent">Open task</Link>
              </div>
            ) : (
              <div className="space-y-4">
                <InspectorMetric icon={<Zap className="h-4 w-4 text-sky-600" />} label="Live packets" value={String(packets.length)} helper="Packets currently visible on graph edges" />
                <InspectorMetric icon={<BrainCircuit className="h-4 w-4 text-violet-600" />} label="Thought fabric" value={String(railEvents.filter((event) => event.tone === 'violet').length)} helper="Reasoning uplinks collected in the rail feed" />
                <InspectorMetric icon={<WalletCards className="h-4 w-4 text-emerald-600" />} label="Daily cost" value={`$${stats.daily_cost_usd.toFixed(4)}`} helper="Streaming from heartbeat cost updates" />
              </div>
            )}
          </section>

          <section className="rounded-[30px] border bg-card p-5 shadow-sm">
            <div className="mb-4 flex items-center gap-2 text-lg font-semibold">
              <Activity className="h-5 w-5 text-violet-600" />
              Live Packet Stream
            </div>
            <div className="space-y-3">
              {railEvents.map((item) => (
                <div key={item.id} className="rounded-[22px] border bg-muted/10 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-foreground">{item.label}</div>
                      <div className="mt-1 text-sm leading-6 text-muted-foreground">{item.detail}</div>
                    </div>
                    <span className={clsx('mt-1 rounded-full px-2 py-1 text-[11px] uppercase tracking-wide', item.tone === 'violet' && 'bg-violet-100 text-violet-700', item.tone === 'sky' && 'bg-sky-100 text-sky-700', item.tone === 'amber' && 'bg-amber-100 text-amber-700', item.tone === 'emerald' && 'bg-emerald-100 text-emerald-700', item.tone === 'rose' && 'bg-rose-100 text-rose-700')}>
                      {formatRelativeTime(item.timestamp, now)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}

function LegendPill({
  label,
  tone,
}: {
  label: string;
  tone: 'sky' | 'amber' | 'violet' | 'emerald';
}) {
  return (
    <span
      className={clsx(
        'rounded-full border px-3 py-1.5',
        tone === 'sky' && 'border-sky-200 bg-sky-50 text-sky-700',
        tone === 'amber' && 'border-amber-200 bg-amber-50 text-amber-700',
        tone === 'violet' && 'border-violet-200 bg-violet-50 text-violet-700',
        tone === 'emerald' && 'border-emerald-200 bg-emerald-50 text-emerald-700'
      )}
    >
      {label}
    </span>
  );
}

function InspectorMetric({
  icon,
  label,
  value,
  helper,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  helper: string;
}) {
  return (
    <div className="rounded-[22px] border bg-muted/10 p-4">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        {icon}
        <span>{label}</span>
      </div>
      <div className="mt-2 text-base font-semibold text-foreground">{value}</div>
      <div className="mt-1 text-xs text-muted-foreground">{helper}</div>
    </div>
  );
}
