import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbMock = vi.hoisted(() => ({
  query: vi.fn(),
}));
const generateEmbeddingMock = vi.hoisted(() => vi.fn());
const toPgVectorMock = vi.hoisted(() => vi.fn());
const recordRetrievalMetricMock = vi.hoisted(() => vi.fn());
const loggerWarnMock = vi.hoisted(() => vi.fn());
const loggerInfoMock = vi.hoisted(() => vi.fn());

vi.mock('../src/db/client.js', () => ({
  db: dbMock,
}));

vi.mock('../src/services/embeddings.js', () => ({
  generateEmbedding: generateEmbeddingMock,
  toPgVector: toPgVectorMock,
}));

vi.mock('../src/services/retrievalMetrics.js', () => ({
  recordRetrievalMetric: recordRetrievalMetricMock,
}));

vi.mock('../src/utils/logger.js', () => ({
  logger: {
    warn: loggerWarnMock,
    info: loggerInfoMock,
  },
}));

import {
  KnowledgeService,
  mergeKnowledgeResults,
} from '../src/services/knowledge.js';

describe('knowledge service', () => {
  beforeEach(() => {
    dbMock.query.mockReset();
    generateEmbeddingMock.mockReset();
    toPgVectorMock.mockReset();
    recordRetrievalMetricMock.mockReset();
    loggerWarnMock.mockReset();
    loggerInfoMock.mockReset();

    generateEmbeddingMock.mockResolvedValue({
      vector: [0.1, 0.2, 0.3],
      model: 'text-embedding-3-small',
      source: 'openai',
      cache_status: 'miss',
      cache_backend: 'memory',
    });
    toPgVectorMock.mockReturnValue('[0.1,0.2,0.3]');
    recordRetrievalMetricMock.mockResolvedValue(undefined);
  });

  it('degrades to lexical results when vector search fails', async () => {
    dbMock.query.mockImplementation(async (text: string) => {
      if (text.includes('embedding <=>')) {
        throw new Error('pgvector unavailable');
      }

      if (text.includes('lexical_score')) {
        return {
          rows: [
            {
              id: 'doc-1',
              title: 'Launch brief',
              content: 'Use a visible checklist before launch.',
              metadata: { source: 'wiki' },
              created_at: '2026-03-20T10:00:00.000Z',
              lexical_score: 12,
            },
          ],
        };
      }

      throw new Error(`Unexpected query: ${text}`);
    });

    const results = await KnowledgeService.search('company-1', 'launch checklist', 3, {
      consumer: 'knowledge_api',
    });

    expect(results).toEqual([
      {
        title: 'Launch brief',
        content: 'Use a visible checklist before launch.',
        metadata: { source: 'wiki' },
      },
    ]);
    expect(recordRetrievalMetricMock).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: 'company-1',
        scope: 'knowledge',
        consumer: 'knowledge_api',
        query: 'launch checklist',
        lexicalCandidateCount: 1,
        vectorCandidateCount: 0,
        overlapCount: 0,
        topDistance: null,
        embeddingSource: 'openai',
        embeddingModel: 'text-embedding-3-small',
      })
    );
    expect(loggerWarnMock).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: 'company-1',
        limit: 9,
      }),
      'Vector knowledge search failed, degrading to lexical results'
    );
  });

  it('degrades to vector results when lexical search fails', async () => {
    dbMock.query.mockImplementation(async (text: string) => {
      if (text.includes('embedding <=>')) {
        return {
          rows: [
            {
              id: 'doc-2',
              title: 'Support notes',
              content: 'Enterprise users ask for rollout plans.',
              metadata: { source: 'handbook' },
              created_at: '2026-03-21T10:00:00.000Z',
              distance: 0.11,
            },
          ],
        };
      }

      if (text.includes('lexical_score')) {
        throw new Error('fts unavailable');
      }

      throw new Error(`Unexpected query: ${text}`);
    });

    const results = await KnowledgeService.search('company-1', 'rollout plan', 2, {
      consumer: 'agent_context',
    });

    expect(results).toEqual([
      {
        title: 'Support notes',
        content: 'Enterprise users ask for rollout plans.',
        metadata: { source: 'handbook' },
      },
    ]);
    expect(recordRetrievalMetricMock).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: 'company-1',
        consumer: 'agent_context',
        lexicalCandidateCount: 0,
        vectorCandidateCount: 1,
        topDistance: 0.11,
      })
    );
    expect(loggerWarnMock).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: 'company-1',
        limit: 6,
      }),
      'Lexical knowledge search failed, degrading to vector results'
    );
  });

  it('prefers hybrid matches when lexical and vector candidates overlap', () => {
    const results = mergeKnowledgeResults(
      [
        {
          id: 'hybrid-doc',
          title: 'Hybrid doc',
          content: 'Strong on both signals.',
          metadata: {},
          created_at: '2026-03-21T10:00:00.000Z',
          distance: 0.2,
        },
        {
          id: 'vector-only',
          title: 'Vector only',
          content: 'Mostly semantic.',
          metadata: {},
          created_at: '2026-03-20T10:00:00.000Z',
          distance: 0.05,
        },
      ],
      [
        {
          id: 'lexical-only',
          title: 'Lexical only',
          content: 'Strong literal match.',
          metadata: {},
          created_at: '2026-03-22T10:00:00.000Z',
          lexical_score: 10,
        },
        {
          id: 'hybrid-doc',
          title: 'Hybrid doc',
          content: 'Strong on both signals.',
          metadata: {},
          created_at: '2026-03-21T10:00:00.000Z',
          lexical_score: 10,
        },
      ],
      3
    );

    expect(results.map((row) => row.title)).toEqual([
      'Hybrid doc',
      'Lexical only',
      'Vector only',
    ]);
  });
});
