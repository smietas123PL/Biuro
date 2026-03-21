import express from 'express';
import { createServer, type Server } from 'http';
import { afterEach, describe, expect, it, vi } from 'vitest';

const envMock = vi.hoisted(() => ({
  REST_RATE_LIMIT_WINDOW_MS: 60_000,
  REST_RATE_LIMIT_MAX: 2,
  LLM_RATE_LIMIT_WINDOW_MS: 60_000,
  LLM_RATE_LIMIT_MAX: 1,
}));

vi.mock('../src/env.js', () => ({
  env: envMock,
}));

describe('rate limit middleware', () => {
  let server: Server | undefined;

  afterEach(async () => {
    vi.resetModules();
    if (server) {
      await new Promise<void>((resolve, reject) => {
        server!.close((err) => {
          if (err) {
            reject(err);
            return;
          }
          resolve();
        });
      });
      server = undefined;
    }
  });

  it('limits general API traffic after the configured threshold', async () => {
    const { apiRateLimit } = await import('../src/middleware/rateLimit.js');

    const app = express();
    app.use('/api', apiRateLimit);
    app.get('/api/projects', (_req, res) => {
      res.json({ ok: true });
    });

    server = createServer(app);
    await new Promise<void>((resolve) => {
      server!.listen(0, '127.0.0.1', () => resolve());
    });

    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Expected TCP address');
    }
    const baseUrl = `http://127.0.0.1:${address.port}/api/projects`;

    expect((await fetch(baseUrl)).status).toBe(200);
    expect((await fetch(baseUrl)).status).toBe(200);

    const blocked = await fetch(baseUrl);
    expect(blocked.status).toBe(429);
    await expect(blocked.json()).resolves.toEqual({
      error: 'Too many API requests. Please try again later.',
    });
  });

  it('applies a stricter limiter to LLM-heavy routes', async () => {
    const { llmRateLimit } = await import('../src/middleware/rateLimit.js');

    const app = express();
    app.use(express.json());
    app.post('/api/nl-command', llmRateLimit, (_req, res) => {
      res.json({ ok: true });
    });

    server = createServer(app);
    await new Promise<void>((resolve) => {
      server!.listen(0, '127.0.0.1', () => resolve());
    });

    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Expected TCP address');
    }
    const baseUrl = `http://127.0.0.1:${address.port}/api/nl-command`;

    expect(
      (
        await fetch(baseUrl, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ input: 'Plan launch rollout' }),
        })
      ).status
    ).toBe(200);

    const blocked = await fetch(baseUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ input: 'Plan launch rollout again' }),
    });
    expect(blocked.status).toBe(429);
    await expect(blocked.json()).resolves.toEqual({
      error: 'Too many AI-assisted requests. Please try again later.',
    });
  });

  it('skips the general limiter for the health endpoint', async () => {
    const { apiRateLimit } = await import('../src/middleware/rateLimit.js');

    const app = express();
    app.use('/api', apiRateLimit);
    app.get('/api/health', (_req, res) => {
      res.json({ ok: true });
    });

    server = createServer(app);
    await new Promise<void>((resolve) => {
      server!.listen(0, '127.0.0.1', () => resolve());
    });

    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Expected TCP address');
    }
    const baseUrl = `http://127.0.0.1:${address.port}/api/health`;

    expect((await fetch(baseUrl)).status).toBe(200);
    expect((await fetch(baseUrl)).status).toBe(200);
    expect((await fetch(baseUrl)).status).toBe(200);
  });

  it('skips the general limiter for websocket stats', async () => {
    const { apiRateLimit } = await import('../src/middleware/rateLimit.js');

    const app = express();
    app.use('/api', apiRateLimit);
    app.get('/api/ws/stats', (_req, res) => {
      res.json({ clients: 0 });
    });

    server = createServer(app);
    await new Promise<void>((resolve) => {
      server!.listen(0, '127.0.0.1', () => resolve());
    });

    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Expected TCP address');
    }
    const baseUrl = `http://127.0.0.1:${address.port}/api/ws/stats`;

    expect((await fetch(baseUrl)).status).toBe(200);
    expect((await fetch(baseUrl)).status).toBe(200);
    expect((await fetch(baseUrl)).status).toBe(200);
  });

  it('skips the general limiter for auth verification', async () => {
    const { apiRateLimit } = await import('../src/middleware/rateLimit.js');

    const app = express();
    app.use('/api', apiRateLimit);
    app.get('/api/auth/me', (_req, res) => {
      res.json({ user: { id: '1' } });
    });

    server = createServer(app);
    await new Promise<void>((resolve) => {
      server!.listen(0, '127.0.0.1', () => resolve());
    });

    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Expected TCP address');
    }
    const baseUrl = `http://127.0.0.1:${address.port}/api/auth/me`;

    // envMock.REST_RATE_LIMIT_MAX is 2, so 3 requests should normally trigger 429
    expect((await fetch(baseUrl)).status).toBe(200);
    expect((await fetch(baseUrl)).status).toBe(200);
    expect((await fetch(baseUrl)).status).toBe(200);
  });
});
