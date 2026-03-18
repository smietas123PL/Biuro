import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { env } from './env.js';
import { logger } from './utils/logger.js';
import { db } from './db/client.js';
import routes from './routes/index.js';
import { createServer } from 'http';
import { initWSHub } from './ws.js';

const app = express();
const server = createServer(app);
const wsHub = initWSHub(server);
const allowedOrigins = new Set(env.ALLOWED_ORIGINS);

const captureRawBody: Parameters<typeof express.json>[0]['verify'] = (req, _res, buffer, encoding) => {
  if (buffer.length === 0) {
    return;
  }

  const bodyEncoding = typeof encoding === 'string' ? (encoding as BufferEncoding) : 'utf8';
  (req as express.Request & { rawBody?: string }).rawBody = buffer.toString(bodyEncoding);
};

// Middleware
app.disable('x-powered-by');
app.use(helmet());
app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.has(origin)) {
      callback(null, true);
      return;
    }

    callback(null, false);
  },
  credentials: true,
}));
app.use(express.json({ verify: captureRawBody }));
app.use(express.urlencoded({ extended: false, verify: captureRawBody }));

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', version: '1.0.0', timestamp: new Date().toISOString() });
});

// Routes
app.use('/api', routes);

// Error handling
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  logger.error({ err, url: req.url }, 'Unhandled error');
  res.status(500).json({ error: 'Internal server error' });
});

const start = async () => {
  try {
    // Test DB connection
    await db.query('SELECT 1');
    logger.info('Database connected');

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
