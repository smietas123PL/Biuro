import {
  formatReplayTimestamp,
  isReplayFailureEvent,
  type FailureExplanationResponse,
  type ReplayEvent,
} from './agentReplayShared';

type AgentFailureExplanationPanelProps = {
  currentReplayEvent: ReplayEvent | null;
  hasReplay: boolean;
  onExplainFailure: () => void | Promise<void>;
  isExplainingFailure: boolean;
  failureExplanationStatus: string | null;
  failureExplanation: FailureExplanationResponse | null;
};

export function AgentFailureExplanationPanel({
  currentReplayEvent,
  hasReplay,
  onExplainFailure,
  isExplainingFailure,
  failureExplanationStatus,
  failureExplanation,
}: AgentFailureExplanationPanelProps) {
  return (
    <div className="rounded-xl border bg-card p-4 space-y-3">
      <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
            Failure explanation
          </p>
          <p className="text-sm text-muted-foreground">
            Ask the system to diagnose the latest failure in scope and
            translate it into a plain-language explanation with next steps.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void onExplainFailure()}
          className="inline-flex items-center justify-center rounded-lg border px-3 py-2 text-sm hover:bg-accent transition-colors disabled:cursor-not-allowed disabled:opacity-60"
          disabled={isExplainingFailure || !hasReplay}
        >
          {isExplainingFailure
            ? 'Explaining...'
            : isReplayFailureEvent(currentReplayEvent)
              ? 'Explain failure'
              : 'Explain latest failure'}
        </button>
      </div>

      {failureExplanationStatus ? (
        <p className="text-sm text-muted-foreground">
          {failureExplanationStatus}
        </p>
      ) : null}

      {failureExplanation ? (
        <div className="rounded-xl border bg-muted/20 p-4 space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`rounded-full px-3 py-1 text-xs font-medium ${
                failureExplanation.explanation.severity === 'high'
                  ? 'bg-rose-100 text-rose-700'
                  : failureExplanation.explanation.severity === 'medium'
                    ? 'bg-amber-100 text-amber-700'
                    : 'bg-slate-100 text-slate-700'
              }`}
            >
              {failureExplanation.explanation.severity} severity
            </span>
            <span className="rounded-full border bg-background px-3 py-1 text-xs text-muted-foreground">
              {failureExplanation.planner.mode === 'llm'
                ? `Planned by ${failureExplanation.planner.runtime || 'LLM'}`
                : 'Fallback diagnosis'}
            </span>
          </div>

          <div>
            <p className="text-lg font-semibold">
              {failureExplanation.explanation.headline}
            </p>
            <p className="mt-2 text-sm text-muted-foreground">
              {failureExplanation.explanation.summary}
            </p>
          </div>

          <div className="rounded-lg border bg-card px-4 py-3">
            <span className="block text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
              Likely cause
            </span>
            <span className="text-sm text-foreground">
              {failureExplanation.explanation.likely_cause}
            </span>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
                Evidence
              </p>
              {failureExplanation.explanation.evidence.map((entry) => (
                <p key={entry} className="text-sm text-muted-foreground">
                  {entry}
                </p>
              ))}
            </div>
            <div className="space-y-2">
              <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
                Recommended actions
              </p>
              {failureExplanation.explanation.recommended_actions.map((entry) => (
                <p key={entry} className="text-sm text-muted-foreground">
                  {entry}
                </p>
              ))}
            </div>
          </div>

          <div className="text-xs text-muted-foreground">
            Focus event: {failureExplanation.target_event.action} on{' '}
            {failureExplanation.target_event.task_title || 'unknown task'} at{' '}
            {formatReplayTimestamp(failureExplanation.target_event.timestamp)}
          </div>
        </div>
      ) : null}
    </div>
  );
}
