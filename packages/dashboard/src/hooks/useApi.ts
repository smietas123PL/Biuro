import { useState, useEffect, useCallback } from 'react';

const API_BASE = '/api';

export function useApi() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const request = useCallback(async (path: string, options?: RequestInit) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}${path}`, {
        ...options,
        headers: {
          'Content-Type': 'application/json',
          ...options?.headers,
        },
      });
      const data = await res.json();
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
