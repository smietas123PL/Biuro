import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import BudgetsPage from './BudgetsPage';

const requestMock = vi.hoisted(() => vi.fn());
const useApiMock = vi.hoisted(() => vi.fn());
const useCompanyMock = vi.hoisted(() => vi.fn());
const useWebSocketMock = vi.hoisted(() => vi.fn());

vi.mock('../hooks/useApi', () => ({
  useApi: () => useApiMock(),
  useWebSocket: () => useWebSocketMock(),
}));

vi.mock('../context/CompanyContext', () => ({
  useCompany: () => useCompanyMock(),
}));

describe('BudgetsPage', () => {
  beforeEach(() => {
    requestMock.mockReset();
    useApiMock.mockReset();
    useCompanyMock.mockReset();
    useWebSocketMock.mockReset();

    requestMock.mockResolvedValue({
      balance_usd: 250,
      totals: {
        limit_usd: 40,
        spent_usd: 32,
        remaining_usd: 8,
        utilization_pct: 80,
        forecast: {
          avg_daily_spend_usd: 2,
          days_in_month: 31,
          current_day: 19,
          remaining_days: 12,
          projected_month_spend_usd: 42,
          projected_over_limit_usd: 2,
        },
      },
      daily_spend: [
        { day: '2026-03-18', total_usd: 4 },
      ],
      agents: [
        {
          id: 'agent-1',
          name: 'Ada',
          role: 'research',
          title: 'Research Lead',
          runtime: 'openai',
          status: 'working',
          configured_limit_usd: 20,
          limit_usd: 20,
          spent_usd: 19,
          remaining_usd: 1,
          utilization_pct: 95,
          last_7d_spend_usd: 6,
          forecast: {
            avg_daily_spend_usd: 1,
            days_in_month: 31,
            current_day: 19,
            remaining_days: 12,
            projected_month_spend_usd: 21,
            projected_over_limit_usd: 1,
          },
        },
      ],
    });

    useApiMock.mockReturnValue({
      request: requestMock,
      loading: false,
      error: null,
    });
    useCompanyMock.mockReturnValue({
      selectedCompany: { id: 'company-1', name: 'Biuro Labs' },
      selectedCompanyId: 'company-1',
    });
    useWebSocketMock.mockReturnValue({
      event: 'budget.threshold',
      data: {
        tone: 'critical',
        threshold_pct: 95,
        message: 'Ada reached 95% of monthly budget.',
      },
      timestamp: '2026-03-19T10:00:00.000Z',
    });
  });

  it('shows the live company budget gauge and threshold toast', async () => {
    render(
      <MemoryRouter>
        <BudgetsPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(requestMock).toHaveBeenCalledWith('/companies/company-1/budgets-summary', undefined, {
        suppressError: true,
        trackTrace: false,
      });
    });

    expect(screen.getByText('Live Budget Mode')).toBeTruthy();
    expect(screen.getByText('Company Budget Gauge')).toBeTruthy();
    expect(screen.getAllByText('80%').length).toBeGreaterThan(0);
    expect(screen.getByText('$8.00 remaining')).toBeTruthy();
    expect(screen.getByText('Budget alert')).toBeTruthy();
    expect(screen.getByText('Ada reached 95% of monthly budget.')).toBeTruthy();
    expect(screen.getByText('95% used')).toBeTruthy();
  });
});
