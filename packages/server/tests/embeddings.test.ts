import { describe, expect, it } from 'vitest';
import { buildDeterministicEmbedding, toPgVector } from '../src/services/embeddings.js';

describe('buildDeterministicEmbedding', () => {
  it('returns a stable 1536-dim vector for the same input', () => {
    const first = buildDeterministicEmbedding('Product roadmap for warehouse SaaS');
    const second = buildDeterministicEmbedding('Product roadmap for warehouse SaaS');

    expect(first).toHaveLength(1536);
    expect(second).toHaveLength(1536);
    expect(first).toEqual(second);
  });

  it('returns different vectors for different text inputs', () => {
    const first = buildDeterministicEmbedding('Hire an operations lead');
    const second = buildDeterministicEmbedding('Create a backend migration');

    expect(first).not.toEqual(second);
  });
});

describe('toPgVector', () => {
  it('serializes vectors in pgvector literal format', () => {
    expect(toPgVector([0.1, -0.2, 0])).toBe('[0.1,-0.2,0]');
  });
});
