import { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { AgentDetailHeader } from '../components/agent-detail/AgentDetailHeader';
import { AgentReplayPanel } from '../components/agent-detail/AgentReplayPanel';
import { AgentSidebar } from '../components/agent-detail/AgentSidebar';
import {
  isReplayFailureEvent,
  parseReplayTypes,
  replayEventTypes,
  type FailureExplanationResponse,
  type ReplayDiffResponse,
  type ReplayEvent,
  type ReplayFilters,
  type ReplayForkResponse,
  type ReplayResponse,
} from '../components/agent-detail/agentReplayShared';
import { useApi } from '../hooks/useApi';
import { getAuthToken, getSelectedCompanyId } from '../lib/session';

export default function AgentDetailPage() {
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const { request, lastTrace } = useApi();
  const [agent, setAgent] = useState<any>(null);
  const [budget, setBudget] = useState<any>(null);
  const [replayEvents, setReplayEvents] = useState<ReplayEvent[]>([]);
  const [replayFilters, setReplayFilters] = useState<ReplayFilters | null>(
    null
  );
  const [currentReplayIndex, setCurrentReplayIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const replayTaskParam = searchParams.get('task_id')?.trim() || 'all';
  const replayEventParam = searchParams.get('event_id')?.trim() || null;
  const replayTypesParam = searchParams.get('types');
  const [selectedTaskId, setSelectedTaskId] = useState(replayTaskParam);
  const [selectedTypes, setSelectedTypes] = useState<ReplayEvent['type'][]>(
    () => parseReplayTypes(replayTypesParam)
  );
  const [isExporting, setIsExporting] = useState(false);
  const [exportStatus, setExportStatus] = useState<string | null>(null);
  const [forkPrompt, setForkPrompt] = useState('');
  const [isForking, setIsForking] = useState(false);
  const [forkStatus, setForkStatus] = useState<string | null>(null);
  const [forkResult, setForkResult] = useState<ReplayForkResponse | null>(null);
  const [isExplainingFailure, setIsExplainingFailure] = useState(false);
  const [failureExplanation, setFailureExplanation] =
    useState<FailureExplanationResponse | null>(null);
  const [failureExplanationStatus, setFailureExplanationStatus] = useState<
    string | null
  >(null);
  const [compareLeftTaskId, setCompareLeftTaskId] = useState('');
  const [compareRightTaskId, setCompareRightTaskId] = useState('');
  const [replayDiff, setReplayDiff] = useState<ReplayDiffResponse | null>(null);

  const replayQuery = (() => {
    const params = new URLSearchParams({ limit: '120' });
    if (selectedTaskId !== 'all') {
      params.set('task_id', selectedTaskId);
    }
    if (selectedTypes.length > 0) {
      params.set('types', selectedTypes.join(','));
    }
    return params.toString();
  })();

  const replayDiffQuery = (() => {
    if (
      !compareLeftTaskId ||
      !compareRightTaskId ||
      compareLeftTaskId === compareRightTaskId
    ) {
      return null;
    }

    const params = new URLSearchParams({
      left_task_id: compareLeftTaskId,
      right_task_id: compareRightTaskId,
      limit: '120',
    });

    if (selectedTypes.length > 0) {
      params.set('types', selectedTypes.join(','));
    }

    return params.toString();
  })();

  const availableTypes = replayFilters?.available_types?.length
    ? replayFilters.available_types
    : replayEventTypes;
  const taskOptions = replayFilters?.tasks ?? [];
  const canCompareTasks = taskOptions.length >= 2;

  useEffect(() => {
    const fetchAgent = async () => {
      const data = await request(`/agents/${id}`);
      setAgent(data);

      const budgetData = await request(`/agents/${id}/budgets`);
      setBudget(
        Array.isArray(budgetData) ? (budgetData[0] ?? null) : budgetData
      );
    };

    void fetchAgent();
  }, [id, request]);

  useEffect(() => {
    setSelectedTaskId(replayTaskParam);
    setSelectedTypes(parseReplayTypes(replayTypesParam));
    setForkPrompt('');
    setForkStatus(null);
    setForkResult(null);
    setFailureExplanation(null);
    setFailureExplanationStatus(null);
    setCompareLeftTaskId('');
    setCompareRightTaskId('');
    setReplayDiff(null);
  }, [id, replayTaskParam, replayTypesParam]);

  useEffect(() => {
    const fetchReplay = async () => {
      const replayData = (await request(
        `/agents/${id}/replay?${replayQuery}`
      )) as ReplayResponse;
      setReplayEvents(Array.isArray(replayData?.items) ? replayData.items : []);
      setReplayFilters(replayData?.filters ?? null);
      setCurrentReplayIndex(0);
      setIsPlaying(false);
    };

    void fetchReplay();
  }, [id, replayQuery, request, selectedTaskId, selectedTypes]);

  useEffect(() => {
    if (taskOptions.length < 2) {
      setCompareLeftTaskId(taskOptions[0]?.task_id ?? '');
      setCompareRightTaskId('');
      setReplayDiff(null);
      return;
    }

    setCompareLeftTaskId((current) => {
      if (current && taskOptions.some((task) => task.task_id === current)) {
        return current;
      }
      return taskOptions[0]?.task_id ?? '';
    });

    setCompareRightTaskId((current) => {
      if (
        current &&
        taskOptions.some((task) => task.task_id === current) &&
        current !== (taskOptions[0]?.task_id ?? '')
      ) {
        return current;
      }
      return taskOptions[1]?.task_id ?? '';
    });
  }, [taskOptions]);

  useEffect(() => {
    if (!replayDiffQuery) {
      setReplayDiff(null);
      return;
    }

    const fetchReplayDiff = async () => {
      const diffData = (await request(
        `/agents/${id}/replay/diff?${replayDiffQuery}`
      )) as ReplayDiffResponse;
      setReplayDiff(diffData);
    };

    void fetchReplayDiff();
  }, [id, replayDiffQuery, request]);

  useEffect(() => {
    if (!isPlaying || replayEvents.length === 0) {
      return;
    }

    if (currentReplayIndex >= replayEvents.length - 1) {
      setIsPlaying(false);
      return;
    }

    const timeout = window.setTimeout(
      () => {
        setCurrentReplayIndex((index) =>
          Math.min(index + 1, replayEvents.length - 1)
        );
      },
      Math.max(350, 1400 / playbackSpeed)
    );

    return () => window.clearTimeout(timeout);
  }, [currentReplayIndex, isPlaying, playbackSpeed, replayEvents]);

  useEffect(() => {
    if (replayEvents.length === 0) {
      return;
    }

    if (!replayEventParam) {
      setCurrentReplayIndex(0);
      return;
    }

    const focusedIndex = replayEvents.findIndex(
      (event) => event.id === replayEventParam
    );
    setCurrentReplayIndex(focusedIndex >= 0 ? focusedIndex : 0);
    setIsPlaying(false);
  }, [replayEventParam, replayEvents]);

  if (!agent) return <div className="p-8">Loading...</div>;

  const hasReplay = replayEvents.length > 0;
  const hasReplayFilters = selectedTaskId !== 'all' || selectedTypes.length > 0;
  const clampedReplayIndex = hasReplay
    ? Math.min(currentReplayIndex, replayEvents.length - 1)
    : 0;
  const currentReplayEvent = hasReplay
    ? replayEvents[clampedReplayIndex]
    : null;
  const revealedEvents = hasReplay
    ? replayEvents.slice(0, clampedReplayIndex + 1).reverse()
    : [];

  const handleExportReport = async () => {
    setIsExporting(true);
    setExportStatus(null);

    try {
      const token = getAuthToken();
      const companyId = getSelectedCompanyId();
      const response = await fetch(
        `/api/agents/${id}/replay/report?${replayQuery}`,
        {
          headers: {
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            ...(companyId ? { 'x-company-id': companyId } : {}),
          },
        }
      );

      if (!response.ok) {
        throw new Error('Replay report export failed.');
      }

      const blob = await response.blob();
      const objectUrl = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = objectUrl;
      link.download = `agent-replay-${id}.html`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(objectUrl);
      setExportStatus('Replay report downloaded.');
    } catch (err) {
      setExportStatus(
        err instanceof Error ? err.message : 'Replay report export failed.'
      );
    } finally {
      setIsExporting(false);
    }
  };

  const handleForkReplay = async () => {
    if (!currentReplayEvent?.id || !currentReplayEvent.task_id) {
      return;
    }

    setIsForking(true);
    setForkStatus(null);
    setForkResult(null);

    try {
      const result = (await request(`/agents/${id}/replay/fork`, {
        method: 'POST',
        body: JSON.stringify({
          replay_event_id: currentReplayEvent.id,
          task_id: selectedTaskId !== 'all' ? selectedTaskId : undefined,
          types: selectedTypes.length > 0 ? selectedTypes : undefined,
          prompt_override: forkPrompt.trim() || undefined,
        }),
      })) as ReplayForkResponse;

      setForkResult(result);
      setForkStatus(`Fork created as ${result.task_title}.`);
    } catch (err) {
      setForkStatus(err instanceof Error ? err.message : 'Replay fork failed.');
    } finally {
      setIsForking(false);
    }
  };

  const handleExplainFailure = async () => {
    setIsExplainingFailure(true);
    setFailureExplanationStatus(null);
    setFailureExplanation(null);

    try {
      const result = (await request(`/agents/${id}/failure-explanation`, {
        method: 'POST',
        body: JSON.stringify({
          task_id: selectedTaskId !== 'all' ? selectedTaskId : undefined,
          event_id: isReplayFailureEvent(currentReplayEvent)
            ? currentReplayEvent?.id
            : undefined,
          types: selectedTypes.length > 0 ? selectedTypes : undefined,
        }),
      })) as FailureExplanationResponse;

      setFailureExplanation(result);
      setFailureExplanationStatus('Failure explanation ready.');
    } catch (err) {
      setFailureExplanationStatus(
        err instanceof Error ? err.message : 'Failure explanation failed.'
      );
    } finally {
      setIsExplainingFailure(false);
    }
  };

  const handleTogglePlayback = () => {
    if (clampedReplayIndex >= replayEvents.length - 1) {
      setCurrentReplayIndex(0);
    }
    setIsPlaying((value) => !value);
  };

  const handleScrub = (index: number) => {
    setIsPlaying(false);
    setCurrentReplayIndex(index);
  };

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <AgentDetailHeader agent={agent} />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="md:col-span-2 space-y-6">
          <AgentReplayPanel
            selectedTaskId={selectedTaskId}
            onTaskChange={setSelectedTaskId}
            taskOptions={taskOptions}
            hasReplayFilters={hasReplayFilters}
            availableTypes={availableTypes}
            selectedTypes={selectedTypes}
            onToggleType={(type) =>
              setSelectedTypes((current) =>
                current.includes(type)
                  ? current.filter((value) => value !== type)
                  : [...current, type]
              )
            }
            onClearFilters={() => {
              setSelectedTaskId('all');
              setSelectedTypes([]);
            }}
            onExportReport={handleExportReport}
            isExporting={isExporting}
            exportStatus={exportStatus}
            canCompareTasks={canCompareTasks}
            compareLeftTaskId={compareLeftTaskId}
            compareRightTaskId={compareRightTaskId}
            onCompareLeftTaskChange={setCompareLeftTaskId}
            onCompareRightTaskChange={setCompareRightTaskId}
            replayDiff={replayDiff}
            hasReplay={hasReplay}
            currentReplayEvent={currentReplayEvent}
            clampedReplayIndex={clampedReplayIndex}
            replayEventsLength={replayEvents.length}
            replayEventParam={replayEventParam}
            isPlaying={isPlaying}
            playbackSpeed={playbackSpeed}
            onTogglePlayback={handleTogglePlayback}
            onPlaybackSpeedChange={setPlaybackSpeed}
            onScrub={handleScrub}
            revealedEvents={revealedEvents}
            forkPrompt={forkPrompt}
            onForkPromptChange={setForkPrompt}
            onForkReplay={handleForkReplay}
            isForking={isForking}
            forkStatus={forkStatus}
            forkResult={forkResult}
            onExplainFailure={handleExplainFailure}
            isExplainingFailure={isExplainingFailure}
            failureExplanationStatus={failureExplanationStatus}
            failureExplanation={failureExplanation}
          />
        </div>

        <AgentSidebar agent={agent} budget={budget} lastTrace={lastTrace} />
      </div>
    </div>
  );
}
