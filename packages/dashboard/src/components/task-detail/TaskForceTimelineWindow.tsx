import { Clock3 } from 'lucide-react';
import {
  TimelineEventCard,
  buildTimelineSegments,
  formatTime,
  getTimelineFilterLabel,
  type CollaborationTask,
  type CollaborationTimelineItem,
  type TimelineFilterId,
  type TimelineWindow,
} from './taskDetailShared';
import { TaskForceToolSequenceCard } from './TaskForceToolSequenceCard';

type TaskForceTimelineWindowProps = {
  window: TimelineWindow;
  expandedToolSequenceIds: Set<string>;
  onToggleToolSequence: (sequenceId: string) => void;
  tasks: CollaborationTask[];
  timeline: CollaborationTimelineItem[];
};

export function TaskForceTimelineWindow({
  window,
  expandedToolSequenceIds,
  onToggleToolSequence,
  tasks,
  timeline,
}: TaskForceTimelineWindowProps) {
  return (
    <section className="grid gap-4 lg:grid-cols-[148px_1fr]">
      <div className="lg:pt-3">
        <div className="sticky top-24 rounded-[22px] border bg-muted/10 p-4">
          <div className="inline-flex items-center gap-2 rounded-full border bg-background px-2.5 py-1 text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
            <Clock3 className="h-3.5 w-3.5" />
            Window
          </div>
          <div className="mt-3 text-lg font-semibold text-foreground">
            {formatTime(window.started_at, true)}
          </div>
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
            return (
              <TaskForceToolSequenceCard
                key={segment.id}
                segment={segment}
                isExpanded={expandedToolSequenceIds.has(segment.id)}
                onToggle={onToggleToolSequence}
                tasks={tasks}
                timeline={timeline}
              />
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
  );
}
