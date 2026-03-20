import { render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import DashboardPage from './DashboardPage';

const requestMock = vi.hoisted(() => vi.fn());
const useApiMock = vi.hoisted(() => vi.fn());
const useWebSocketMock = vi.hoisted(() => vi.fn());
const useCompanyMock = vi.hoisted(() => vi.fn());
const useAuthMock = vi.hoisted(() => vi.fn());
const useOnboardingMock = vi.hoisted(() => vi.fn());

vi.mock('../hooks/useApi', () => ({
  useApi: () => useApiMock(),
  useWebSocket: () => useWebSocketMock(),
}));

vi.mock('../context/CompanyContext', () => ({
  useCompany: () => useCompanyMock(),
}));

vi.mock('../context/AuthContext', () => ({
  useAuth: () => useAuthMock(),
}));

vi.mock('../context/OnboardingContext', () => ({
  useOnboarding: () => useOnboardingMock(),
}));

describe('DashboardPage', () => {
  beforeEach(() => {
    requestMock.mockReset();
    useApiMock.mockReset();
    useWebSocketMock.mockReset();
    useCompanyMock.mockReset();
    useAuthMock.mockReset();
    useOnboardingMock.mockReset();

    requestMock.mockImplementation(async (path: string) => {
      if (path === '/companies/company-1/stats') {
        return {
          agent_count: 4,
          active_agents: 2,
          idle_agents: 2,
          paused_agents: 0,
          task_count: 9,
          pending_tasks: 3,
          completed_tasks: 6,
          blocked_tasks: 0,
          goal_count: 4,
          pending_approvals: 1,
          daily_cost_usd: 12.5,
        };
      }

      if (path === '/companies/company-1/activity-feed?limit=20') {
        return [
          {
            id: 'heartbeat-1',
            type: 'heartbeat.worked',
            created_at: '2026-03-19T10:01:00.000Z',
            cost_usd: 0.42,
            agent_id: 'agent-1',
            agent_name: 'Ada',
            task_id: 'task-1',
            task_title: 'Investigate churn',
            thought:
              'We should verify retention cohorts before changing the headline.',
            summary:
              'We should verify retention cohorts before changing the headline.',
          },
        ];
      }

      if (path === '/companies/company-1/budgets-summary') {
        return {
          totals: {
            limit_usd: 40,
            spent_usd: 12.5,
            remaining_usd: 27.5,
            utilization_pct: 31.25,
          },
        };
      }

      if (path === '/companies/company-1/retrieval-metrics?days=7') {
        return {
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
      }

      if (path === '/companies/company-1/memory-insights?days=30') {
        return {
          range_days: 30,
          summary: {
            total_memories: 9,
            recent_memories: 3,
            agents_with_memories: 2,
            tasks_with_memories: 3,
            memory_reuse_searches: 4,
          },
          recurring_topics: [
            {
              label: 'retention cohorts',
              count: 2,
            },
          ],
          top_agents: [
            {
              agent_id: 'agent-1',
              agent_name: 'Ada',
              total_memories: 2,
              latest_memory_at: '2026-03-19T10:01:00.000Z',
            },
          ],
          revisited_queries: [
            {
              query: 'retention cohorts',
              total: 3,
            },
          ],
          recent_lessons: [
            {
              id: 'memory-1',
              content:
                'Retention cohorts are more predictive than signup totals for this segment.',
              created_at: '2026-03-19T09:58:00.000Z',
              agent_id: 'agent-1',
              agent_name: 'Ada',
              task_id: 'task-1',
              task_title: 'Investigate churn',
            },
          ],
        };
      }

      if (path === '/observability/traces/trace-1234abcd') {
        return {
          trace_id: 'trace-1234abcd',
          service: 'biuro-api',
          summary: {
            span_count: 3,
            started_at: '2026-03-19T10:00:00.000Z',
            ended_at: '2026-03-19T10:00:01.000Z',
            duration_ms: 108.4,
          },
          items: [
            {
              span_id: 'span-root',
              name: 'http.get',
              duration_ms: 108.4,
              status_code: '1',
              start_time: '2026-03-19T10:00:00.000Z',
              attributes: {
                'http.route': '/api/companies/:id/stats',
              },
            },
            {
              span_id: 'span-worker',
              parent_span_id: 'span-root',
              name: 'worker.heartbeat',
              duration_ms: 34.2,
              status_code: '1',
              start_time: '2026-03-19T10:00:00.100Z',
              attributes: {
                'heartbeat.status': 'worked',
                'task.id': 'task-1',
              },
            },
          ],
        };
      }

      throw new Error(`Unexpected request path: ${path}`);
    });

    useApiMock.mockReturnValue({
      request: requestMock,
      loading: false,
      error: null,
      lastTrace: {
        traceId: 'trace-1234abcd',
        path: '/companies/company-1/stats',
        method: 'GET',
        status: 200,
        capturedAt: '2026-03-19T10:00:00.000Z',
      },
    });
    useWebSocketMock.mockReturnValue(null);

    useCompanyMock.mockReturnValue({
      selectedCompany: {
        id: 'company-1',
        name: 'Biuro Labs',
      },
      selectedCompanyId: 'company-1',
    });
    useAuthMock.mockReturnValue({
      user: {
        id: 'user-1',
        email: 'ada@example.com',
        full_name: 'Ada Lovelace',
      },
    });
    useOnboardingMock.mockReturnValue({
      hasCompleted: true,
      startTutorial: vi.fn(),
      status: 'idle',
    });
  });

  it('shows the latest trace drilldown alongside the live operations stream', async () => {
    render(
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(requestMock).toHaveBeenCalledWith('/companies/company-1/stats');
      expect(requestMock).toHaveBeenCalledWith(
        '/companies/company-1/budgets-summary',
        undefined,
        {
          suppressError: true,
          trackTrace: false,
        }
      );
      expect(requestMock).toHaveBeenCalledWith(
        '/observability/traces/trace-1234abcd',
        undefined,
        {
          suppressError: true,
          trackTrace: false,
        }
      );
    });

    expect(screen.getByText('Trace Drilldown')).toBeTruthy();
    expect(screen.getByText('Live Cost Ticker')).toBeTruthy();
    expect(screen.getByText('Budget Gauge')).toBeTruthy();
    const thoughtSection = screen
      .getByText('Live Operations Stream')
      .closest(
        'div.rounded-2xl.border.bg-card.p-6.shadow-sm'
      ) as HTMLElement | null;
    if (!thoughtSection) {
      throw new Error('Expected Live Operations Stream section');
    }
    const thoughtPanel = within(thoughtSection);
    expect(thoughtPanel.getByText('Live Operations Stream')).toBeTruthy();
    expect(thoughtPanel.getByRole('button', { name: 'All' })).toBeTruthy();
    expect(thoughtPanel.getByRole('button', { name: 'Thoughts' })).toBeTruthy();
    expect(thoughtPanel.getByRole('button', { name: 'Actions' })).toBeTruthy();
    expect(thoughtPanel.getByRole('button', { name: 'Errors' })).toBeTruthy();
    expect(
      thoughtPanel.getByText(
        'We should verify retention cohorts before changing the headline.'
      )
    ).toBeTruthy();
    expect(thoughtPanel.getByText('Ada')).toBeTruthy();
    expect(
      thoughtPanel.getByRole('link', { name: 'View Task' }).getAttribute('href')
    ).toContain('/tasks/task-1');
    expect(
      thoughtPanel
        .getByRole('link', { name: 'Agent Profile' })
        .getAttribute('href')
    ).toContain('/agents/agent-1');
    expect(screen.getByText('$12.5000 today')).toBeTruthy();
    expect(screen.getByText('$27.50 remaining')).toBeTruthy();
    expect(screen.getByText('Operations Snapshot')).toBeTruthy();
    expect(screen.getByText('What To Watch')).toBeTruthy();
    expect(screen.getByText(/Latest trace/)).toBeTruthy();
    expect(screen.getByText('http.get')).toBeTruthy();
    expect(screen.getByText('worker.heartbeat')).toBeTruthy();
    expect(screen.getByText(/3 spans across 108 ms/)).toBeTruthy();
    const grafanaLink = screen.getByRole('link', { name: 'Open in Grafana' });
    expect(grafanaLink.getAttribute('href')).toContain('trace-1234abcd');
    expect(grafanaLink.getAttribute('href')).toContain('/explore?');
  });

  it('updates the live thought stream when an agent.thought websocket event arrives', async () => {
    useWebSocketMock.mockReturnValue({
      event: 'agent.thought',
      timestamp: '2026-03-19T10:02:00.000Z',
      data: {
        agent_id: 'agent-2',
        agent_name: 'Ben',
        task_id: 'task-2',
        task_title: 'Polish onboarding',
        thought: 'The current friction is around the second confirmation step.',
      },
    });

    render(
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>
    );

    expect(screen.getByText('Live Operations Stream')).toBeTruthy();

    await waitFor(() => {
      expect(
        screen.getByText(
          'The current friction is around the second confirmation step.'
        )
      ).toBeTruthy();
      expect(screen.getByText('Ben')).toBeTruthy();
      expect(
        screen.getByRole('link', { name: 'View Task' }).getAttribute('href')
      ).toContain('/tasks/task-2');
    });
  });
});
