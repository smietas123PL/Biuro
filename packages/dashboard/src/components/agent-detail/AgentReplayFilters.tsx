import {
  type ReplayEvent,
  type ReplayFilters,
} from './agentReplayShared';

type AgentReplayFiltersProps = {
  selectedTaskId: string;
  onTaskChange: (taskId: string) => void;
  taskOptions: NonNullable<ReplayFilters['tasks']>;
  hasReplayFilters: boolean;
  availableTypes: ReplayEvent['type'][];
  selectedTypes: ReplayEvent['type'][];
  onToggleType: (type: ReplayEvent['type']) => void;
  onClearFilters: () => void;
  onExportReport: () => void | Promise<void>;
  isExporting: boolean;
  exportStatus: string | null;
};

export function AgentReplayFilters({
  selectedTaskId,
  onTaskChange,
  taskOptions,
  hasReplayFilters,
  availableTypes,
  selectedTypes,
  onToggleType,
  onClearFilters,
  onExportReport,
  isExporting,
  exportStatus,
}: AgentReplayFiltersProps) {
  return (
    <>
      <div className="rounded-xl border bg-muted/20 p-4 space-y-4">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <label className="space-y-2 text-sm">
            <span className="block text-xs uppercase tracking-[0.16em] text-muted-foreground">
              Session scope
            </span>
            <select
              aria-label="Replay task filter"
              value={selectedTaskId}
              onChange={(event) => onTaskChange(event.target.value)}
              className="min-w-[220px] rounded-lg border bg-card px-3 py-2 text-sm"
            >
              <option value="all">All tasks</option>
              {taskOptions.map((task) => (
                <option key={task.task_id} value={task.task_id}>
                  {task.task_title} ({task.event_count})
                </option>
              ))}
            </select>
          </label>

          {hasReplayFilters ? (
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => void onExportReport()}
                className="rounded-lg border px-3 py-2 text-sm hover:bg-accent transition-colors"
                disabled={isExporting}
              >
                {isExporting ? 'Exporting...' : 'Export report'}
              </button>
              <button
                type="button"
                onClick={onClearFilters}
                className="rounded-lg border px-3 py-2 text-sm hover:bg-accent transition-colors"
              >
                Clear filters
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => void onExportReport()}
              className="rounded-lg border px-3 py-2 text-sm hover:bg-accent transition-colors"
              disabled={isExporting}
            >
              {isExporting ? 'Exporting...' : 'Export report'}
            </button>
          )}
        </div>

        <div className="space-y-2">
          <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
            Event types
          </p>
          <div className="flex flex-wrap gap-2">
            {availableTypes.map((type) => {
              const selected = selectedTypes.includes(type);
              return (
                <button
                  key={type}
                  type="button"
                  onClick={() => onToggleType(type)}
                  className={`rounded-full border px-3 py-1.5 text-xs uppercase tracking-[0.12em] transition-colors ${
                    selected
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'hover:bg-accent'
                  }`}
                >
                  {type}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {exportStatus ? (
        <p className="text-sm text-muted-foreground">{exportStatus}</p>
      ) : null}
    </>
  );
}
