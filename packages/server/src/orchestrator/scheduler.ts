import { db } from '../db/client.js';
import { env } from '../env.js';
import { logger } from '../utils/logger.js';
import { processAgentHeartbeat } from './heartbeat.js';

let interval: NodeJS.Timeout | null = null;

export function startOrchestrator() {
  if (interval) return;

  logger.info({ intervalMs: env.HEARTBEAT_INTERVAL_MS }, 'Starting orchestrator scheduler');

  interval = setInterval(async () => {
    try {
      // Find all idle agents that are active
      const agentsRes = await db.query(
        "SELECT id FROM agents WHERE status = 'idle'"
      );

      for (const agent of agentsRes.rows) {
        // Run heartbeats concurrently but catch individual errors
        processAgentHeartbeat(agent.id).catch(err => {
          logger.error({ err, agentId: agent.id }, 'Heartbeat loop error');
        });
      }
    } catch (err) {
      logger.error({ err }, 'Orchestrator scheduler error');
    }
  }, env.HEARTBEAT_INTERVAL_MS);
}

export function stopOrchestrator() {
  if (interval) {
    clearInterval(interval);
    interval = null;
    logger.info('Orchestrator scheduler stopped');
  }
}
