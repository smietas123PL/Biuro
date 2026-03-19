import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import DashboardPage from './DashboardPage';

const requestMock = vi.hoisted(() => vi.fn());
const useApiMock = vi.hoisted(() => vi.fn());
const useCompanyMock = vi.hoisted(() => vi.fn());

vi.mock('../hooks/useApi', () => ({
  useApi: () => useApiMock(),
  useWebSocket: () => null,
}));

vi.mock('../context/CompanyContext', () => ({
  useCompany: () => useCompanyMock(),
}));

describe('DashboardPage', () => {
  beforeEach(() => {
    requestMock.mockReset();
    useApiMock.mockReset();
    useCompanyMock.mockReset();

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

      if (path === '/companies/company-1/activity-feed?limit=12') {
        return [];
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

    useCompanyMock.mockReturnValue({
      selectedCompany: {
        id: 'company-1',
        name: 'Biuro Labs',
      },
      selectedCompanyId: 'company-1',
    });
  });

  it('shows a trace drilldown card for the latest API trace', async () => {
    render(
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(requestMock).toHaveBeenCalledWith('/companies/company-1/stats');
      expect(requestMock).toHaveBeenCalledWith('/companies/company-1/budgets-summary', undefined, {
        suppressError: true,
        trackTrace: false,
      });
      expect(requestMock).toHaveBeenCalledWith('/observability/traces/trace-1234abcd', undefined, {
        suppressError: true,
        trackTrace: false,
      });
    });

    expect(screen.getByText('Trace Drilldown')).toBeTruthy();
    expect(screen.getByText('Live Cost Ticker')).toBeTruthy();
    expect(screen.getByText('Budget Gauge')).toBeTruthy();
    expect(screen.getByText('$12.5000 today')).toBeTruthy();
    expect(screen.getByText('$27.50 remaining')).toBeTruthy();
    expect(screen.getByText(/Latest trace/)).toBeTruthy();
    expect(screen.getByText('http.get')).toBeTruthy();
    expect(screen.getByText('worker.heartbeat')).toBeTruthy();
    expect(screen.getByText(/3 spans across 108 ms/)).toBeTruthy();
    const grafanaLink = screen.getByRole('link', { name: 'Open in Grafana' });
    expect(grafanaLink.getAttribute('href')).toContain('trace-1234abcd');
    expect(grafanaLink.getAttribute('href')).toContain('/explore?');
  });
});
