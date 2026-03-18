import { useState, useEffect, useCallback } from 'react';
import { clearAuthToken, getAuthToken, getSelectedCompanyId } from '../lib/session';

const API_BASE = '/api';

export function useApi() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const request = useCallback(async (path: string, options?: RequestInit) => {
    setLoading(true);
    setError(null);
    try {
      const token = getAuthToken();
      const selectedCompanyId = getSelectedCompanyId();
      const res = await fetch(`${API_BASE}${path}`, {
        ...options,
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
      setError(err.message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  return { request, loading, error };
}

export function useWebSocket(companyId?: string) {
  const [lastEvent, setLastEvent] = useState<any>(null);

  useEffect(() => {
    if (!companyId) return;

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws?companyId=${companyId}`);

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      setLastEvent(data);
    };

    return () => ws.close();
  }, [companyId]);

  return lastEvent;
}
