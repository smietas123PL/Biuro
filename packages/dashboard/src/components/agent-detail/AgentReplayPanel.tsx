import { Activity } from 'lucide-react';
import { AgentReplayDiffPanel } from './AgentReplayDiffPanel';
import { AgentReplayEmptyState } from './AgentReplayEmptyState';
import { AgentReplayEventList } from './AgentReplayEventList';
import { AgentReplayFilters } from './AgentReplayFilters';
import { AgentReplayPlayer } from './AgentReplayPlayer';
import {
  type FailureExplanationResponse,
  type ReplayDiffResponse,
  type ReplayEvent,
  type ReplayFilters,
  type ReplayForkResponse,
} from './agentReplayShared';

type AgentReplayPanelProps = {
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
  canCompareTasks: boolean;
  compareLeftTaskId: string;
  compareRightTaskId: string;
  onCompareLeftTaskChange: (taskId: string) => void;
  onCompareRightTaskChange: (taskId: string) => void;
  replayDiff: ReplayDiffResponse | null;
  hasReplay: boolean;
  currentReplayEvent: ReplayEvent | null;
  clampedReplayIndex: number;
  replayEventsLength: number;
  replayEventParam: string | null;
  isPlaying: boolean;
  playbackSpeed: number;
  onTogglePlayback: () => void;
  onPlaybackSpeedChange: (speed: number) => void;
  onScrub: (index: number) => void;
  revealedEvents: ReplayEvent[];
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

export function AgentReplayPanel({
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
  canCompareTasks,
  compareLeftTaskId,
  compareRightTaskId,
  onCompareLeftTaskChange,
  onCompareRightTaskChange,
  replayDiff,
  hasReplay,
  currentReplayEvent,
  clampedReplayIndex,
  replayEventsLength,
  replayEventParam,
  isPlaying,
  playbackSpeed,
  onTogglePlayback,
  onPlaybackSpeedChange,
  onScrub,
  revealedEvents,
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
}: AgentReplayPanelProps) {
  return (
    <div className="border rounded-xl bg-card p-6 space-y-4">
      <h3 className="font-semibold flex items-center gap-2">
        <Activity className="w-4 h-4 text-primary" />
        Live Agent Replay
      </h3>

      <AgentReplayFilters
        selectedTaskId={selectedTaskId}
        onTaskChange={onTaskChange}
        taskOptions={taskOptions}
        hasReplayFilters={hasReplayFilters}
        availableTypes={availableTypes}
        selectedTypes={selectedTypes}
        onToggleType={onToggleType}
        onClearFilters={onClearFilters}
        onExportReport={onExportReport}
        isExporting={isExporting}
        exportStatus={exportStatus}
      />

      <AgentReplayDiffPanel
        canCompareTasks={canCompareTasks}
        taskOptions={taskOptions}
        compareLeftTaskId={compareLeftTaskId}
        compareRightTaskId={compareRightTaskId}
        onCompareLeftTaskChange={onCompareLeftTaskChange}
        onCompareRightTaskChange={onCompareRightTaskChange}
        replayDiff={replayDiff}
      />

      {hasReplay ? (
        <div className="space-y-5">
          <AgentReplayPlayer
            currentReplayEvent={currentReplayEvent}
            clampedReplayIndex={clampedReplayIndex}
            replayEventsLength={replayEventsLength}
            replayEventParam={replayEventParam}
            isPlaying={isPlaying}
            playbackSpeed={playbackSpeed}
            onTogglePlayback={onTogglePlayback}
            onPlaybackSpeedChange={onPlaybackSpeedChange}
            onScrub={onScrub}
            hasReplay={hasReplay}
            forkPrompt={forkPrompt}
            onForkPromptChange={onForkPromptChange}
            onForkReplay={onForkReplay}
            isForking={isForking}
            forkStatus={forkStatus}
            forkResult={forkResult}
            onExplainFailure={onExplainFailure}
            isExplainingFailure={isExplainingFailure}
            failureExplanationStatus={failureExplanationStatus}
            failureExplanation={failureExplanation}
          />
          <AgentReplayEventList revealedEvents={revealedEvents} />
        </div>
      ) : (
        <AgentReplayEmptyState hasReplayFilters={hasReplayFilters} />
      )}
    </div>
  );
}
