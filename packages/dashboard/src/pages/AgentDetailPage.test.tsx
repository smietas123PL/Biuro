import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AgentDetailPage from './AgentDetailPage';
import { AUTH_TOKEN_KEY, COMPANY_STORAGE_KEY } from '../lib/session';

const requestMock = vi.hoisted(() => vi.fn());
const useApiMock = vi.hoisted(() => vi.fn());

vi.mock('../hooks/useApi', () => ({
  useApi: () => useApiMock(),
}));

const replayFilters = {
  available_types: ['heartbeat', 'audit', 'message', 'session'] as const,
  tasks: [
    {
      task_id: 'task-1',
      task_title: 'Research customer pain points',
      event_count: 3,
    },
    {
      task_id: 'task-2',
      task_title: 'Prepare launch notes',
      event_count: 1,
    },
  ],
};

describe('AgentDetailPage', () => {
  beforeEach(() => {
    requestMock.mockReset();
    useApiMock.mockReset();
    localStorage.setItem(AUTH_TOKEN_KEY, 'token-123');
    localStorage.setItem(COMPANY_STORAGE_KEY, 'company-7');

    requestMock.mockImplementation(async (path: string) => {
      if (path === '/agents/agent-1') {
        return {
          id: 'agent-1',
          name: 'Ada',
          role: 'Research Lead',
          status: 'active',
          runtime: 'claude',
          monthly_budget_usd: '80.00',
          tools: [{ id: 'tool-1', name: 'Web Search' }],
        };
      }

      if (path === '/agents/agent-1/budgets') {
        return [
          {
            agent_id: 'agent-1',
            month: '2026-03-01',
            limit_usd: '80.00',
            spent_usd: '12.50',
          },
        ];
      }

      if (path === '/agents/agent-1/replay?limit=120') {
        return {
          items: [
            {
              id: 'event-1',
              type: 'audit',
              action: 'task.started',
              summary: 'Picked the next strategic task.',
              timestamp: '2026-03-18T10:00:00.000Z',
              task_id: 'task-1',
              task_title: 'Research customer pain points',
            },
            {
              id: 'event-2',
              type: 'heartbeat',
              action: 'heartbeat.completed',
              summary: 'Summarized five interview transcripts.',
              timestamp: '2026-03-18T10:03:00.000Z',
              task_id: 'task-1',
              task_title: 'Research customer pain points',
              duration_ms: 3200,
              cost_usd: '1.45',
              details: {
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
            },
            {
              id: 'event-3',
              type: 'message',
              action: 'message.sent',
              summary: 'Shared the draft findings with the PM.',
              timestamp: '2026-03-18T10:05:00.000Z',
              task_id: 'task-1',
              task_title: 'Research customer pain points',
            },
            {
              id: 'event-4',
              type: 'session',
              action: 'session.updated',
              summary: 'Paused pending sign-off from PM.',
              timestamp: '2026-03-18T10:06:00.000Z',
              task_id: 'task-2',
              task_title: 'Prepare launch notes',
            },
          ],
          filters: replayFilters,
        };
      }

      if (path === '/agents/agent-1/replay?limit=120&task_id=task-1') {
        return {
          items: [
            {
              id: 'event-1',
              type: 'audit',
              action: 'task.started',
              summary: 'Picked the next strategic task.',
              timestamp: '2026-03-18T10:00:00.000Z',
              task_id: 'task-1',
              task_title: 'Research customer pain points',
            },
            {
              id: 'event-2',
              type: 'heartbeat',
              action: 'heartbeat.completed',
              summary: 'Summarized five interview transcripts.',
              timestamp: '2026-03-18T10:03:00.000Z',
              task_id: 'task-1',
              task_title: 'Research customer pain points',
              duration_ms: 3200,
              cost_usd: '1.45',
              details: {
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
            },
            {
              id: 'event-3',
              type: 'message',
              action: 'message.sent',
              summary: 'Shared the draft findings with the PM.',
              timestamp: '2026-03-18T10:05:00.000Z',
              task_id: 'task-1',
              task_title: 'Research customer pain points',
            },
          ],
          filters: replayFilters,
        };
      }

      if (path === '/agents/agent-1/replay?limit=120&task_id=task-1&types=heartbeat') {
        return {
          items: [
            {
              id: 'event-2',
              type: 'heartbeat',
              action: 'heartbeat.completed',
              summary: 'Summarized five interview transcripts.',
              timestamp: '2026-03-18T10:03:00.000Z',
              task_id: 'task-1',
              task_title: 'Research customer pain points',
              duration_ms: 3200,
              cost_usd: '1.45',
              details: {
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
            },
          ],
          filters: replayFilters,
        };
      }

      if (path === '/agents/agent-1/replay/diff?left_task_id=task-1&right_task_id=task-2&limit=120') {
        return {
          left: {
            task_id: 'task-1',
            task_title: 'Research customer pain points',
            event_count: 3,
            total_duration_ms: 3200,
            total_cost_usd: 1.45,
            first_event_at: '2026-03-18T10:00:00.000Z',
            last_event_at: '2026-03-18T10:05:00.000Z',
            type_counts: { heartbeat: 1, audit: 1, message: 1, session: 0 },
            highlights: [
              'Picked the next strategic task.',
              'Summarized five interview transcripts.',
              'Shared the draft findings with the PM.',
            ],
          },
          right: {
            task_id: 'task-2',
            task_title: 'Prepare launch notes',
            event_count: 1,
            total_duration_ms: 0,
            total_cost_usd: 0,
            first_event_at: '2026-03-18T10:06:00.000Z',
            last_event_at: '2026-03-18T10:06:00.000Z',
            type_counts: { heartbeat: 0, audit: 0, message: 0, session: 1 },
            highlights: ['Paused pending sign-off from PM.'],
          },
          delta: {
            event_count: 2,
            total_duration_ms: 3200,
            total_cost_usd: 1.45,
          },
        };
      }

      if (path === '/agents/agent-1/replay/diff?left_task_id=task-1&right_task_id=task-2&limit=120&types=heartbeat') {
        return {
          left: {
            task_id: 'task-1',
            task_title: 'Research customer pain points',
            event_count: 1,
            total_duration_ms: 3200,
            total_cost_usd: 1.45,
            first_event_at: '2026-03-18T10:03:00.000Z',
            last_event_at: '2026-03-18T10:03:00.000Z',
            type_counts: { heartbeat: 1, audit: 0, message: 0, session: 0 },
            highlights: ['Summarized five interview transcripts.'],
          },
          right: {
            task_id: 'task-2',
            task_title: 'Prepare launch notes',
            event_count: 0,
            total_duration_ms: 0,
            total_cost_usd: 0,
            first_event_at: null,
            last_event_at: null,
            type_counts: { heartbeat: 0, audit: 0, message: 0, session: 0 },
            highlights: [],
          },
          delta: {
            event_count: 1,
            total_duration_ms: 3200,
            total_cost_usd: 1.45,
          },
        };
      }

      throw new Error(`Unexpected request path: ${path}`);
    });

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      blob: async () => new Blob(['<html>report</html>'], { type: 'text/html' }),
    });
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn(() => 'blob:replay-report'),
      revokeObjectURL: vi.fn(),
    });

    useApiMock.mockReturnValue({
      request: requestMock,
      loading: false,
      error: null,
      lastTrace: {
        traceId: 'agent-trace-1234abcd',
        path: '/agents/agent-1/replay?limit=120',
        method: 'GET',
        status: 200,
        capturedAt: '2026-03-18T10:06:00.000Z',
      },
    });
  });

  it('supports task-scoped session replay and event-type filters', async () => {
    render(
      <MemoryRouter initialEntries={['/agents/agent-1']} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <Routes>
          <Route path="/agents/:id" element={<AgentDetailPage />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(requestMock).toHaveBeenCalledWith('/agents/agent-1');
      expect(requestMock).toHaveBeenCalledWith('/agents/agent-1/budgets');
      expect(requestMock).toHaveBeenCalledWith('/agents/agent-1/replay?limit=120');
      expect(requestMock).toHaveBeenCalledWith('/agents/agent-1/replay/diff?left_task_id=task-1&right_task_id=task-2&limit=120');
    });

    expect(screen.getByRole('heading', { name: 'Ada' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Live Agent Replay' })).toBeTruthy();
    expect(screen.getByLabelText('Replay task filter')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'heartbeat' })).toBeTruthy();
    expect(screen.getByText('Prepare launch notes (1)')).toBeTruthy();
    expect(screen.getByText('Timeline diff')).toBeTruthy();
    expect(screen.getByText('3200 ms')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Replay task filter'), {
      target: { value: 'task-1' },
    });

    await waitFor(() => {
      expect(requestMock).toHaveBeenCalledWith('/agents/agent-1/replay?limit=120&task_id=task-1');
    });

    fireEvent.click(screen.getByRole('button', { name: 'heartbeat' }));

    await waitFor(() => {
      expect(requestMock).toHaveBeenCalledWith('/agents/agent-1/replay?limit=120&task_id=task-1&types=heartbeat');
      expect(requestMock).toHaveBeenCalledWith('/agents/agent-1/replay/diff?left_task_id=task-1&right_task_id=task-2&limit=120&types=heartbeat');
    });

    expect(screen.getByText(/Provider:\s*claude/)).toBeTruthy();
    expect(screen.getByText(/Model:\s*claude-sonnet-4-20250514/)).toBeTruthy();
    expect(screen.getByText(/Fallbacks:\s*1/)).toBeTruthy();
    expect(screen.getByText('openai / gpt-4o')).toBeTruthy();
    expect(screen.getAllByText('Summarized five interview transcripts.').length).toBeGreaterThanOrEqual(2);
    expect(screen.queryAllByText('Shared the draft findings with the PM.')).toHaveLength(0);
    expect(screen.getByText('LLM route: claude / claude-sonnet-4-20250514 • fallbacks 1')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Clear filters' })).toBeTruthy();
    expect(screen.getByText('Research customer pain points vs Prepare launch notes')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Open in Grafana' }).getAttribute('href')).toContain('agent-trace-1234abcd');

    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    fireEvent.click(screen.getByRole('button', { name: 'Export report' }));

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        '/api/agents/agent-1/replay/report?limit=120&task_id=task-1&types=heartbeat',
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer token-123',
            'x-company-id': 'company-7',
          }),
        })
      );
    });

    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Replay report downloaded.')).toBeTruthy();
  });
});
