import {
  getFallbackCount,
  getReplayRouting,
  type ReplayEvent,
} from './agentReplayShared';

type AgentReplayRoutingCardProps = {
  event: ReplayEvent | null;
};

export function AgentReplayRoutingCard({
  event,
}: AgentReplayRoutingCardProps) {
  const routing = getReplayRouting(event?.details);

  if (!routing) {
    return null;
  }

  return (
    <div className="rounded-xl border bg-card p-4 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
          Provider: {routing.selected_runtime}
        </span>
        <span className="rounded-full bg-muted px-3 py-1 text-xs text-muted-foreground">
          Model: {routing.selected_model}
        </span>
        {getFallbackCount(routing) > 0 ? (
          <span className="rounded-full bg-amber-500/10 px-3 py-1 text-xs font-medium text-amber-700">
            Fallbacks: {getFallbackCount(routing)}
          </span>
        ) : (
          <span className="rounded-full bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-700">
            Direct hit
          </span>
        )}
      </div>
      <div className="space-y-2 text-xs text-muted-foreground">
        {routing.attempts.map((attempt, index) => (
          <div
            key={`${attempt.runtime}-${attempt.model}-${index}`}
            className="flex flex-wrap items-center gap-2"
          >
            <span className="font-medium text-foreground">
              {attempt.runtime} / {attempt.model}
            </span>
            <span
              className={`rounded-full px-2 py-0.5 ${
                attempt.status === 'success'
                  ? 'bg-emerald-500/10 text-emerald-700'
                  : attempt.status === 'fallback'
                    ? 'bg-amber-500/10 text-amber-700'
                    : 'bg-red-500/10 text-red-700'
              }`}
            >
              {attempt.status}
            </span>
            {attempt.reason ? <span>{attempt.reason}</span> : null}
          </div>
        ))}
      </div>
    </div>
  );
}
