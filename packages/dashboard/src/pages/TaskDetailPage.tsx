import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import {
  BrainCircuit,
  ChevronDown,
  ChevronRight,
  Clock3,
  ClipboardList,
  GitBranch,
  ListFilter,
  MessageSquareText,
  RadioTower,
  Send,
  ShieldAlert,
  Sparkles,
  TimerReset,
  Users,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import { useApi, useWebSocket } from '../hooks/useApi';
import { useCompany } from '../context/CompanyContext';
import { TraceLinkCallout } from '../components/TraceLinkCallout';

type CollaborationTask = {
  id: string;
  parent_id: string | null;
  title: string;
  description: string | null;
  status: string;
  assigned_to: string | null;
  assigned_to_name: string | null;
  assigned_to_role: string | null;
  assigned_to_status: string | null;
  priority: number;
  depth: number;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
};

type CollaborationParticipant = {
  agent_id: string;
  name: string;
  role: string | null;
  status: string | null;
  assigned_task_count: number;
  contribution_count: number;
  latest_activity_at: string | null;
};

type CollaborationTimelineItem = {
  id: string;
  kind: 'thought' | 'message' | 'delegation' | 'status' | 'tool' | 'supervisor';
  task_id: string;
  task_title: string;
  agent_id: string | null;
  agent_name: string;
  agent_role: string | null;
  to_agent_id: string | null;
  to_agent_name: string | null;
  to_agent_role: string | null;
  content: string;
  summary: string;
  message_type: string | null;
  duration_ms: number | null;
  cost_usd: string | number | null;
  created_at: string;
  metadata: Record<string, unknown> | null;
};

type CollaborationSnapshot = {
  generated_at: string;
  root_task: {
    id: string;
    title: string;
    description: string | null;
    status: string;
  };
  current_task: {
    id: string;
    title: string;
    description: string | null;
    status: string;
    fork_origin: {
      source_agent_id: string | null;
      source_task_id: string;
      source_event_id: string | null;
      source_action: string | null;
      source_timestamp: string | null;
      prompt_override: boolean;
    } | null;
  };
  tasks: CollaborationTask[];
  participants: CollaborationParticipant[];
  timeline: CollaborationTimelineItem[];
  summary: {
    task_count: number;
    participant_count: number;
    thought_count: number;
    message_count: number;
    delegation_count: number;
  };
};

type TimelineFilterId = 'all' | CollaborationTimelineItem['kind'];
type TaskDetailViewMode = 'overview' | 'task-force';

type TimelineWindow = {
  id: string;
  started_at: string;
  ended_at: string;
  items: CollaborationTimelineItem[];
  counts: Record<CollaborationTimelineItem['kind'], number>;
};

type TimelineSegment =
  | {
      id: string;
      type: 'event';
      item: CollaborationTimelineItem;
    }
  | {
      id: string;
      type: 'tool-sequence';
      items: CollaborationTimelineItem[];
    };

const TIMELINE_WINDOW_MS = 30_000;

type DelegationPreview = {
  parentTask: CollaborationTask;
  childTask: CollaborationTask | null;
  ownerName: string;
  ownerRole: string | null;
  ownerStatus: string | null;
  firstVisibleMoveAt: string | null;
  firstVisibleMoveLatencyMs: number | null;
  completedAt: string | null;
  completionLatencyMs: number | null;
};

type DelegationHealth = {
  label: 'Fast handoff' | 'Slow start' | 'Stuck';
  className: string;
  helper: string;
};

type DelegationHealthFilterId = 'all' | 'risky' | 'stuck' | 'slow-start' | 'fast-handoff';

function getStatusTone(status: string) {
  if (status === 'working' || status === 'in_progress') return 'bg-sky-100 text-sky-700 border-sky-200';
  if (status === 'assigned') return 'bg-violet-100 text-violet-700 border-violet-200';
  if (status === 'done' || status === 'idle') return 'bg-emerald-100 text-emerald-700 border-emerald-200';
  if (status === 'blocked' || status === 'paused') return 'bg-amber-100 text-amber-700 border-amber-200';
  if (status === 'error' || status === 'terminated') return 'bg-rose-100 text-rose-700 border-rose-200';
  return 'bg-slate-100 text-slate-700 border-slate-200';
}

function getTimelineTone(kind: CollaborationTimelineItem['kind']) {
  if (kind === 'thought') {
    return 'border-sky-200 bg-gradient-to-br from-sky-50 via-white to-cyan-50';
  }
  if (kind === 'delegation') {
    return 'border-violet-200 bg-gradient-to-br from-violet-50 via-white to-fuchsia-50';
  }
  if (kind === 'supervisor') {
    return 'border-emerald-200 bg-gradient-to-br from-emerald-50 via-white to-lime-50';
  }
  if (kind === 'status') {
    return 'border-amber-200 bg-gradient-to-br from-amber-50 via-white to-orange-50';
  }
  if (kind === 'tool') {
    return 'border-slate-200 bg-gradient-to-br from-slate-50 via-white to-zinc-50';
  }
  return 'border-stone-200 bg-white';
}

function formatLiveLabel(kind?: string) {
  if (kind === 'thought') return 'Live reasoning updated';
  if (kind === 'delegation') return 'Task force delegated work';
  if (kind === 'status_update') return 'Agent status changed';
  if (kind === 'supervisor_message') return 'Supervisor joined the debate';
  return 'Task force refreshed';
}

function formatCurrency(value: string | number | null) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const amount = typeof value === 'string' ? Number(value) : value;
  if (!Number.isFinite(amount)) {
    return null;
  }

  return `$${amount.toFixed(2)}`;
}

function formatTime(value: string, withSeconds = false) {
  return new Date(value).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    ...(withSeconds ? { second: '2-digit' } : {}),
  });
}

function formatDateTime(value: string | null) {
  if (!value) {
    return null;
  }

  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) {
    return null;
  }

  return timestamp.toLocaleString();
}

function getForkReplayLink(
  forkOrigin: CollaborationSnapshot['current_task']['fork_origin']
) {
  if (!forkOrigin?.source_agent_id) {
    return null;
  }

  const params = new URLSearchParams({ task_id: forkOrigin.source_task_id });
  if (forkOrigin.source_event_id) {
    params.set('event_id', forkOrigin.source_event_id);
  }

  return `/agents/${forkOrigin.source_agent_id}?${params.toString()}`;
}

function formatDurationMs(value: number | null) {
  if (value === null || !Number.isFinite(value) || value < 0) {
    return null;
  }

  const totalSeconds = Math.round(value / 1000);
  if (totalSeconds < 60) {
    return `${totalSeconds}s`;
  }

  const totalMinutes = Math.round(totalSeconds / 60);
  if (totalMinutes < 60) {
    return `${totalMinutes}m`;
  }

  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
}

function getDelegationHealth(preview: DelegationPreview): DelegationHealth {
  if (preview.firstVisibleMoveLatencyMs !== null && preview.firstVisibleMoveLatencyMs <= 60_000) {
    return {
      label: 'Fast handoff',
      className: 'border-emerald-200 bg-emerald-100 text-emerald-700',
      helper: 'Child task picked up within the first minute.',
    };
  }

  if (preview.firstVisibleMoveLatencyMs !== null) {
    return {
      label: 'Slow start',
      className: 'border-amber-200 bg-amber-100 text-amber-700',
      helper: 'Delegation moved, but the first visible activity came later than expected.',
    };
  }

  return {
    label: 'Stuck',
    className: 'border-rose-200 bg-rose-100 text-rose-700',
    helper: 'Delegated child task has no visible follow-up activity yet.',
  };
}

function matchesDelegationHealthFilter(
  health: DelegationHealth,
  filterId: DelegationHealthFilterId
) {
  if (filterId === 'all') {
    return true;
  }

  if (filterId === 'risky') {
    return health.label !== 'Fast handoff';
  }

  if (filterId === 'stuck') {
    return health.label === 'Stuck';
  }

  if (filterId === 'slow-start') {
    return health.label === 'Slow start';
  }

  return health.label === 'Fast handoff';
}

function parseDelegationHealthFilter(value: string | null): DelegationHealthFilterId {
  if (
    value === 'risky' ||
    value === 'stuck' ||
    value === 'slow-start' ||
    value === 'fast-handoff'
  ) {
    return value;
  }

  return 'all';
}

function parseTaskDetailViewMode(value: string | null): TaskDetailViewMode {
  if (value === 'overview') {
    return 'overview';
  }

  return 'task-force';
}

function parseTaskMapFocusTaskId(value: string | null, tasks: CollaborationTask[]) {
  if (!value) {
    return null;
  }

  return tasks.some((task) => task.id === value) ? value : null;
}

function parseTimelineFilter(value: string | null): TimelineFilterId {
  if (
    value === 'thought' ||
    value === 'message' ||
    value === 'delegation' ||
    value === 'status' ||
    value === 'tool' ||
    value === 'supervisor'
  ) {
    return value;
  }

  return 'all';
}

function parseExpandedToolSequenceIds(value: string | null) {
  if (!value) {
    return new Set<string>();
  }

  return new Set(
    value
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean)
  );
}

function getTimelineFilterLabel(filterId: TimelineFilterId) {
  if (filterId === 'all') return 'All events';
  if (filterId === 'thought') return 'Thoughts';
  if (filterId === 'delegation') return 'Delegations';
  if (filterId === 'tool') return 'Tooling';
  if (filterId === 'status') return 'Status';
  if (filterId === 'supervisor') return 'Supervisor';
  return 'Messages';
}

function getTimelineItemMeta(item: CollaborationTimelineItem): {
  label: string;
  icon: LucideIcon;
  chipClassName: string;
  markerClassName: string;
} {
  if (item.kind === 'thought') {
    return {
      label: 'Thought',
      icon: BrainCircuit,
      chipClassName: 'border-sky-200 bg-sky-100 text-sky-700',
      markerClassName: 'border-sky-200 bg-sky-50 text-sky-700',
    };
  }

  if (item.kind === 'delegation') {
    return {
      label: 'Delegation',
      icon: GitBranch,
      chipClassName: 'border-violet-200 bg-violet-100 text-violet-700',
      markerClassName: 'border-violet-200 bg-violet-50 text-violet-700',
    };
  }

  if (item.kind === 'tool') {
    return {
      label: item.message_type === 'tool_call' ? 'Tool call' : 'Tool result',
      icon: Wrench,
      chipClassName: 'border-slate-200 bg-slate-100 text-slate-700',
      markerClassName: 'border-slate-200 bg-white text-slate-700',
    };
  }

  if (item.kind === 'status') {
    return {
      label: item.message_type === 'approval_request' ? 'Approval' : 'Status',
      icon: TimerReset,
      chipClassName: 'border-amber-200 bg-amber-100 text-amber-700',
      markerClassName: 'border-amber-200 bg-amber-50 text-amber-700',
    };
  }

  if (item.kind === 'supervisor') {
    return {
      label: 'Supervisor',
      icon: ShieldAlert,
      chipClassName: 'border-emerald-200 bg-emerald-100 text-emerald-700',
      markerClassName: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    };
  }

  return {
    label: 'Message',
    icon: MessageSquareText,
    chipClassName: 'border-stone-200 bg-stone-100 text-stone-700',
    markerClassName: 'border-stone-200 bg-white text-stone-700',
  };
}

function buildTimelineWindows(items: CollaborationTimelineItem[]) {
  const windows: TimelineWindow[] = [];

  for (const item of items) {
    const eventAt = new Date(item.created_at).getTime();
    const bucketAt = Math.floor(eventAt / TIMELINE_WINDOW_MS) * TIMELINE_WINDOW_MS;
    const startedAt = new Date(bucketAt).toISOString();
    const endedAt = new Date(bucketAt + TIMELINE_WINDOW_MS).toISOString();
    const lastWindow = windows[windows.length - 1];

    if (lastWindow && lastWindow.started_at === startedAt) {
      lastWindow.items.push(item);
      lastWindow.ended_at = endedAt;
      lastWindow.counts[item.kind] += 1;
      continue;
    }

    windows.push({
      id: `${startedAt}-${item.task_id}`,
      started_at: startedAt,
      ended_at: endedAt,
      items: [item],
      counts: {
        thought: item.kind === 'thought' ? 1 : 0,
        message: item.kind === 'message' ? 1 : 0,
        delegation: item.kind === 'delegation' ? 1 : 0,
        status: item.kind === 'status' ? 1 : 0,
        tool: item.kind === 'tool' ? 1 : 0,
        supervisor: item.kind === 'supervisor' ? 1 : 0,
      },
    });
  }

  return windows;
}

function buildTimelineSegments(window: TimelineWindow): TimelineSegment[] {
  const segments: TimelineSegment[] = [];
  let toolBuffer: CollaborationTimelineItem[] = [];

  const flushToolBuffer = () => {
    if (toolBuffer.length === 0) {
      return;
    }

    if (toolBuffer.length === 1) {
      segments.push({
        id: toolBuffer[0].id,
        type: 'event',
        item: toolBuffer[0],
      });
    } else {
      segments.push({
        id: `${window.id}-${toolBuffer[0].id}-${toolBuffer[toolBuffer.length - 1].id}`,
        type: 'tool-sequence',
        items: toolBuffer,
      });
    }

    toolBuffer = [];
  };

  for (const item of window.items) {
    if (item.kind === 'tool') {
      toolBuffer.push(item);
      continue;
    }

    flushToolBuffer();
    segments.push({
      id: item.id,
      type: 'event',
      item,
    });
  }

  flushToolBuffer();
  return segments;
}

function resolveDelegationPreview(
  item: CollaborationTimelineItem,
  tasks: CollaborationTask[],
  timeline: CollaborationTimelineItem[]
): DelegationPreview | null {
  if (item.kind !== 'delegation') {
    return null;
  }

  const parentTask = tasks.find((task) => task.id === item.task_id);
  if (!parentTask) {
    return null;
  }

  const childTaskId = typeof item.metadata?.child_task_id === 'string'
    ? item.metadata.child_task_id
    : null;
  const delegatedToAgentId = typeof item.metadata?.delegated_to_agent_id === 'string'
    ? item.metadata.delegated_to_agent_id
    : item.to_agent_id;

  const childTask = childTaskId
    ? tasks.find((task) => task.id === childTaskId) ?? null
    : tasks.find((task) =>
        task.parent_id === parentTask.id &&
        (!delegatedToAgentId || task.assigned_to === delegatedToAgentId)
      ) ?? null;
  const delegationCreatedAt = new Date(item.created_at).getTime();
  const firstVisibleMove = childTask
    ? timeline
      .filter((timelineItem) =>
        timelineItem.task_id === childTask.id &&
        timelineItem.created_at >= item.created_at
      )
      .sort((left, right) => left.created_at.localeCompare(right.created_at))[0] ?? null
    : null;
  const completedAt = childTask?.completed_at ?? null;
  const completionLatencyMs = completedAt
    ? Math.max(0, new Date(completedAt).getTime() - delegationCreatedAt)
    : null;
  const firstVisibleMoveLatencyMs = firstVisibleMove
    ? Math.max(0, new Date(firstVisibleMove.created_at).getTime() - delegationCreatedAt)
    : null;

  return {
    parentTask,
    childTask,
    ownerName: childTask?.assigned_to_name || item.to_agent_name || item.to_agent_role || 'Awaiting assignment',
    ownerRole: childTask?.assigned_to_role || item.to_agent_role || null,
    ownerStatus: childTask?.assigned_to_status || null,
    firstVisibleMoveAt: firstVisibleMove?.created_at ?? null,
    firstVisibleMoveLatencyMs,
    completedAt,
    completionLatencyMs,
  };
}

export default function TaskDetailPage() {
  const { id } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const { request, error, lastTrace } = useApi();
  const { selectedCompanyId } = useCompany();
  const lastEvent = useWebSocket(selectedCompanyId ?? undefined) as
    | { event: string; data?: { root_task_id?: string; task_id?: string; kind?: string } }
    | null;
  const [snapshot, setSnapshot] = useState<CollaborationSnapshot | null>(null);
  const [newMsg, setNewMsg] = useState('');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [liveLabel, setLiveLabel] = useState<string | null>(null);
  const activeViewMode = parseTaskDetailViewMode(searchParams.get('view'));
  const activeTimelineFilter = parseTimelineFilter(searchParams.get('timelineFilter'));
  const expandedToolSequenceIds = useMemo(
    () => parseExpandedToolSequenceIds(searchParams.get('expandedTools')),
    [searchParams]
  );
  const activeDelegationHealthFilter = parseDelegationHealthFilter(searchParams.get('taskMapFilter'));

  const fetchSnapshot = useCallback(
    async (suppressError = false) => {
      if (!id) {
        return;
      }

      setIsRefreshing(true);
      try {
        const data = (await request(`/tasks/${id}/collaboration`, undefined, suppressError ? { suppressError: true } : undefined)) as CollaborationSnapshot;
        setSnapshot(data);
      } finally {
        setIsRefreshing(false);
      }
    },
    [id, request]
  );

  useEffect(() => {
    void fetchSnapshot();
  }, [fetchSnapshot]);

  useEffect(() => {
    if (!snapshot || !lastEvent || lastEvent.event !== 'task.collaboration') {
      return;
    }

    const rootTaskId = lastEvent.data?.root_task_id;
    const updatedTaskId = lastEvent.data?.task_id;
    if (
      rootTaskId !== snapshot.root_task.id &&
      updatedTaskId !== snapshot.current_task.id &&
      !snapshot.tasks.some((task) => task.id === updatedTaskId)
    ) {
      return;
    }

    setLiveLabel(formatLiveLabel(lastEvent.data?.kind));
    void fetchSnapshot(true);
  }, [fetchSnapshot, lastEvent, snapshot]);

  const currentTaskEntry = useMemo(
    () => snapshot?.tasks.find((task) => task.id === snapshot.current_task.id) ?? null,
    [snapshot]
  );

  const timeline = snapshot?.timeline ?? [];
  const participants = snapshot?.participants ?? [];
  const tasks = snapshot?.tasks ?? [];
  const timelineFilterOptions = useMemo(
    () =>
      [
        { id: 'all', count: timeline.length },
        { id: 'thought', count: timeline.filter((item) => item.kind === 'thought').length },
        { id: 'delegation', count: timeline.filter((item) => item.kind === 'delegation').length },
        { id: 'tool', count: timeline.filter((item) => item.kind === 'tool').length },
        { id: 'status', count: timeline.filter((item) => item.kind === 'status').length },
        { id: 'supervisor', count: timeline.filter((item) => item.kind === 'supervisor').length },
        { id: 'message', count: timeline.filter((item) => item.kind === 'message').length },
      ] satisfies Array<{ id: TimelineFilterId; count: number }>,
    [timeline]
  );
  const filteredTimeline = useMemo(
    () => timeline.filter((item) => activeTimelineFilter === 'all' || item.kind === activeTimelineFilter),
    [activeTimelineFilter, timeline]
  );
  const timelineWindows = useMemo(() => buildTimelineWindows(filteredTimeline), [filteredTimeline]);
  const recentTimelineItems = useMemo(
    () => [...timeline].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()).slice(0, 5),
    [timeline]
  );
  const delegationHealthByTaskId = useMemo(() => {
    const entries = timeline
      .filter((item) => item.kind === 'delegation')
      .map((item) => {
        const preview = resolveDelegationPreview(item, tasks, timeline);
        if (!preview?.childTask) {
          return null;
        }

        return [
          preview.childTask.id,
          {
            health: getDelegationHealth(preview),
            preview,
          },
        ] as const;
      })
      .filter((entry): entry is readonly [string, { health: DelegationHealth; preview: DelegationPreview }] => Boolean(entry));

    return new Map(entries);
  }, [tasks, timeline]);
  const delegationHealthSummary = useMemo(() => {
    const values = Array.from(delegationHealthByTaskId.values());
    return {
      fastHandoff: values.filter((entry) => entry.health.label === 'Fast handoff').length,
      slowStart: values.filter((entry) => entry.health.label === 'Slow start').length,
      stuck: values.filter((entry) => entry.health.label === 'Stuck').length,
    };
  }, [delegationHealthByTaskId]);
  const riskyTaskIds = useMemo(
    () =>
      new Set(
        Array.from(delegationHealthByTaskId.entries())
          .filter(([, value]) => value.health.label !== 'Fast handoff')
          .map(([taskId]) => taskId)
      ),
    [delegationHealthByTaskId]
  );
  const visibleTaskIdsWhenFiltered = useMemo(() => {
    if (activeDelegationHealthFilter === 'all') {
      return null;
    }

    const matchingTaskIds = Array.from(delegationHealthByTaskId.entries())
      .filter(([, value]) => matchesDelegationHealthFilter(value.health, activeDelegationHealthFilter))
      .map(([taskId]) => taskId);
    const visibleIds = new Set<string>();
    for (const taskId of matchingTaskIds) {
      let currentTask = tasks.find((task) => task.id === taskId) ?? null;
      while (currentTask) {
        visibleIds.add(currentTask.id);
        currentTask = currentTask.parent_id
          ? tasks.find((task) => task.id === currentTask?.parent_id) ?? null
          : null;
      }
    }

    return visibleIds;
  }, [activeDelegationHealthFilter, delegationHealthByTaskId, tasks]);
  const visibleTasks = useMemo(() => {
    if (activeDelegationHealthFilter === 'all' || !visibleTaskIdsWhenFiltered) {
      return tasks;
    }

    return tasks.filter((task) => visibleTaskIdsWhenFiltered.has(task.id));
  }, [activeDelegationHealthFilter, tasks, visibleTaskIdsWhenFiltered]);
  const focusedTaskMapTaskId = useMemo(
    () => parseTaskMapFocusTaskId(searchParams.get('taskFocus'), tasks),
    [searchParams, tasks]
  );
  const focusedTaskMapTask = useMemo(
    () => tasks.find((task) => task.id === focusedTaskMapTaskId) ?? null,
    [focusedTaskMapTaskId, tasks]
  );
  const isFocusedTaskVisible = useMemo(
    () => (focusedTaskMapTaskId ? visibleTasks.some((task) => task.id === focusedTaskMapTaskId) : false),
    [focusedTaskMapTaskId, visibleTasks]
  );

  const toggleToolSequence = (sequenceId: string) => {
    const nextParams = new URLSearchParams(searchParams);
    const nextExpandedIds = parseExpandedToolSequenceIds(searchParams.get('expandedTools'));
    if (nextExpandedIds.has(sequenceId)) {
      nextExpandedIds.delete(sequenceId);
    } else {
      nextExpandedIds.add(sequenceId);
    }

    if (nextExpandedIds.size === 0) {
      nextParams.delete('expandedTools');
    } else {
      nextParams.set('expandedTools', Array.from(nextExpandedIds).sort().join(','));
    }

    setSearchParams(nextParams, { replace: true });
  };

  const setViewMode = (nextMode: TaskDetailViewMode) => {
    const nextParams = new URLSearchParams(searchParams);
    if (nextMode === 'task-force') {
      nextParams.delete('view');
    } else {
      nextParams.set('view', nextMode);
    }
    setSearchParams(nextParams, { replace: true });
  };

  const setTaskMapFocus = (nextTaskId: string | null) => {
    const nextParams = new URLSearchParams(searchParams);
    if (!nextTaskId) {
      nextParams.delete('taskFocus');
    } else {
      nextParams.set('taskFocus', nextTaskId);
    }
    setSearchParams(nextParams, { replace: true });
  };

  const setDelegationHealthFilter = (nextFilter: DelegationHealthFilterId) => {
    const nextParams = new URLSearchParams(searchParams);
    if (nextFilter === 'all') {
      nextParams.delete('taskMapFilter');
    } else {
      nextParams.set('taskMapFilter', nextFilter);
    }
    setSearchParams(nextParams, { replace: true });
  };

  const setTimelineFilter = (nextFilter: TimelineFilterId) => {
    const nextParams = new URLSearchParams(searchParams);
    if (nextFilter === 'all') {
      nextParams.delete('timelineFilter');
    } else {
      nextParams.set('timelineFilter', nextFilter);
    }
    setSearchParams(nextParams, { replace: true });
  };

  const handleSend = async () => {
    if (!id || !newMsg.trim()) {
      return;
    }

    await request(`/tasks/${id}/messages`, {
      method: 'POST',
      body: JSON.stringify({
        content: newMsg,
      }),
    });
    setNewMsg('');
    await fetchSnapshot(true);
  };

  if (!snapshot) {
    return <div className="rounded-2xl border border-dashed p-10 text-sm text-muted-foreground">Loading collaboration mode...</div>;
  }

  return (
    <div className="space-y-6">
      <section className="overflow-hidden rounded-[28px] border bg-gradient-to-br from-stone-950 via-slate-900 to-sky-950 text-white shadow-xl">
        <div className="grid gap-6 p-6 lg:grid-cols-[1.2fr_0.8fr] lg:p-8">
          <div className="space-y-4">
            <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-xs uppercase tracking-[0.2em] text-sky-100">
              <RadioTower className="h-3.5 w-3.5" />
              Task Force Mode
            </div>
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-3">
                <ClipboardList className="h-7 w-7 text-sky-200" />
                <h2 className="text-3xl font-semibold tracking-tight">{snapshot.root_task.title}</h2>
                <span className={`rounded-full border px-3 py-1 text-[11px] uppercase tracking-wide ${getStatusTone(snapshot.root_task.status)}`}>
                  {snapshot.root_task.status}
                </span>
              </div>
              <p className="max-w-3xl text-sm leading-7 text-slate-200">
                {snapshot.root_task.description || 'This task force is coordinating through delegated subtasks, live reasoning, and internal debate.'}
              </p>
              {snapshot.current_task.fork_origin ? (
                <div className="max-w-3xl rounded-2xl border border-sky-200/40 bg-sky-100/10 px-4 py-3 text-sm text-sky-50">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-full border border-sky-200/40 bg-white/10 px-2 py-1 text-[11px] uppercase tracking-wide text-sky-100">
                          Replay fork
                        </span>
                        <span>
                          Forked from{' '}
                          <Link
                            to={`/tasks/${snapshot.current_task.fork_origin.source_task_id}`}
                            className="font-medium underline underline-offset-4"
                          >
                            source task
                          </Link>
                          {snapshot.current_task.fork_origin.source_action
                            ? ` at ${snapshot.current_task.fork_origin.source_action}`
                            : ''}
                          .
                        </span>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-sky-100/80">
                        {snapshot.current_task.fork_origin.source_event_id ? (
                          <span>Replay event: {snapshot.current_task.fork_origin.source_event_id}</span>
                        ) : null}
                        {formatDateTime(snapshot.current_task.fork_origin.source_timestamp) ? (
                          <span>Fork point: {formatDateTime(snapshot.current_task.fork_origin.source_timestamp)}</span>
                        ) : null}
                        {snapshot.current_task.fork_origin.prompt_override ? <span>Prompt override included</span> : null}
                      </div>
                    </div>
                    {getForkReplayLink(snapshot.current_task.fork_origin) ? (
                      <Link
                        to={getForkReplayLink(snapshot.current_task.fork_origin) || '#'}
                        className="inline-flex items-center rounded-full border border-sky-200/40 bg-white/10 px-3 py-1.5 text-xs font-medium text-sky-50 transition-colors hover:bg-white/15"
                      >
                        Open source replay
                      </Link>
                    ) : null}
                  </div>
                </div>
              ) : null}
              <div className="inline-flex rounded-full border border-white/15 bg-black/15 p-1">
                <button
                  type="button"
                  onClick={() => setViewMode('overview')}
                  className={`rounded-full px-3 py-1.5 text-xs transition-colors ${
                    activeViewMode === 'overview'
                      ? 'bg-white text-slate-900'
                      : 'text-slate-200 hover:bg-white/10 hover:text-white'
                  }`}
                >
                  Overview
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode('task-force')}
                  className={`rounded-full px-3 py-1.5 text-xs transition-colors ${
                    activeViewMode === 'task-force'
                      ? 'bg-white text-slate-900'
                      : 'text-slate-200 hover:bg-white/10 hover:text-white'
                  }`}
                >
                  Task Force
                </button>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <MetricBadge label="Agents in formation" value={String(snapshot.summary.participant_count)} helper="Active contributors in this task force" />
              <MetricBadge label="Subtasks in play" value={String(snapshot.summary.task_count)} helper="Root mission plus delegated workstreams" />
              <MetricBadge label="Reasoning bursts" value={String(snapshot.summary.thought_count)} helper="Thoughts captured from live heartbeats" />
            </div>
          </div>

          <div className="rounded-[24px] border border-white/10 bg-white/8 p-5 backdrop-blur">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-xs uppercase tracking-[0.16em] text-sky-100/80">Live pulse</div>
                <div className="mt-2 text-lg font-semibold">
                  {liveLabel || 'Watching the team reason together in real time.'}
                </div>
              </div>
              <div className={`mt-1 h-3 w-3 rounded-full ${isRefreshing ? 'animate-pulse bg-emerald-300' : 'bg-sky-300'}`} />
            </div>

            <div className="mt-5 space-y-3">
              {participants.slice(0, 3).map((participant) => (
                <div key={participant.agent_id} className="rounded-2xl border border-white/10 bg-black/15 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="font-medium text-white">{participant.name}</div>
                      <div className="text-xs text-slate-300">{participant.role || 'Task force member'}</div>
                    </div>
                    <span className={`rounded-full border px-2 py-1 text-[11px] uppercase tracking-wide ${getStatusTone(participant.status || 'idle')}`}>
                      {participant.status || 'idle'}
                    </span>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-3 text-xs text-slate-300">
                    <span>{participant.assigned_task_count} assigned task{participant.assigned_task_count === 1 ? '' : 's'}</span>
                    <span>{participant.contribution_count} visible moves</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {error ? (
        <div className="space-y-3">
          <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
          <TraceLinkCallout
            trace={lastTrace}
            title="Debug This Task Error"
            body="Open the latest collaboration trace in Grafana Explore to inspect the failing request."
            compact
          />
        </div>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[1.35fr_0.65fr]">
        {activeViewMode === 'task-force' ? (
          <section className="rounded-[28px] border bg-card p-5 shadow-sm lg:p-6">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b pb-4">
              <div>
                <div className="flex items-center gap-2 text-lg font-semibold">
                  <Sparkles className="h-5 w-5 text-sky-600" />
                  Task Timeline
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  A real event timeline grouped into 30-second windows, so delegation, reasoning, and tool activity read like one operation.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <div className="rounded-full border bg-muted/20 px-3 py-1 text-xs text-muted-foreground">
                  Focusing task: {snapshot.current_task.title}
                </div>
                <div className="rounded-full border bg-sky-50 px-3 py-1 text-xs text-sky-700">
                  {filteredTimeline.length} event{filteredTimeline.length === 1 ? '' : 's'}
                </div>
                <div className="rounded-full border bg-background px-3 py-1 text-xs text-muted-foreground">
                  {timelineWindows.length} timeline window{timelineWindows.length === 1 ? '' : 's'}
                </div>
              </div>
            </div>

            <div className="mt-5 space-y-5">
              <div className="rounded-[24px] border bg-muted/10 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="inline-flex items-center gap-2 rounded-full border bg-background px-3 py-1 text-xs text-muted-foreground">
                    <ListFilter className="h-3.5 w-3.5" />
                    Filter events
                  </div>
                  {timelineFilterOptions
                    .filter((option) => option.count > 0 || option.id === 'all')
                    .map((option) => (
                      <button
                        key={option.id}
                        type="button"
                        onClick={() => setTimelineFilter(option.id)}
                        className={`rounded-full border px-3 py-1.5 text-xs transition-colors ${
                          activeTimelineFilter === option.id
                            ? 'border-sky-200 bg-sky-100 text-sky-700'
                            : 'bg-background text-muted-foreground hover:border-sky-200 hover:text-foreground'
                        }`}
                      >
                        {getTimelineFilterLabel(option.id)} ({option.count})
                      </button>
                    ))}
                </div>
                <p className="mt-3 text-xs text-muted-foreground">
                  Heartbeat thoughts, supervisor nudges, delegations, and tool activity are clustered into short operational windows.
                </p>
              </div>

              <div className="space-y-5">
                {timelineWindows.map((window) => (
                  <section key={window.id} className="grid gap-4 lg:grid-cols-[148px_1fr]">
                    <div className="lg:pt-3">
                      <div className="sticky top-24 rounded-[22px] border bg-muted/10 p-4">
                        <div className="inline-flex items-center gap-2 rounded-full border bg-background px-2.5 py-1 text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                          <Clock3 className="h-3.5 w-3.5" />
                          Window
                        </div>
                        <div className="mt-3 text-lg font-semibold text-foreground">{formatTime(window.started_at, true)}</div>
                        <div className="text-xs text-muted-foreground">
                          to {formatTime(window.ended_at, true)}
                        </div>
                        <div className="mt-4 flex flex-wrap gap-2">
                          {Object.entries(window.counts)
                            .filter(([, count]) => count > 0)
                            .map(([kind, count]) => (
                              <span
                                key={kind}
                                className="rounded-full border bg-background px-2 py-1 text-[11px] uppercase tracking-wide text-muted-foreground"
                              >
                                {getTimelineFilterLabel(kind as TimelineFilterId)} {count}
                              </span>
                            ))}
                        </div>
                      </div>
                    </div>

                    <div className="relative space-y-4 border-l border-dashed border-slate-200 pl-6">
                      {buildTimelineSegments(window).map((segment) => {
                        if (segment.type === 'tool-sequence') {
                          const isExpanded = expandedToolSequenceIds.has(segment.id);
                          const firstItem = segment.items[0];
                          const toolNames = Array.from(
                            new Set(
                              segment.items
                                .map((item) => {
                                  const tool = item.metadata?.tool;
                                  return typeof tool === 'string' ? tool : null;
                                })
                                .filter((tool): tool is string => Boolean(tool))
                            )
                          );

                          return (
                            <article key={segment.id} className="relative rounded-[24px] border border-slate-200 bg-gradient-to-br from-slate-50 via-white to-stone-50 p-4 shadow-sm">
                              <div className="absolute -left-[37px] top-6 flex h-7 w-7 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-700 shadow-sm">
                                <Wrench className="h-3.5 w-3.5" />
                              </div>
                              <div className="flex flex-wrap items-start justify-between gap-3">
                                <div>
                                  <div className="flex flex-wrap items-center gap-2">
                                    <span className="rounded-full border border-slate-200 bg-slate-100 px-2 py-1 text-[11px] uppercase tracking-wide text-slate-700">
                                      Tool sequence
                                    </span>
                                    <span className="text-sm font-semibold text-foreground">
                                      {segment.items.length} linked tool event{segment.items.length === 1 ? '' : 's'}
                                    </span>
                                  </div>
                                  <div className="mt-1 text-xs uppercase tracking-[0.16em] text-muted-foreground">
                                    {firstItem.task_title}
                                  </div>
                                </div>
                                <button
                                  type="button"
                                  onClick={() => toggleToolSequence(segment.id)}
                                  className="inline-flex items-center gap-2 rounded-full border bg-background px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground"
                                >
                                  {isExpanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                                  {isExpanded ? 'Collapse' : 'Expand'}
                                </button>
                              </div>

                              <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
                                <span>{firstItem.agent_name}</span>
                                <span>{formatTime(firstItem.created_at, true)}</span>
                                {toolNames.map((toolName) => (
                                  <span key={toolName} className="rounded-full border bg-background px-2 py-1">
                                    {toolName}
                                  </span>
                                ))}
                              </div>

                              {isExpanded && (
                                <div className="mt-4 space-y-3 border-t pt-4">
                                  {segment.items.map((item) => (
                                    <TimelineEventCard key={item.id} item={item} tasks={tasks} timeline={timeline} nested />
                                  ))}
                                </div>
                              )}
                            </article>
                          );
                        }

                        return (
                          <TimelineEventCard
                            key={segment.id}
                            item={segment.item}
                            tasks={tasks}
                            timeline={timeline}
                          />
                        );
                      })}
                    </div>
                  </section>
                ))}
              </div>

              {timelineWindows.length === 0 && (
                <div className="rounded-2xl border border-dashed p-10 text-center text-sm text-muted-foreground">
                  No events match the current timeline filter yet.
                </div>
              )}
            </div>

            <div className="mt-5 rounded-[24px] border bg-muted/20 p-4">
              <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                <MessageSquareText className="h-4 w-4 text-emerald-600" />
                Join the room
              </div>
              <div className="mt-3 flex gap-3">
                <input
                  id="task-message"
                  name="taskMessage"
                  aria-label="taskMessage"
                  className="flex-1 rounded-2xl border bg-background px-4 py-3 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                  placeholder="Drop guidance into the task force..."
                  value={newMsg}
                  onChange={(event) => setNewMsg(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      void handleSend();
                    }
                  }}
                />
                <button
                  onClick={() => void handleSend()}
                  className="inline-flex items-center gap-2 rounded-2xl bg-primary px-4 py-3 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
                >
                  <Send className="h-4 w-4" />
                  Send
                </button>
              </div>
            </div>
          </section>
        ) : (
          <section className="rounded-[28px] border bg-card p-5 shadow-sm lg:p-6">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b pb-4">
              <div>
                <div className="flex items-center gap-2 text-lg font-semibold">
                  <Sparkles className="h-5 w-5 text-sky-600" />
                  Mission Overview
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  A lighter readout of the current mission, recent moves, and delegation risk before you dive into the full timeline.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <div className="rounded-full border bg-muted/20 px-3 py-1 text-xs text-muted-foreground">
                  Current focus: {snapshot.current_task.title}
                </div>
                <div className="rounded-full border bg-sky-50 px-3 py-1 text-xs text-sky-700">
                  {timeline.length} total event{timeline.length === 1 ? '' : 's'}
                </div>
              </div>
            </div>

            <div className="mt-5 grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
              <div className="rounded-[24px] border bg-gradient-to-br from-slate-50 via-white to-stone-50 p-5">
                <div className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Current focus</div>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <div className="text-lg font-semibold text-foreground">{snapshot.current_task.title}</div>
                  <span className={`rounded-full border px-2 py-1 text-[11px] uppercase tracking-wide ${getStatusTone(snapshot.current_task.status)}`}>
                    {snapshot.current_task.status}
                  </span>
                </div>
                <p className="mt-3 text-sm leading-7 text-muted-foreground">
                  {snapshot.current_task.description || 'The selected workstream is now part of a larger coordinated push.'}
                </p>
                {currentTaskEntry?.assigned_to_name && (
                  <div className="mt-4 inline-flex items-center gap-2 rounded-full border bg-background px-3 py-1 text-xs text-muted-foreground">
                    Owned by {currentTaskEntry.assigned_to_name}
                  </div>
                )}
              </div>

              <div className="rounded-[24px] border bg-muted/10 p-5">
                <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                  <ShieldAlert className="h-4 w-4 text-amber-600" />
                  Delegation risk snapshot
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  <span className="rounded-full border bg-rose-50 px-3 py-1 text-xs text-rose-700">
                    {delegationHealthSummary.stuck} stuck
                  </span>
                  <span className="rounded-full border bg-amber-50 px-3 py-1 text-xs text-amber-700">
                    {delegationHealthSummary.slowStart} slow start
                  </span>
                  <span className="rounded-full border bg-emerald-50 px-3 py-1 text-xs text-emerald-700">
                    {delegationHealthSummary.fastHandoff} fast handoff
                  </span>
                </div>
                <p className="mt-3 text-sm text-muted-foreground">
                  Use Task Force mode when you need per-event detail, filters, and expandable tool sequences.
                </p>
              </div>
            </div>

            <div className="mt-5 rounded-[24px] border bg-muted/10 p-5">
              <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                <Clock3 className="h-4 w-4 text-violet-600" />
                Recent activity
              </div>
              <div className="mt-4 space-y-3">
                {recentTimelineItems.map((item) => (
                  <div key={item.id} className="rounded-[20px] border bg-background p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium text-foreground">{item.summary}</span>
                          <span className="rounded-full border bg-muted/20 px-2 py-1 text-[11px] uppercase tracking-wide text-muted-foreground">
                            {getTimelineFilterLabel(item.kind)}
                          </span>
                        </div>
                        <div className="mt-1 text-xs uppercase tracking-[0.16em] text-muted-foreground">
                          {item.task_title}
                        </div>
                      </div>
                      <div className="text-xs text-muted-foreground">{new Date(item.created_at).toLocaleString()}</div>
                    </div>
                    <p className="mt-3 text-sm text-muted-foreground">{item.content}</p>
                  </div>
                ))}
              </div>
            </div>
          </section>
        )}

        <div className="space-y-6">
          <section className="rounded-[28px] border bg-card p-5 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-lg font-semibold">
                <Users className="h-5 w-5 text-violet-600" />
                Task Force Map
              </div>
              <button
                type="button"
                onClick={() =>
                  setDelegationHealthFilter(activeDelegationHealthFilter === 'risky' ? 'all' : 'risky')
                }
                className={`rounded-full border px-3 py-1.5 text-xs transition-colors ${
                  activeDelegationHealthFilter === 'risky'
                    ? 'border-rose-200 bg-rose-100 text-rose-700'
                    : 'bg-background text-muted-foreground hover:border-rose-200 hover:text-foreground'
                }`}
              >
                {activeDelegationHealthFilter === 'risky'
                  ? 'Show all workstreams'
                  : `Show only risky handoffs (${riskyTaskIds.size})`}
              </button>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              Delegated workstreams and the agents currently holding them.
            </p>

            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setDelegationHealthFilter('stuck')}
                className={`rounded-full border px-3 py-1.5 text-xs transition-colors ${
                  activeDelegationHealthFilter === 'stuck'
                    ? 'border-rose-300 bg-rose-100 text-rose-800'
                    : 'bg-rose-50 text-rose-700 hover:border-rose-200'
                }`}
              >
                {delegationHealthSummary.stuck} stuck
              </button>
              <button
                type="button"
                onClick={() => setDelegationHealthFilter('slow-start')}
                className={`rounded-full border px-3 py-1.5 text-xs transition-colors ${
                  activeDelegationHealthFilter === 'slow-start'
                    ? 'border-amber-300 bg-amber-100 text-amber-800'
                    : 'bg-amber-50 text-amber-700 hover:border-amber-200'
                }`}
              >
                {delegationHealthSummary.slowStart} slow start
              </button>
              <button
                type="button"
                onClick={() => setDelegationHealthFilter('fast-handoff')}
                className={`rounded-full border px-3 py-1.5 text-xs transition-colors ${
                  activeDelegationHealthFilter === 'fast-handoff'
                    ? 'border-emerald-300 bg-emerald-100 text-emerald-800'
                    : 'bg-emerald-50 text-emerald-700 hover:border-emerald-200'
                }`}
              >
                {delegationHealthSummary.fastHandoff} fast handoff
              </button>
              {activeDelegationHealthFilter !== 'all' && (
                <button
                  type="button"
                  onClick={() => setDelegationHealthFilter('all')}
                  className="rounded-full border bg-background px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground"
                >
                  Clear facet
                </button>
              )}
            </div>

            {focusedTaskMapTask && (
              <div className="mt-4 flex flex-wrap items-center gap-2 rounded-[20px] border bg-sky-50/70 p-3 text-xs text-sky-800">
                <span className="rounded-full border border-sky-200 bg-white px-2 py-1 uppercase tracking-wide text-sky-700">
                  Map focus
                </span>
                <span>{focusedTaskMapTask.title}</span>
                {!isFocusedTaskVisible && (
                  <span className="text-sky-700/80">
                    Hidden by the current delegation facet.
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => setTaskMapFocus(null)}
                  className="rounded-full border bg-white px-3 py-1 text-xs text-sky-700 hover:text-sky-900"
                >
                  Clear focus
                </button>
              </div>
            )}

            <div className="mt-5 space-y-3">
              {visibleTasks.map((task) => (
                <div
                  key={task.id}
                  className={`rounded-[22px] border p-4 ${
                    focusedTaskMapTaskId === task.id
                      ? 'border-sky-300 bg-sky-50/70 shadow-sm'
                      : 'bg-muted/10'
                  }`}
                  style={{ marginLeft: `${task.depth * 18}px` }}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="font-medium text-foreground">{task.title}</div>
                        {delegationHealthByTaskId.get(task.id) && (
                          <span
                            className={`rounded-full border px-2 py-1 text-[11px] uppercase tracking-wide ${
                              delegationHealthByTaskId.get(task.id)?.health.className
                            }`}
                          >
                            {delegationHealthByTaskId.get(task.id)?.health.label}
                          </span>
                        )}
                      </div>
                      <div className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
                        {task.depth === 0 ? 'Root mission' : `Delegation layer ${task.depth}`}
                      </div>
                    </div>
                    <span className={`rounded-full border px-2 py-1 text-[11px] uppercase tracking-wide ${getStatusTone(task.status)}`}>
                      {task.status}
                    </span>
                  </div>
                  <div className="mt-3 text-sm text-muted-foreground">
                    {task.description || 'No additional context recorded for this workstream.'}
                  </div>
                  {delegationHealthByTaskId.get(task.id) && (
                    <div className="mt-3 text-xs text-muted-foreground">
                      Delegation health: {delegationHealthByTaskId.get(task.id)?.health.helper}
                    </div>
                  )}
                  <div className="mt-4 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                    <button
                      type="button"
                      onClick={() => setTaskMapFocus(focusedTaskMapTaskId === task.id ? null : task.id)}
                      className={`rounded-full border px-3 py-1 transition-colors ${
                        focusedTaskMapTaskId === task.id
                          ? 'border-sky-300 bg-white text-sky-700'
                          : 'bg-background text-muted-foreground hover:border-sky-200 hover:text-foreground'
                      }`}
                    >
                      {focusedTaskMapTaskId === task.id ? 'Focused' : 'Focus'}
                    </button>
                    <span>{task.assigned_to_name || 'Awaiting assignment'}</span>
                    {task.assigned_to_role ? <span>{task.assigned_to_role}</span> : null}
                    {task.assigned_to && (
                      <Link className="text-foreground underline-offset-2 hover:underline" to={`/agents/${task.assigned_to}`}>
                        Agent profile
                      </Link>
                    )}
                    <Link className="text-foreground underline-offset-2 hover:underline" to={`/tasks/${task.id}`}>
                      Open task
                    </Link>
                  </div>
                </div>
              ))}
              {visibleTasks.length === 0 && (
                <div className="rounded-[22px] border border-dashed p-6 text-sm text-muted-foreground">
                  {activeDelegationHealthFilter === 'risky'
                    ? 'No risky handoffs right now. Fast delegations stay visible in the full task map.'
                    : 'No workstreams match this delegation facet right now.'}
                </div>
              )}
            </div>
          </section>

          <section className="rounded-[28px] border bg-card p-5 shadow-sm">
            <div className="flex items-center gap-2 text-lg font-semibold">
              <TimerReset className="h-5 w-5 text-amber-600" />
              Team Readout
            </div>
            <div className="mt-5 space-y-3">
              {participants.map((participant) => (
                <div key={participant.agent_id} className="rounded-[22px] border bg-muted/10 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="font-medium text-foreground">{participant.name}</div>
                      <div className="text-xs text-muted-foreground">{participant.role || 'Task force member'}</div>
                    </div>
                    <span className={`rounded-full border px-2 py-1 text-[11px] uppercase tracking-wide ${getStatusTone(participant.status || 'idle')}`}>
                      {participant.status || 'idle'}
                    </span>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-3 text-xs text-muted-foreground">
                    <span>{participant.assigned_task_count} workstream{participant.assigned_task_count === 1 ? '' : 's'}</span>
                    <span>{participant.contribution_count} visible moves</span>
                    {participant.latest_activity_at ? <span>{new Date(participant.latest_activity_at).toLocaleTimeString()}</span> : null}
                  </div>
                  <Link
                    to={`/agents/${participant.agent_id}`}
                    className="mt-3 inline-flex text-xs font-medium text-foreground underline-offset-2 hover:underline"
                  >
                    Open collaborator profile
                  </Link>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-[28px] border bg-card p-5 shadow-sm">
            <div className="text-lg font-semibold">Current Focus</div>
            <div className="mt-4 rounded-[22px] border bg-gradient-to-br from-slate-50 via-white to-stone-50 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <div className="font-medium text-foreground">{snapshot.current_task.title}</div>
                <span className={`rounded-full border px-2 py-1 text-[11px] uppercase tracking-wide ${getStatusTone(snapshot.current_task.status)}`}>
                  {snapshot.current_task.status}
                </span>
              </div>
              <div className="mt-3 text-sm leading-7 text-muted-foreground">
                {snapshot.current_task.description || 'The selected workstream is now part of a larger coordinated push.'}
              </div>
              {currentTaskEntry?.assigned_to_name && (
                <div className="mt-4 inline-flex items-center gap-2 rounded-full border bg-background px-3 py-1 text-xs text-muted-foreground">
                  Owned by {currentTaskEntry.assigned_to_name}
                </div>
              )}
            </div>
          </section>

          <TraceLinkCallout
            trace={lastTrace}
            title="Inspect Task Trace"
            body="Jump into Grafana Explore for the latest task collaboration or message request."
          />
        </div>
      </div>
    </div>
  );
}

function TimelineEventCard({
  item,
  tasks,
  timeline,
  nested = false,
}: {
  item: CollaborationTimelineItem;
  tasks: CollaborationTask[];
  timeline: CollaborationTimelineItem[];
  nested?: boolean;
}) {
  const meta = getTimelineItemMeta(item);
  const Icon = meta.icon;
  const costLabel = formatCurrency(item.cost_usd);
  const delegationPreview = resolveDelegationPreview(item, tasks, timeline);
  const delegationHealth = delegationPreview ? getDelegationHealth(delegationPreview) : null;

  return (
    <article className={`relative rounded-[24px] border p-4 shadow-sm ${nested ? 'bg-background' : getTimelineTone(item.kind)}`}>
      {!nested && (
        <div className={`absolute -left-[37px] top-6 flex h-7 w-7 items-center justify-center rounded-full border shadow-sm ${meta.markerClassName}`}>
          <Icon className="h-3.5 w-3.5" />
        </div>
      )}

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-foreground">{item.agent_name}</span>
            {item.agent_role && (
              <span className="rounded-full border bg-background/70 px-2 py-1 text-[11px] uppercase tracking-wide text-muted-foreground">
                {item.agent_role}
              </span>
            )}
            <span className={`rounded-full border px-2 py-1 text-[11px] uppercase tracking-wide ${meta.chipClassName}`}>
              {meta.label}
            </span>
            {item.message_type && (
              <span className="rounded-full border bg-background/70 px-2 py-1 text-[11px] uppercase tracking-wide text-muted-foreground">
                {item.message_type.replace(/_/g, ' ')}
              </span>
            )}
          </div>
          <div className="text-xs uppercase tracking-[0.16em] text-muted-foreground">{item.task_title}</div>
        </div>
        <div className="text-right text-xs text-muted-foreground">
          <div>{new Date(item.created_at).toLocaleString()}</div>
          {item.duration_ms ? <div>{item.duration_ms} ms</div> : null}
          {costLabel ? <div>{costLabel}</div> : null}
        </div>
      </div>

      <div className="mt-4 text-sm font-medium text-foreground">{item.summary}</div>
      <div className="mt-2 whitespace-pre-wrap break-words text-sm leading-7 text-muted-foreground">{item.content}</div>

      {(item.to_agent_name || item.to_agent_role) && (
        <div className="mt-4 inline-flex items-center gap-2 rounded-full border bg-background/70 px-3 py-1 text-xs text-muted-foreground">
          <GitBranch className="h-3.5 w-3.5" />
          Routed to {item.to_agent_name || item.to_agent_role}
        </div>
      )}

      {delegationPreview && (
        <div className="mt-4 rounded-[22px] border border-violet-200 bg-white/80 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-[11px] uppercase tracking-[0.16em] text-violet-700">Delegation diff</div>
            {delegationHealth && (
              <div className="flex items-center gap-2">
                <span className={`rounded-full border px-2.5 py-1 text-[11px] uppercase tracking-wide ${delegationHealth.className}`}>
                  {delegationHealth.label}
                </span>
                <span className="text-xs text-muted-foreground">{delegationHealth.helper}</span>
              </div>
            )}
          </div>
          <div className="mt-3 grid gap-3 md:grid-cols-3">
            <div className="rounded-2xl border bg-violet-50/70 p-3">
              <div className="text-[11px] uppercase tracking-[0.16em] text-violet-700">Parent task</div>
              <div className="mt-2 font-medium text-foreground">{delegationPreview.parentTask.title}</div>
              <div className="mt-1 text-xs text-muted-foreground">
                {delegationPreview.parentTask.description || 'No parent task description recorded.'}
              </div>
              <div className="mt-3 inline-flex rounded-full border bg-background px-2 py-1 text-[11px] uppercase tracking-wide text-muted-foreground">
                {delegationPreview.parentTask.status}
              </div>
            </div>

            <div className="rounded-2xl border bg-background p-3">
              <div className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Delegated child</div>
              <div className="mt-2 font-medium text-foreground">
                {delegationPreview.childTask?.title || 'Delegated workstream pending'}
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                {delegationPreview.childTask?.description || item.content}
              </div>
              {delegationPreview.childTask ? (
                <Link
                  to={`/tasks/${delegationPreview.childTask.id}`}
                  className="mt-3 inline-flex text-xs font-medium text-foreground underline-offset-2 hover:underline"
                >
                  Open delegated task
                </Link>
              ) : (
                <div className="mt-3 text-xs text-muted-foreground">Waiting for a concrete child task record.</div>
              )}
            </div>

            <div className="rounded-2xl border bg-emerald-50/60 p-3">
              <div className="text-[11px] uppercase tracking-[0.16em] text-emerald-700">Assigned owner</div>
              <div className="mt-2 font-medium text-foreground">{delegationPreview.ownerName}</div>
              <div className="mt-1 text-xs text-muted-foreground">
                {delegationPreview.ownerRole || 'Role not specified'}
              </div>
              {delegationPreview.ownerStatus && (
                <div className={`mt-3 inline-flex rounded-full border px-2 py-1 text-[11px] uppercase tracking-wide ${getStatusTone(delegationPreview.ownerStatus)}`}>
                  {delegationPreview.ownerStatus}
                </div>
              )}
            </div>
          </div>

          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <div className="rounded-2xl border bg-background p-3">
              <div className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">First visible move</div>
              <div className="mt-2 font-medium text-foreground">
                {formatDurationMs(delegationPreview.firstVisibleMoveLatencyMs) || 'Pending'}
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                {delegationPreview.firstVisibleMoveAt
                  ? `Seen at ${new Date(delegationPreview.firstVisibleMoveAt).toLocaleString()}`
                  : 'No child-task activity captured yet.'}
              </div>
            </div>

            <div className="rounded-2xl border bg-background p-3">
              <div className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Completed in</div>
              <div className="mt-2 font-medium text-foreground">
                {formatDurationMs(delegationPreview.completionLatencyMs) || 'Still open'}
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                {delegationPreview.completedAt
                  ? `Closed at ${new Date(delegationPreview.completedAt).toLocaleString()}`
                  : 'Delegated child task has not been completed yet.'}
              </div>
            </div>
          </div>
        </div>
      )}

      {item.metadata && Object.keys(item.metadata).length > 0 && (
        <div className="mt-4 rounded-2xl border bg-background/70 p-3">
          <div className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Metadata</div>
          <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-all text-xs leading-6 text-muted-foreground">
            {JSON.stringify(item.metadata, null, 2)}
          </pre>
        </div>
      )}
    </article>
  );
}

function MetricBadge({ label, value, helper }: { label: string; value: string; helper: string }) {
  return (
    <div className="rounded-[22px] border border-white/10 bg-black/15 p-4">
      <div className="text-xs uppercase tracking-[0.16em] text-sky-100/80">{label}</div>
      <div className="mt-2 text-2xl font-semibold text-white">{value}</div>
      <div className="mt-1 text-xs text-slate-300">{helper}</div>
    </div>
  );
}
