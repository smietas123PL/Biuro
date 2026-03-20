import { Clock3, ShieldAlert, Sparkles } from 'lucide-react';
import {
  getStatusTone,
  getTimelineFilterLabel,
  type CollaborationSnapshot,
  type CollaborationTask,
  type CollaborationTimelineItem,
} from './taskDetailShared';

type TaskOverviewViewProps = {
  snapshot: CollaborationSnapshot;
  currentTaskEntry: CollaborationTask | null;
  delegationHealthSummary: {
    fastHandoff: number;
    slowStart: number;
    stuck: number;
  };
  recentTimelineItems: CollaborationTimelineItem[];
};

export function TaskOverviewView({
  snapshot,
  currentTaskEntry,
  delegationHealthSummary,
  recentTimelineItems,
}: TaskOverviewViewProps) {
  return (
    <section className="rounded-[28px] border bg-card p-5 shadow-sm lg:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b pb-4">
        <div>
          <div className="flex items-center gap-2 text-lg font-semibold">
            <Sparkles className="h-5 w-5 text-sky-600" />
            Mission Overview
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            A lighter readout of the current mission, recent moves, and
            delegation risk before you dive into the full timeline.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="rounded-full border bg-muted/20 px-3 py-1 text-xs text-muted-foreground">
            Current focus: {snapshot.current_task.title}
          </div>
          <div className="rounded-full border bg-sky-50 px-3 py-1 text-xs text-sky-700">
            {snapshot.timeline.length} total event
            {snapshot.timeline.length === 1 ? '' : 's'}
          </div>
        </div>
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="rounded-[24px] border bg-gradient-to-br from-slate-50 via-white to-stone-50 p-5">
          <div className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
            Current focus
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <div className="text-lg font-semibold text-foreground">
              {snapshot.current_task.title}
            </div>
            <span
              className={`rounded-full border px-2 py-1 text-[11px] uppercase tracking-wide ${getStatusTone(snapshot.current_task.status)}`}
            >
              {snapshot.current_task.status}
            </span>
          </div>
          <p className="mt-3 text-sm leading-7 text-muted-foreground">
            {snapshot.current_task.description ||
              'The selected workstream is now part of a larger coordinated push.'}
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
            Use Task Force mode when you need per-event detail, filters, and
            expandable tool sequences.
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
                    <span className="font-medium text-foreground">
                      {item.summary}
                    </span>
                    <span className="rounded-full border bg-muted/20 px-2 py-1 text-[11px] uppercase tracking-wide text-muted-foreground">
                      {getTimelineFilterLabel(item.kind)}
                    </span>
                  </div>
                  <div className="mt-1 text-xs uppercase tracking-[0.16em] text-muted-foreground">
                    {item.task_title}
                  </div>
                </div>
                <div className="text-xs text-muted-foreground">
                  {new Date(item.created_at).toLocaleString()}
                </div>
              </div>
              <p className="mt-3 text-sm text-muted-foreground">
                {item.content}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
