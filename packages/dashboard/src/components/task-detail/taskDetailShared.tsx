import {
  BrainCircuit,
  GitBranch,
  MessageSquareText,
  ShieldAlert,
  TimerReset,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import { Link } from 'react-router-dom';

export type CollaborationTask = {
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

export type CollaborationParticipant = {
  agent_id: string;
  name: string;
  role: string | null;
  status: string | null;
  assigned_task_count: number;
  contribution_count: number;
  latest_activity_at: string | null;
};

export type CollaborationTimelineItem = {
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

export type CollaborationSnapshot = {
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

export type TimelineFilterId = 'all' | CollaborationTimelineItem['kind'];
export type TaskDetailViewMode = 'overview' | 'task-force';

export type TimelineWindow = {
  id: string;
  started_at: string;
  ended_at: string;
  items: CollaborationTimelineItem[];
  counts: Record<CollaborationTimelineItem['kind'], number>;
};

export type TimelineSegment =
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

export type DelegationPreview = {
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

export type DelegationHealth = {
  label: 'Fast handoff' | 'Slow start' | 'Stuck';
  className: string;
  helper: string;
};

export type DelegationHealthFilterId =
  | 'all'
  | 'risky'
  | 'stuck'
  | 'slow-start'
  | 'fast-handoff';

export function getStatusTone(status: string) {
  if (status === 'working' || status === 'in_progress')
    return 'bg-sky-100 text-sky-700 border-sky-200';
  if (status === 'assigned')
    return 'bg-violet-100 text-violet-700 border-violet-200';
  if (status === 'done' || status === 'idle')
    return 'bg-emerald-100 text-emerald-700 border-emerald-200';
  if (status === 'blocked' || status === 'paused')
    return 'bg-amber-100 text-amber-700 border-amber-200';
  if (status === 'error' || status === 'terminated')
    return 'bg-rose-100 text-rose-700 border-rose-200';
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

export function formatLiveLabel(kind?: string) {
  if (kind === 'thought') return 'Live reasoning updated';
  if (kind === 'delegation') return 'Task force delegated work';
  if (kind === 'status_update') return 'Agent status changed';
  if (kind === 'supervisor_message') return 'Supervisor joined the debate';
  return 'Task force refreshed';
}

export function formatCurrency(value: string | number | null) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const amount = typeof value === 'string' ? Number(value) : value;
  if (!Number.isFinite(amount)) {
    return null;
  }

  return `$${amount.toFixed(2)}`;
}

export function formatTime(value: string, withSeconds = false) {
  return new Date(value).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    ...(withSeconds ? { second: '2-digit' } : {}),
  });
}

export function formatDateTime(value: string | null) {
  if (!value) {
    return null;
  }

  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) {
    return null;
  }

  return timestamp.toLocaleString();
}

export function getForkReplayLink(
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

export function formatDurationMs(value: number | null) {
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

export function getDelegationHealth(
  preview: DelegationPreview
): DelegationHealth {
  if (
    preview.firstVisibleMoveLatencyMs !== null &&
    preview.firstVisibleMoveLatencyMs <= 60_000
  ) {
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
      helper:
        'Delegation moved, but the first visible activity came later than expected.',
    };
  }

  return {
    label: 'Stuck',
    className: 'border-rose-200 bg-rose-100 text-rose-700',
    helper: 'Delegated child task has no visible follow-up activity yet.',
  };
}

export function matchesDelegationHealthFilter(
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

export function parseDelegationHealthFilter(
  value: string | null
): DelegationHealthFilterId {
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

export function parseTaskDetailViewMode(
  value: string | null
): TaskDetailViewMode {
  if (value === 'overview') {
    return 'overview';
  }

  return 'task-force';
}

export function parseTaskMapFocusTaskId(
  value: string | null,
  tasks: CollaborationTask[]
) {
  if (!value) {
    return null;
  }

  return tasks.some((task) => task.id === value) ? value : null;
}

export function parseTimelineFilter(value: string | null): TimelineFilterId {
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

export function parseExpandedToolSequenceIds(value: string | null) {
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

export function getTimelineFilterLabel(filterId: TimelineFilterId) {
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

export function buildTimelineWindows(items: CollaborationTimelineItem[]) {
  const windows: TimelineWindow[] = [];

  for (const item of items) {
    const eventAt = new Date(item.created_at).getTime();
    const bucketAt =
      Math.floor(eventAt / TIMELINE_WINDOW_MS) * TIMELINE_WINDOW_MS;
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

export function buildTimelineSegments(
  window: TimelineWindow
): TimelineSegment[] {
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

export function resolveDelegationPreview(
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

  const childTaskId =
    typeof item.metadata?.child_task_id === 'string'
      ? item.metadata.child_task_id
      : null;
  const delegatedToAgentId =
    typeof item.metadata?.delegated_to_agent_id === 'string'
      ? item.metadata.delegated_to_agent_id
      : item.to_agent_id;

  const childTask = childTaskId
    ? (tasks.find((task) => task.id === childTaskId) ?? null)
    : (tasks.find(
        (task) =>
          task.parent_id === parentTask.id &&
          (!delegatedToAgentId || task.assigned_to === delegatedToAgentId)
      ) ?? null);
  const delegationCreatedAt = new Date(item.created_at).getTime();
  const firstVisibleMove = childTask
    ? (timeline
        .filter(
          (timelineItem) =>
            timelineItem.task_id === childTask.id &&
            timelineItem.created_at >= item.created_at
        )
        .sort((left, right) =>
          left.created_at.localeCompare(right.created_at)
        )[0] ?? null)
    : null;
  const completedAt = childTask?.completed_at ?? null;
  const completionLatencyMs = completedAt
    ? Math.max(0, new Date(completedAt).getTime() - delegationCreatedAt)
    : null;
  const firstVisibleMoveLatencyMs = firstVisibleMove
    ? Math.max(
        0,
        new Date(firstVisibleMove.created_at).getTime() - delegationCreatedAt
      )
    : null;

  return {
    parentTask,
    childTask,
    ownerName:
      childTask?.assigned_to_name ||
      item.to_agent_name ||
      item.to_agent_role ||
      'Awaiting assignment',
    ownerRole: childTask?.assigned_to_role || item.to_agent_role || null,
    ownerStatus: childTask?.assigned_to_status || null,
    firstVisibleMoveAt: firstVisibleMove?.created_at ?? null,
    firstVisibleMoveLatencyMs,
    completedAt,
    completionLatencyMs,
  };
}

export function TimelineEventCard({
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
  const delegationHealth = delegationPreview
    ? getDelegationHealth(delegationPreview)
    : null;

  return (
    <article
      className={`relative rounded-[24px] border p-4 shadow-sm ${nested ? 'bg-background' : getTimelineTone(item.kind)}`}
    >
      {!nested && (
        <div
          className={`absolute -left-[37px] top-6 flex h-7 w-7 items-center justify-center rounded-full border shadow-sm ${meta.markerClassName}`}
        >
          <Icon className="h-3.5 w-3.5" />
        </div>
      )}

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-foreground">
              {item.agent_name}
            </span>
            {item.agent_role && (
              <span className="rounded-full border bg-background/70 px-2 py-1 text-[11px] uppercase tracking-wide text-muted-foreground">
                {item.agent_role}
              </span>
            )}
            <span
              className={`rounded-full border px-2 py-1 text-[11px] uppercase tracking-wide ${meta.chipClassName}`}
            >
              {meta.label}
            </span>
            {item.message_type && (
              <span className="rounded-full border bg-background/70 px-2 py-1 text-[11px] uppercase tracking-wide text-muted-foreground">
                {item.message_type.replace(/_/g, ' ')}
              </span>
            )}
          </div>
          <div className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
            {item.task_title}
          </div>
        </div>
        <div className="text-right text-xs text-muted-foreground">
          <div>{new Date(item.created_at).toLocaleString()}</div>
          {item.duration_ms ? <div>{item.duration_ms} ms</div> : null}
          {costLabel ? <div>{costLabel}</div> : null}
        </div>
      </div>

      <div className="mt-4 text-sm font-medium text-foreground">
        {item.summary}
      </div>
      <div className="mt-2 whitespace-pre-wrap break-words text-sm leading-7 text-muted-foreground">
        {item.content}
      </div>

      {(item.to_agent_name || item.to_agent_role) && (
        <div className="mt-4 inline-flex items-center gap-2 rounded-full border bg-background/70 px-3 py-1 text-xs text-muted-foreground">
          <GitBranch className="h-3.5 w-3.5" />
          Routed to {item.to_agent_name || item.to_agent_role}
        </div>
      )}

      {delegationPreview && (
        <div className="mt-4 rounded-[22px] border border-violet-200 bg-white/80 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-[11px] uppercase tracking-[0.16em] text-violet-700">
              Delegation diff
            </div>
            {delegationHealth && (
              <div className="flex items-center gap-2">
                <span
                  className={`rounded-full border px-2.5 py-1 text-[11px] uppercase tracking-wide ${delegationHealth.className}`}
                >
                  {delegationHealth.label}
                </span>
                <span className="text-xs text-muted-foreground">
                  {delegationHealth.helper}
                </span>
              </div>
            )}
          </div>
          <div className="mt-3 grid gap-3 md:grid-cols-3">
            <div className="rounded-2xl border bg-violet-50/70 p-3">
              <div className="text-[11px] uppercase tracking-[0.16em] text-violet-700">
                Parent task
              </div>
              <div className="mt-2 font-medium text-foreground">
                {delegationPreview.parentTask.title}
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                {delegationPreview.parentTask.description ||
                  'No parent task description recorded.'}
              </div>
              <div className="mt-3 inline-flex rounded-full border bg-background px-2 py-1 text-[11px] uppercase tracking-wide text-muted-foreground">
                {delegationPreview.parentTask.status}
              </div>
            </div>

            <div className="rounded-2xl border bg-background p-3">
              <div className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                Delegated child
              </div>
              <div className="mt-2 font-medium text-foreground">
                {delegationPreview.childTask?.title ||
                  'Delegated workstream pending'}
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
                <div className="mt-3 text-xs text-muted-foreground">
                  Waiting for a concrete child task record.
                </div>
              )}
            </div>

            <div className="rounded-2xl border bg-emerald-50/60 p-3">
              <div className="text-[11px] uppercase tracking-[0.16em] text-emerald-700">
                Assigned owner
              </div>
              <div className="mt-2 font-medium text-foreground">
                {delegationPreview.ownerName}
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                {delegationPreview.ownerRole || 'Role not specified'}
              </div>
              {delegationPreview.ownerStatus && (
                <div
                  className={`mt-3 inline-flex rounded-full border px-2 py-1 text-[11px] uppercase tracking-wide ${getStatusTone(delegationPreview.ownerStatus)}`}
                >
                  {delegationPreview.ownerStatus}
                </div>
              )}
            </div>
          </div>

          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <div className="rounded-2xl border bg-background p-3">
              <div className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                First visible move
              </div>
              <div className="mt-2 font-medium text-foreground">
                {formatDurationMs(
                  delegationPreview.firstVisibleMoveLatencyMs
                ) || 'Pending'}
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                {delegationPreview.firstVisibleMoveAt
                  ? `Seen at ${new Date(delegationPreview.firstVisibleMoveAt).toLocaleString()}`
                  : 'No child-task activity captured yet.'}
              </div>
            </div>

            <div className="rounded-2xl border bg-background p-3">
              <div className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                Completed in
              </div>
              <div className="mt-2 font-medium text-foreground">
                {formatDurationMs(delegationPreview.completionLatencyMs) ||
                  'Still open'}
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
          <div className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
            Metadata
          </div>
          <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-all text-xs leading-6 text-muted-foreground">
            {JSON.stringify(item.metadata, null, 2)}
          </pre>
        </div>
      )}
    </article>
  );
}

export function MetricBadge({
  label,
  value,
  helper,
}: {
  label: string;
  value: string;
  helper: string;
}) {
  return (
    <div className="rounded-[22px] border border-white/10 bg-black/15 p-4">
      <div className="text-xs uppercase tracking-[0.16em] text-sky-100/80">
        {label}
      </div>
      <div className="mt-2 text-2xl font-semibold text-white">{value}</div>
      <div className="mt-1 text-xs text-slate-300">{helper}</div>
    </div>
  );
}
