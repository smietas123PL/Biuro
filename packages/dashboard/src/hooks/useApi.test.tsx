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
      headers: new Headers({ 'x-trace-id': 'trace-auth-123' }),
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
    expect(result.current.lastTrace).toMatchObject({
      traceId: 'trace-auth-123',
      path: '/integrations/config',
      method: 'PATCH',
      status: 200,
    });
  });

  it('clears the local session after a 401 response', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ error: 'Unauthorized' }),
      headers: new Headers({ 'x-trace-id': 'trace-401' }),
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
    expect(result.current.lastTrace).toMatchObject({
      traceId: 'trace-401',
      status: 401,
    });
  });

  it('retries safe requests after transient network failures', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ ok: true, source: 'retry' }),
        headers: new Headers({ 'x-trace-id': 'trace-retry-2' }),
      });

    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useApi());

    let response: unknown = null;
    await act(async () => {
      response = await result.current.request('/companies');
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(response).toEqual({ ok: true, source: 'retry' });
    expect(result.current.error).toBeNull();
    expect(result.current.loading).toBe(false);
    expect(result.current.lastTrace?.traceId).toBe('trace-retry-2');
  });

  it('can skip trace tracking for internal observability requests', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true }),
      headers: new Headers({ 'x-trace-id': 'trace-hidden' }),
    });

    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useApi());

    await act(async () => {
      await result.current.request('/observability/traces/trace-hidden', undefined, {
        trackTrace: false,
      });
    });

    expect(result.current.lastTrace).toBeNull();
  });
});
