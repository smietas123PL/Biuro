import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  RetrievalInsights,
  type RetrievalMetricsSummary,
} from './RetrievalInsights';

const populatedMetrics: RetrievalMetricsSummary = {
  range_days: 7,
  totals: {
    searches: 14,
    knowledge_searches: 8,
    memory_searches: 6,
    avg_latency_ms: 127.4,
    avg_result_count: 4.2,
    avg_overlap_count: 1.4,
    zero_result_rate_pct: 7.1,
  },
  by_source: [
    { embedding_source: 'knowledge_base', total: 8 },
    { embedding_source: 'memory_store', total: 4 },
    { embedding_source: 'faq_cache', total: 2 },
  ],
  by_consumer: [
    { consumer: 'task_planner', total: 7 },
    { consumer: 'heartbeat_worker', total: 5 },
    { consumer: 'approval_router', total: 2 },
  ],
  recent: [
    {
      scope: 'company',
      consumer: 'task_planner',
      result_count: 6,
      overlap_count: 2,
      top_distance: 0.123,
      embedding_source: 'knowledge_base',
      created_at: '2026-03-19T09:00:00.000Z',
    },
  ],
};

const emptyMetrics: RetrievalMetricsSummary = {
  range_days: 7,
  totals: {
    searches: 0,
    knowledge_searches: 0,
    memory_searches: 0,
    avg_latency_ms: 0,
    avg_result_count: 0,
    avg_overlap_count: 0,
    zero_result_rate_pct: 0,
  },
  by_source: [],
  by_consumer: [],
  recent: [],
};

describe('RetrievalInsights', () => {
  it('renders retrieval quality summaries and recent activity', () => {
    render(<RetrievalInsights metrics={populatedMetrics} />);

    expect(screen.getByText('Retrieval Quality')).toBeTruthy();
    expect(screen.getByText('14 searches')).toBeTruthy();
    expect(screen.getByText('7.1%')).toBeTruthy();
    expect(screen.getByText('127ms')).toBeTruthy();
    expect(screen.getByText('knowledge_base')).toBeTruthy();
    expect(screen.getByText('task planner')).toBeTruthy();
    expect(screen.getByText('Recent Retrievals')).toBeTruthy();
    expect(screen.getByText('company - task planner')).toBeTruthy();
    expect(
      screen.getByText(
        '6 results, overlap 2, source knowledge_base, top distance 0.123'
      )
    ).toBeTruthy();
  });

  it('shows empty states when there is no retrieval history', () => {
    render(<RetrievalInsights metrics={emptyMetrics} />);

    expect(screen.getByText('No retrieval data yet.')).toBeTruthy();
    expect(
      screen.getByText('No active retrieval consumers yet.')
    ).toBeTruthy();
    expect(
      screen.getByText(
        'Retrieval metrics will appear after the first knowledge or memory lookups.'
      )
    ).toBeTruthy();
  });

  it('renders nothing when metrics are unavailable', () => {
    const { container } = render(<RetrievalInsights metrics={null} />);

    expect(container.textContent).toBe('');
  });
});
