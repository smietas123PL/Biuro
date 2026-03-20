import { createClient, type RedisClientType } from 'redis';
import { env } from '../env.js';

function injectRedisPassword(rawUrl: string, password?: string) {
  const redisUrl = new URL(rawUrl);
  if (!redisUrl.password && password) {
    redisUrl.password = password;
  }
  return redisUrl.toString();
}

export function resolveRedisUrl() {
  if (!env.REDIS_URL) {
    return null;
  }

  return injectRedisPassword(env.REDIS_URL, env.REDIS_PASSWORD);
}

export function isRedisConfigured() {
  return Boolean(resolveRedisUrl());
}

export function createRedisConnection(): RedisClientType | null {
  const redisUrl = resolveRedisUrl();
  if (!redisUrl) {
    return null;
  }

  return createClient({ url: redisUrl });
}
