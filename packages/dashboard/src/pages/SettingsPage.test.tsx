import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import SettingsPage from './SettingsPage';

const requestMock = vi.hoisted(() => vi.fn());
const useApiMock = vi.hoisted(() => vi.fn());
const useCompanyMock = vi.hoisted(() => vi.fn());
const useAuthMock = vi.hoisted(() => vi.fn());

vi.mock('../hooks/useApi', () => ({
  useApi: () => useApiMock(),
}));

vi.mock('../context/CompanyContext', () => ({
  useCompany: () => useCompanyMock(),
}));

vi.mock('../context/AuthContext', () => ({
  useAuth: () => useAuthMock(),
}));

describe('SettingsPage', () => {
  beforeEach(() => {
    requestMock.mockReset();
    useApiMock.mockReset();
    useCompanyMock.mockReset();
    useAuthMock.mockReset();

    useApiMock.mockReturnValue({
      request: requestMock,
      loading: false,
      error: null,
    });
    useCompanyMock.mockReturnValue({
      selectedCompany: { id: 'company-1', name: 'QA Test Corp', role: 'owner' },
      selectedCompanyId: 'company-1',
      companies: [{ id: 'company-1', name: 'QA Test Corp', role: 'owner' }],
    });
    useAuthMock.mockReturnValue({
      user: {
        full_name: 'Ada Lovelace',
        email: 'ada@example.com',
      },
    });
  });

  it('loads and saves runtime routing settings', async () => {
    requestMock
      .mockResolvedValueOnce({
        company_id: 'company-1',
        company_name: 'QA Test Corp',
        primary_runtime: 'gemini',
        fallback_order: ['gemini', 'claude', 'openai'],
        system_defaults: {
          primary_runtime: 'gemini',
          fallback_order: ['gemini', 'claude', 'openai'],
        },
        available_runtimes: ['gemini', 'claude', 'openai'],
      })
      .mockResolvedValueOnce({
        company_id: 'company-1',
        company_name: 'QA Test Corp',
        enabled: true,
        hour_utc: 18,
        minute_utc: 0,
        system_defaults: {
          enabled: true,
          hour_utc: 18,
          minute_utc: 0,
        },
      })
      .mockResolvedValueOnce({
        company_id: 'company-1',
        company_name: 'QA Test Corp',
        primary_runtime: 'openai',
        fallback_order: ['claude', 'openai', 'gemini'],
        system_defaults: {
          primary_runtime: 'gemini',
          fallback_order: ['gemini', 'claude', 'openai'],
        },
        available_runtimes: ['gemini', 'claude', 'openai'],
      })
      .mockResolvedValueOnce({
        company_id: 'company-1',
        company_name: 'QA Test Corp',
        enabled: false,
        hour_utc: 19,
        minute_utc: 15,
        system_defaults: {
          enabled: true,
          hour_utc: 18,
          minute_utc: 0,
        },
      });

    render(<SettingsPage />);

    await waitFor(() => {
      expect(requestMock).toHaveBeenCalledWith(
        '/companies/company-1/runtime-settings',
        undefined,
        { suppressError: true }
      );
      expect(requestMock).toHaveBeenCalledWith(
        '/companies/company-1/digest-settings',
        undefined,
        { suppressError: true }
      );
    });

    expect(screen.getByText('Primary runtime: Gemini')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Set openai as primary runtime' }));
    fireEvent.click(screen.getByRole('button', { name: 'Move openai up' }));
    fireEvent.click(screen.getByRole('button', { name: 'Move openai up' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save runtime settings' }));

    await waitFor(() => {
      expect(requestMock).toHaveBeenCalledWith(
        '/companies/company-1/runtime-settings',
        {
          method: 'PATCH',
          body: JSON.stringify({
            primary_runtime: 'openai',
            fallback_order: ['openai', 'gemini', 'claude'],
          }),
        }
      );
    });

    expect(screen.getByText('Runtime routing settings saved for this company.')).toBeTruthy();
    expect(screen.getByText('Primary runtime: OpenAI')).toBeTruthy();

    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.change(screen.getByDisplayValue('18'), {
      target: { value: '19' },
    });
    fireEvent.change(screen.getByDisplayValue('00'), {
      target: { value: '15' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save daily digest settings' }));

    await waitFor(() => {
      expect(requestMock).toHaveBeenCalledWith(
        '/companies/company-1/digest-settings',
        {
          method: 'PATCH',
          body: JSON.stringify({
            enabled: false,
            hour_utc: 19,
            minute_utc: 15,
          }),
        }
      );
    });

    expect(screen.getByText('Daily digest settings saved for this company.')).toBeTruthy();
    expect(screen.getByText('Digest disabled')).toBeTruthy();
  });
});
