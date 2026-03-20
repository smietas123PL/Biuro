import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ObservabilityPage from './ObservabilityPage';

const requestMock = vi.hoisted(() => vi.fn());
const useApiMock = vi.hoisted(() => vi.fn());

vi.mock('../hooks/useApi', () => ({
  useApi: () => useApiMock(),
}));

describe('ObservabilityPage', () => {
  beforeEach(() => {
    requestMock.mockReset();
    useApiMock.mockReset();

    requestMock.mockImplementation(async (path: string) => {
      if (path === '/observability/heartbeat-runs/recent?limit=12') {
        return {
          count: 2,
          items: [
            {
              heartbeat_id: 'heartbeat-1',
              agent_id: 'agent-1',
              agent_name: 'Ada',
              task_id: 'task-1',
              task_title: 'Investigate churn',
              status: 'worked',
              created_at: '2026-03-19T09:00:00.000Z',
              duration_ms: 1900,
              cost_usd: 0.42,
              llm_selected_runtime: 'openai',
              llm_selected_model: 'gpt-4o',
              llm_fallback_count: 1,
              retrieval_count: 2,
              retrieval_fallback_count: 1,
              retrieval_skipped_count: 0,
              budget_capped: false,
            },
            {
              heartbeat_id: 'heartbeat-2',
              agent_id: 'agent-2',
              agent_name: 'Ben',
              task_id: 'task-2',
              task_title: 'Review launch plan',
              status: 'worked',
              created_at: '2026-03-19T08:55:00.000Z',
              duration_ms: 1200,
              cost_usd: 0.18,
              llm_selected_runtime: 'gemini',
              llm_selected_model: 'gemini-2.0-flash',
              llm_fallback_count: 0,
              retrieval_count: 2,
              retrieval_fallback_count: 0,
              retrieval_skipped_count: 1,
              budget_capped: false,
            },
          ],
        };
      }

      if (path === '/observability/traces/recent?limit=100') {
        return {
          service: 'autonomiczne-biuro',
          count: 4,
          items: [
            {
              trace_id: 'trace-a1234567890',
              span_id: 'span-a-root',
              name: 'http.get',
              kind: '0',
              start_time: '2026-03-19T09:00:00.000Z',
              end_time: '2026-03-19T09:00:00.090Z',
              duration_ms: 90,
              status_code: '1',
              attributes: {
                'service.name': 'autonomiczne-biuro-api',
                'http.route': '/api/companies/:id/stats',
              },
              events: [],
            },
            {
              trace_id: 'trace-a1234567890',
              span_id: 'span-a-child',
              parent_span_id: 'span-a-root',
              name: 'worker.heartbeat',
              kind: '0',
              start_time: '2026-03-19T09:00:00.010Z',
              end_time: '2026-03-19T09:00:00.040Z',
              duration_ms: 30,
              status_code: '1',
              attributes: {
                'service.name': 'autonomiczne-biuro-worker',
                'heartbeat.status': 'worked',
                'task.id': 'task-1',
              },
              events: [],
            },
            {
              trace_id: 'trace-b1234567890',
              span_id: 'span-b-root',
              name: 'tool.execute',
              kind: '0',
              start_time: '2026-03-19T08:59:00.000Z',
              end_time: '2026-03-19T08:59:00.250Z',
              duration_ms: 250,
              status_code: '2',
              attributes: {
                'service.name': 'autonomiczne-biuro-worker',
                'tool.name': 'web_search',
              },
              events: [],
            },
          ],
        };
      }

      if (path === '/observability/traces/trace-a1234567890') {
        return {
          trace_id: 'trace-a1234567890',
          service: 'autonomiczne-biuro-api',
          summary: {
            span_count: 2,
            started_at: '2026-03-19T09:00:00.000Z',
            ended_at: '2026-03-19T09:00:00.090Z',
            duration_ms: 90,
          },
          items: [
            {
              trace_id: 'trace-a1234567890',
              span_id: 'span-a-root',
              name: 'http.get',
              kind: '0',
              start_time: '2026-03-19T09:00:00.000Z',
              end_time: '2026-03-19T09:00:00.090Z',
              duration_ms: 90,
              status_code: '1',
              attributes: {
                'http.route': '/api/companies/:id/stats',
              },
              events: [],
            },
            {
              trace_id: 'trace-a1234567890',
              span_id: 'span-a-child',
              parent_span_id: 'span-a-root',
              name: 'worker.heartbeat',
              kind: '0',
              start_time: '2026-03-19T09:00:00.010Z',
              end_time: '2026-03-19T09:00:00.040Z',
              duration_ms: 30,
              status_code: '1',
              attributes: {
                'heartbeat.status': 'worked',
                'task.id': 'task-1',
              },
              events: [],
            },
          ],
        };
      }

      if (path === '/observability/traces/trace-b1234567890') {
        return {
          trace_id: 'trace-b1234567890',
          service: 'autonomiczne-biuro-worker',
          summary: {
            span_count: 1,
            started_at: '2026-03-19T08:59:00.000Z',
            ended_at: '2026-03-19T08:59:00.250Z',
            duration_ms: 250,
          },
          items: [
            {
              trace_id: 'trace-b1234567890',
              span_id: 'span-b-root',
              name: 'tool.execute',
              kind: '0',
              start_time: '2026-03-19T08:59:00.000Z',
              end_time: '2026-03-19T08:59:00.250Z',
              duration_ms: 250,
              status_code: '2',
              attributes: {
                'tool.name': 'web_search',
              },
              events: [],
            },
          ],
        };
      }

      throw new Error(`Unexpected request path: ${path}`);
    });

    useApiMock.mockReturnValue({
      request: requestMock,
      loading: false,
      error: null,
      lastTrace: {
        traceId: 'trace-last-1234abcd',
        path: '/api/companies/company-1/stats',
        method: 'GET',
        status: 200,
        capturedAt: '2026-03-19T09:01:00.000Z',
      },
    });
  });

  it('groups recent traces and shows detail for the selected trace', async () => {
    render(
      <MemoryRouter>
        <ObservabilityPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(requestMock).toHaveBeenCalledWith(
        '/observability/traces/recent?limit=100',
        undefined,
        {
          suppressError: true,
          trackTrace: false,
        }
      );
      expect(requestMock).toHaveBeenCalledWith(
        '/observability/heartbeat-runs/recent?limit=12',
        undefined,
        {
          suppressError: true,
          trackTrace: false,
        }
      );
      expect(requestMock).toHaveBeenCalledWith(
        '/observability/traces/trace-a1234567890',
        undefined,
        {
          suppressError: true,
          trackTrace: false,
        }
      );
    });

    expect(screen.getByText('Observability')).toBeTruthy();
    expect(screen.getByText('Heartbeat runtime health')).toBeTruthy();
    expect(screen.getByText('LLM fallback runs')).toBeTruthy();
    expect(screen.getAllByText('Retrieval skipped').length).toBeGreaterThan(0);
    expect(screen.getByText('Investigate churn')).toBeTruthy();
    expect(screen.getByText('Recent trace sessions')).toBeTruthy();
    expect(screen.getByText('Trace detail')).toBeTruthy();
    expect(screen.getAllByText('http.get').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('worker.heartbeat')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Filter traces by status'), {
      target: { value: 'error' },
    });

    await waitFor(() => {
      expect(screen.getByText('tool.execute')).toBeTruthy();
      expect(requestMock).toHaveBeenCalledWith(
        '/observability/traces/trace-b1234567890',
        undefined,
        {
          suppressError: true,
          trackTrace: false,
        }
      );
    });
  });
});
