import express from 'express';
import cors from 'cors';
import { env } from './env.js';
import { logger } from './utils/logger.js';
import { db } from './db/client.js';
import routes from './routes/index.js';
import { createServer } from 'http';
import { initWSHub } from './ws.js';

const app = express();
const server = createServer(app);
const wsHub = initWSHub(server);

// Middleware
app.use(cors());
app.use(express.json());

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
