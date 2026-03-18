import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import OrgChartPage from './OrgChartPage';

const requestMock = vi.hoisted(() => vi.fn());
const useApiMock = vi.hoisted(() => vi.fn());
const useCompanyMock = vi.hoisted(() => vi.fn());

vi.mock('../hooks/useApi', () => ({
  useApi: () => useApiMock(),
}));

vi.mock('../context/CompanyContext', () => ({
  useCompany: () => useCompanyMock(),
}));

describe('OrgChartPage', () => {
  beforeEach(() => {
    requestMock.mockReset();
    useApiMock.mockReset();
    useCompanyMock.mockReset();

    useApiMock.mockReturnValue({
      request: requestMock,
      loading: false,
      error: null,
    });
    useCompanyMock.mockReturnValue({
      selectedCompany: { id: 'company-1', name: 'QA Test Corp' },
      selectedCompanyId: 'company-1',
    });
  });

  it('renders reporting structure and aggregate metrics from the org chart payload', async () => {
    requestMock.mockResolvedValue([
      {
        id: 'agent-1',
        name: 'Ada',
        role: 'CEO',
        title: 'Chief Executive Officer',
        reports_to: null,
        status: 'working',
      },
      {
        id: 'agent-2',
        name: 'Ben',
        role: 'Manager',
        title: 'Engineering Manager',
        reports_to: 'agent-1',
        status: 'idle',
      },
      {
        id: 'agent-3',
        name: 'Cara',
        role: 'Engineer',
        title: 'Software Engineer',
        reports_to: 'agent-2',
        status: 'paused',
      },
      {
        id: 'agent-4',
        name: 'Dina',
        role: 'Designer',
        title: 'Product Designer',
        reports_to: 'agent-1',
        status: 'idle',
      },
    ]);

    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <OrgChartPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(requestMock).toHaveBeenCalledWith('/companies/company-1/org-chart');
    });

    expect(screen.getByRole('heading', { name: 'Org Chart' })).toBeTruthy();
    expect(screen.getByText('4')).toBeTruthy();
    expect(screen.getAllByText('2').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('3')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Ada' }).getAttribute('href')).toBe('/agents/agent-1');
    expect(screen.getByRole('link', { name: 'Cara' }).getAttribute('href')).toBe('/agents/agent-3');
    expect(screen.getByText('2 direct reports')).toBeTruthy();
    expect(screen.getByText('1 direct report')).toBeTruthy();
    expect(screen.getByText('top level')).toBeTruthy();
  });
});
