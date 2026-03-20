import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { env } from './env.js';
import { logger } from './utils/logger.js';
import { db } from './db/client.js';
import routes from './routes/index.js';
import { createServer } from 'http';
import { initWSHub } from './ws.js';
import { AppError } from './utils/errors.js';
import { MCPService } from './services/mcp.js';
import { closeEmbeddingCache } from './services/embeddings.js';
import {
  observabilityMiddleware,
  metricsHandler,
} from './observability/http.js';
import { initializeTracing, shutdownTracing } from './observability/tracing.js';
import {
  closeRealtimeEventBus,
  initializeRealtimeEventBus,
  subscribeToCompanyEvents,
} from './realtime/eventBus.js';
import { runStartupMigrations } from './db/startupMigrations.js';
import { buildHelmetOptions } from './security/helmet.js';
import { apiRateLimit } from './middleware/rateLimit.js';

initializeTracing({
  serviceName: `${env.OTEL_SERVICE_NAME}-api`,
  enableConsoleExporter: env.OTEL_TRACE_CONSOLE_EXPORTER,
  historyLimit: env.OTEL_TRACE_HISTORY_LIMIT,
  otlpEndpoint: env.OTEL_EXPORTER_OTLP_ENDPOINT,
});

const app = express();
const server = createServer(app);
const wsHub = initWSHub(server);
const unsubscribeRealtimeEvents = subscribeToCompanyEvents(
  'api-ws-hub',
  async (envelope) => {
    wsHub.broadcast(envelope.companyId, envelope.event, envelope.data);
  }
);
const allowedOrigins = new Set(env.ALLOWED_ORIGINS);
let shuttingDown = false;

const captureRawBody: Parameters<typeof express.json>[0]['verify'] = (
  req,
  _res,
  buffer,
  encoding
) => {
  if (buffer.length === 0) {
    return;
  }

  const bodyEncoding =
    typeof encoding === 'string' ? (encoding as BufferEncoding) : 'utf8';
  (req as express.Request & { rawBody?: string }).rawBody =
    buffer.toString(bodyEncoding);
};

// Middleware
app.disable('x-powered-by');
app.use(helmet(buildHelmetOptions(allowedOrigins)));
app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.has(origin)) {
        callback(null, true);
        return;
      }

      callback(null, false);
    },
    credentials: true,
  })
);
app.use(express.json({ verify: captureRawBody }));
app.use(express.urlencoded({ extended: false, verify: captureRawBody }));
app.use(observabilityMiddleware);

app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    version: env.APP_VERSION,
    timestamp: new Date().toISOString(),
  });
});
app.get('/metrics', metricsHandler);

// Routes
app.use('/api', apiRateLimit, routes);

// Error handling
app.use(
  (
    err: any,
    req: express.Request,
    res: express.Response,
    _next: express.NextFunction
  ) => {
    if (err instanceof AppError) {
      if (err.statusCode >= 500) {
        logger.error({ err, url: req.url }, 'Server-side operation failed');
      } else {
        logger.warn({ err, url: req.url }, 'Client-side operation rejected');
      }
      return res.status(err.statusCode).json({
        error: err.message,
        code: err.code,
        details: err.details,
      });
    }

    logger.error({ err, url: req.url }, 'Unexpected server crash');
    res.status(500).json({ error: 'Internal server error' });
  }
);

async function stopHttpServer() {
  if (!server.listening) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    server.close((err) => {
      if (err) {
        reject(err);
        return;
      }
      resolve();
    });
  });
}

async function shutdown(signal: string, exitCode: number = 0) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  logger.info({ signal }, 'Stopping API server');

  const forceExitTimer = setTimeout(() => {
    logger.error({ signal }, 'Forcing API server shutdown after timeout');
    process.exit(exitCode === 0 ? 1 : exitCode);
  }, 10_000);
  forceExitTimer.unref();

  try {
    await stopHttpServer();
    unsubscribeRealtimeEvents();
    await closeRealtimeEventBus();
    await MCPService.closeAllClients();
    await closeEmbeddingCache();
    await shutdownTracing();
    await db.close();
    clearTimeout(forceExitTimer);
    logger.info('API server stopped cleanly');
    process.exit(exitCode);
  } catch (err) {
    clearTimeout(forceExitTimer);
    logger.error({ err, signal }, 'API server shutdown failed');
    process.exit(1);
  }
}

const start = async () => {
  try {
    const migrationClient = await db.getClient();
    try {
      await runStartupMigrations(migrationClient, logger);
    } finally {
      migrationClient.release();
    }
    await db.query('SELECT 1');
    logger.info('Database connected');
    await initializeRealtimeEventBus({
      serviceName: 'api',
      subscribe: true,
    });

    // API Server doesn't run heartbeats anymore (offloaded to worker)
    // const { startOrchestrator } = await import('./orchestrator/scheduler.js');
    // startOrchestrator();

    server.listen(env.PORT, () => {
      logger.info(`Server listening on port ${env.PORT}`);
    });
  } catch (err) {
    logger.error({ err }, 'Failed to start server');
    process.exit(1);
  }
};

start();

process.on('SIGINT', () => {
  void shutdown('SIGINT');
});

process.on('SIGTERM', () => {
  void shutdown('SIGTERM');
});

process.on('uncaughtException', (err) => {
  logger.error({ err }, 'API server crashed with uncaught exception');
  void shutdown('uncaughtException', 1);
});

process.on('unhandledRejection', (reason) => {
  logger.error({ err: reason }, 'API server crashed with unhandled rejection');
  void shutdown('unhandledRejection', 1);
});
