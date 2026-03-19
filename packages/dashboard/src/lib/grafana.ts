import type { ApiTraceSnapshot } from '../hooks/useApi';

const DEFAULT_GRAFANA_PORT = '3001';
const TEMPO_DATASOURCE_UID = 'tempo';
const TEMPO_DATASOURCE_TYPE = 'tempo';

function resolveGrafanaBaseUrl() {
  const configuredUrl = (
    import.meta as ImportMeta & { env?: Record<string, string | undefined> }
  ).env?.VITE_GRAFANA_URL;
  if (typeof configuredUrl === 'string' && configuredUrl.trim().length > 0) {
    return configuredUrl.replace(/\/+$/, '');
  }

  if (typeof window === 'undefined') {
    return `http://localhost:${DEFAULT_GRAFANA_PORT}`;
  }

  return `${window.location.protocol}//${window.location.hostname}:${DEFAULT_GRAFANA_PORT}`;
}

export function buildGrafanaTraceExploreUrl(trace: ApiTraceSnapshot) {
  const capturedAtMs = Date.parse(trace.capturedAt);
  const timeCenter = Number.isFinite(capturedAtMs) ? capturedAtMs : Date.now();
  const timePaddingMs = 15 * 60 * 1000;

  const panes = {
    A: {
      datasource: TEMPO_DATASOURCE_UID,
      queries: [
        {
          refId: 'A',
          datasource: {
            uid: TEMPO_DATASOURCE_UID,
            type: TEMPO_DATASOURCE_TYPE,
          },
          queryType: 'traceql',
          query: trace.traceId,
          limit: 20,
          tableType: 'traces',
        },
      ],
      range: {
        from: String(timeCenter - timePaddingMs),
        to: String(timeCenter + timePaddingMs),
      },
    },
  };

  const searchParams = new URLSearchParams({
    schemaVersion: '1',
    orgId: '1',
    panes: JSON.stringify(panes),
  });

  return `${resolveGrafanaBaseUrl()}/explore?${searchParams.toString()}`;
}
