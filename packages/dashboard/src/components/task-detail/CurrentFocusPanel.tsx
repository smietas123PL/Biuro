import {
  getStatusTone,
  type CollaborationSnapshot,
  type CollaborationTask,
} from './taskDetailShared';

type CurrentFocusPanelProps = {
  currentTask: CollaborationSnapshot['current_task'];
  currentTaskEntry: CollaborationTask | null;
};

export function CurrentFocusPanel({
  currentTask,
  currentTaskEntry,
}: CurrentFocusPanelProps) {
  return (
    <section className="rounded-[28px] border bg-card p-5 shadow-sm">
      <div className="text-lg font-semibold">Current Focus</div>
      <div className="mt-4 rounded-[22px] border bg-gradient-to-br from-slate-50 via-white to-stone-50 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <div className="font-medium text-foreground">{currentTask.title}</div>
          <span
            className={`rounded-full border px-2 py-1 text-[11px] uppercase tracking-wide ${getStatusTone(currentTask.status)}`}
          >
            {currentTask.status}
          </span>
        </div>
        <div className="mt-3 text-sm leading-7 text-muted-foreground">
          {currentTask.description ||
            'The selected workstream is now part of a larger coordinated push.'}
        </div>
        {currentTaskEntry?.assigned_to_name && (
          <div className="mt-4 inline-flex items-center gap-2 rounded-full border bg-background px-3 py-1 text-xs text-muted-foreground">
            Owned by {currentTaskEntry.assigned_to_name}
          </div>
        )}
      </div>
    </section>
  );
}
