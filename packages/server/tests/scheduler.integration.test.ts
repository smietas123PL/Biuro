import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const dbMock = vi.hoisted(() => ({
  query: vi.fn(),
}));

const envMock = vi.hoisted(() => ({
  HEARTBEAT_INTERVAL_MS: 1000,
  MAX_CONCURRENT_HEARTBEATS: 2,
}));

const loggerMock = vi.hoisted(() => ({
  info: vi.fn(),
  debug: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

const processAgentHeartbeatMock = vi.hoisted(() => vi.fn());

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

import { getActiveHeartbeatCount, startOrchestrator, stopOrchestrator } from '../src/orchestrator/scheduler.js';

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
    envMock.HEARTBEAT_INTERVAL_MS = 1000;
    envMock.MAX_CONCURRENT_HEARTBEATS = 2;
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
    expect(String(dbMock.query.mock.calls[0]?.[0])).toContain("WHERE status = 'idle'");
    expect(String(dbMock.query.mock.calls[0]?.[0])).toContain("AND status != 'terminated'");
    expect(String(dbMock.query.mock.calls[0]?.[0])).toContain('LIMIT $1');
    expect(dbMock.query.mock.calls[0]?.[1]).toEqual([2]);
    expect(processAgentHeartbeatMock).toHaveBeenCalledTimes(2);
    expect(processAgentHeartbeatMock).toHaveBeenNthCalledWith(1, 'agent-1');
    expect(processAgentHeartbeatMock).toHaveBeenNthCalledWith(2, 'agent-2');
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
});
