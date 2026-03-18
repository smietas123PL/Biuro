import { describe, expect, it } from 'vitest';
import { buildBackfillQueryOptions } from '../src/services/embeddingBackfill.js';

describe('buildBackfillQueryOptions', () => {
  it('targets only missing embeddings without offset in incremental mode', () => {
    expect(buildBackfillQueryOptions(25, true, 50)).toEqual({
      clause: 'WHERE embedding IS NULL',
      params: [25],
    });
  });

  it('uses offset-based batching when re-embedding all records', () => {
    expect(buildBackfillQueryOptions(25, false, 50)).toEqual({
      clause: '',
      params: [25, 50],
    });
  });
});
