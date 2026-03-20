import { ChevronDown, ChevronRight, Wrench } from 'lucide-react';
import {
  TimelineEventCard,
  formatTime,
  type CollaborationTask,
  type CollaborationTimelineItem,
  type TimelineSegment,
} from './taskDetailShared';

type ToolSequenceSegment = Extract<TimelineSegment, { type: 'tool-sequence' }>;

type TaskForceToolSequenceCardProps = {
  segment: ToolSequenceSegment;
  isExpanded: boolean;
  onToggle: (sequenceId: string) => void;
  tasks: CollaborationTask[];
  timeline: CollaborationTimelineItem[];
};

export function TaskForceToolSequenceCard({
  segment,
  isExpanded,
  onToggle,
  tasks,
  timeline,
}: TaskForceToolSequenceCardProps) {
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
    <article className="relative rounded-[24px] border border-slate-200 bg-gradient-to-br from-slate-50 via-white to-stone-50 p-4 shadow-sm">
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
              {segment.items.length} linked tool event
              {segment.items.length === 1 ? '' : 's'}
            </span>
          </div>
          <div className="mt-1 text-xs uppercase tracking-[0.16em] text-muted-foreground">
            {firstItem.task_title}
          </div>
        </div>
        <button
          type="button"
          onClick={() => onToggle(segment.id)}
          className="inline-flex items-center gap-2 rounded-full border bg-background px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground"
        >
          {isExpanded ? (
            <ChevronDown className="h-3.5 w-3.5" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5" />
          )}
          {isExpanded ? 'Collapse' : 'Expand'}
        </button>
      </div>

      <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
        <span>{firstItem.agent_name}</span>
        <span>{formatTime(firstItem.created_at, true)}</span>
        {toolNames.map((toolName) => (
          <span
            key={toolName}
            className="rounded-full border bg-background px-2 py-1"
          >
            {toolName}
          </span>
        ))}
      </div>

      {isExpanded && (
        <div className="mt-4 space-y-3 border-t pt-4">
          {segment.items.map((item) => (
            <TimelineEventCard
              key={item.id}
              item={item}
              tasks={tasks}
              timeline={timeline}
              nested
            />
          ))}
        </div>
      )}
    </article>
  );
}
