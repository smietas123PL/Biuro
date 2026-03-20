import {
  formatCurrency,
  type ReplayDiffResponse,
  type ReplayFilters,
} from './agentReplayShared';

type AgentReplayDiffPanelProps = {
  canCompareTasks: boolean;
  taskOptions: NonNullable<ReplayFilters['tasks']>;
  compareLeftTaskId: string;
  compareRightTaskId: string;
  onCompareLeftTaskChange: (taskId: string) => void;
  onCompareRightTaskChange: (taskId: string) => void;
  replayDiff: ReplayDiffResponse | null;
};

export function AgentReplayDiffPanel({
  canCompareTasks,
  taskOptions,
  compareLeftTaskId,
  compareRightTaskId,
  onCompareLeftTaskChange,
  onCompareRightTaskChange,
  replayDiff,
}: AgentReplayDiffPanelProps) {
  return (
    <div className="rounded-xl border bg-muted/20 p-4 space-y-4">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
            Timeline diff
          </p>
          <p className="text-sm text-muted-foreground">
            Compare two task sessions for this agent using the current
            event-type filter.
          </p>
        </div>
      </div>

      {canCompareTasks ? (
        <>
          <div className="grid gap-4 md:grid-cols-2">
            <label className="space-y-2 text-sm">
              <span className="block text-xs uppercase tracking-[0.16em] text-muted-foreground">
                Left task
              </span>
              <select
                aria-label="Replay diff left task"
                value={compareLeftTaskId}
                onChange={(event) => onCompareLeftTaskChange(event.target.value)}
                className="w-full rounded-lg border bg-card px-3 py-2 text-sm"
              >
                {taskOptions.map((task) => (
                  <option key={task.task_id} value={task.task_id}>
                    {task.task_title}
                  </option>
                ))}
              </select>
            </label>

            <label className="space-y-2 text-sm">
              <span className="block text-xs uppercase tracking-[0.16em] text-muted-foreground">
                Right task
              </span>
              <select
                aria-label="Replay diff right task"
                value={compareRightTaskId}
                onChange={(event) => onCompareRightTaskChange(event.target.value)}
                className="w-full rounded-lg border bg-card px-3 py-2 text-sm"
              >
                {taskOptions.map((task) => (
                  <option key={task.task_id} value={task.task_id}>
                    {task.task_title}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {replayDiff ? (
            <div className="grid gap-4 md:grid-cols-3">
              <div className="rounded-xl border bg-card p-4 space-y-2">
                <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
                  Event delta
                </p>
                <p className="text-2xl font-semibold">
                  {replayDiff.delta.event_count}
                </p>
                <p className="text-sm text-muted-foreground">
                  {replayDiff.left.task_title} vs {replayDiff.right.task_title}
                </p>
              </div>

              <div className="rounded-xl border bg-card p-4 space-y-2">
                <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
                  Duration delta
                </p>
                <p className="text-2xl font-semibold">
                  {replayDiff.delta.total_duration_ms} ms
                </p>
                <p className="text-sm text-muted-foreground">
                  {replayDiff.left.total_duration_ms} ms vs{' '}
                  {replayDiff.right.total_duration_ms} ms
                </p>
              </div>

              <div className="rounded-xl border bg-card p-4 space-y-2">
                <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
                  Cost delta
                </p>
                <p className="text-2xl font-semibold">
                  {formatCurrency(replayDiff.delta.total_cost_usd)}
                </p>
                <p className="text-sm text-muted-foreground">
                  {formatCurrency(replayDiff.left.total_cost_usd)} vs{' '}
                  {formatCurrency(replayDiff.right.total_cost_usd)}
                </p>
              </div>

              <div className="rounded-xl border bg-card p-4 space-y-3 md:col-span-3">
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <p className="text-sm font-semibold">
                      {replayDiff.left.task_title}
                    </p>
                    {replayDiff.left.highlights.map((highlight) => (
                      <p key={highlight} className="text-sm text-muted-foreground">
                        {highlight}
                      </p>
                    ))}
                  </div>
                  <div className="space-y-2">
                    <p className="text-sm font-semibold">
                      {replayDiff.right.task_title}
                    </p>
                    {replayDiff.right.highlights.map((highlight) => (
                      <p key={highlight} className="text-sm text-muted-foreground">
                        {highlight}
                      </p>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Choose two different tasks to compare their timelines.
            </p>
          )}
        </>
      ) : (
        <p className="text-sm text-muted-foreground">
          At least two task timelines are needed before a diff becomes useful.
        </p>
      )}
    </div>
  );
}
