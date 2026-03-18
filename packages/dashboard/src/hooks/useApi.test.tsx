import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useApi } from './useApi';
import { AUTH_TOKEN_KEY, COMPANY_STORAGE_KEY } from '../lib/session';

describe('useApi', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('sends auth and company headers for authenticated JSON requests', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true }),
    });

    vi.stubGlobal('fetch', fetchMock);
    localStorage.setItem(AUTH_TOKEN_KEY, 'token-123');
    localStorage.setItem(COMPANY_STORAGE_KEY, 'company-7');

    const { result } = renderHook(() => useApi());

    await act(async () => {
      await result.current.request('/integrations/config', {
        method: 'PATCH',
        body: JSON.stringify({ slack_webhook_url: 'https://hooks.slack.test/services/abc' }),
      });
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/integrations/config',
      expect.objectContaining({
        method: 'PATCH',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          Authorization: 'Bearer token-123',
          'x-company-id': 'company-7',
        }),
      })
    );
    expect(result.current.error).toBeNull();
    expect(result.current.loading).toBe(false);
  });

  it('clears the local session after a 401 response', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ error: 'Unauthorized' }),
    });

    vi.stubGlobal('fetch', fetchMock);
    localStorage.setItem(AUTH_TOKEN_KEY, 'expired-token');
    localStorage.setItem(COMPANY_STORAGE_KEY, 'company-9');

    const { result } = renderHook(() => useApi());
    let thrownError: unknown = null;

    await act(async () => {
      try {
        await result.current.request('/companies');
      } catch (err) {
        thrownError = err;
      }
    });

    expect(thrownError).toBeInstanceOf(Error);
    expect((thrownError as Error).message).toBe('Unauthorized');

    expect(localStorage.getItem(AUTH_TOKEN_KEY)).toBeNull();
    expect(localStorage.getItem(COMPANY_STORAGE_KEY)).toBeNull();
    expect(result.current.error).toBe('Unauthorized');
    expect(result.current.loading).toBe(false);
  });
});
