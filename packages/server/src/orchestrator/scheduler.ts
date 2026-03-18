import { db } from '../db/client.js';
import { env } from '../env.js';
import { logger } from '../utils/logger.js';
import { processAgentHeartbeat } from './heartbeat.js';

let interval: NodeJS.Timeout | null = null;
const inFlightHeartbeats = new Set<Promise<void>>();

function trackHeartbeat(promise: Promise<void>) {
  inFlightHeartbeats.add(promise);
  promise.finally(() => {
    inFlightHeartbeats.delete(promise);
  }).catch(() => {
    // Errors are already logged by the tracked heartbeat.
  });
}

export function startOrchestrator() {
  if (interval) return;

  logger.info(
    { intervalMs: env.HEARTBEAT_INTERVAL_MS, maxConcurrentHeartbeats: env.MAX_CONCURRENT_HEARTBEATS },
    'Starting orchestrator scheduler'
  );

  interval = setInterval(async () => {
    try {
      const remainingCapacity = Math.max(env.MAX_CONCURRENT_HEARTBEATS - inFlightHeartbeats.size, 0);
      if (remainingCapacity === 0) {
        logger.debug({ activeHeartbeats: inFlightHeartbeats.size }, 'Skipping scheduler tick because capacity is full');
        return;
      }

      // Find idle agents in a bounded batch to avoid thundering herd behavior.
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
        const heartbeatPromise = processAgentHeartbeat(agent.id).catch(err => {
          logger.error({ err, agentId: agent.id }, 'Heartbeat loop error');
        });
        trackHeartbeat(heartbeatPromise);
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
  if (interval) {
    clearInterval(interval);
    interval = null;
    logger.info({ activeHeartbeats: inFlightHeartbeats.size }, 'Orchestrator scheduler stopped');
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

  if (inFlightHeartbeats.size > 0) {
    logger.warn({ activeHeartbeats: inFlightHeartbeats.size }, 'Timed out waiting for active heartbeats');
  }
}
