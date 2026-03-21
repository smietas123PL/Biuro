import rateLimit from 'express-rate-limit';
import { env } from '../env.js';

function buildRateLimiter(options: {
  windowMs: number;
  max: number;
  message: string;
  skip?: (req: Parameters<ReturnType<typeof rateLimit>>[0]) => boolean;
}) {
  return rateLimit({
    windowMs: options.windowMs,
    max: options.max,
    standardHeaders: true,
    legacyHeaders: false,
    skip: options.skip,
    handler: (_req, res) => {
      res.status(429).json({ error: options.message });
    },
  });
}

export const apiRateLimit = buildRateLimiter({
  windowMs: env.REST_RATE_LIMIT_WINDOW_MS,
  max: env.REST_RATE_LIMIT_MAX,
  message: 'Too many API requests. Please try again later.',
  skip: (req) =>
    req.path === '/health' ||
    req.path === '/ws/stats' ||
    req.path === '/auth/me' ||
    req.path.startsWith('/observability/traces/'),
});

export const llmRateLimit = buildRateLimiter({
  windowMs: env.LLM_RATE_LIMIT_WINDOW_MS,
  max: env.LLM_RATE_LIMIT_MAX,
  message: 'Too many AI-assisted requests. Please try again later.',
});
