import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AuditLogPage from './AuditLogPage';

const requestMock = vi.hoisted(() => vi.fn());
const useApiMock = vi.hoisted(() => vi.fn());
const useCompanyMock = vi.hoisted(() => vi.fn());

vi.mock('../hooks/useApi', () => ({
  useApi: () => useApiMock(),
}));

vi.mock('../context/CompanyContext', () => ({
  useCompany: () => useCompanyMock(),
}));

describe('AuditLogPage', () => {
  beforeEach(() => {
    requestMock.mockReset();
    useApiMock.mockReset();
    useCompanyMock.mockReset();

    requestMock.mockImplementation(async (path: string) => {
      if (
        path ===
        '/companies/company-1/audit-log?limit=5&action_prefix=nl_command.'
      ) {
        return {
          items: [
            {
              id: 'audit-control-1',
              action: 'nl_command.planned',
              details: {
                input: 'pause Ada',
                source: 'llm',
                can_execute: true,
                action_count: 2,
                action_types: ['api_request', 'navigate'],
                planner: {
                  mode: 'llm',
                  runtime: 'claude',
                  attempts: [
                    {
                      runtime: 'claude',
                      model: 'claude-sonnet-4-20250514',
                      status: 'success',
                    },
                  ],
                  fallback_reason: null,
                },
              },
              created_at: '2026-03-19T09:15:00.000Z',
            },
          ],
          has_more: false,
          next_cursor: null,
        };
      }

      if (path.includes('action_prefix=nl_command.')) {
        return {
          items: [
            {
              id: 'audit-control-1',
              action: 'nl_command.planned',
              details: {
                input: 'pause Ada',
                source: 'llm',
                can_execute: true,
                action_count: 2,
                action_types: ['api_request', 'navigate'],
                planner: {
                  mode: 'llm',
                  runtime: 'claude',
                  attempts: [
                    {
                      runtime: 'claude',
                      model: 'claude-sonnet-4-20250514',
                      status: 'success',
                    },
                  ],
                  fallback_reason: null,
                },
              },
              created_at: '2026-03-19T09:15:00.000Z',
            },
            {
              id: 'audit-control-2',
              action: 'nl_command.planned',
              details: {
                input: 'create goal Q4 partner pipeline',
                source: 'rules',
                can_execute: true,
                action_count: 2,
                action_types: ['api_request', 'navigate'],
                planner: {
                  mode: 'rules',
                  fallback_reason: 'llm_failed',
                },
              },
              created_at: '2026-03-19T09:16:00.000Z',
            },
            {
              id: 'audit-control-3',
              action: 'nl_command.planned',
              details: {
                input: 'find me the best strategy for Europe',
                source: 'rules',
                can_execute: false,
                action_count: 0,
                action_types: [],
                planner: {
                  mode: 'rules',
                  fallback_reason: 'invalid_llm_plan',
                },
              },
              created_at: '2026-03-19T09:17:00.000Z',
            },
          ],
          has_more: false,
          next_cursor: null,
        };
      }

      if (path.startsWith('/companies/company-1/audit-log?')) {
        return {
          items: [
            {
              id: 'audit-1',
              action: 'heartbeat.completed',
              agent_id: 'agent-1',
              details: {
                task_id: 'task-1',
                llm_routing: {
                  selected_runtime: 'claude',
                  selected_model: 'claude-sonnet-4-20250514',
                  attempts: [
                    {
                      runtime: 'openai',
                      model: 'gpt-4o',
                      status: 'fallback',
                      reason: '429 rate limit exceeded',
                    },
                    {
                      runtime: 'claude',
                      model: 'claude-sonnet-4-20250514',
                      status: 'success',
                    },
                  ],
                },
              },
              created_at: '2026-03-19T09:12:00.000Z',
            },
          ],
          has_more: false,
          next_cursor: null,
        };
      }

      if (path === '/observability/traces/recent?limit=6') {
        return {
          items: [
            {
              trace_id: 'recent-trace-1234abcd',
              name: 'http.get',
              start_time: '2026-03-19T09:10:00.000Z',
              status_code: '1',
            },
          ],
        };
      }

      throw new Error(`Unexpected request path: ${path}`);
    });

    useApiMock.mockReturnValue({
      request: requestMock,
      loading: false,
    });

    useCompanyMock.mockReturnValue({
      selectedCompany: {
        id: 'company-1',
        name: 'Biuro Labs',
      },
      selectedCompanyId: 'company-1',
    });

    vi.stubGlobal('navigator', {
      clipboard: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
    });
  });

  it('shows recent traces with copy and Grafana actions beside the audit log', async () => {
    render(
      <MemoryRouter>
        <AuditLogPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(requestMock).toHaveBeenCalledWith(
        '/observability/traces/recent?limit=6',
        undefined,
        {
          suppressError: true,
          trackTrace: false,
        }
      );
      expect(requestMock).toHaveBeenCalledWith(
        '/companies/company-1/audit-log?limit=5&action_prefix=nl_command.',
        undefined,
        {
          suppressError: true,
          trackTrace: false,
        }
      );
    });

    expect(screen.getByText('Recent Traces')).toBeTruthy();
    expect(screen.getByText('Control Panel Activity')).toBeTruthy();

    await waitFor(() => {
      expect(
        screen
          .getByRole('link', { name: 'Open in Grafana' })
          .getAttribute('href')
      ).toContain('recent-trace-1234abcd');
      expect(screen.getByText('Provider claude')).toBeTruthy();
      expect(screen.getByText('Model claude-sonnet-4-20250514')).toBeTruthy();
      expect(screen.getByText('Fallbacks 1')).toBeTruthy();
      expect(screen.getByText('LLM routing')).toBeTruthy();
      expect(screen.getByText(/openai \/ gpt-4o/)).toBeTruthy();
      expect(
        screen.getAllByText(/429 rate limit exceeded/).length
      ).toBeGreaterThan(0);
      expect(screen.getByText('Planned by Claude')).toBeTruthy();
      expect(screen.getByText('pause Ada')).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Copy trace ID' }));

    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
        'recent-trace-1234abcd'
      );
    });
  });

  it('filters Control Panel events by facet', async () => {
    render(
      <MemoryRouter>
        <AuditLogPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: 'Control Panel' })
      ).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Control Panel' }));

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: 'Failed Planning (1)' })
      ).toBeTruthy();
      expect(screen.getAllByText('pause Ada').length).toBeGreaterThan(0);
      expect(
        screen.getAllByText('create goal Q4 partner pipeline').length
      ).toBeGreaterThan(0);
      expect(
        screen.getAllByText('find me the best strategy for Europe').length
      ).toBeGreaterThan(0);
    });

    fireEvent.click(
      screen.getByRole('button', { name: 'Failed Planning (1)' })
    );

    await waitFor(() => {
      expect(screen.getAllByText('pause Ada').length).toBe(1);
      expect(
        screen.queryAllByText('create goal Q4 partner pipeline').length
      ).toBe(0);
      expect(
        screen.getByText('find me the best strategy for Europe')
      ).toBeTruthy();
    });
  });

  it('searches Control Panel commands by user input text', async () => {
    const { container } = render(
      <MemoryRouter>
        <AuditLogPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: 'Control Panel' })
      ).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Control Panel' }));

    await waitFor(() => {
      expect(
        screen.getByPlaceholderText('Search Control Panel commands...')
      ).toBeTruthy();
    });

    fireEvent.change(
      screen.getByPlaceholderText('Search Control Panel commands...'),
      {
        target: { value: 'Europe' },
      }
    );

    await waitFor(() => {
      expect(
        screen.getByText(
          (_, element) =>
            element?.textContent === 'find me the best strategy for Europe'
        )
      ).toBeTruthy();
      expect(screen.queryAllByText('pause Ada').length).toBe(0);
      expect(
        screen.queryAllByText('create goal Q4 partner pipeline').length
      ).toBe(0);
      expect(container.querySelector('mark')?.textContent).toBe('Europe');
    });
  });
});
