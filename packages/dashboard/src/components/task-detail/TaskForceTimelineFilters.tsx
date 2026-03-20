import { ListFilter } from 'lucide-react';
import {
  getTimelineFilterLabel,
  type TimelineFilterId,
} from './taskDetailShared';

type TaskForceTimelineFiltersProps = {
  activeTimelineFilter: TimelineFilterId;
  timelineFilterOptions: Array<{ id: TimelineFilterId; count: number }>;
  onTimelineFilterChange: (filter: TimelineFilterId) => void;
};

export function TaskForceTimelineFilters({
  activeTimelineFilter,
  timelineFilterOptions,
  onTimelineFilterChange,
}: TaskForceTimelineFiltersProps) {
  return (
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
              onClick={() => onTimelineFilterChange(option.id)}
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
        Heartbeat thoughts, supervisor nudges, delegations, and tool activity
        are clustered into short operational windows.
      </p>
    </div>
  );
}
