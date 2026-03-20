import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const dbMock = vi.hoisted(() => ({
  query: vi.fn(),
}));

const envMock = vi.hoisted(() => ({
  HEARTBEAT_INTERVAL_MS: 1000,
  MAX_CONCURRENT_HEARTBEATS: 2,
  DAILY_DIGEST_SWEEP_INTERVAL_MS: 60000,
  SCHEDULER_ERROR_BACKOFF_MIN_MS: 500,
  SCHEDULER_ERROR_BACKOFF_MAX_MS: 10000,
}));

const loggerMock = vi.hoisted(() => ({
  info: vi.fn(),
  debug: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

const processAgentHeartbeatMock = vi.hoisted(() => vi.fn());
const initializeSchedulerQueueMock = vi.hoisted(() => vi.fn());
const readSchedulerWakeupsMock = vi.hoisted(() => vi.fn());
const acknowledgeSchedulerWakeupMock = vi.hoisted(() => vi.fn());
const enqueueCompanyWakeupMock = vi.hoisted(() => vi.fn());
const closeSchedulerQueueMock = vi.hoisted(() => vi.fn());
const isSchedulerQueueEnabledMock = vi.hoisted(() => vi.fn(() => false));
const dispatchDueDailyDigestsMock = vi.hoisted(() => vi.fn());

vi.mock('../src/db/client.js', () => ({
  db: dbMock,
}));

vi.mock('../src/env.js', () => ({
  env: envMock,
}));

vi.mock('../src/utils/logger.js', () => ({
  logger: loggerMock,
}));

vi.mock('../src/orchestrator/heartbeat.js', () => ({
  processAgentHeartbeat: processAgentHeartbeatMock,
}));

vi.mock('../src/orchestrator/schedulerQueue.js', () => ({
  initializeSchedulerQueue: initializeSchedulerQueueMock,
  readSchedulerWakeups: readSchedulerWakeupsMock,
  acknowledgeSchedulerWakeup: acknowledgeSchedulerWakeupMock,
  enqueueCompanyWakeup: enqueueCompanyWakeupMock,
  closeSchedulerQueue: closeSchedulerQueueMock,
  isSchedulerQueueEnabled: isSchedulerQueueEnabledMock,
}));

vi.mock('../src/services/dailyDigest.js', () => ({
  dispatchDueDailyDigests: dispatchDueDailyDigestsMock,
}));

import {
  getActiveHeartbeatCount,
  startOrchestrator,
  stopOrchestrator,
} from '../src/orchestrator/scheduler.js';

function createDeferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((resolver) => {
    resolve = resolver;
  });

  return { promise, resolve };
}

describe('scheduler orchestration', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    dbMock.query.mockReset();
    processAgentHeartbeatMock.mockReset();
    loggerMock.info.mockReset();
    loggerMock.debug.mockReset();
    loggerMock.warn.mockReset();
    loggerMock.error.mockReset();
    initializeSchedulerQueueMock.mockReset();
    readSchedulerWakeupsMock.mockReset();
    acknowledgeSchedulerWakeupMock.mockReset();
    enqueueCompanyWakeupMock.mockReset();
    closeSchedulerQueueMock.mockReset();
    isSchedulerQueueEnabledMock.mockReset();
    dispatchDueDailyDigestsMock.mockReset();
    isSchedulerQueueEnabledMock.mockReturnValue(false);
    envMock.HEARTBEAT_INTERVAL_MS = 1000;
    envMock.MAX_CONCURRENT_HEARTBEATS = 2;
    envMock.DAILY_DIGEST_SWEEP_INTERVAL_MS = 60000;
    envMock.SCHEDULER_ERROR_BACKOFF_MIN_MS = 500;
    envMock.SCHEDULER_ERROR_BACKOFF_MAX_MS = 10000;
    dispatchDueDailyDigestsMock.mockResolvedValue([]);
  });

  afterEach(async () => {
    await stopOrchestrator();
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('queries a bounded batch of idle non-terminated agents', async () => {
    dbMock.query.mockResolvedValue({
      rows: [{ id: 'agent-1' }, { id: 'agent-2' }],
    });
    processAgentHeartbeatMock.mockResolvedValue(undefined);

    startOrchestrator();
    await vi.advanceTimersByTimeAsync(1000);

    expect(dbMock.query).toHaveBeenCalledTimes(1);
    expect(String(dbMock.query.mock.calls[0]?.[0])).toContain(
      "WHERE status = 'idle'"
    );
    expect(String(dbMock.query.mock.calls[0]?.[0])).toContain(
      "AND status != 'terminated'"
    );
    expect(String(dbMock.query.mock.calls[0]?.[0])).toContain('LIMIT $1');
    expect(dbMock.query.mock.calls[0]?.[1]).toEqual([2]);
    expect(processAgentHeartbeatMock).toHaveBeenCalledTimes(2);
    expect(processAgentHeartbeatMock).toHaveBeenNthCalledWith(1, 'agent-1');
    expect(processAgentHeartbeatMock).toHaveBeenNthCalledWith(2, 'agent-2');
    expect(dispatchDueDailyDigestsMock).toHaveBeenCalledTimes(1);
  });

  it('reduces the next scheduler batch when heartbeats are still in flight', async () => {
    const deferred = createDeferred();

    dbMock.query
      .mockResolvedValueOnce({
        rows: [{ id: 'agent-1' }, { id: 'agent-2' }],
      })
      .mockResolvedValueOnce({
        rows: [{ id: 'agent-3' }],
      });

    processAgentHeartbeatMock.mockImplementation((agentId: string) => {
      if (agentId === 'agent-1') {
        return deferred.promise;
      }
      return Promise.resolve();
    });

    startOrchestrator();
    await vi.advanceTimersByTimeAsync(1000);

    expect(getActiveHeartbeatCount()).toBe(1);

    await vi.advanceTimersByTimeAsync(1000);

    expect(dbMock.query).toHaveBeenCalledTimes(2);
    expect(dbMock.query.mock.calls[0]?.[1]).toEqual([2]);
    expect(dbMock.query.mock.calls[1]?.[1]).toEqual([1]);

    deferred.resolve();
    await Promise.resolve();
  });

  it('waits for active heartbeats to finish during orchestrator shutdown', async () => {
    const deferred = createDeferred();

    dbMock.query.mockResolvedValue({
      rows: [{ id: 'agent-1' }],
    });
    processAgentHeartbeatMock.mockReturnValue(deferred.promise);

    startOrchestrator();
    await vi.advanceTimersByTimeAsync(1000);

    expect(getActiveHeartbeatCount()).toBe(1);

    const stopPromise = stopOrchestrator(5000);
    await Promise.resolve();

    let resolved = false;
    void stopPromise.then(() => {
      resolved = true;
    });

    await Promise.resolve();
    expect(resolved).toBe(false);

    deferred.resolve();
    await stopPromise;

    expect(getActiveHeartbeatCount()).toBe(0);
    expect(loggerMock.warn).not.toHaveBeenCalled();
  });

  it('backs off exponentially after repeated scheduler errors in interval mode', async () => {
    envMock.SCHEDULER_ERROR_BACKOFF_MIN_MS = 2000;
    envMock.SCHEDULER_ERROR_BACKOFF_MAX_MS = 8000;

    dbMock.query
      .mockRejectedValueOnce(new Error('db down'))
      .mockRejectedValueOnce(new Error('db still down'))
      .mockResolvedValueOnce({
        rows: [{ id: 'agent-1' }],
      });
    processAgentHeartbeatMock.mockResolvedValue(undefined);

    startOrchestrator();

    await vi.advanceTimersByTimeAsync(1000);
    expect(dbMock.query).toHaveBeenCalledTimes(1);
    expect(loggerMock.warn).toHaveBeenCalledWith(
      expect.objectContaining({ delayMs: 2000, failureCount: 1 }),
      'Orchestrator scheduler backing off after error'
    );

    await vi.advanceTimersByTimeAsync(1000);
    expect(dbMock.query).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1000);
    expect(dbMock.query).toHaveBeenCalledTimes(2);
    expect(loggerMock.warn).toHaveBeenLastCalledWith(
      expect.objectContaining({ delayMs: 4000, failureCount: 2 }),
      'Orchestrator scheduler backing off after error'
    );

    await vi.advanceTimersByTimeAsync(3000);
    expect(dbMock.query).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(1000);
    expect(dbMock.query).toHaveBeenCalledTimes(3);
    expect(processAgentHeartbeatMock).toHaveBeenCalledWith('agent-1');
  });

  it('backs off after queue-driven scheduler errors before retrying reads', async () => {
    vi.useRealTimers();
    isSchedulerQueueEnabledMock.mockReturnValue(true);
    initializeSchedulerQueueMock.mockResolvedValue(undefined);
    envMock.SCHEDULER_ERROR_BACKOFF_MIN_MS = 20;
    envMock.SCHEDULER_ERROR_BACKOFF_MAX_MS = 80;
    dbMock.query.mockResolvedValueOnce({
      rows: [],
    });
    readSchedulerWakeupsMock
      .mockRejectedValueOnce(new Error('redis read failed'))
      .mockImplementation(async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        return [];
      });

    try {
      startOrchestrator();
      await new Promise((resolve) => setTimeout(resolve, 45));

      expect(loggerMock.warn).toHaveBeenCalledWith(
        expect.objectContaining({ delayMs: 20, failureCount: 1 }),
        'Queue-driven orchestrator backing off after error'
      );
      expect(readSchedulerWakeupsMock.mock.calls.length).toBeGreaterThanOrEqual(
        2
      );
    } finally {
      await stopOrchestrator();
    }
  });

  it('warns when shutdown times out before heartbeats finish draining', async () => {
    const deferred = createDeferred();

    dbMock.query.mockResolvedValue({
      rows: [{ id: 'agent-1' }],
    });
    processAgentHeartbeatMock.mockReturnValue(deferred.promise);

    startOrchestrator();
    await vi.advanceTimersByTimeAsync(1000);

    expect(getActiveHeartbeatCount()).toBe(1);

    const stopPromise = stopOrchestrator(100);
    await vi.advanceTimersByTimeAsync(100);
    await stopPromise;

    expect(getActiveHeartbeatCount()).toBe(1);
    expect(loggerMock.warn).toHaveBeenCalledWith(
      { activeHeartbeats: 1 },
      'Timed out waiting for active heartbeats'
    );

    deferred.resolve();
    await Promise.resolve();
  });

  it('dispatches work from the scheduler queue when Redis wakeups are enabled', async () => {
    vi.useRealTimers();
    isSchedulerQueueEnabledMock.mockReturnValue(true);
    initializeSchedulerQueueMock.mockResolvedValue(undefined);
    dbMock.query
      .mockResolvedValueOnce({
        rows: [{ company_id: 'company-1' }],
      })
      .mockResolvedValueOnce({
        rows: [{ id: 'agent-1' }],
      });

    readSchedulerWakeupsMock
      .mockResolvedValueOnce([
        {
          id: 'wake-1',
          companyId: 'company-1',
          reason: 'task_created',
          taskId: 'task-1',
          agentId: null,
          queuedAt: '2026-03-19T10:00:00.000Z',
        },
      ])
      .mockImplementation(async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        return [];
      });

    processAgentHeartbeatMock.mockResolvedValue({
      status: 'worked',
      companyId: 'company-1',
      taskId: 'task-1',
    });

    try {
      startOrchestrator();
      await new Promise((resolve) => setTimeout(resolve, 25));

      expect(initializeSchedulerQueueMock).toHaveBeenCalledTimes(1);
      const bootstrapQuery = dbMock.query.mock.calls.find(([text]) =>
        String(text).includes("status IN ('backlog', 'assigned')")
      );
      const dispatchQuery = dbMock.query.mock.calls.find(([text]) =>
        String(text).includes('FROM agents a')
      );
      expect(String(bootstrapQuery?.[0])).toContain(
        "status IN ('backlog', 'assigned')"
      );
      expect(String(dispatchQuery?.[0])).toContain('FROM agents a');
      expect(dispatchQuery?.[1]).toEqual(['company-1', 2]);
      expect(processAgentHeartbeatMock).toHaveBeenCalledWith('agent-1');
      expect(acknowledgeSchedulerWakeupMock).toHaveBeenCalledWith('wake-1');

      await Promise.resolve();
      expect(enqueueCompanyWakeupMock).toHaveBeenCalledWith(
        'company-1',
        'heartbeat_follow_up',
        {
          taskId: 'task-1',
        }
      );
    } finally {
      await stopOrchestrator();
    }

    expect(closeSchedulerQueueMock).toHaveBeenCalledTimes(1);
  });
});
