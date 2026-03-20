import { describe, expect, it, vi } from 'vitest';

const envMock = vi.hoisted(() => ({
  REDIS_URL: undefined as string | undefined,
  REDIS_PASSWORD: undefined as string | undefined,
}));

vi.mock('../src/env.js', () => ({
  env: envMock,
}));

describe('redis config', () => {
  it('returns null when Redis is not configured', async () => {
    envMock.REDIS_URL = undefined;
    envMock.REDIS_PASSWORD = undefined;

    const { resolveRedisUrl, isRedisConfigured } = await import(
      '../src/realtime/redisConfig.js'
    );

    expect(resolveRedisUrl()).toBeNull();
    expect(isRedisConfigured()).toBe(false);
  });

  it('injects REDIS_PASSWORD when REDIS_URL has no password', async () => {
    envMock.REDIS_URL = 'redis://redis:6379';
    envMock.REDIS_PASSWORD = 'super-secret-redis';

    const { resolveRedisUrl, isRedisConfigured } = await import(
      '../src/realtime/redisConfig.js'
    );

    expect(resolveRedisUrl()).toBe('redis://:super-secret-redis@redis:6379');
    expect(isRedisConfigured()).toBe(true);
  });

  it('keeps an explicit password from REDIS_URL', async () => {
    envMock.REDIS_URL = 'redis://:url-secret@redis:6379';
    envMock.REDIS_PASSWORD = 'env-secret';

    const { resolveRedisUrl } = await import(
      '../src/realtime/redisConfig.js'
    );

    expect(resolveRedisUrl()).toBe('redis://:url-secret@redis:6379');
  });
});
