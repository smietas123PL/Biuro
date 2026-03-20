import { TraceLinkCallout } from '../components/TraceLinkCallout';
import { CurrentFocusPanel } from '../components/task-detail/CurrentFocusPanel';
import { TaskDetailHero } from '../components/task-detail/TaskDetailHero';
import { TaskForceMapPanel } from '../components/task-detail/TaskForceMapPanel';
import { TaskForceView } from '../components/task-detail/TaskForceView';
import { TaskOverviewView } from '../components/task-detail/TaskOverviewView';
import { TeamReadoutPanel } from '../components/task-detail/TeamReadoutPanel';
import { useTaskDetailPageController } from '../components/task-detail/useTaskDetailPageController';

export default function TaskDetailPage() {
  const {
    error,
    lastTrace,
    snapshot,
    newMsg,
    setNewMsg,
    isRefreshing,
    liveLabel,
    activeViewMode,
    activeTimelineFilter,
    expandedToolSequenceIds,
    activeDelegationHealthFilter,
    currentTaskEntry,
    timeline,
    participants,
    tasks,
    timelineFilterOptions,
    filteredTimeline,
    timelineWindows,
    recentTimelineItems,
    delegationHealthByTaskId,
    delegationHealthSummary,
    riskyTaskIds,
    visibleTasks,
    focusedTaskMapTaskId,
    focusedTaskMapTask,
    isFocusedTaskVisible,
    toggleToolSequence,
    setViewMode,
    setTaskMapFocus,
    setDelegationHealthFilter,
    setTimelineFilter,
    handleSend,
  } = useTaskDetailPageController();

  if (!snapshot) {
    return (
      <div className="rounded-2xl border border-dashed p-10 text-sm text-muted-foreground">
        Loading collaboration mode...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <TaskDetailHero
        snapshot={snapshot}
        activeViewMode={activeViewMode}
        onViewModeChange={setViewMode}
        liveLabel={liveLabel}
        isRefreshing={isRefreshing}
        participants={participants}
      />

      {error ? (
        <div className="space-y-3">
          <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
          <TraceLinkCallout
            trace={lastTrace}
            title="Debug This Task Error"
            body="Open the latest collaboration trace in Grafana Explore to inspect the failing request."
            compact
          />
        </div>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[1.35fr_0.65fr]">
        {activeViewMode === 'task-force' ? (
          <TaskForceView
            currentTaskTitle={snapshot.current_task.title}
            filteredTimelineCount={filteredTimeline.length}
            timelineWindows={timelineWindows}
            activeTimelineFilter={activeTimelineFilter}
            timelineFilterOptions={timelineFilterOptions}
            onTimelineFilterChange={setTimelineFilter}
            expandedToolSequenceIds={expandedToolSequenceIds}
            onToggleToolSequence={toggleToolSequence}
            tasks={tasks}
            timeline={timeline}
            newMsg={newMsg}
            onMessageChange={setNewMsg}
            onSendMessage={handleSend}
          />
        ) : (
          <TaskOverviewView
            snapshot={snapshot}
            currentTaskEntry={currentTaskEntry}
            delegationHealthSummary={delegationHealthSummary}
            recentTimelineItems={recentTimelineItems}
          />
        )}

        <div className="space-y-6">
          <TaskForceMapPanel
            activeDelegationHealthFilter={activeDelegationHealthFilter}
            onDelegationHealthFilterChange={setDelegationHealthFilter}
            riskyTaskCount={riskyTaskIds.size}
            delegationHealthSummary={delegationHealthSummary}
            focusedTaskMapTask={focusedTaskMapTask}
            focusedTaskMapTaskId={focusedTaskMapTaskId}
            isFocusedTaskVisible={isFocusedTaskVisible}
            onTaskMapFocusChange={setTaskMapFocus}
            visibleTasks={visibleTasks}
            delegationHealthByTaskId={delegationHealthByTaskId}
          />
          <TeamReadoutPanel participants={participants} />
          <CurrentFocusPanel
            currentTask={snapshot.current_task}
            currentTaskEntry={currentTaskEntry}
          />
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
