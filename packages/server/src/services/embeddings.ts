import crypto from 'node:crypto';
import OpenAI from 'openai';
import type { RedisClientType } from 'redis';
import { env } from '../env.js';
import { logger } from '../utils/logger.js';
import {
  createRedisConnection,
  isRedisConfigured,
} from '../realtime/redisConfig.js';

const EMBEDDING_DIMENSIONS = 1536;
const FALLBACK_EMBEDDING_MODEL = 'local-hash-v1';
const DEFAULT_EMBEDDING_MODEL =
  env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-small';

let openAIClient: OpenAI | null = null;
let loggedFallbackReason = false;
let embeddingCacheClient: RedisClientType | null = null;
let embeddingCacheReady = false;
let embeddingCacheConnectAttempted = false;
const memoryEmbeddingCache = new Map<
  string,
  { value: EmbeddingResult; expiresAt: number }
>();

export type EmbeddingResult = {
  vector: number[];
  model: string;
  source: 'openai' | 'fallback';
  cache_status?: 'hit' | 'miss';
  cache_backend?: 'redis' | 'memory' | 'none';
};

type CacheLookupResult = {
  value: EmbeddingResult;
  backend: 'redis' | 'memory';
};

function getOpenAIClient() {
  if (!env.OPENAI_API_KEY) {
    return null;
  }

  if (!openAIClient) {
    openAIClient = new OpenAI({ apiKey: env.OPENAI_API_KEY });
  }

  return openAIClient;
}

function logFallback(reason: string, err?: unknown) {
  if (loggedFallbackReason) {
    return;
  }

  loggedFallbackReason = true;
  logger.warn(
    { reason, err },
    'Embeddings API unavailable, using deterministic fallback embeddings'
  );
}

function tokenize(text: string) {
  return text
    .toLowerCase()
    .split(/\s+/)
    .map((token) => token.replace(/[^\p{L}\p{N}_-]+/gu, ''))
    .filter((token) => token.length >= 2)
    .slice(0, 256);
}

function buildEmbeddingCacheKey(text: string) {
  return `biuro:embeddings:${DEFAULT_EMBEDDING_MODEL}:${crypto
    .createHash('sha256')
    .update(text, 'utf8')
    .digest('hex')}`;
}

function logEmbeddingTelemetry(
  text: string,
  payload: {
    cache_status: 'hit' | 'miss';
    cache_backend: 'redis' | 'memory' | 'none';
    embedding_source: EmbeddingResult['source'];
    embedding_model: string;
  }
) {
  logger.info(
    {
      text_length: text.length,
      ...payload,
    },
    'Embedding resolved'
  );
}

async function getEmbeddingCacheClient() {
  if (!isRedisConfigured()) {
    return null;
  }

  if (embeddingCacheReady && embeddingCacheClient) {
    return embeddingCacheClient;
  }

  if (embeddingCacheConnectAttempted) {
    return null;
  }

  embeddingCacheConnectAttempted = true;
  try {
    embeddingCacheClient = createRedisConnection();
    if (!embeddingCacheClient) {
      embeddingCacheReady = false;
      return null;
    }
    embeddingCacheClient.on('error', (err) => {
      logger.warn({ err }, 'Embedding cache Redis error');
    });
    await embeddingCacheClient.connect();
    embeddingCacheReady = true;
    logger.info('Embedding cache connected to Redis');
    return embeddingCacheClient;
  } catch (err) {
    embeddingCacheClient = null;
    embeddingCacheReady = false;
    logger.warn({ err }, 'Embedding cache unavailable, falling back to memory');
    return null;
  }
}

function readMemoryEmbeddingCache(key: string) {
  const cached = memoryEmbeddingCache.get(key);
  if (!cached) {
    return null;
  }

  if (cached.expiresAt <= Date.now()) {
    memoryEmbeddingCache.delete(key);
    return null;
  }

  return cached.value;
}

function writeMemoryEmbeddingCache(key: string, value: EmbeddingResult) {
  memoryEmbeddingCache.set(key, {
    value,
    expiresAt: Date.now() + env.EMBEDDING_CACHE_TTL_MS,
  });
}

async function readEmbeddingCache(key: string): Promise<CacheLookupResult | null> {
  const redisClient = await getEmbeddingCacheClient();
  if (redisClient) {
    try {
      const cached = await redisClient.get(key);
      if (typeof cached === 'string') {
        try {
          return {
            value: JSON.parse(cached) as EmbeddingResult,
            backend: 'redis',
          };
        } catch (err) {
          logger.warn({ err }, 'Embedding cache contained invalid JSON');
          await redisClient.del(key).catch(() => undefined);
        }
      }
      return null;
    } catch (err) {
      logger.warn({ err }, 'Failed to read embedding cache from Redis');
      return null;
    }
  }

  const cached = readMemoryEmbeddingCache(key);
  return cached
    ? {
        value: cached,
        backend: 'memory',
      }
    : null;
}

async function writeEmbeddingCache(
  key: string,
  value: EmbeddingResult
): Promise<'redis' | 'memory'> {
  const redisClient = await getEmbeddingCacheClient();
  if (redisClient) {
    try {
      await redisClient.set(key, JSON.stringify(value), {
        PX: env.EMBEDDING_CACHE_TTL_MS,
      });
      return 'redis';
    } catch (err) {
      logger.warn({ err }, 'Failed to write embedding cache to Redis');
    }
  }

  writeMemoryEmbeddingCache(key, value);
  return 'memory';
}

function hashToken(token: string, seed: number) {
  let hash = 2166136261 ^ seed;
  for (let index = 0; index < token.length; index += 1) {
    hash ^= token.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function buildDeterministicEmbedding(
  text: string,
  dimensions: number = EMBEDDING_DIMENSIONS
) {
  const vector = Array(dimensions).fill(0);
  const tokens = tokenize(text);

  if (tokens.length === 0) {
    return vector;
  }

  for (const token of tokens) {
    const weight = Math.min(1 + token.length / 12, 3);
    const primaryIndex = hashToken(token, 0) % dimensions;
    const secondaryIndex = hashToken(token, 1) % dimensions;
    const tertiaryIndex = hashToken(token, 2) % dimensions;
    const sign = hashToken(token, 3) % 2 === 0 ? 1 : -1;

    vector[primaryIndex] += sign * weight;
    vector[secondaryIndex] += sign * 0.6 * weight;
    vector[tertiaryIndex] -= sign * 0.3 * weight;
  }

  const magnitude = Math.hypot(...vector);
  if (magnitude === 0) {
    return vector;
  }

  return vector.map((value) => Number((value / magnitude).toFixed(8)));
}

export function toPgVector(vector: number[]) {
  const normalized = vector.map((value) =>
    Number.isFinite(value) ? value : 0
  );
  return `[${normalized.join(',')}]`;
}

export async function generateEmbedding(
  text: string
): Promise<EmbeddingResult> {
  const normalizedText = text.trim();
  if (!normalizedText) {
    return {
      vector: buildDeterministicEmbedding(''),
      model: FALLBACK_EMBEDDING_MODEL,
      source: 'fallback',
    };
  }

  const cacheKey = buildEmbeddingCacheKey(normalizedText);
  const cached = await readEmbeddingCache(cacheKey);
  if (cached) {
    logEmbeddingTelemetry(normalizedText, {
      cache_status: 'hit',
      cache_backend: cached.backend,
      embedding_source: cached.value.source,
      embedding_model: cached.value.model,
    });
    return {
      ...cached.value,
      cache_status: 'hit',
      cache_backend: cached.backend,
    };
  }

  const client = getOpenAIClient();
  if (!client) {
    logFallback('missing_openai_api_key');
    const fallback: EmbeddingResult = {
      vector: buildDeterministicEmbedding(normalizedText),
      model: FALLBACK_EMBEDDING_MODEL,
      source: 'fallback',
    };
    const cacheBackend = await writeEmbeddingCache(cacheKey, fallback);
    logEmbeddingTelemetry(normalizedText, {
      cache_status: 'miss',
      cache_backend: cacheBackend,
      embedding_source: fallback.source,
      embedding_model: fallback.model,
    });
    return {
      ...fallback,
      cache_status: 'miss',
      cache_backend: cacheBackend,
    };
  }

  try {
    const response = await client.embeddings.create({
      model: DEFAULT_EMBEDDING_MODEL,
      input: normalizedText,
    });
    const vector = response.data[0]?.embedding;
    if (!Array.isArray(vector) || vector.length !== EMBEDDING_DIMENSIONS) {
      logFallback('unexpected_embedding_dimensions');
      const fallback: EmbeddingResult = {
        vector: buildDeterministicEmbedding(normalizedText),
        model: FALLBACK_EMBEDDING_MODEL,
        source: 'fallback',
      };
      await writeEmbeddingCache(cacheKey, fallback);
      return fallback;
    }

    const fresh: EmbeddingResult = {
      vector,
      model: DEFAULT_EMBEDDING_MODEL,
      source: 'openai',
    };
    const cacheBackend = await writeEmbeddingCache(cacheKey, fresh);
    logEmbeddingTelemetry(normalizedText, {
      cache_status: 'miss',
      cache_backend: cacheBackend,
      embedding_source: fresh.source,
      embedding_model: fresh.model,
    });
    return {
      ...fresh,
      cache_status: 'miss',
      cache_backend: cacheBackend,
    };
  } catch (err) {
    logFallback('openai_embedding_error', err);
    const fallback: EmbeddingResult = {
      vector: buildDeterministicEmbedding(normalizedText),
      model: FALLBACK_EMBEDDING_MODEL,
      source: 'fallback',
    };
    const cacheBackend = await writeEmbeddingCache(cacheKey, fallback);
    logEmbeddingTelemetry(normalizedText, {
      cache_status: 'miss',
      cache_backend: cacheBackend,
      embedding_source: fallback.source,
      embedding_model: fallback.model,
    });
    return {
      ...fallback,
      cache_status: 'miss',
      cache_backend: cacheBackend,
    };
  }
}

export async function closeEmbeddingCache() {
  const client = embeddingCacheClient;
  embeddingCacheClient = null;
  embeddingCacheReady = false;
  embeddingCacheConnectAttempted = false;
  openAIClient = null;
  loggedFallbackReason = false;
  memoryEmbeddingCache.clear();

  if (client) {
    await client.quit().catch(() => undefined);
  }
}
