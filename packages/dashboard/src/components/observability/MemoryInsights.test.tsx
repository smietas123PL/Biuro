import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import {
  MemoryInsights,
  type MemoryInsightsSummary,
} from './MemoryInsights';

const populatedInsights: MemoryInsightsSummary = {
  range_days: 30,
  summary: {
    total_memories: 18,
    recent_memories: 4,
    agents_with_memories: 3,
    tasks_with_memories: 5,
    memory_reuse_searches: 9,
  },
  recurring_topics: [
    { label: 'retention cohorts', count: 3 },
    { label: 'pricing objections', count: 2 },
  ],
  top_agents: [
    {
      agent_id: 'agent-1',
      agent_name: 'Ada',
      total_memories: 7,
      latest_memory_at: '2026-03-19T09:15:00.000Z',
    },
  ],
  revisited_queries: [
    { query: 'retention cohorts', total: 5 },
    { query: 'pricing objections', total: 2 },
  ],
  recent_lessons: [
    {
      id: 'lesson-1',
      content: 'Retention cohorts predict churn better than signup totals.',
      created_at: '2026-03-19T10:00:00.000Z',
      agent_id: 'agent-1',
      agent_name: 'Ada',
      task_id: 'task-1',
      task_title: 'Investigate churn',
    },
    {
      id: 'lesson-2',
      content: 'Legal review should happen before outbound pricing changes.',
      created_at: '2026-03-18T10:00:00.000Z',
      agent_id: 'agent-2',
      agent_name: 'Ben',
      task_id: null,
      task_title: null,
    },
  ],
};

const emptyInsights: MemoryInsightsSummary = {
  range_days: 30,
  summary: {
    total_memories: 0,
    recent_memories: 0,
    agents_with_memories: 0,
    tasks_with_memories: 0,
    memory_reuse_searches: 0,
  },
  recurring_topics: [],
  top_agents: [],
  revisited_queries: [],
  recent_lessons: [],
};

describe('MemoryInsights', () => {
  it('renders summary groups, revisited questions, and lesson links', () => {
    render(
      <MemoryRouter>
        <MemoryInsights insights={populatedInsights} />
      </MemoryRouter>
    );

    expect(screen.getByText('Memory Insights')).toBeTruthy();
    expect(screen.getByText('4 new lessons')).toBeTruthy();
    expect(screen.getByText('Recurring lessons')).toBeTruthy();
    expect(screen.getByText('Top learning agents')).toBeTruthy();
    expect(screen.getAllByText('retention cohorts').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Ada').length).toBeGreaterThan(0);
    expect(screen.getByText('Most revisited questions')).toBeTruthy();
    expect(
      screen.getByText(
        'Retention cohorts predict churn better than signup totals.'
      )
    ).toBeTruthy();
    expect(screen.getByText('No linked task')).toBeTruthy();
    expect(
      screen.getAllByRole('link', { name: 'Open agent' })[0].getAttribute(
        'href'
      )
    ).toBe('/agents/agent-1');
    expect(
      screen.getByRole('link', { name: 'Open task' }).getAttribute('href')
    ).toBe('/tasks/task-1');
  });

  it('shows empty states when there is no stored memory yet', () => {
    render(
      <MemoryRouter>
        <MemoryInsights insights={emptyInsights} />
      </MemoryRouter>
    );

    expect(
      screen.getByText(
        'Recurring themes will appear after several similar memories are stored.'
      )
    ).toBeTruthy();
    expect(
      screen.getByText('No agents have stored memory in this window yet.')
    ).toBeTruthy();
    expect(
      screen.getByText(
        'Memory reuse patterns will show up here after agents start querying history.'
      )
    ).toBeTruthy();
    expect(
      screen.getByText(
        'Memory lessons will appear here after agents store their first experience.'
      )
    ).toBeTruthy();
  });

  it('renders nothing when insights are unavailable', () => {
    const { container } = render(
      <MemoryRouter>
        <MemoryInsights insights={null} />
      </MemoryRouter>
    );

    expect(container.textContent).toBe('');
  });
});
