import { db } from '../db/client.js';
import { env } from '../env.js';
import { logger } from '../utils/logger.js';
import { processAgentHeartbeat, type HeartbeatOutcome } from './heartbeat.js';
import {
  acknowledgeSchedulerWakeup,
  closeSchedulerQueue,
  enqueueCompanyWakeup,
  initializeSchedulerQueue,
  isSchedulerQueueEnabled,
  readSchedulerWakeups,
} from './schedulerQueue.js';

let interval: NodeJS.Timeout | null = null;
let queueLoopPromise: Promise<void> | null = null;
let schedulerRunning = false;
const inFlightHeartbeats = new Set<Promise<HeartbeatOutcome>>();
const inFlightHeartbeatWaiters = new Set<() => void>();

function notifyHeartbeatWaiters() {
  for (const resolve of inFlightHeartbeatWaiters) {
    resolve();
  }
  inFlightHeartbeatWaiters.clear();
}

function trackHeartbeat(companyId: string | null, promise: Promise<HeartbeatOutcome>) {
  inFlightHeartbeats.add(promise);
  promise
    .then(async (result) => {
      if (!result?.companyId) {
        return;
      }

      if (result.status === 'worked' || result.status === 'blocked') {
        await enqueueCompanyWakeup(result.companyId, 'heartbeat_follow_up', {
          taskId: result.taskId ?? null,
        });
      }
    })
    .finally(() => {
      inFlightHeartbeats.delete(promise);
      notifyHeartbeatWaiters();
    })
    .catch((err) => {
      logger.error({ err, companyId }, 'Tracked heartbeat follow-up failed');
    });
}

function runHeartbeat(agentId: string, companyId: string | null) {
  const heartbeatPromise = processAgentHeartbeat(agentId).catch((err) => {
    logger.error({ err, agentId, companyId }, 'Heartbeat loop error');
    return {
      status: 'error',
      companyId,
      taskId: null,
    } satisfies HeartbeatOutcome;
  });
  trackHeartbeat(companyId, heartbeatPromise);
}

async function waitForCapacity() {
  if (inFlightHeartbeats.size < env.MAX_CONCURRENT_HEARTBEATS) {
    return;
  }

  await new Promise<void>((resolve) => {
    inFlightHeartbeatWaiters.add(resolve);
    setTimeout(() => {
      inFlightHeartbeatWaiters.delete(resolve);
      resolve();
    }, Math.min(env.SCHEDULER_STREAM_BLOCK_MS, 1000)).unref();
  });
}

async function dispatchQueuedCompany(companyId: string) {
  const remainingCapacity = Math.max(env.MAX_CONCURRENT_HEARTBEATS - inFlightHeartbeats.size, 0);
  if (remainingCapacity === 0) {
    await enqueueCompanyWakeup(companyId, 'capacity_deferred');
    return;
  }

  const agentsRes = await db.query(
    `SELECT a.id
     FROM agents a
     WHERE a.company_id = $1
       AND a.status = 'idle'
       AND a.status != 'terminated'
       AND EXISTS (
         SELECT 1
         FROM tasks t
         WHERE t.company_id = a.company_id
           AND (
             (t.status IN ('backlog', 'assigned') AND (t.assigned_to = a.id OR t.assigned_to IS NULL))
             OR (t.status = 'in_progress' AND t.assigned_to = a.id AND t.locked_by IS NULL)
           )
       )
     ORDER BY a.updated_at ASC NULLS FIRST, a.created_at ASC
     LIMIT $2`,
    [companyId, remainingCapacity]
  );

  for (const agent of agentsRes.rows) {
    runHeartbeat(agent.id, companyId);
  }
}

async function bootstrapQueueDrivenScheduler() {
  const companiesRes = await db.query(
    `SELECT DISTINCT company_id
     FROM tasks
     WHERE status IN ('backlog', 'assigned')
        OR (status = 'in_progress' AND locked_by IS NULL)`
  );

  for (const row of companiesRes.rows) {
    if (row.company_id) {
      await enqueueCompanyWakeup(String(row.company_id), 'startup_bootstrap');
    }
  }
}

async function runQueueDrivenScheduler() {
  await initializeSchedulerQueue();
  await bootstrapQueueDrivenScheduler();

  while (schedulerRunning) {
    try {
      await waitForCapacity();
      if (!schedulerRunning) {
        break;
      }

      const remainingCapacity = Math.max(env.MAX_CONCURRENT_HEARTBEATS - inFlightHeartbeats.size, 0);
      if (remainingCapacity === 0) {
        continue;
      }

      const wakeups = await readSchedulerWakeups(remainingCapacity);
      if (wakeups.length === 0) {
        continue;
      }

      for (const wakeup of wakeups) {
        if (!schedulerRunning) {
          break;
        }

        await dispatchQueuedCompany(wakeup.companyId);
        await acknowledgeSchedulerWakeup(wakeup.id);
      }
    } catch (err) {
      logger.error({ err }, 'Queue-driven orchestrator scheduler error');
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 500).unref();
      });
    }
  }
}

export function startOrchestrator() {
  if (schedulerRunning) return;
  schedulerRunning = true;

  logger.info(
    { intervalMs: env.HEARTBEAT_INTERVAL_MS, maxConcurrentHeartbeats: env.MAX_CONCURRENT_HEARTBEATS },
    'Starting orchestrator scheduler'
  );

  if (isSchedulerQueueEnabled()) {
    queueLoopPromise = runQueueDrivenScheduler().catch((err) => {
      logger.error({ err }, 'Queue-driven scheduler crashed');
    });
    return;
  }

  interval = setInterval(async () => {
    try {
      const remainingCapacity = Math.max(env.MAX_CONCURRENT_HEARTBEATS - inFlightHeartbeats.size, 0);
      if (remainingCapacity === 0) {
        logger.debug({ activeHeartbeats: inFlightHeartbeats.size }, 'Skipping scheduler tick because capacity is full');
        return;
      }

      const agentsRes = await db.query(
        `SELECT id
         FROM agents
         WHERE status = 'idle'
           AND status != 'terminated'
         ORDER BY updated_at ASC NULLS FIRST, created_at ASC
         LIMIT $1`,
        [remainingCapacity]
      );

      for (const agent of agentsRes.rows) {
        runHeartbeat(agent.id, null);
      }
    } catch (err) {
      logger.error({ err }, 'Orchestrator scheduler error');
    }
  }, env.HEARTBEAT_INTERVAL_MS);
}

export function getActiveHeartbeatCount() {
  return inFlightHeartbeats.size;
}

export async function stopOrchestrator(timeoutMs: number = 9_000) {
  schedulerRunning = false;

  if (interval) {
    clearInterval(interval);
    interval = null;
    logger.info({ activeHeartbeats: inFlightHeartbeats.size }, 'Orchestrator scheduler stopped');
  }

  if (queueLoopPromise) {
    await queueLoopPromise;
    queueLoopPromise = null;
    await closeSchedulerQueue();
    logger.info({ activeHeartbeats: inFlightHeartbeats.size }, 'Queue-driven orchestrator stopped');
  }

  if (inFlightHeartbeats.size === 0) {
    return;
  }

  const pendingHeartbeats = Array.from(inFlightHeartbeats);
  logger.info({ activeHeartbeats: pendingHeartbeats.length }, 'Waiting for active heartbeats to finish');

  await Promise.race([
    Promise.allSettled(pendingHeartbeats),
    new Promise<void>((resolve) => {
      setTimeout(resolve, timeoutMs).unref();
    }),
  ]);

  await Promise.resolve();
  if (inFlightHeartbeats.size > 0) {
    logger.warn({ activeHeartbeats: inFlightHeartbeats.size }, 'Timed out waiting for active heartbeats');
  }
}
