import { Link } from 'react-router-dom';
import {
  type ReplayEvent,
  type ReplayForkResponse,
} from './agentReplayShared';

type AgentReplayForkPanelProps = {
  currentReplayEvent: ReplayEvent | null;
  forkPrompt: string;
  onForkPromptChange: (value: string) => void;
  onForkReplay: () => void | Promise<void>;
  isForking: boolean;
  forkStatus: string | null;
  forkResult: ReplayForkResponse | null;
};

export function AgentReplayForkPanel({
  currentReplayEvent,
  forkPrompt,
  onForkPromptChange,
  onForkReplay,
  isForking,
  forkStatus,
  forkResult,
}: AgentReplayForkPanelProps) {
  return (
    <div className="rounded-xl border bg-card p-4 space-y-3">
      <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
            Time-travel fork
          </p>
          <p className="text-sm text-muted-foreground">
            Clone the task from this replay frame, restore visible history, and
            optionally steer the rerun with a new supervisor prompt.
          </p>
        </div>
        {forkResult ? (
          <Link
            to={`/tasks/${forkResult.task_id}`}
            className="inline-flex items-center justify-center rounded-lg border px-3 py-2 text-sm hover:bg-accent transition-colors"
          >
            Open forked task
          </Link>
        ) : null}
      </div>

      {currentReplayEvent?.task_id ? (
        <>
          <textarea
            aria-label="Fork prompt override"
            value={forkPrompt}
            onChange={(event) => onForkPromptChange(event.target.value)}
            placeholder="Optional: add a new steering prompt for this rerun branch."
            className="min-h-[88px] w-full rounded-lg border bg-card px-3 py-2 text-sm"
          />
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <p className="text-xs text-muted-foreground">
              Fork point: {currentReplayEvent.task_title || 'Current task'} via{' '}
              {currentReplayEvent.action}
            </p>
            <button
              type="button"
              onClick={() => void onForkReplay()}
              className="inline-flex items-center justify-center rounded-lg border px-3 py-2 text-sm hover:bg-accent transition-colors disabled:cursor-not-allowed disabled:opacity-60"
              disabled={isForking}
            >
              {isForking ? 'Forking...' : 'Fork from this point'}
            </button>
          </div>
        </>
      ) : (
        <p className="text-sm text-muted-foreground">
          This frame is not scoped to a task, so there is nothing stable to
          fork from here yet.
        </p>
      )}

      {forkStatus ? (
        <p className="text-sm text-muted-foreground">{forkStatus}</p>
      ) : null}
      {forkResult ? (
        <p className="text-xs text-muted-foreground">
          Restored {forkResult.restored_message_count} message
          {forkResult.restored_message_count === 1 ? '' : 's'}
          {forkResult.seeded_session
            ? ' and seeded a session snapshot.'
            : ' and started with a synthetic fork checkpoint.'}
          {forkResult.prompt_override_applied
            ? ' Prompt override included.'
            : ''}
        </p>
      ) : null}
    </div>
  );
}
