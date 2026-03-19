import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CompanyProvider, useCompany } from './CompanyContext';
import { COMPANY_STORAGE_KEY } from '../lib/session';

const requestMock = vi.hoisted(() => vi.fn());
const useAuthMock = vi.hoisted(() => vi.fn());

vi.mock('../hooks/useApi', () => ({
  useApi: () => ({
    request: requestMock,
    error: null,
    loading: false,
  }),
}));

vi.mock('./AuthContext', () => ({
  useAuth: () => useAuthMock(),
}));

function wrapper({ children }: { children: React.ReactNode }) {
  return <CompanyProvider>{children}</CompanyProvider>;
}

describe('CompanyProvider', () => {
  beforeEach(() => {
    requestMock.mockReset();
    useAuthMock.mockReset();
    useAuthMock.mockReturnValue({
      isAuthenticated: true,
      loading: false,
    });
  });

  it('hydrates companies and keeps the stored company selection when it is still available', async () => {
    localStorage.setItem(COMPANY_STORAGE_KEY, 'company-2');
    requestMock.mockResolvedValue([
      { id: 'company-1', name: 'Alpha', role: 'admin' },
      { id: 'company-2', name: 'Beta', role: 'owner' },
    ]);

    const { result } = renderHook(() => useCompany(), { wrapper });

    await waitFor(() => {
      expect(result.current.companies).toHaveLength(2);
    });

    expect(result.current.companies).toHaveLength(2);
    expect(result.current.selectedCompanyId).toBe('company-2');
    expect(result.current.selectedCompany?.name).toBe('Beta');
    expect(localStorage.getItem(COMPANY_STORAGE_KEY)).toBe('company-2');
  });

  it('creates a company, assigns owner role locally, and switches the active company', async () => {
    requestMock
      .mockResolvedValueOnce([
        { id: 'company-1', name: 'Alpha', role: 'admin' },
      ])
      .mockResolvedValueOnce({
        id: 'company-2',
        name: 'Nova',
        mission: 'Launch fast',
      });

    const { result } = renderHook(() => useCompany(), { wrapper });

    await waitFor(() => {
      expect(result.current.selectedCompanyId).toBe('company-1');
    });

    await act(async () => {
      await result.current.createCompany({
        name: 'Nova',
        mission: 'Launch fast',
      });
    });

    expect(requestMock).toHaveBeenNthCalledWith(2, '/companies', {
      method: 'POST',
      body: JSON.stringify({
        name: 'Nova',
        mission: 'Launch fast',
      }),
    });
    expect(result.current.companies[0]).toMatchObject({
      id: 'company-2',
      name: 'Nova',
      mission: 'Launch fast',
      role: 'owner',
    });
    expect(result.current.selectedCompanyId).toBe('company-2');
    expect(result.current.selectedCompany?.name).toBe('Nova');
    expect(localStorage.getItem(COMPANY_STORAGE_KEY)).toBe('company-2');
  });
});
