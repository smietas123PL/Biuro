import OpenAI from 'openai';
import { env } from '../env.js';
import { logger } from '../utils/logger.js';

const EMBEDDING_DIMENSIONS = 1536;
const FALLBACK_EMBEDDING_MODEL = 'local-hash-v1';
const DEFAULT_EMBEDDING_MODEL =
  env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-small';

let openAIClient: OpenAI | null = null;
let loggedFallbackReason = false;

type EmbeddingResult = {
  vector: number[];
  model: string;
  source: 'openai' | 'fallback';
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

  const client = getOpenAIClient();
  if (!client) {
    logFallback('missing_openai_api_key');
    return {
      vector: buildDeterministicEmbedding(normalizedText),
      model: FALLBACK_EMBEDDING_MODEL,
      source: 'fallback',
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
      return {
        vector: buildDeterministicEmbedding(normalizedText),
        model: FALLBACK_EMBEDDING_MODEL,
        source: 'fallback',
      };
    }

    return {
      vector,
      model: DEFAULT_EMBEDDING_MODEL,
      source: 'openai',
    };
  } catch (err) {
    logFallback('openai_embedding_error', err);
    return {
      vector: buildDeterministicEmbedding(normalizedText),
      model: FALLBACK_EMBEDDING_MODEL,
      source: 'fallback',
    };
  }
}
