import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import DigitalTwinPage from './DigitalTwinPage';

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

describe('DigitalTwinPage', () => {
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
    useWebSocketMock.mockReturnValue({
      event: 'agent.working',
      data: {
        agentId: 'agent-2',
        agentName: 'Ben',
        taskId: 'task-2',
        taskTitle: 'Ship launch brief',
      },
      timestamp: '2026-03-20T20:15:00.000Z',
    });

    requestMock.mockImplementation((path: string) => {
      if (path === '/companies/company-1/agents') {
        return Promise.resolve([
          {
            id: 'agent-1',
            name: 'Ada',
            role: 'CEO',
            title: 'Chief Executive Officer',
            reports_to: null,
            runtime: 'claude',
            monthly_budget_usd: 100,
            status: 'working',
          },
          {
            id: 'agent-2',
            name: 'Ben',
            role: 'Manager',
            title: 'Engineering Manager',
            reports_to: 'agent-1',
            runtime: 'openai',
            monthly_budget_usd: 50,
            status: 'idle',
          },
          {
            id: 'agent-3',
            name: 'Cara',
            role: 'Engineer',
            title: 'Software Engineer',
            reports_to: 'agent-2',
            runtime: 'gemini',
            status: 'paused',
          },
        ]);
      }

      if (path === '/companies/company-1/tasks') {
        return Promise.resolve([
          {
            id: 'task-1',
            title: 'Audit onboarding flow',
            description: 'Review the current setup path.',
            assigned_to: 'agent-1',
            priority: 80,
            status: 'in_progress',
            created_at: '2026-03-20T08:00:00.000Z',
          },
          {
            id: 'task-2',
            title: 'Ship launch brief',
            description: 'Prepare the launch package.',
            assigned_to: 'agent-2',
            priority: 70,
            status: 'assigned',
            created_at: '2026-03-20T09:00:00.000Z',
          },
        ]);
      }

      if (path === '/companies/company-1/activity-feed?limit=30') {
        return Promise.resolve([
          {
            id: 'heartbeat-1',
            type: 'heartbeat.worked',
            created_at: '2026-03-20T19:58:00.000Z',
            cost_usd: 0.42,
            agent_id: 'agent-1',
            agent_name: 'Ada',
            task_id: 'task-1',
            task_title: 'Audit onboarding flow',
            thought: 'I found the main leak in the signup handoff.',
            summary: 'I found the main leak in the signup handoff.',
          },
        ]);
      }

      if (path === '/companies/company-1/stats') {
        return Promise.resolve({
          agent_count: 3,
          active_agents: 1,
          idle_agents: 1,
          paused_agents: 1,
          task_count: 2,
          pending_tasks: 2,
          completed_tasks: 0,
          blocked_tasks: 0,
          goal_count: 1,
          pending_approvals: 0,
          daily_cost_usd: 1.23,
        });
      }

      if (path === '/companies/company-1/budgets-summary') {
        return Promise.resolve({
          totals: {
            limit_usd: 150,
            spent_usd: 70,
            remaining_usd: 80,
            utilization_pct: 46.6,
          },
        });
      }

      throw new Error(`Unexpected request path: ${path}`);
    });
  });

  it('renders the digital twin graph and opens the agent inspector', async () => {
    render(
      <MemoryRouter>
        <DigitalTwinPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(requestMock).toHaveBeenCalledWith('/companies/company-1/agents');
      expect(requestMock).toHaveBeenCalledWith('/companies/company-1/tasks');
      expect(requestMock).toHaveBeenCalledWith(
        '/companies/company-1/activity-feed?limit=30',
        undefined,
        { suppressError: true }
      );
      expect(requestMock).toHaveBeenCalledWith(
        '/companies/company-1/stats',
        undefined,
        { suppressError: true, trackTrace: false }
      );
      expect(requestMock).toHaveBeenCalledWith(
        '/companies/company-1/budgets-summary',
        undefined,
        { suppressError: true, trackTrace: false }
      );
    });

    expect(screen.getByRole('heading', { name: 'Digital Twin' })).toBeTruthy();
    expect(screen.getByText('Twin Mesh')).toBeTruthy();
    expect(screen.getByText('Command Mesh')).toBeTruthy();
    expect(screen.getByText('Memory Fabric')).toBeTruthy();
    expect(screen.getByText('Budget Rail')).toBeTruthy();
    expect(screen.getAllByText('Ship launch brief').length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('button', { name: 'Inspect agent Ben' }));

    expect(screen.getAllByText('Engineering Manager').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Ship launch brief').length).toBeGreaterThan(0);
    expect(
      screen.getByRole('link', { name: 'Open agent profile' }).getAttribute('href')
    ).toBe('/agents/agent-2');
  });
});
