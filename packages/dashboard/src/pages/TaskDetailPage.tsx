import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  ClipboardList,
  GitBranch,
  MessageSquareText,
  RadioTower,
  Send,
  Sparkles,
  TimerReset,
  Users,
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

export default function TaskDetailPage() {
  const { id } = useParams();
  const { request, error, lastTrace } = useApi();
  const { selectedCompanyId } = useCompany();
  const lastEvent = useWebSocket(selectedCompanyId ?? undefined) as
    | { event: string; data?: { root_task_id?: string; task_id?: string; kind?: string } }
    | null;
  const [snapshot, setSnapshot] = useState<CollaborationSnapshot | null>(null);
  const [newMsg, setNewMsg] = useState('');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [liveLabel, setLiveLabel] = useState<string | null>(null);

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
        <section className="rounded-[28px] border bg-card p-5 shadow-sm lg:p-6">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b pb-4">
            <div>
              <div className="flex items-center gap-2 text-lg font-semibold">
                <Sparkles className="h-5 w-5 text-sky-600" />
                Live Co-Reasoning Window
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                Watch the team debate, delegate, and coordinate around the same mission thread.
              </p>
            </div>
            <div className="rounded-full border bg-muted/20 px-3 py-1 text-xs text-muted-foreground">
              Focusing task: {snapshot.current_task.title}
            </div>
          </div>

          <div className="mt-5 space-y-4">
            {timeline.map((item) => (
              <article key={item.id} className={`rounded-[24px] border p-4 shadow-sm ${getTimelineTone(item.kind)}`}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold text-foreground">{item.agent_name}</span>
                      {item.agent_role && (
                        <span className="rounded-full border bg-background/70 px-2 py-1 text-[11px] uppercase tracking-wide text-muted-foreground">
                          {item.agent_role}
                        </span>
                      )}
                      <span className="rounded-full border bg-background/70 px-2 py-1 text-[11px] uppercase tracking-wide text-muted-foreground">
                        {item.kind}
                      </span>
                    </div>
                    <div className="text-xs uppercase tracking-[0.16em] text-muted-foreground">{item.task_title}</div>
                  </div>
                  <div className="text-right text-xs text-muted-foreground">
                    <div>{new Date(item.created_at).toLocaleString()}</div>
                    {item.duration_ms ? <div>{item.duration_ms} ms</div> : null}
                    {formatCurrency(item.cost_usd) ? <div>{formatCurrency(item.cost_usd)}</div> : null}
                  </div>
                </div>

                <div className="mt-4 text-sm font-medium text-foreground">{item.summary}</div>
                <div className="mt-2 text-sm leading-7 text-muted-foreground">{item.content}</div>

                {(item.to_agent_name || item.to_agent_role) && (
                  <div className="mt-4 inline-flex items-center gap-2 rounded-full border bg-background/70 px-3 py-1 text-xs text-muted-foreground">
                    <GitBranch className="h-3.5 w-3.5" />
                    Routed to {item.to_agent_name || item.to_agent_role}
                  </div>
                )}
              </article>
            ))}

            {timeline.length === 0 && (
              <div className="rounded-2xl border border-dashed p-10 text-center text-sm text-muted-foreground">
                The task force has not started debating yet.
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

        <div className="space-y-6">
          <section className="rounded-[28px] border bg-card p-5 shadow-sm">
            <div className="flex items-center gap-2 text-lg font-semibold">
              <Users className="h-5 w-5 text-violet-600" />
              Task Force Map
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              Delegated workstreams and the agents currently holding them.
            </p>

            <div className="mt-5 space-y-3">
              {tasks.map((task) => (
                <div key={task.id} className="rounded-[22px] border bg-muted/10 p-4" style={{ marginLeft: `${task.depth * 18}px` }}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-1">
                      <div className="font-medium text-foreground">{task.title}</div>
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
                  <div className="mt-4 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
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

function MetricBadge({ label, value, helper }: { label: string; value: string; helper: string }) {
  return (
    <div className="rounded-[22px] border border-white/10 bg-black/15 p-4">
      <div className="text-xs uppercase tracking-[0.16em] text-sky-100/80">{label}</div>
      <div className="mt-2 text-2xl font-semibold text-white">{value}</div>
      <div className="mt-1 text-xs text-slate-300">{helper}</div>
    </div>
  );
}
