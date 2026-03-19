import { describe, expect, it, vi } from 'vitest';
import { buildGrafanaTraceExploreUrl } from './grafana';

describe('buildGrafanaTraceExploreUrl', () => {
  it('builds a Grafana Explore deep-link for a Tempo trace', () => {
    vi.stubGlobal('window', {
      location: {
        protocol: 'http:',
        hostname: '127.0.0.1',
      },
    });

    const url = new URL(
      buildGrafanaTraceExploreUrl({
        traceId: '41928b92edf1cdbe0ba6594baee5ae9',
        path: '/companies/company-1/stats',
        method: 'GET',
        status: 200,
        capturedAt: '2026-03-19T08:52:00.000Z',
      })
    );

    expect(url.origin).toBe('http://127.0.0.1:3001');
    expect(url.pathname).toBe('/explore');
    expect(url.searchParams.get('schemaVersion')).toBe('1');
    expect(url.searchParams.get('orgId')).toBe('1');

    const panes = JSON.parse(url.searchParams.get('panes') || '{}');
    expect(panes.A.datasource).toBe('tempo');
    expect(panes.A.queries[0]).toMatchObject({
      queryType: 'traceql',
      query: '41928b92edf1cdbe0ba6594baee5ae9',
      datasource: {
        uid: 'tempo',
        type: 'tempo',
      },
    });
  });
});
