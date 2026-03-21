import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import OrgChartPage from './OrgChartPage';

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

const orgChartPayload = [
  {
    id: 'agent-1',
    name: 'Ada',
    role: 'CEO',
    title: 'Chief Executive Officer',
    reports_to: null,
    status: 'working',
    runtime: 'claude',
    model: 'claude-3-7-sonnet',
  },
  {
    id: 'agent-2',
    name: 'Ben',
    role: 'Manager',
    title: 'Engineering Manager',
    reports_to: 'agent-1',
    status: 'idle',
    runtime: 'openai',
    model: 'gpt-5.4',
  },
  {
    id: 'agent-3',
    name: 'Cara',
    role: 'Engineer',
    title: 'Software Engineer',
    reports_to: 'agent-2',
    status: 'paused',
    runtime: 'gemini',
    model: 'gemini-2.5-flash',
  },
  {
    id: 'agent-4',
    name: 'Dina',
    role: 'Designer',
    title: 'Product Designer',
    reports_to: 'agent-1',
    status: 'idle',
  },
];

const activityPayload = [
  {
    id: 'heartbeat-1',
    type: 'heartbeat.worked',
    created_at: '2026-03-19T09:58:00.000Z',
    cost_usd: 1.42,
    agent_id: 'agent-2',
    task_id: 'task-77',
    task_title: 'Fix onboarding bugs',
    thought: 'Triaged the top issue and isolated the regression.',
    summary: 'Triaged the top issue and isolated the regression.',
  },
];

describe('OrgChartPage', () => {
  beforeEach(() => {
    requestMock.mockReset();
    useApiMock.mockReset();
    useCompanyMock.mockReset();
    useWebSocketMock.mockReset();

    useApiMock.mockReturnValue({
      request: requestMock,
      loading: false,
      error: null,
    });
    useCompanyMock.mockReturnValue({
      selectedCompany: { id: 'company-1', name: 'QA Test Corp', role: 'admin' },
      selectedCompanyId: 'company-1',
    });
    useWebSocketMock.mockReturnValue(null);
  });

  it('renders the live org chart and opens an agent sidepanel with detail', async () => {
    requestMock.mockImplementation((path: string) => {
      if (path === '/companies/company-1/org-chart') {
        return Promise.resolve(orgChartPayload);
      }
      if (path === '/companies/company-1/activity-feed?limit=24') {
        return Promise.resolve(activityPayload);
      }
      if (path === '/agents/agent-2') {
        return Promise.resolve(orgChartPayload[1]);
      }
      if (path === '/agents/agent-2/heartbeats') {
        return Promise.resolve([
          {
            status: 'worked',
            timestamp: '2026-03-19T09:58:00.000Z',
            duration_ms: 4200,
            cost_usd: 1.42,
            details: {
              thought: 'Triaged the top issue and isolated the regression.',
            },
          },
        ]);
      }
      if (path === '/agents/agent-2/budgets') {
        return Promise.resolve([
          {
            agent_id: 'agent-2',
            month: '2026-03-01',
            limit_usd: 100,
            spent_usd: 34.5,
            created_at: '2026-03-01T00:00:00.000Z',
          },
        ]);
      }

      throw new Error(`Unexpected request: ${path}`);
    });

    render(
      <MemoryRouter
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
      >
        <OrgChartPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(requestMock).toHaveBeenCalledWith(
        '/companies/company-1/org-chart'
      );
      expect(requestMock).toHaveBeenCalledWith(
        '/companies/company-1/activity-feed?limit=24',
        undefined,
        {
          suppressError: true,
        }
      );
    });

    expect(screen.getByRole('heading', { name: 'Org Chart' })).toBeTruthy();
    expect(screen.getByText('Live Reporting Map')).toBeTruthy();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Inspect Ada' })).toBeTruthy();
      expect(screen.getByText('2 direct reports')).toBeTruthy();
      expect(screen.getByText('1 direct report')).toBeTruthy();
      expect(screen.getByText('top level')).toBeTruthy();
      expect(screen.getByText('Fix onboarding bugs')).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Inspect Ben' }));

    await waitFor(() => {
      expect(requestMock).toHaveBeenCalledWith('/agents/agent-2');
      expect(requestMock).toHaveBeenCalledWith(
        '/agents/agent-2/heartbeats',
        undefined,
        {
          suppressError: true,
        }
      );
      expect(requestMock).toHaveBeenCalledWith(
        '/agents/agent-2/budgets',
        undefined,
        {
          suppressError: true,
        }
      );
    });

    const sidepanel = within(
      screen.getByText('Command Sidepanel').closest('aside') as HTMLElement
    );
    expect(sidepanel.getByText('Engineering Manager')).toBeTruthy();
    expect(
      sidepanel.getAllByText(
        'Triaged the top issue and isolated the regression.'
      ).length
    ).toBeGreaterThan(0);
    expect(sidepanel.getByText('$34.50 / $100.00')).toBeTruthy();
    expect(
      sidepanel.getByRole('link', { name: 'Open task' }).getAttribute('href')
    ).toBe('/tasks/task-77');
    expect(sidepanel.getByRole('button', { name: 'Pause agent' })).toBeTruthy();
  });

  it('shows an empty state when no company is selected', () => {
    useCompanyMock.mockReturnValue({
      selectedCompany: null,
      selectedCompanyId: null,
    });

    render(
      <MemoryRouter
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
      >
        <OrgChartPage />
      </MemoryRouter>
    );

    expect(
      screen.getByText('Choose a company to view its reporting structure.')
    ).toBeTruthy();
    expect(requestMock).not.toHaveBeenCalled();
  });

  it('reflects a live working event and allows pausing the selected agent', async () => {
    const liveTimestamp = new Date().toISOString();

    useWebSocketMock.mockReturnValue({
      event: 'agent.working',
      data: {
        agentId: 'agent-2',
        taskId: 'task-88',
        taskTitle: 'Triage production queue',
      },
      timestamp: liveTimestamp,
    });

    requestMock.mockImplementation((path: string, init?: RequestInit) => {
      if (path === '/companies/company-1/org-chart') {
        return Promise.resolve(orgChartPayload);
      }
      if (path === '/companies/company-1/activity-feed?limit=24') {
        return Promise.resolve(activityPayload);
      }
      if (path === '/agents/agent-2') {
        return Promise.resolve(orgChartPayload[1]);
      }
      if (path === '/agents/agent-2/heartbeats') {
        return Promise.resolve([]);
      }
      if (path === '/agents/agent-2/budgets') {
        return Promise.resolve([]);
      }
      if (path === '/agents/agent-2/pause' && init?.method === 'POST') {
        return Promise.resolve({ ok: true });
      }

      throw new Error(`Unexpected request: ${path}`);
    });

    render(
      <MemoryRouter
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
      >
        <OrgChartPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getAllByText('Working').length).toBeGreaterThan(0);
    });

    fireEvent.click(screen.getByRole('button', { name: 'Inspect Ben' }));

    await waitFor(() => {
      const sidepanel = within(
        screen.getByText('Command Sidepanel').closest('aside') as HTMLElement
      );
      expect(sidepanel.getByText('Triage production queue')).toBeTruthy();
      expect(sidepanel.getByText('Working')).toBeTruthy();
      expect(
        sidepanel.getByRole('button', { name: 'Pause agent' })
      ).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Pause agent' }));

    await waitFor(() => {
      expect(requestMock).toHaveBeenCalledWith('/agents/agent-2/pause', {
        method: 'POST',
      });
    });

    const sidepanel = within(
      screen.getByText('Command Sidepanel').closest('aside') as HTMLElement
    );
    expect(sidepanel.getByText('Paused')).toBeTruthy();
    expect(
      sidepanel.getByRole('button', { name: 'Resume agent' })
    ).toBeTruthy();
  });
});
