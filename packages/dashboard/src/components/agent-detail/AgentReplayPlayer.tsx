import { PauseCircle, PlayCircle } from 'lucide-react';
import { AgentFailureExplanationPanel } from './AgentFailureExplanationPanel';
import { AgentReplayForkPanel } from './AgentReplayForkPanel';
import { AgentReplayRoutingCard } from './AgentReplayRoutingCard';
import {
  formatCurrency,
  formatReplayTimestamp,
  playbackSpeeds,
  type FailureExplanationResponse,
  type ReplayEvent,
  type ReplayForkResponse,
} from './agentReplayShared';

type AgentReplayPlayerProps = {
  currentReplayEvent: ReplayEvent | null;
  clampedReplayIndex: number;
  replayEventsLength: number;
  replayEventParam: string | null;
  isPlaying: boolean;
  playbackSpeed: number;
  onTogglePlayback: () => void;
  onPlaybackSpeedChange: (speed: number) => void;
  onScrub: (index: number) => void;
  hasReplay: boolean;
  forkPrompt: string;
  onForkPromptChange: (value: string) => void;
  onForkReplay: () => void | Promise<void>;
  isForking: boolean;
  forkStatus: string | null;
  forkResult: ReplayForkResponse | null;
  onExplainFailure: () => void | Promise<void>;
  isExplainingFailure: boolean;
  failureExplanationStatus: string | null;
  failureExplanation: FailureExplanationResponse | null;
};

export function AgentReplayPlayer({
  currentReplayEvent,
  clampedReplayIndex,
  replayEventsLength,
  replayEventParam,
  isPlaying,
  playbackSpeed,
  onTogglePlayback,
  onPlaybackSpeedChange,
  onScrub,
  hasReplay,
  forkPrompt,
  onForkPromptChange,
  onForkReplay,
  isForking,
  forkStatus,
  forkResult,
  onExplainFailure,
  isExplainingFailure,
  failureExplanationStatus,
  failureExplanation,
}: AgentReplayPlayerProps) {
  return (
    <div className="rounded-xl border bg-muted/30 p-4 space-y-3">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
            Current frame
          </p>
          <p className="text-lg font-semibold">{currentReplayEvent?.summary}</p>
          <p className="text-xs text-muted-foreground">
            {currentReplayEvent?.action} |{' '}
            {currentReplayEvent
              ? formatReplayTimestamp(currentReplayEvent.timestamp)
              : ''}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onTogglePlayback}
            className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm hover:bg-accent transition-colors"
          >
            {isPlaying ? (
              <PauseCircle className="w-4 h-4" />
            ) : (
              <PlayCircle className="w-4 h-4" />
            )}
            {isPlaying ? 'Pause' : 'Play'}
          </button>
          {playbackSpeeds.map((speed) => (
            <button
              key={speed}
              type="button"
              onClick={() => onPlaybackSpeedChange(speed)}
              className={`rounded-lg border px-3 py-2 text-sm transition-colors ${
                playbackSpeed === speed
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'hover:bg-accent'
              }`}
            >
              {speed}x
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>
            Event {clampedReplayIndex + 1} of {replayEventsLength}
          </span>
          <span>{currentReplayEvent?.task_title || 'Cross-agent activity'}</span>
        </div>
        {replayEventParam && currentReplayEvent?.id === replayEventParam ? (
          <div className="inline-flex items-center rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-xs font-medium text-sky-700">
            Source fork event
          </div>
        ) : null}
        <input
          aria-label="Replay scrubber"
          className="w-full accent-primary"
          type="range"
          min={0}
          max={Math.max(replayEventsLength - 1, 0)}
          step={1}
          value={clampedReplayIndex}
          onChange={(event) => onScrub(Number(event.target.value))}
        />
      </div>

      <div className="grid gap-3 text-sm text-muted-foreground md:grid-cols-3">
        <div className="rounded-lg border bg-card px-3 py-2">
          <span className="block text-[11px] uppercase tracking-[0.16em]">
            Type
          </span>
          <span className="text-foreground">
            {currentReplayEvent?.type || 'n/a'}
          </span>
        </div>
        <div className="rounded-lg border bg-card px-3 py-2">
          <span className="block text-[11px] uppercase tracking-[0.16em]">
            Duration
          </span>
          <span className="text-foreground">
            {currentReplayEvent?.duration_ms
              ? `${currentReplayEvent.duration_ms} ms`
              : 'n/a'}
          </span>
        </div>
        <div className="rounded-lg border bg-card px-3 py-2">
          <span className="block text-[11px] uppercase tracking-[0.16em]">
            Cost
          </span>
          <span className="text-foreground">
            {formatCurrency(currentReplayEvent?.cost_usd)}
          </span>
        </div>
      </div>

      <AgentReplayRoutingCard event={currentReplayEvent} />
      <AgentReplayForkPanel
        currentReplayEvent={currentReplayEvent}
        forkPrompt={forkPrompt}
        onForkPromptChange={onForkPromptChange}
        onForkReplay={onForkReplay}
        isForking={isForking}
        forkStatus={forkStatus}
        forkResult={forkResult}
      />
      <AgentFailureExplanationPanel
        currentReplayEvent={currentReplayEvent}
        hasReplay={hasReplay}
        onExplainFailure={onExplainFailure}
        isExplainingFailure={isExplainingFailure}
        failureExplanationStatus={failureExplanationStatus}
        failureExplanation={failureExplanation}
      />
    </div>
  );
}
