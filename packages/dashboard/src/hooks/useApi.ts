import { useState, useEffect, useCallback, useRef } from 'react';
import { AUTH_EVENT, clearAuthToken, getAuthToken, getSelectedCompanyId } from '../lib/session';

const API_BASE = '/api';

type RequestConfig = {
  suppressError?: boolean;
};

export function useApi() {
  const [pendingRequests, setPendingRequests] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);
  const activeControllersRef = useRef<Set<AbortController>>(new Set());

  useEffect(() => {
    return () => {
      mountedRef.current = false;
      activeControllersRef.current.forEach((controller) => controller.abort());
      activeControllersRef.current.clear();
    };
  }, []);

  const request = useCallback(async (path: string, options?: RequestInit, config?: RequestConfig) => {
    const controller = new AbortController();
    activeControllersRef.current.add(controller);
    if (mountedRef.current) {
      setPendingRequests((count) => count + 1);
      setError(null);
    }

    try {
      const token = getAuthToken();
      const selectedCompanyId = getSelectedCompanyId();
      const res = await fetch(`${API_BASE}${path}`, {
        ...options,
        signal: controller.signal,
        headers: {
          ...(options?.body ? { 'Content-Type': 'application/json' } : {}),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(selectedCompanyId ? { 'x-company-id': selectedCompanyId } : {}),
          ...options?.headers,
        },
      });
      const data = await res.json().catch(() => null);
      if (res.status === 401) {
        clearAuthToken();
      }
      if (!res.ok) throw new Error(data.error || 'API Error');
      return data;
    } catch (err: any) {
      if (err.name !== 'AbortError' && mountedRef.current && !config?.suppressError) {
        setError(err.message);
      }
      throw err;
    } finally {
      activeControllersRef.current.delete(controller);
      if (mountedRef.current) {
        setPendingRequests((count) => Math.max(0, count - 1));
      }
    }
  }, []);

  return { request, loading: pendingRequests > 0, error };
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
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws?${params.toString()}`);

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      setLastEvent(data);
    };

    return () => ws.close();
  }, [authVersion, companyId]);

  return lastEvent;
}
