import { Sparkles } from 'lucide-react';
import {
  type CollaborationTask,
  type CollaborationTimelineItem,
  type TimelineFilterId,
  type TimelineWindow,
} from './taskDetailShared';
import { TaskForceComposer } from './TaskForceComposer';
import { TaskForceTimelineFilters } from './TaskForceTimelineFilters';
import { TaskForceTimelineWindow } from './TaskForceTimelineWindow';

type TaskForceViewProps = {
  currentTaskTitle: string;
  filteredTimelineCount: number;
  timelineWindows: TimelineWindow[];
  activeTimelineFilter: TimelineFilterId;
  timelineFilterOptions: Array<{ id: TimelineFilterId; count: number }>;
  onTimelineFilterChange: (filter: TimelineFilterId) => void;
  expandedToolSequenceIds: Set<string>;
  onToggleToolSequence: (sequenceId: string) => void;
  tasks: CollaborationTask[];
  timeline: CollaborationTimelineItem[];
  newMsg: string;
  onMessageChange: (value: string) => void;
  onSendMessage: () => void | Promise<void>;
};

export function TaskForceView({
  currentTaskTitle,
  filteredTimelineCount,
  timelineWindows,
  activeTimelineFilter,
  timelineFilterOptions,
  onTimelineFilterChange,
  expandedToolSequenceIds,
  onToggleToolSequence,
  tasks,
  timeline,
  newMsg,
  onMessageChange,
  onSendMessage,
}: TaskForceViewProps) {
  return (
    <section className="rounded-[28px] border bg-card p-5 shadow-sm lg:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b pb-4">
        <div>
          <div className="flex items-center gap-2 text-lg font-semibold">
            <Sparkles className="h-5 w-5 text-sky-600" />
            Task Timeline
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            A real event timeline grouped into 30-second windows, so
            delegation, reasoning, and tool activity read like one operation.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="rounded-full border bg-muted/20 px-3 py-1 text-xs text-muted-foreground">
            Focusing task: {currentTaskTitle}
          </div>
          <div className="rounded-full border bg-sky-50 px-3 py-1 text-xs text-sky-700">
            {filteredTimelineCount} event
            {filteredTimelineCount === 1 ? '' : 's'}
          </div>
          <div className="rounded-full border bg-background px-3 py-1 text-xs text-muted-foreground">
            {timelineWindows.length} timeline window
            {timelineWindows.length === 1 ? '' : 's'}
          </div>
        </div>
      </div>

      <div className="mt-5 space-y-5">
        <TaskForceTimelineFilters
          activeTimelineFilter={activeTimelineFilter}
          timelineFilterOptions={timelineFilterOptions}
          onTimelineFilterChange={onTimelineFilterChange}
        />

        <div className="space-y-5">
          {timelineWindows.map((window) => (
            <TaskForceTimelineWindow
              key={window.id}
              window={window}
              expandedToolSequenceIds={expandedToolSequenceIds}
              onToggleToolSequence={onToggleToolSequence}
              tasks={tasks}
              timeline={timeline}
            />
          ))}
        </div>

        {timelineWindows.length === 0 && (
          <div className="rounded-2xl border border-dashed p-10 text-center text-sm text-muted-foreground">
            No events match the current timeline filter yet.
          </div>
        )}
      </div>

      <TaskForceComposer
        newMsg={newMsg}
        onMessageChange={onMessageChange}
        onSend={onSendMessage}
      />
    </section>
  );
}
