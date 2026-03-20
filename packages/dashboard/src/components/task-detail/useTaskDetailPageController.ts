import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { useCompany } from '../../context/CompanyContext';
import { useApi, useWebSocket } from '../../hooks/useApi';
import {
  type CollaborationSnapshot,
  type CollaborationTask,
  type CollaborationTimelineItem,
  type DelegationHealth,
  type DelegationHealthFilterId,
  type DelegationPreview,
  type TaskDetailViewMode,
  type TimelineFilterId,
  buildTimelineWindows,
  formatLiveLabel,
  getDelegationHealth,
  matchesDelegationHealthFilter,
  parseDelegationHealthFilter,
  parseExpandedToolSequenceIds,
  parseTaskDetailViewMode,
  parseTaskMapFocusTaskId,
  parseTimelineFilter,
  resolveDelegationPreview,
} from './taskDetailShared';

type TaskDetailLiveEvent = {
  event: string;
  data?: { root_task_id?: string; task_id?: string; kind?: string };
};

type TimelineFilterOption = { id: TimelineFilterId; count: number };
type DelegationHealthEntry = {
  health: DelegationHealth;
  preview: DelegationPreview;
};

function buildTimelineFilterOptions(
  timeline: CollaborationTimelineItem[]
): TimelineFilterOption[] {
  return [
    { id: 'all', count: timeline.length },
    {
      id: 'thought',
      count: timeline.filter((item) => item.kind === 'thought').length,
    },
    {
      id: 'delegation',
      count: timeline.filter((item) => item.kind === 'delegation').length,
    },
    { id: 'tool', count: timeline.filter((item) => item.kind === 'tool').length },
    {
      id: 'status',
      count: timeline.filter((item) => item.kind === 'status').length,
    },
    {
      id: 'supervisor',
      count: timeline.filter((item) => item.kind === 'supervisor').length,
    },
    {
      id: 'message',
      count: timeline.filter((item) => item.kind === 'message').length,
    },
  ];
}

function buildDelegationHealthByTaskId(
  tasks: CollaborationTask[],
  timeline: CollaborationTimelineItem[]
) {
  const entries = timeline
    .filter((item) => item.kind === 'delegation')
    .map((item) => {
      const preview = resolveDelegationPreview(item, tasks, timeline);
      if (!preview?.childTask) {
        return null;
      }

      return [
        preview.childTask.id,
        {
          health: getDelegationHealth(preview),
          preview,
        },
      ] as const;
    })
    .filter(
      (
        entry
      ): entry is readonly [string, DelegationHealthEntry] => Boolean(entry)
    );

  return new Map(entries);
}

export function useTaskDetailPageController() {
  const { id } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const { request, error, lastTrace } = useApi();
  const { selectedCompanyId } = useCompany();
  const lastEvent = useWebSocket(selectedCompanyId ?? undefined) as TaskDetailLiveEvent | null;
  const [snapshot, setSnapshot] = useState<CollaborationSnapshot | null>(null);
  const [newMsg, setNewMsg] = useState('');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [liveLabel, setLiveLabel] = useState<string | null>(null);

  const activeViewMode = parseTaskDetailViewMode(searchParams.get('view'));
  const activeTimelineFilter = parseTimelineFilter(
    searchParams.get('timelineFilter')
  );
  const expandedToolSequenceIds = useMemo(
    () => parseExpandedToolSequenceIds(searchParams.get('expandedTools')),
    [searchParams]
  );
  const activeDelegationHealthFilter = parseDelegationHealthFilter(
    searchParams.get('taskMapFilter')
  );

  const fetchSnapshot = useCallback(
    async (suppressError = false) => {
      if (!id) {
        return;
      }

      setIsRefreshing(true);
      try {
        const data = (await request(
          `/tasks/${id}/collaboration`,
          undefined,
          suppressError ? { suppressError: true } : undefined
        )) as CollaborationSnapshot;
        setSnapshot(data);
      } finally {
        setIsRefreshing(false);
      }
    },
    [id, request]
  );

  useEffect(() => {
    void fetchSnapshot();
  }, [fetchSnapshot]);

  useEffect(() => {
    if (!snapshot || !lastEvent || lastEvent.event !== 'task.collaboration') {
      return;
    }

    const rootTaskId = lastEvent.data?.root_task_id;
    const updatedTaskId = lastEvent.data?.task_id;
    if (
      rootTaskId !== snapshot.root_task.id &&
      updatedTaskId !== snapshot.current_task.id &&
      !snapshot.tasks.some((task) => task.id === updatedTaskId)
    ) {
      return;
    }

    setLiveLabel(formatLiveLabel(lastEvent.data?.kind));
    void fetchSnapshot(true);
  }, [fetchSnapshot, lastEvent, snapshot]);

  const tasks = snapshot?.tasks ?? [];
  const participants = snapshot?.participants ?? [];
  const timeline = snapshot?.timeline ?? [];
  const currentTaskEntry = useMemo(
    () => tasks.find((task) => task.id === snapshot?.current_task.id) ?? null,
    [snapshot?.current_task.id, tasks]
  );
  const timelineFilterOptions = useMemo(
    () => buildTimelineFilterOptions(timeline),
    [timeline]
  );
  const filteredTimeline = useMemo(
    () =>
      timeline.filter(
        (item) =>
          activeTimelineFilter === 'all' || item.kind === activeTimelineFilter
      ),
    [activeTimelineFilter, timeline]
  );
  const timelineWindows = useMemo(
    () => buildTimelineWindows(filteredTimeline),
    [filteredTimeline]
  );
  const recentTimelineItems = useMemo(
    () =>
      [...timeline]
        .sort(
          (a, b) =>
            new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        )
        .slice(0, 5),
    [timeline]
  );
  const delegationHealthByTaskId = useMemo(
    () => buildDelegationHealthByTaskId(tasks, timeline),
    [tasks, timeline]
  );
  const delegationHealthSummary = useMemo(() => {
    const values = Array.from(delegationHealthByTaskId.values());
    return {
      fastHandoff: values.filter(
        (entry) => entry.health.label === 'Fast handoff'
      ).length,
      slowStart: values.filter((entry) => entry.health.label === 'Slow start')
        .length,
      stuck: values.filter((entry) => entry.health.label === 'Stuck').length,
    };
  }, [delegationHealthByTaskId]);
  const riskyTaskIds = useMemo(
    () =>
      new Set(
        Array.from(delegationHealthByTaskId.entries())
          .filter(([, value]) => value.health.label !== 'Fast handoff')
          .map(([taskId]) => taskId)
      ),
    [delegationHealthByTaskId]
  );
  const taskById = useMemo(
    () => new Map(tasks.map((task) => [task.id, task])),
    [tasks]
  );
  const visibleTaskIdsWhenFiltered = useMemo(() => {
    if (activeDelegationHealthFilter === 'all') {
      return null;
    }

    const matchingTaskIds = Array.from(delegationHealthByTaskId.entries())
      .filter(([, value]) =>
        matchesDelegationHealthFilter(
          value.health,
          activeDelegationHealthFilter
        )
      )
      .map(([taskId]) => taskId);
    const visibleIds = new Set<string>();

    for (const taskId of matchingTaskIds) {
      let currentTask = taskById.get(taskId) ?? null;
      while (currentTask) {
        visibleIds.add(currentTask.id);
        currentTask = currentTask.parent_id
          ? (taskById.get(currentTask.parent_id) ?? null)
          : null;
      }
    }

    return visibleIds;
  }, [activeDelegationHealthFilter, delegationHealthByTaskId, taskById]);
  const visibleTasks = useMemo(() => {
    if (activeDelegationHealthFilter === 'all' || !visibleTaskIdsWhenFiltered) {
      return tasks;
    }

    return tasks.filter((task) => visibleTaskIdsWhenFiltered.has(task.id));
  }, [activeDelegationHealthFilter, tasks, visibleTaskIdsWhenFiltered]);
  const focusedTaskMapTaskId = useMemo(
    () => parseTaskMapFocusTaskId(searchParams.get('taskFocus'), tasks),
    [searchParams, tasks]
  );
  const focusedTaskMapTask = useMemo(
    () => tasks.find((task) => task.id === focusedTaskMapTaskId) ?? null,
    [focusedTaskMapTaskId, tasks]
  );
  const isFocusedTaskVisible = useMemo(
    () =>
      focusedTaskMapTaskId
        ? visibleTasks.some((task) => task.id === focusedTaskMapTaskId)
        : false,
    [focusedTaskMapTaskId, visibleTasks]
  );

  const replaceSearchParams = useCallback(
    (mutate: (params: URLSearchParams) => void) => {
      const nextParams = new URLSearchParams(searchParams);
      mutate(nextParams);
      setSearchParams(nextParams, { replace: true });
    },
    [searchParams, setSearchParams]
  );

  const toggleToolSequence = useCallback(
    (sequenceId: string) => {
      replaceSearchParams((nextParams) => {
        const nextExpandedIds = new Set(expandedToolSequenceIds);
        if (nextExpandedIds.has(sequenceId)) {
          nextExpandedIds.delete(sequenceId);
        } else {
          nextExpandedIds.add(sequenceId);
        }

        if (nextExpandedIds.size === 0) {
          nextParams.delete('expandedTools');
          return;
        }

        nextParams.set(
          'expandedTools',
          Array.from(nextExpandedIds).sort().join(',')
        );
      });
    },
    [expandedToolSequenceIds, replaceSearchParams]
  );

  const setViewMode = useCallback(
    (nextMode: TaskDetailViewMode) => {
      replaceSearchParams((nextParams) => {
        if (nextMode === 'task-force') {
          nextParams.delete('view');
          return;
        }

        nextParams.set('view', nextMode);
      });
    },
    [replaceSearchParams]
  );

  const setTaskMapFocus = useCallback(
    (nextTaskId: string | null) => {
      replaceSearchParams((nextParams) => {
        if (!nextTaskId) {
          nextParams.delete('taskFocus');
          return;
        }

        nextParams.set('taskFocus', nextTaskId);
      });
    },
    [replaceSearchParams]
  );

  const setDelegationHealthFilter = useCallback(
    (nextFilter: DelegationHealthFilterId) => {
      replaceSearchParams((nextParams) => {
        if (nextFilter === 'all') {
          nextParams.delete('taskMapFilter');
          return;
        }

        nextParams.set('taskMapFilter', nextFilter);
      });
    },
    [replaceSearchParams]
  );

  const setTimelineFilter = useCallback(
    (nextFilter: TimelineFilterId) => {
      replaceSearchParams((nextParams) => {
        if (nextFilter === 'all') {
          nextParams.delete('timelineFilter');
          return;
        }

        nextParams.set('timelineFilter', nextFilter);
      });
    },
    [replaceSearchParams]
  );

  const handleSend = useCallback(async () => {
    if (!id || !newMsg.trim()) {
      return;
    }

    await request(`/tasks/${id}/messages`, {
      method: 'POST',
      body: JSON.stringify({
        content: newMsg,
      }),
    });
    setNewMsg('');
    await fetchSnapshot(true);
  }, [fetchSnapshot, id, newMsg, request]);

  return {
    error,
    lastTrace,
    snapshot,
    newMsg,
    setNewMsg,
    isRefreshing,
    liveLabel,
    activeViewMode,
    activeTimelineFilter,
    expandedToolSequenceIds,
    activeDelegationHealthFilter,
    currentTaskEntry,
    timeline,
    participants,
    tasks,
    timelineFilterOptions,
    filteredTimeline,
    timelineWindows,
    recentTimelineItems,
    delegationHealthByTaskId,
    delegationHealthSummary,
    riskyTaskIds,
    visibleTasks,
    focusedTaskMapTaskId,
    focusedTaskMapTask,
    isFocusedTaskVisible,
    toggleToolSequence,
    setViewMode,
    setTaskMapFocus,
    setDelegationHealthFilter,
    setTimelineFilter,
    handleSend,
  };
}
