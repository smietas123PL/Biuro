import { afterEach, describe, expect, it, vi } from 'vitest';

const loggerInfoMock = vi.hoisted(() => vi.fn());
const loggerWarnMock = vi.hoisted(() => vi.fn());

async function loadEmbeddingsModule() {
  vi.resetModules();

  vi.doMock('../src/env.js', () => ({
    env: {
      OPENAI_API_KEY: undefined,
      OPENAI_EMBEDDING_MODEL: 'text-embedding-3-small',
      REDIS_URL: undefined,
      EMBEDDING_CACHE_TTL_MS: 60_000,
    },
  }));

  vi.doMock('../src/utils/logger.js', () => ({
    logger: {
      info: loggerInfoMock,
      warn: loggerWarnMock,
    },
  }));

  return import('../src/services/embeddings.js');
}

describe('embeddings service', () => {
  afterEach(async () => {
    vi.doUnmock('../src/env.js');
    vi.doUnmock('../src/utils/logger.js');
    vi.resetModules();
    loggerInfoMock.mockReset();
    loggerWarnMock.mockReset();
  });

  it('reports memory cache miss then hit when OpenAI is unavailable', async () => {
    const { generateEmbedding, closeEmbeddingCache } =
      await loadEmbeddingsModule();

    const first = await generateEmbedding('Launch readiness checklist');
    const second = await generateEmbedding('Launch readiness checklist');

    expect(first.source).toBe('fallback');
    expect(first.cache_status).toBe('miss');
    expect(first.cache_backend).toBe('memory');
    expect(second.source).toBe('fallback');
    expect(second.cache_status).toBe('hit');
    expect(second.cache_backend).toBe('memory');
    expect(second.vector).toEqual(first.vector);
    expect(loggerWarnMock).toHaveBeenCalledWith(
      {
        reason: 'missing_openai_api_key',
        err: undefined,
      },
      'Embeddings API unavailable, using deterministic fallback embeddings'
    );
    expect(loggerInfoMock).toHaveBeenNthCalledWith(
      1,
      {
        text_length: 'Launch readiness checklist'.length,
        cache_status: 'miss',
        cache_backend: 'memory',
        embedding_source: 'fallback',
        embedding_model: 'local-hash-v1',
      },
      'Embedding resolved'
    );
    expect(loggerInfoMock).toHaveBeenNthCalledWith(
      2,
      {
        text_length: 'Launch readiness checklist'.length,
        cache_status: 'hit',
        cache_backend: 'memory',
        embedding_source: 'fallback',
        embedding_model: 'local-hash-v1',
      },
      'Embedding resolved'
    );

    await closeEmbeddingCache();
  });
});
