import { describe, expect, it } from 'vitest';
import { buildQueryPreview } from '../src/services/retrievalMetrics.js';

describe('buildQueryPreview', () => {
  it('collapses extra whitespace before returning the preview', () => {
    expect(buildQueryPreview('  roadmap    for   rag quality  ', 80)).toBe('roadmap for rag quality');
  });

  it('truncates long queries with an ASCII ellipsis', () => {
    expect(buildQueryPreview('abcdefghijklmnop', 10)).toBe('abcdefg...');
  });
});
