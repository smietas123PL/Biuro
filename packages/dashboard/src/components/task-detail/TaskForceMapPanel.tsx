import { Users } from 'lucide-react';
import { Link } from 'react-router-dom';
import {
  getStatusTone,
  type CollaborationTask,
  type DelegationHealth,
  type DelegationHealthFilterId,
  type DelegationPreview,
} from './taskDetailShared';

type TaskForceMapPanelProps = {
  activeDelegationHealthFilter: DelegationHealthFilterId;
  onDelegationHealthFilterChange: (filter: DelegationHealthFilterId) => void;
  riskyTaskCount: number;
  delegationHealthSummary: {
    fastHandoff: number;
    slowStart: number;
    stuck: number;
  };
  focusedTaskMapTask: CollaborationTask | null;
  focusedTaskMapTaskId: string | null;
  isFocusedTaskVisible: boolean;
  onTaskMapFocusChange: (taskId: string | null) => void;
  visibleTasks: CollaborationTask[];
  delegationHealthByTaskId: Map<
    string,
    { health: DelegationHealth; preview: DelegationPreview }
  >;
};

export function TaskForceMapPanel({
  activeDelegationHealthFilter,
  onDelegationHealthFilterChange,
  riskyTaskCount,
  delegationHealthSummary,
  focusedTaskMapTask,
  focusedTaskMapTaskId,
  isFocusedTaskVisible,
  onTaskMapFocusChange,
  visibleTasks,
  delegationHealthByTaskId,
}: TaskForceMapPanelProps) {
  return (
    <section className="rounded-[28px] border bg-card p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-lg font-semibold">
          <Users className="h-5 w-5 text-violet-600" />
          Task Force Map
        </div>
        <button
          type="button"
          onClick={() =>
            onDelegationHealthFilterChange(
              activeDelegationHealthFilter === 'risky' ? 'all' : 'risky'
            )
          }
          className={`rounded-full border px-3 py-1.5 text-xs transition-colors ${
            activeDelegationHealthFilter === 'risky'
              ? 'border-rose-200 bg-rose-100 text-rose-700'
              : 'bg-background text-muted-foreground hover:border-rose-200 hover:text-foreground'
          }`}
        >
          {activeDelegationHealthFilter === 'risky'
            ? 'Show all workstreams'
            : `Show only risky handoffs (${riskyTaskCount})`}
        </button>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        Delegated workstreams and the agents currently holding them.
      </p>

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => onDelegationHealthFilterChange('stuck')}
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
          onClick={() => onDelegationHealthFilterChange('slow-start')}
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
          onClick={() => onDelegationHealthFilterChange('fast-handoff')}
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
            onClick={() => onDelegationHealthFilterChange('all')}
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
            onClick={() => onTaskMapFocusChange(null)}
            className="rounded-full border bg-white px-3 py-1 text-xs text-sky-700 hover:text-sky-900"
          >
            Clear focus
          </button>
        </div>
      )}

      <div className="mt-5 space-y-3">
        {visibleTasks.map((task) => {
          const delegationEntry = delegationHealthByTaskId.get(task.id);
          return (
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
                    <div className="font-medium text-foreground">
                      {task.title}
                    </div>
                    {delegationEntry && (
                      <span
                        className={`rounded-full border px-2 py-1 text-[11px] uppercase tracking-wide ${delegationEntry.health.className}`}
                      >
                        {delegationEntry.health.label}
                      </span>
                    )}
                  </div>
                  <div className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
                    {task.depth === 0
                      ? 'Root mission'
                      : `Delegation layer ${task.depth}`}
                  </div>
                </div>
                <span
                  className={`rounded-full border px-2 py-1 text-[11px] uppercase tracking-wide ${getStatusTone(task.status)}`}
                >
                  {task.status}
                </span>
              </div>
              <div className="mt-3 text-sm text-muted-foreground">
                {task.description ||
                  'No additional context recorded for this workstream.'}
              </div>
              {delegationEntry && (
                <div className="mt-3 text-xs text-muted-foreground">
                  Delegation health: {delegationEntry.health.helper}
                </div>
              )}
              <div className="mt-4 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                <button
                  type="button"
                  onClick={() =>
                    onTaskMapFocusChange(
                      focusedTaskMapTaskId === task.id ? null : task.id
                    )
                  }
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
                  <Link
                    className="text-foreground underline-offset-2 hover:underline"
                    to={`/agents/${task.assigned_to}`}
                  >
                    Agent profile
                  </Link>
                )}
                <Link
                  className="text-foreground underline-offset-2 hover:underline"
                  to={`/tasks/${task.id}`}
                >
                  Open task
                </Link>
              </div>
            </div>
          );
        })}
        {visibleTasks.length === 0 && (
          <div className="rounded-[22px] border border-dashed p-6 text-sm text-muted-foreground">
            {activeDelegationHealthFilter === 'risky'
              ? 'No risky handoffs right now. Fast delegations stay visible in the full task map.'
              : 'No workstreams match this delegation facet right now.'}
          </div>
        )}
      </div>
    </section>
  );
}
