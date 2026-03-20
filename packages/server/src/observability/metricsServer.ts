import { createServer, type Server } from 'http';
import { logger } from '../utils/logger.js';
import { metricsRegistry, renderMetrics } from './metrics.js';
import { env } from '../env.js';

export type MetricsServerHandle = {
  close: () => Promise<void>;
};

export function startMetricsServer(
  port: number,
  serviceName: string
): MetricsServerHandle | null {
  if (port <= 0) {
    logger.info({ serviceName }, 'Dedicated metrics server disabled');
    return null;
  }

  const server: Server = createServer(async (req, res) => {
    if (!req.url) {
      res.statusCode = 400;
      res.end('Missing URL');
      return;
    }

    if (req.url === '/health') {
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      res.end(
        JSON.stringify({
          status: 'ok',
          service: serviceName,
          version: env.APP_VERSION,
        })
      );
      return;
    }

    if (req.url === '/metrics') {
      res.statusCode = 200;
      res.setHeader('Content-Type', metricsRegistry.contentType);
      res.end(await renderMetrics());
      return;
    }

    res.statusCode = 404;
    res.end('Not found');
  });

  server.listen(port, () => {
    logger.info({ serviceName, port }, 'Dedicated metrics server listening');
  });

  return {
    close: async () => {
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
    },
  };
}
