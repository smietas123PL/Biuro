import type { RedisClientType } from 'redis';
import { env } from '../env.js';
import { logger } from '../utils/logger.js';
import {
  createRedisConnection,
  isRedisConfigured,
} from '../realtime/redisConfig.js';

export type SchedulerWakeup = {
  id: string;
  companyId: string;
  reason: string;
  taskId: string | null;
  agentId: string | null;
  queuedAt: string | null;
};

const SCHEDULER_STREAM_GROUP = 'biuro-scheduler';
const schedulerConsumerName = `worker-${process.pid}`;

let queueClient: RedisClientType | null = null;
let queueReady = false;

function parseWakeupEntries(raw: unknown): SchedulerWakeup[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  const wakeups: SchedulerWakeup[] = [];

  for (const streamEntry of raw) {
    if (!Array.isArray(streamEntry) || streamEntry.length < 2) {
      continue;
    }

    const entries = streamEntry[1];
    if (!Array.isArray(entries)) {
      continue;
    }

    for (const entry of entries) {
      if (!Array.isArray(entry) || entry.length < 2) {
        continue;
      }

      const id = String(entry[0]);
      const fields = Array.isArray(entry[1]) ? entry[1] : [];
      const mapped = new Map<string, string>();
      for (let index = 0; index < fields.length; index += 2) {
        const key = fields[index];
        const value = fields[index + 1];
        if (key !== undefined && value !== undefined) {
          mapped.set(String(key), String(value));
        }
      }

      const companyId = mapped.get('company_id');
      const reason = mapped.get('reason');
      if (!companyId || !reason) {
        continue;
      }

      wakeups.push({
        id,
        companyId,
        reason,
        taskId: mapped.get('task_id') || null,
        agentId: mapped.get('agent_id') || null,
        queuedAt: mapped.get('queued_at') || null,
      });
    }
  }

  return wakeups;
}

export function isSchedulerQueueEnabled() {
  return isRedisConfigured();
}

export async function initializeSchedulerQueue() {
  if (!isRedisConfigured()) {
    queueReady = false;
    return false;
  }

  if (!queueClient) {
    queueClient = createRedisConnection();
    if (!queueClient) {
      queueReady = false;
      return false;
    }
    queueClient.on('error', (err) => {
      logger.error({ err }, 'Scheduler Redis queue error');
    });
    await queueClient.connect();
  }

  try {
    await queueClient.sendCommand([
      'XGROUP',
      'CREATE',
      env.SCHEDULER_STREAM_KEY,
      SCHEDULER_STREAM_GROUP,
      '0',
      'MKSTREAM',
    ]);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (!message.includes('BUSYGROUP')) {
      throw err;
    }
  }

  queueReady = true;
  logger.info(
    {
      stream: env.SCHEDULER_STREAM_KEY,
      consumer: schedulerConsumerName,
    },
    'Scheduler queue connected'
  );
  return true;
}

export async function enqueueCompanyWakeup(
  companyId: string,
  reason: string,
  options?: {
    taskId?: string | null;
    agentId?: string | null;
  }
) {
  if ((!queueReady || !queueClient) && isRedisConfigured()) {
    await initializeSchedulerQueue();
  }

  if (!queueReady || !queueClient) {
    return false;
  }

  await queueClient.sendCommand([
    'XADD',
    env.SCHEDULER_STREAM_KEY,
    '*',
    'company_id',
    companyId,
    'reason',
    reason,
    'task_id',
    options?.taskId ?? '',
    'agent_id',
    options?.agentId ?? '',
    'queued_at',
    new Date().toISOString(),
  ]);

  return true;
}

export async function readSchedulerWakeups(count: number) {
  if (!queueReady || !queueClient) {
    return [];
  }

  const raw = await queueClient.sendCommand([
    'XREADGROUP',
    'GROUP',
    SCHEDULER_STREAM_GROUP,
    schedulerConsumerName,
    'COUNT',
    String(Math.max(count, 1)),
    'BLOCK',
    String(env.SCHEDULER_STREAM_BLOCK_MS),
    'STREAMS',
    env.SCHEDULER_STREAM_KEY,
    '>',
  ]);

  return parseWakeupEntries(raw);
}

export async function acknowledgeSchedulerWakeup(id: string) {
  if (!queueReady || !queueClient) {
    return;
  }

  await queueClient.sendCommand([
    'XACK',
    env.SCHEDULER_STREAM_KEY,
    SCHEDULER_STREAM_GROUP,
    id,
  ]);
}

export async function closeSchedulerQueue() {
  const client = queueClient;
  queueClient = null;
  queueReady = false;

  if (client) {
    await client.quit().catch(() => undefined);
  }
}
