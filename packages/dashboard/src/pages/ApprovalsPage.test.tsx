import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ApprovalsPage from './ApprovalsPage';

const requestMock = vi.hoisted(() => vi.fn());
const useApiMock = vi.hoisted(() => vi.fn());
const useCompanyMock = vi.hoisted(() => vi.fn());

vi.mock('../hooks/useApi', () => ({
  useApi: () => useApiMock(),
}));

vi.mock('../context/CompanyContext', () => ({
  useCompany: () => useCompanyMock(),
}));

describe('ApprovalsPage', () => {
  beforeEach(() => {
    requestMock.mockReset();
    useApiMock.mockReset();
    useCompanyMock.mockReset();

    useApiMock.mockReturnValue({
      request: requestMock,
      loading: false,
      error: null,
    });
  });

  it('shows an empty state when no company is selected', () => {
    useCompanyMock.mockReturnValue({
      selectedCompany: null,
      selectedCompanyId: null,
    });

    render(<ApprovalsPage />);

    expect(
      screen.getByText('Choose a company to review approvals.')
    ).toBeTruthy();
    expect(requestMock).not.toHaveBeenCalled();
  });

  it('loads pending approvals and resolves one through the queue', async () => {
    useCompanyMock.mockReturnValue({
      selectedCompany: { id: 'company-1', name: 'QA Test Corp' },
      selectedCompanyId: 'company-1',
    });

    requestMock
      .mockResolvedValueOnce([
        {
          id: 'approval-1',
          status: 'pending',
          reason: 'Approve production deployment',
          payload: { environment: 'prod', version: '2026.03.20' },
          requested_by_agent: 'Ada',
        },
        {
          id: 'approval-2',
          status: 'approved',
          reason: 'Already handled',
          payload: { environment: 'staging' },
          requested_by_agent: null,
        },
      ])
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce([]);

    render(<ApprovalsPage />);

    expect(
      await screen.findByText('Pending approvals for QA Test Corp')
    ).toBeTruthy();
    expect(await screen.findByText('Approve production deployment')).toBeTruthy();
    expect(screen.getByText('Requested by: Ada')).toBeTruthy();
    expect(screen.queryByText('Already handled')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));

    await waitFor(() => {
      expect(requestMock).toHaveBeenCalledWith(
        '/approvals/approval-1/resolve',
        {
          method: 'POST',
          body: JSON.stringify({
            status: 'approved',
            notes: 'Resolved via Dashboard',
          }),
        }
      );
    });

    expect(
      await screen.findByText('No pending approvals. Governance is silent.')
    ).toBeTruthy();
  });

  it('shows the quiet state when the selected company has no pending approvals', async () => {
    useCompanyMock.mockReturnValue({
      selectedCompany: { id: 'company-1', name: 'QA Test Corp' },
      selectedCompanyId: 'company-1',
    });

    requestMock.mockResolvedValueOnce([
      {
        id: 'approval-1',
        status: 'approved',
        reason: 'Resolved earlier',
        payload: { environment: 'prod' },
        requested_by_agent: null,
      },
    ]);

    render(<ApprovalsPage />);

    expect(
      await screen.findByText('No pending approvals. Governance is silent.')
    ).toBeTruthy();
    expect(screen.queryByText('Resolved earlier')).toBeNull();
  });
});
