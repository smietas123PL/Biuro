import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbMock = vi.hoisted(() => ({
  query: vi.fn(),
}));
const generateEmbeddingMock = vi.hoisted(() => vi.fn());
const toPgVectorMock = vi.hoisted(() => vi.fn());
const recordRetrievalMetricMock = vi.hoisted(() => vi.fn());
const loggerWarnMock = vi.hoisted(() => vi.fn());
const loggerErrorMock = vi.hoisted(() => vi.fn());
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
    error: loggerErrorMock,
    info: loggerInfoMock,
  },
}));

import {
  findRelatedMemories,
  mergeMemoryResults,
} from '../src/orchestrator/memory.js';

describe('memory retrieval', () => {
  beforeEach(() => {
    dbMock.query.mockReset();
    generateEmbeddingMock.mockReset();
    toPgVectorMock.mockReset();
    recordRetrievalMetricMock.mockReset();
    loggerWarnMock.mockReset();
    loggerErrorMock.mockReset();
    loggerInfoMock.mockReset();

    generateEmbeddingMock.mockResolvedValue({
      vector: [0.1, 0.2, 0.3],
      model: 'text-embedding-3-small',
      source: 'openai',
    });
    toPgVectorMock.mockReturnValue('[0.1,0.2,0.3]');
    recordRetrievalMetricMock.mockResolvedValue(undefined);
  });

  it('degrades to lexical matches when vector retrieval fails', async () => {
    dbMock.query.mockImplementation(async (text: string) => {
      if (text.includes('content ILIKE')) {
        return {
          rows: [
            {
              content: 'Remember the launch checklist before rollout.',
              created_at: '2026-03-20T10:00:00.000Z',
            },
          ],
        };
      }

      if (text.includes('embedding <=>')) {
        throw new Error('pgvector unavailable');
      }

      throw new Error(`Unexpected query: ${text}`);
    });

    const results = await findRelatedMemories('company-1', 'launch checklist', 3, {
      agentId: 'agent-1',
      taskId: 'task-1',
      consumer: 'heartbeat_memory',
    });

    expect(results).toEqual([
      'Remember the launch checklist before rollout.',
    ]);
    expect(recordRetrievalMetricMock).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: 'memory',
        consumer: 'heartbeat_memory',
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
        limit: 3,
      }),
      'Vector memory search failed, degrading to lexical results'
    );
  });

  it('degrades to lexical matches when embedding generation fails', async () => {
    generateEmbeddingMock.mockRejectedValue(new Error('openai timeout'));
    dbMock.query.mockImplementation(async (text: string) => {
      if (text.includes('content ILIKE')) {
        return {
          rows: [
            {
              content: 'Previous incident notes mention rollout timing.',
              created_at: '2026-03-19T10:00:00.000Z',
            },
          ],
        };
      }

      throw new Error(`Unexpected query: ${text}`);
    });

    const results = await findRelatedMemories('company-1', 'rollout timing', 2, {
      consumer: 'agent_memory',
    });

    expect(results).toEqual([
      'Previous incident notes mention rollout timing.',
    ]);
    expect(recordRetrievalMetricMock).toHaveBeenCalledWith(
      expect.objectContaining({
        lexicalCandidateCount: 1,
        vectorCandidateCount: 0,
        embeddingSource: 'unavailable',
        embeddingModel: 'unavailable',
      })
    );
  });

  it('prefers hybrid memories when lexical and vector results overlap', () => {
    const results = mergeMemoryResults(
      [
        {
          content: 'Hybrid memory',
          created_at: '2026-03-21T10:00:00.000Z',
          distance: 0.2,
        },
        {
          content: 'Vector only memory',
          created_at: '2026-03-20T10:00:00.000Z',
          distance: 0.05,
        },
      ],
      [
        {
          content: 'Lexical only memory',
          created_at: '2026-03-22T10:00:00.000Z',
        },
        {
          content: 'Hybrid memory',
          created_at: '2026-03-21T10:00:00.000Z',
        },
      ],
      3
    );

    expect(results).toEqual([
      'Hybrid memory',
      'Lexical only memory',
      'Vector only memory',
    ]);
  });
});
