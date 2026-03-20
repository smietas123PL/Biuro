import { ClipboardList, RadioTower } from 'lucide-react';
import { Link } from 'react-router-dom';
import {
  MetricBadge,
  formatDateTime,
  getForkReplayLink,
  getStatusTone,
  type CollaborationParticipant,
  type CollaborationSnapshot,
  type TaskDetailViewMode,
} from './taskDetailShared';

type TaskDetailHeroProps = {
  snapshot: CollaborationSnapshot;
  activeViewMode: TaskDetailViewMode;
  onViewModeChange: (mode: TaskDetailViewMode) => void;
  liveLabel: string | null;
  isRefreshing: boolean;
  participants: CollaborationParticipant[];
};

export function TaskDetailHero({
  snapshot,
  activeViewMode,
  onViewModeChange,
  liveLabel,
  isRefreshing,
  participants,
}: TaskDetailHeroProps) {
  return (
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
              <h2 className="text-3xl font-semibold tracking-tight">
                {snapshot.root_task.title}
              </h2>
              <span
                className={`rounded-full border px-3 py-1 text-[11px] uppercase tracking-wide ${getStatusTone(snapshot.root_task.status)}`}
              >
                {snapshot.root_task.status}
              </span>
            </div>
            <p className="max-w-3xl text-sm leading-7 text-slate-200">
              {snapshot.root_task.description ||
                'This task force is coordinating through delegated subtasks, live reasoning, and internal debate.'}
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
                        <span>
                          Replay event:{' '}
                          {snapshot.current_task.fork_origin.source_event_id}
                        </span>
                      ) : null}
                      {formatDateTime(
                        snapshot.current_task.fork_origin.source_timestamp
                      ) ? (
                        <span>
                          Fork point:{' '}
                          {formatDateTime(
                            snapshot.current_task.fork_origin.source_timestamp
                          )}
                        </span>
                      ) : null}
                      {snapshot.current_task.fork_origin.prompt_override ? (
                        <span>Prompt override included</span>
                      ) : null}
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
                onClick={() => onViewModeChange('overview')}
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
                onClick={() => onViewModeChange('task-force')}
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
            <MetricBadge
              label="Agents in formation"
              value={String(snapshot.summary.participant_count)}
              helper="Active contributors in this task force"
            />
            <MetricBadge
              label="Subtasks in play"
              value={String(snapshot.summary.task_count)}
              helper="Root mission plus delegated workstreams"
            />
            <MetricBadge
              label="Reasoning bursts"
              value={String(snapshot.summary.thought_count)}
              helper="Thoughts captured from live heartbeats"
            />
          </div>
        </div>

        <div className="rounded-[24px] border border-white/10 bg-white/8 p-5 backdrop-blur">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-xs uppercase tracking-[0.16em] text-sky-100/80">
                Live pulse
              </div>
              <div className="mt-2 text-lg font-semibold">
                {liveLabel ||
                  'Watching the team reason together in real time.'}
              </div>
            </div>
            <div
              className={`mt-1 h-3 w-3 rounded-full ${
                isRefreshing ? 'animate-pulse bg-emerald-300' : 'bg-sky-300'
              }`}
            />
          </div>

          <div className="mt-5 space-y-3">
            {participants.slice(0, 3).map((participant) => (
              <div
                key={participant.agent_id}
                className="rounded-2xl border border-white/10 bg-black/15 p-4"
              >
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="font-medium text-white">
                      {participant.name}
                    </div>
                    <div className="text-xs text-slate-300">
                      {participant.role || 'Task force member'}
                    </div>
                  </div>
                  <span
                    className={`rounded-full border px-2 py-1 text-[11px] uppercase tracking-wide ${getStatusTone(participant.status || 'idle')}`}
                  >
                    {participant.status || 'idle'}
                  </span>
                </div>
                <div className="mt-3 flex flex-wrap gap-3 text-xs text-slate-300">
                  <span>
                    {participant.assigned_task_count} assigned task
                    {participant.assigned_task_count === 1 ? '' : 's'}
                  </span>
                  <span>{participant.contribution_count} visible moves</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
