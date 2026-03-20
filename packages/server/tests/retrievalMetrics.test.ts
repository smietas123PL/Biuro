import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbMock = vi.hoisted(() => ({
  query: vi.fn(),
}));
const loggerWarnMock = vi.hoisted(() => vi.fn());

vi.mock('../src/db/client.js', () => ({
  db: dbMock,
}));

vi.mock('../src/utils/logger.js', () => ({
  logger: {
    warn: loggerWarnMock,
  },
}));

import {
  buildQueryPreview,
  recordRetrievalMetric,
} from '../src/services/retrievalMetrics.js';

describe('buildQueryPreview', () => {
  beforeEach(() => {
    dbMock.query.mockReset();
    loggerWarnMock.mockReset();
  });

  it('collapses extra whitespace before returning the preview', () => {
    expect(buildQueryPreview('  roadmap    for   rag quality  ', 80)).toBe(
      'roadmap for rag quality'
    );
  });

  it('truncates long queries with an ASCII ellipsis', () => {
    expect(buildQueryPreview('abcdefghijklmnop', 10)).toBe('abcdefg...');
  });

  it('records retrieval metrics with normalized preview and query length', async () => {
    dbMock.query.mockResolvedValue({ rows: [] });

    await recordRetrievalMetric({
      companyId: 'company-1',
      agentId: 'agent-1',
      taskId: 'task-1',
      scope: 'knowledge',
      consumer: 'agent_context',
      query: '  roadmap    for   rag quality  ',
      limitRequested: 5,
      resultCount: 2,
      lexicalCandidateCount: 4,
      vectorCandidateCount: 3,
      overlapCount: 1,
      topDistance: 0.12,
      embeddingSource: 'openai',
      embeddingModel: 'text-embedding-3-small',
      latencyMs: 84,
    });

    expect(dbMock.query).toHaveBeenCalledTimes(1);
    expect(dbMock.query.mock.calls[0]?.[1]).toEqual([
      'company-1',
      'agent-1',
      'task-1',
      'knowledge',
      'agent_context',
      'roadmap for rag quality',
      23,
      5,
      2,
      4,
      3,
      1,
      0.12,
      'openai',
      'text-embedding-3-small',
      84,
    ]);
  });

  it('swallows metric write failures and logs a warning', async () => {
    const error = new Error('db down');
    dbMock.query.mockRejectedValue(error);

    await expect(
      recordRetrievalMetric({
        companyId: 'company-1',
        scope: 'memory',
        consumer: 'insights',
        query: 'retention',
        limitRequested: 3,
        resultCount: 0,
        lexicalCandidateCount: 0,
        vectorCandidateCount: 0,
        overlapCount: 0,
        topDistance: null,
        embeddingSource: 'openai',
        embeddingModel: 'text-embedding-3-small',
        latencyMs: 12,
      })
    ).resolves.toBeUndefined();

    expect(loggerWarnMock).toHaveBeenCalledWith(
      {
        err: error,
        scope: 'memory',
        consumer: 'insights',
      },
      'Failed to record retrieval metric'
    );
  });
});
