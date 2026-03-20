import 'dotenv/config';
import { db } from './db/client.js';
import { logger } from './utils/logger.js';
import {
  getActiveHeartbeatCount,
  startOrchestrator,
  stopOrchestrator,
} from './orchestrator/scheduler.js';
import { runtimeRegistry } from './runtime/registry.js';
import { MCPService } from './services/mcp.js';
import { closeEmbeddingCache } from './services/embeddings.js';
import { env } from './env.js';
import { startMetricsServer } from './observability/metricsServer.js';
import { initializeTracing, shutdownTracing } from './observability/tracing.js';
import {
  closeRealtimeEventBus,
  initializeRealtimeEventBus,
} from './realtime/eventBus.js';
import {
  closeSchedulerQueue,
  initializeSchedulerQueue,
} from './orchestrator/schedulerQueue.js';
import { runStartupMigrations } from './db/startupMigrations.js';

initializeTracing({
  serviceName: `${env.OTEL_SERVICE_NAME}-worker`,
  enableConsoleExporter: env.OTEL_TRACE_CONSOLE_EXPORTER,
  historyLimit: env.OTEL_TRACE_HISTORY_LIMIT,
  otlpEndpoint: env.OTEL_EXPORTER_OTLP_ENDPOINT,
});

const metricsServer = startMetricsServer(
  env.WORKER_METRICS_PORT,
  'biuro-worker'
);

let shuttingDown = false;

async function shutdown(signal: string, exitCode: number = 0) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  logger.info({ signal }, 'Stopping worker');

  const forceExitTimer = setTimeout(() => {
    logger.error({ signal }, 'Forcing worker shutdown after timeout');
    process.exit(exitCode === 0 ? 1 : exitCode);
  }, 10_000);
  forceExitTimer.unref();

  try {
    await stopOrchestrator();
    logger.info(
      { activeHeartbeats: getActiveHeartbeatCount() },
      'Heartbeat drain finished'
    );
    await metricsServer?.close();
    await closeSchedulerQueue();
    await closeRealtimeEventBus();
    await MCPService.closeAllClients();
    await closeEmbeddingCache();
    await shutdownTracing();
    await db.close();
    clearTimeout(forceExitTimer);
    logger.info('Worker stopped cleanly');
    process.exit(exitCode);
  } catch (err) {
    clearTimeout(forceExitTimer);
    logger.error({ err, signal }, 'Worker shutdown failed');
    process.exit(1);
  }
}

async function initWorker() {
  logger.info('Starting Autonomiczne Biuro Worker...');

  try {
    const migrationClient = await db.getClient();
    try {
      await runStartupMigrations(migrationClient, logger);
    } finally {
      migrationClient.release();
    }
    await db.query('SELECT 1');
    logger.info('Worker connected to Database');
    await initializeRealtimeEventBus({
      serviceName: 'worker',
      subscribe: false,
    });
    await initializeSchedulerQueue();

    // 2. Runtimes are auto-registered in RuntimeRegistry constructor
    void runtimeRegistry;

    // 3. Start Scheduler
    startOrchestrator();

    logger.info('Worker execution loop heartbeat started');
  } catch (err) {
    logger.error({ err }, 'Worker failed to start');
    process.exit(1);
  }
}

process.on('SIGINT', () => {
  void shutdown('SIGINT');
});

process.on('SIGTERM', () => {
  void shutdown('SIGTERM');
});

process.on('uncaughtException', (err) => {
  logger.error({ err }, 'Worker crashed with uncaught exception');
  void shutdown('uncaughtException', 1);
});

process.on('unhandledRejection', (reason) => {
  logger.error({ err: reason }, 'Worker crashed with unhandled rejection');
  void shutdown('unhandledRejection', 1);
});

void initWorker();
