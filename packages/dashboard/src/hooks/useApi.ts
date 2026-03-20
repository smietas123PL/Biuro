import { useState, useEffect, useCallback, useRef } from 'react';
import type { ApiTraceSnapshot } from '@biuro/shared';
import {
  AUTH_EVENT,
  clearAuthToken,
  getAuthToken,
  getCsrfToken,
  getSelectedCompanyId,
} from '../lib/session';

const API_BASE = '/api';
const DEFAULT_RETRY_DELAY_MS = 350;

type RequestConfig = {
  suppressError?: boolean;
  retries?: number;
  retryDelayMs?: number;
  trackTrace?: boolean;
};

export type { ApiTraceSnapshot } from '@biuro/shared';

function isSafeToRetry(method?: string) {
  return !method || method === 'GET' || method === 'HEAD';
}

function isSafeMethod(method?: string) {
  return !method || method === 'GET' || method === 'HEAD';
}

function isRetriableError(error: unknown) {
  if (!error || typeof error !== 'object') {
    return false;
  }

  const maybeError = error as Error & { status?: number };
  if (maybeError.name === 'AbortError') {
    return false;
  }

  if (typeof maybeError.status === 'number') {
    return maybeError.status >= 500;
  }

  return maybeError instanceof TypeError;
}

function normalizeRequestError(error: unknown) {
  if (!error || typeof error !== 'object') {
    return new Error('Unexpected request failure');
  }

  const maybeError = error as Error & { status?: number };
  if (maybeError.name === 'AbortError') {
    return maybeError;
  }

  if (typeof maybeError.status === 'number' && maybeError.status >= 500) {
    return new Error(
      'Server is temporarily unavailable. Please try again in a moment.'
    );
  }

  if (maybeError instanceof TypeError) {
    return new Error(
      'Network request failed. Check your connection and try again.'
    );
  }

  return maybeError;
}

async function waitForRetry(delayMs: number, signal: AbortSignal) {
  await new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      signal.removeEventListener('abort', handleAbort);
      resolve();
    }, delayMs);

    const handleAbort = () => {
      window.clearTimeout(timeout);
      reject(new DOMException('Request aborted', 'AbortError'));
    };

    signal.addEventListener('abort', handleAbort, { once: true });
  });
}

export function useApi() {
  const [pendingRequests, setPendingRequests] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [lastTrace, setLastTrace] = useState<ApiTraceSnapshot | null>(null);
  const mountedRef = useRef(true);
  const activeControllersRef = useRef<Set<AbortController>>(new Set());

  useEffect(() => {
    return () => {
      mountedRef.current = false;
      activeControllersRef.current.forEach((controller) => controller.abort());
      activeControllersRef.current.clear();
    };
  }, []);

  const request = useCallback(
    async (path: string, options?: RequestInit, config?: RequestConfig) => {
      const controller = new AbortController();
      activeControllersRef.current.add(controller);
      if (mountedRef.current) {
        setPendingRequests((count) => count + 1);
        setError(null);
      }

      try {
        const method = options?.method?.toUpperCase();
        const maxRetries = config?.retries ?? (isSafeToRetry(method) ? 1 : 0);

        for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
          try {
            const token = getAuthToken();
            const csrfToken = getCsrfToken();
            const selectedCompanyId = getSelectedCompanyId();
            const res = await fetch(`${API_BASE}${path}`, {
              ...options,
              signal: controller.signal,
              headers: {
                ...(options?.body
                  ? { 'Content-Type': 'application/json' }
                  : {}),
                ...(token ? { Authorization: `Bearer ${token}` } : {}),
                ...(token && csrfToken && !isSafeMethod(method)
                  ? { 'x-csrf-token': csrfToken }
                  : {}),
                ...(selectedCompanyId
                  ? { 'x-company-id': selectedCompanyId }
                  : {}),
                ...options?.headers,
              },
            });
            const data = await res.json().catch(() => null);
            const traceId = res.headers.get('x-trace-id');
            if (traceId && mountedRef.current && config?.trackTrace !== false) {
              setLastTrace({
                traceId,
                path,
                method: method || 'GET',
                status: res.status,
                capturedAt: new Date().toISOString(),
              });
            }
            if (res.status === 401) {
              clearAuthToken();
            }
            if (!res.ok) {
              const apiError = new Error(
                data?.error || 'API Error'
              ) as Error & { status?: number };
              apiError.status = res.status;
              throw apiError;
            }
            return data;
          } catch (err) {
            if (attempt < maxRetries && isRetriableError(err)) {
              await waitForRetry(
                config?.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS,
                controller.signal
              );
              continue;
            }

            throw normalizeRequestError(err);
          }
        }

        throw new Error('API request exhausted retries');
      } catch (err: any) {
        if (
          err.name !== 'AbortError' &&
          mountedRef.current &&
          !config?.suppressError
        ) {
          setError(err.message);
        }
        throw err;
      } finally {
        activeControllersRef.current.delete(controller);
        if (mountedRef.current) {
          setPendingRequests((count) => Math.max(0, count - 1));
        }
      }
    },
    []
  );

  return { request, loading: pendingRequests > 0, error, lastTrace };
}

export function useWebSocket(companyId?: string) {
  const [lastEvent, setLastEvent] = useState<any>(null);
  const [authVersion, setAuthVersion] = useState(0);

  useEffect(() => {
    const handleAuthChange = () => {
      setAuthVersion((current) => current + 1);
    };

    window.addEventListener(AUTH_EVENT, handleAuthChange);
    return () => window.removeEventListener(AUTH_EVENT, handleAuthChange);
  }, []);

  useEffect(() => {
    if (!companyId) {
      setLastEvent(null);
      return;
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const token = getAuthToken();
    const params = new URLSearchParams({ companyId });
    if (token) {
      params.set('token', token);
    }
    const ws = new WebSocket(
      `${protocol}//${window.location.host}/ws?${params.toString()}`
    );

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      setLastEvent(data);
    };

    return () => ws.close();
  }, [authVersion, companyId]);

  return lastEvent;
}
