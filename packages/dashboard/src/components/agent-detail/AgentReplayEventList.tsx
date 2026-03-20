import {
  formatReplayTimestamp,
  getFallbackCount,
  getReplayRouting,
  type ReplayEvent,
} from './agentReplayShared';

type AgentReplayEventListProps = {
  revealedEvents: ReplayEvent[];
};

export function AgentReplayEventList({
  revealedEvents,
}: AgentReplayEventListProps) {
  return (
    <div className="space-y-4">
      {revealedEvents.map((event, index) => {
        const routing = getReplayRouting(event.details);
        return (
          <div
            key={event.id}
            className={`border-l-2 pl-4 py-1 space-y-1 ${
              index === 0 ? 'border-primary' : 'border-primary/20'
            }`}
          >
            <div className="flex justify-between text-xs text-muted-foreground gap-4">
              <span>{event.action}</span>
              <span>{formatReplayTimestamp(event.timestamp)}</span>
            </div>
            <p className="text-sm">{event.summary}</p>
            {event.task_title ? (
              <p className="text-xs text-muted-foreground">
                Task: {event.task_title}
              </p>
            ) : null}
            {routing ? (
              <p className="text-xs text-muted-foreground">
                LLM route: {routing.selected_runtime} / {routing.selected_model}
                {getFallbackCount(routing) > 0
                  ? ` • fallbacks ${getFallbackCount(routing)}`
                  : ''}
              </p>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
