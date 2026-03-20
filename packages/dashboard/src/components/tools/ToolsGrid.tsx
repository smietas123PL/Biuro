import { Package2 } from 'lucide-react';
import { typeIcon, type Tool } from './toolsShared';

export function ToolsGrid({
  tools,
  filteredTools,
  loading,
  selectedToolId,
  focusTool,
}: {
  tools: Tool[];
  filteredTools: Tool[];
  loading: boolean;
  selectedToolId: string | null;
  focusTool: (toolId: string | null) => void;
}) {
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {filteredTools.map((tool) => {
        const Icon = typeIcon[tool.type] ?? Package2;
        const isSelected = tool.id === selectedToolId;

        return (
          <div
            key={tool.id}
            className={`rounded-2xl border bg-card p-5 shadow-sm transition-colors ${isSelected ? 'border-primary ring-2 ring-primary/10' : ''}`}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-lg font-semibold">{tool.name}</div>
                <div className="mt-1 text-sm text-muted-foreground">
                  {tool.description || 'No description provided.'}
                </div>
              </div>
              <div className="rounded-xl bg-muted p-3 text-muted-foreground">
                <Icon className="h-5 w-5" />
              </div>
            </div>

            <div className="mt-5 flex items-center justify-between text-sm">
              <span className="rounded-full bg-muted px-2 py-1 uppercase tracking-wide text-muted-foreground">
                {tool.type}
              </span>
              <span className="text-muted-foreground">
                {tool.agent_count} assigned agents
              </span>
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              {tool.assigned_agents.slice(0, 3).map((assignment) => (
                <span
                  key={assignment.agent_id}
                  className="rounded-full bg-slate-100 px-2 py-1 text-[11px] uppercase tracking-wide text-slate-700"
                >
                  {assignment.agent_name}
                </span>
              ))}
              {tool.assigned_agents.length > 3 && (
                <span className="rounded-full bg-slate-100 px-2 py-1 text-[11px] uppercase tracking-wide text-slate-700">
                  +{tool.assigned_agents.length - 3} more
                </span>
              )}
            </div>

            <div className="mt-5 grid gap-3 rounded-2xl border bg-muted/20 p-4 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Last status</span>
                <span
                  className={`rounded-full px-2 py-1 text-[11px] uppercase tracking-wide ${
                    tool.usage.last_status === 'success'
                      ? 'bg-emerald-100 text-emerald-700'
                      : tool.usage.last_status === 'error'
                        ? 'bg-red-100 text-red-700'
                        : 'bg-slate-100 text-slate-600'
                  }`}
                >
                  {tool.usage.last_status || 'unused'}
                </span>
              </div>
              <div className="flex items-center justify-between text-muted-foreground">
                <span>Total calls</span>
                <span className="text-foreground">{tool.usage.total_calls}</span>
              </div>
              <div className="flex items-center justify-between text-muted-foreground">
                <span>Success / errors</span>
                <span className="text-foreground">
                  {tool.usage.success_count} / {tool.usage.error_count}
                </span>
              </div>
              <div className="flex items-center justify-between text-muted-foreground">
                <span>Last called</span>
                <span className="text-foreground">
                  {tool.usage.last_called_at
                    ? new Date(tool.usage.last_called_at).toLocaleString()
                    : 'Never'}
                </span>
              </div>
            </div>

            <div className="mt-5">
              <button
                onClick={() => focusTool(tool.id)}
                className="w-full rounded-xl border px-3 py-2 text-sm text-foreground transition-colors hover:bg-accent"
              >
                {isSelected ? 'Viewing details' : 'Open details'}
              </button>
            </div>

            <div className="mt-5 space-y-3">
              <div className="text-sm font-medium">Recent Calls</div>
              {tool.recent_calls.length > 0 ? (
                tool.recent_calls.slice(0, 3).map((call) => (
                  <div
                    key={call.id}
                    className="rounded-xl border bg-muted/10 p-3 text-sm"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-medium text-foreground">
                        {call.task_title || 'No task title'}
                      </span>
                      <span
                        className={`rounded-full px-2 py-1 text-[11px] uppercase tracking-wide ${
                          call.status === 'success'
                            ? 'bg-emerald-100 text-emerald-700'
                            : 'bg-red-100 text-red-700'
                        }`}
                      >
                        {call.status}
                      </span>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                      <span>{call.agent_name || 'Unknown agent'}</span>
                      <span>
                        {call.duration_ms ? `${call.duration_ms} ms` : 'No duration'}
                      </span>
                      <span>{new Date(call.created_at).toLocaleString()}</span>
                    </div>
                  </div>
                ))
              ) : (
                <div className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
                  No tool calls recorded yet.
                </div>
              )}
            </div>
          </div>
        );
      })}

      {tools.length === 0 && !loading && (
        <div className="col-span-full rounded-2xl border border-dashed p-12 text-center text-muted-foreground italic">
          No tools registered yet.
        </div>
      )}

      {tools.length > 0 && filteredTools.length === 0 && !loading && (
        <div className="col-span-full rounded-2xl border border-dashed p-12 text-center text-muted-foreground italic">
          No tools match the current filters.
        </div>
      )}
    </div>
  );
}
