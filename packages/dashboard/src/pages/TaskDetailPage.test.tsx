import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import TaskDetailPage from './TaskDetailPage';

const requestMock = vi.hoisted(() => vi.fn());
const useApiMock = vi.hoisted(() => vi.fn());
const useWebSocketMock = vi.hoisted(() => vi.fn());
const useCompanyMock = vi.hoisted(() => vi.fn());

vi.mock('../hooks/useApi', () => ({
  useApi: () => useApiMock(),
  useWebSocket: () => useWebSocketMock(),
}));

vi.mock('../context/CompanyContext', () => ({
  useCompany: () => useCompanyMock(),
}));

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location-search">{location.search}</div>;
}

describe('TaskDetailPage', () => {
  beforeEach(() => {
    requestMock.mockReset();
    useApiMock.mockReset();
    useWebSocketMock.mockReset();
    useCompanyMock.mockReset();

    requestMock.mockImplementation(
      async (path: string, options?: RequestInit) => {
        if (path === '/tasks/task-root/collaboration') {
          return {
            generated_at: '2026-03-18T22:10:00.000Z',
            root_task: {
              id: 'task-root',
              title: 'Ship launch plan',
              description:
                'Coordinate launch prep across a tight AI strike team.',
              status: 'in_progress',
            },
            current_task: {
              id: 'task-root',
              title: 'Ship launch plan',
              description:
                'Coordinate launch prep across a tight AI strike team.',
              status: 'in_progress',
              fork_origin: null,
            },
            tasks: [
              {
                id: 'task-root',
                parent_id: null,
                title: 'Ship launch plan',
                description:
                  'Coordinate launch prep across a tight AI strike team.',
                status: 'in_progress',
                assigned_to: 'agent-1',
                assigned_to_name: 'Ada',
                assigned_to_role: 'Lead Strategist',
                assigned_to_status: 'working',
                priority: 10,
                depth: 0,
                created_at: '2026-03-18T22:00:00.000Z',
                updated_at: '2026-03-18T22:04:00.000Z',
                completed_at: null,
              },
              {
                id: 'task-child',
                parent_id: 'task-root',
                title: 'Delegated: Validate messaging',
                description: 'Pressure-test the hero headline.',
                status: 'done',
                assigned_to: 'agent-2',
                assigned_to_name: 'Ben',
                assigned_to_role: 'Messaging Specialist',
                assigned_to_status: 'idle',
                priority: 0,
                depth: 1,
                created_at: '2026-03-18T22:02:00.000Z',
                updated_at: '2026-03-18T22:05:00.000Z',
                completed_at: '2026-03-18T22:05:00.000Z',
              },
              {
                id: 'task-risk',
                parent_id: 'task-root',
                title: 'Delegated: Pricing audit',
                description: 'Review competitor pricing shifts.',
                status: 'assigned',
                assigned_to: 'agent-3',
                assigned_to_name: 'Cara',
                assigned_to_role: 'Research Analyst',
                assigned_to_status: 'idle',
                priority: 0,
                depth: 1,
                created_at: '2026-03-18T22:03:00.000Z',
                updated_at: '2026-03-18T22:03:00.000Z',
                completed_at: null,
              },
            ],
            participants: [
              {
                agent_id: 'agent-1',
                name: 'Ada',
                role: 'Lead Strategist',
                status: 'working',
                assigned_task_count: 1,
                contribution_count: 2,
                latest_activity_at: '2026-03-18T22:03:00.000Z',
              },
              {
                agent_id: 'agent-2',
                name: 'Ben',
                role: 'Messaging Specialist',
                status: 'idle',
                assigned_task_count: 1,
                contribution_count: 1,
                latest_activity_at: '2026-03-18T22:04:00.000Z',
              },
              {
                agent_id: 'agent-3',
                name: 'Cara',
                role: 'Research Analyst',
                status: 'idle',
                assigned_task_count: 1,
                contribution_count: 0,
                latest_activity_at: null,
              },
            ],
            timeline: [
              {
                id: 'thought-1',
                kind: 'thought',
                task_id: 'task-root',
                task_title: 'Ship launch plan',
                agent_id: 'agent-1',
                agent_name: 'Ada',
                agent_role: 'Lead Strategist',
                to_agent_id: null,
                to_agent_name: null,
                to_agent_role: null,
                content:
                  'Ben should challenge the narrative before we lock the copy.',
                summary: 'Ada reasoned out loud.',
                message_type: 'heartbeat_thought',
                duration_ms: 2100,
                cost_usd: '0.55',
                created_at: '2026-03-18T22:01:00.000Z',
                metadata: {},
              },
              {
                id: 'delegation-1',
                kind: 'delegation',
                task_id: 'task-root',
                task_title: 'Ship launch plan',
                agent_id: 'agent-1',
                agent_name: 'Ada',
                agent_role: 'Lead Strategist',
                to_agent_id: 'agent-2',
                to_agent_name: 'Ben',
                to_agent_role: 'Messaging Specialist',
                content: 'Pressure-test the new headline stack before noon.',
                summary: 'Ada delegated work to Ben.',
                message_type: 'delegation',
                duration_ms: null,
                cost_usd: null,
                created_at: '2026-03-18T22:02:00.000Z',
                metadata: {
                  child_task_id: 'task-child',
                  delegated_to_agent_id: 'agent-2',
                  delegated_to_role: 'Messaging Specialist',
                },
              },
              {
                id: 'tool-1',
                kind: 'tool',
                task_id: 'task-child',
                task_title: 'Delegated: Validate messaging',
                agent_id: 'agent-2',
                agent_name: 'Ben',
                agent_role: 'Messaging Specialist',
                to_agent_id: null,
                to_agent_name: null,
                to_agent_role: null,
                content: 'Tool called web_search with Europe pricing query.',
                summary: 'Ben ran a tool call.',
                message_type: 'tool_call',
                duration_ms: 1500,
                cost_usd: null,
                created_at: '2026-03-18T22:02:10.000Z',
                metadata: {
                  tool: 'web_search',
                  query: 'Europe pricing',
                },
              },
              {
                id: 'tool-2',
                kind: 'tool',
                task_id: 'task-child',
                task_title: 'Delegated: Validate messaging',
                agent_id: 'agent-2',
                agent_name: 'Ben',
                agent_role: 'Messaging Specialist',
                to_agent_id: null,
                to_agent_name: null,
                to_agent_role: null,
                content:
                  'Tool Result (web_search): {\"query\":\"Europe pricing\"}',
                summary: 'Ben posted a tool result.',
                message_type: 'tool_result',
                duration_ms: 1800,
                cost_usd: null,
                created_at: '2026-03-18T22:02:12.000Z',
                metadata: {
                  tool: 'web_search',
                  result: {
                    query: 'Europe pricing',
                  },
                },
              },
              {
                id: 'delegation-2',
                kind: 'delegation',
                task_id: 'task-root',
                task_title: 'Ship launch plan',
                agent_id: 'agent-1',
                agent_name: 'Ada',
                agent_role: 'Lead Strategist',
                to_agent_id: 'agent-3',
                to_agent_name: 'Cara',
                to_agent_role: 'Research Analyst',
                content: 'Review the pricing moves from the last 30 days.',
                summary: 'Ada delegated work to Cara.',
                message_type: 'delegation',
                duration_ms: null,
                cost_usd: null,
                created_at: '2026-03-18T22:03:00.000Z',
                metadata: {
                  child_task_id: 'task-risk',
                  delegated_to_agent_id: 'agent-3',
                  delegated_to_role: 'Research Analyst',
                },
              },
              {
                id: 'supervisor-1',
                kind: 'supervisor',
                task_id: 'task-child',
                task_title: 'Delegated: Validate messaging',
                agent_id: null,
                agent_name: 'Supervisor',
                agent_role: null,
                to_agent_id: 'agent-2',
                to_agent_name: 'Ben',
                to_agent_role: 'Messaging Specialist',
                content: 'Bring back two variants, not one.',
                summary: 'Supervisor directed Ben.',
                message_type: 'message',
                duration_ms: null,
                cost_usd: null,
                created_at: '2026-03-18T22:04:00.000Z',
                metadata: {},
              },
            ],
            summary: {
              task_count: 3,
              participant_count: 3,
              thought_count: 1,
              message_count: 3,
              delegation_count: 2,
            },
          };
        }

        if (
          path === '/tasks/task-root/messages' &&
          options?.method === 'POST'
        ) {
          return { id: 'msg-new' };
        }

        throw new Error(`Unexpected request path: ${path}`);
      }
    );

    useApiMock.mockReturnValue({
      request: requestMock,
      loading: false,
      error: null,
      lastTrace: {
        traceId: 'task-trace-1234abcd',
        path: '/tasks/task-root/collaboration',
        method: 'GET',
        status: 200,
        capturedAt: '2026-03-18T22:10:00.000Z',
      },
    });
    useWebSocketMock.mockReturnValue(null);
    useCompanyMock.mockReturnValue({
      selectedCompanyId: 'company-1',
    });
  });

  it(
    'renders task force mode with live co-reasoning and delegated workstreams',
    async () => {
    render(
      <MemoryRouter
        initialEntries={['/tasks/task-root']}
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
      >
        <Routes>
          <Route path="/tasks/:id" element={<TaskDetailPage />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(requestMock).toHaveBeenCalledWith(
        '/tasks/task-root/collaboration',
        undefined,
        undefined
      );
    });

    await waitFor(() => {
      expect(screen.getByText('Task Force Mode')).toBeTruthy();
    });

    expect(screen.getByText('Task Timeline')).toBeTruthy();
    expect(
      screen.getAllByText('Ship launch plan').length
    ).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Ada reasoned out loud.')).toBeTruthy();
    expect(
      screen.getByText('Pressure-test the new headline stack before noon.')
    ).toBeTruthy();
    expect(
      screen.getAllByText('Delegation diff').length
    ).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText('Assigned owner').length).toBeGreaterThanOrEqual(
      2
    );
    expect(screen.getAllByText('Fast handoff').length).toBeGreaterThanOrEqual(
      2
    );
    expect(screen.getAllByText('Stuck').length).toBeGreaterThanOrEqual(2);
    expect(
      screen.getByText('Child task picked up within the first minute.')
    ).toBeTruthy();
    expect(
      screen.getByText(
        'Delegation health: Child task picked up within the first minute.'
      )
    ).toBeTruthy();
    expect(
      screen.getAllByText('First visible move').length
    ).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText('Completed in').length).toBeGreaterThanOrEqual(
      2
    );
    expect(screen.getByText('10s')).toBeTruthy();
    expect(screen.getByText('3m')).toBeTruthy();
    expect(
      screen
        .getAllByRole('link', { name: 'Open delegated task' })
        .some((link) =>
          link.getAttribute('href')?.includes('/tasks/task-child')
        )
    ).toBe(true);
    expect(screen.getByText('Task Force Map')).toBeTruthy();
    expect(
      screen.getAllByText('Delegated: Validate messaging').length
    ).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Team Readout')).toBeTruthy();
    expect(screen.getByText('1 stuck')).toBeTruthy();
    expect(screen.getByText('0 slow start')).toBeTruthy();
    expect(screen.getByText('1 fast handoff')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Tooling (2)' })).toBeTruthy();
    expect(
      screen.getByRole('link', { name: 'Open in Grafana' }).getAttribute('href')
    ).toContain('task-trace-1234abcd');

    fireEvent.change(screen.getByLabelText('taskMessage'), {
      target: { value: 'Lock the stronger option by 3pm.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() => {
      expect(requestMock).toHaveBeenCalledWith(
        '/tasks/task-root/messages',
        expect.objectContaining({
          method: 'POST',
        })
      );
    });
    },
    15000
  );

  it('shows replay fork provenance for forked task branches', async () => {
    requestMock.mockImplementationOnce(async (path: string) => {
      if (path === '/tasks/task-root/collaboration') {
        return {
          generated_at: '2026-03-18T22:10:00.000Z',
          root_task: {
            id: 'task-root',
            title: 'Ship launch plan',
            description:
              'Coordinate launch prep across a tight AI strike team.',
            status: 'in_progress',
          },
          current_task: {
            id: 'task-root',
            title: 'Ship launch plan',
            description:
              'Coordinate launch prep across a tight AI strike team.',
            status: 'in_progress',
            fork_origin: {
              source_agent_id: 'agent-7',
              source_task_id: 'task-source',
              source_event_id: 'heartbeat:heartbeat-7',
              source_action: 'heartbeat.completed',
              source_timestamp: '2026-03-18T21:45:00.000Z',
              prompt_override: true,
            },
          },
          tasks: [
            {
              id: 'task-root',
              parent_id: null,
              title: 'Ship launch plan',
              description:
                'Coordinate launch prep across a tight AI strike team.',
              status: 'in_progress',
              assigned_to: 'agent-1',
              assigned_to_name: 'Ada',
              assigned_to_role: 'Lead Strategist',
              assigned_to_status: 'working',
              priority: 10,
              depth: 0,
              created_at: '2026-03-18T22:00:00.000Z',
              updated_at: '2026-03-18T22:04:00.000Z',
              completed_at: null,
            },
          ],
          participants: [],
          timeline: [],
          summary: {
            task_count: 1,
            participant_count: 0,
            thought_count: 0,
            message_count: 0,
            delegation_count: 0,
          },
        };
      }

      throw new Error(`Unexpected request path: ${path}`);
    });

    render(
      <MemoryRouter
        initialEntries={['/tasks/task-root']}
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
      >
        <Routes>
          <Route path="/tasks/:id" element={<TaskDetailPage />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('Replay fork')).toBeTruthy();
    });

    expect(screen.getByText(/Forked from/)).toBeTruthy();
    expect(
      screen.getByRole('link', { name: 'source task' }).getAttribute('href')
    ).toBe('/tasks/task-source');
    expect(
      screen
        .getByRole('link', { name: 'Open source replay' })
        .getAttribute('href')
    ).toBe(
      '/agents/agent-7?task_id=task-source&event_id=heartbeat%3Aheartbeat-7'
    );
    expect(
      screen.getByText('Replay event: heartbeat:heartbeat-7')
    ).toBeTruthy();
    expect(screen.getByText('Prompt override included')).toBeTruthy();
  });

  it('filters the timeline by event type and expands grouped tool activity', async () => {
    render(
      <MemoryRouter
        initialEntries={['/tasks/task-root']}
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
      >
        <Routes>
          <Route path="/tasks/:id" element={<TaskDetailPage />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Tooling (2)' })).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Tooling (2)' }));

    await waitFor(() => {
      expect(screen.getByText('Tool sequence')).toBeTruthy();
      expect(screen.queryByText('Ada reasoned out loud.')).toBeNull();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Expand' }));

    await waitFor(() => {
      expect(
        screen.getByText('Tool called web_search with Europe pricing query.')
      ).toBeTruthy();
      expect(
        screen.getByText('Tool Result (web_search): {"query":"Europe pricing"}')
      ).toBeTruthy();
    });
  });

  it('filters Task Force Map to risky handoffs only', async () => {
    render(
      <MemoryRouter
        initialEntries={['/tasks/task-root']}
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
      >
        <Routes>
          <Route path="/tasks/:id" element={<TaskDetailPage />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: 'Show only risky handoffs (1)' })
      ).toBeTruthy();
    });

    fireEvent.click(
      screen.getByRole('button', { name: 'Show only risky handoffs (1)' })
    );

    await waitFor(() => {
      const taskForceMapSection = screen
        .getByText('Task Force Map')
        .closest('section');
      if (!taskForceMapSection) {
        throw new Error('Expected Task Force Map section');
      }

      const taskForceMap = within(taskForceMapSection);
      expect(
        screen.getByRole('button', { name: 'Show all workstreams' })
      ).toBeTruthy();
      expect(
        taskForceMap.getAllByText('Ship launch plan').length
      ).toBeGreaterThanOrEqual(1);
      expect(
        taskForceMap.queryByText('Delegated: Validate messaging')
      ).toBeNull();
      expect(taskForceMap.getAllByText('Stuck').length).toBeGreaterThanOrEqual(
        1
      );
      expect(
        taskForceMap.getByText(
          'Delegation health: Delegated child task has no visible follow-up activity yet.'
        )
      ).toBeTruthy();
    });
  });

  it('filters Task Force Map from summary facets', async () => {
    render(
      <MemoryRouter
        initialEntries={['/tasks/task-root']}
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
      >
        <Routes>
          <Route path="/tasks/:id" element={<TaskDetailPage />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '1 stuck' })).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: '1 stuck' }));

    await waitFor(() => {
      const taskForceMapSection = screen
        .getByText('Task Force Map')
        .closest('section');
      if (!taskForceMapSection) {
        throw new Error('Expected Task Force Map section');
      }

      const taskForceMap = within(taskForceMapSection);
      expect(taskForceMap.getAllByText('Stuck').length).toBeGreaterThanOrEqual(
        1
      );
      expect(
        taskForceMap.queryByText('Delegated: Validate messaging')
      ).toBeNull();
      expect(
        taskForceMap.getByRole('button', { name: 'Clear facet' })
      ).toBeTruthy();
      expect(
        taskForceMap.getByText(
          'Delegation health: Delegated child task has no visible follow-up activity yet.'
        )
      ).toBeTruthy();
    });
  });

  it('restores Task Force Map facet from the URL', async () => {
    render(
      <MemoryRouter
        initialEntries={['/tasks/task-root?taskMapFilter=stuck']}
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
      >
        <Routes>
          <Route path="/tasks/:id" element={<TaskDetailPage />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      const taskForceMapSection = screen
        .getByText('Task Force Map')
        .closest('section');
      if (!taskForceMapSection) {
        throw new Error('Expected Task Force Map section');
      }

      const taskForceMap = within(taskForceMapSection);
      expect(
        taskForceMap.getByRole('button', { name: 'Clear facet' })
      ).toBeTruthy();
      expect(taskForceMap.getAllByText('Stuck').length).toBeGreaterThanOrEqual(
        1
      );
      expect(
        taskForceMap.queryByText('Delegated: Validate messaging')
      ).toBeNull();
      expect(
        taskForceMap.getByText(
          'Delegation health: Delegated child task has no visible follow-up activity yet.'
        )
      ).toBeTruthy();
    });
  });

  it('persists timeline filter and expanded tool sequence in the URL', async () => {
    render(
      <MemoryRouter
        initialEntries={['/tasks/task-root']}
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
      >
        <Routes>
          <Route
            path="/tasks/:id"
            element={
              <>
                <TaskDetailPage />
                <LocationProbe />
              </>
            }
          />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Tooling (2)' })).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Tooling (2)' }));

    await waitFor(() => {
      expect(screen.getByTestId('location-search').textContent).toContain(
        'timelineFilter=tool'
      );
      expect(screen.getByText('Tool sequence')).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Expand' }));

    await waitFor(() => {
      const search = screen.getByTestId('location-search').textContent || '';
      expect(search).toContain('timelineFilter=tool');
      expect(search).toContain('expandedTools=');
      expect(search).toContain('tool-1-tool-2');
      expect(
        screen.getByText('Tool called web_search with Europe pricing query.')
      ).toBeTruthy();
    });
  });

  it('restores timeline filter and expanded tool sequence from the URL', async () => {
    render(
      <MemoryRouter
        initialEntries={[
          '/tasks/task-root?timelineFilter=tool&expandedTools=2026-03-18T22%3A02%3A00.000Z-task-child-tool-1-tool-2',
        ]}
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
      >
        <Routes>
          <Route path="/tasks/:id" element={<TaskDetailPage />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('Tool sequence')).toBeTruthy();
      expect(screen.queryByText('Ada reasoned out loud.')).toBeNull();
      expect(
        screen.getByText('Tool called web_search with Europe pricing query.')
      ).toBeTruthy();
    });
  });

  it('persists the active page mode in the URL', async () => {
    render(
      <MemoryRouter
        initialEntries={['/tasks/task-root']}
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
      >
        <Routes>
          <Route
            path="/tasks/:id"
            element={
              <>
                <TaskDetailPage />
                <LocationProbe />
              </>
            }
          />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Overview' })).toBeTruthy();
      expect(screen.getByText('Task Timeline')).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Overview' }));

    await waitFor(() => {
      expect(screen.getByText('Mission Overview')).toBeTruthy();
      expect(screen.queryByText('Task Timeline')).toBeNull();
      expect(screen.getByTestId('location-search').textContent).toContain(
        'view=overview'
      );
    });

    fireEvent.click(screen.getByRole('button', { name: 'Task Force' }));

    await waitFor(() => {
      const search = screen.getByTestId('location-search').textContent || '';
      expect(screen.getByText('Task Timeline')).toBeTruthy();
      expect(search).not.toContain('view=');
    });
  });

  it('restores the active page mode from the URL', async () => {
    render(
      <MemoryRouter
        initialEntries={['/tasks/task-root?view=overview']}
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
      >
        <Routes>
          <Route path="/tasks/:id" element={<TaskDetailPage />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('Mission Overview')).toBeTruthy();
      expect(screen.getByText('Recent activity')).toBeTruthy();
      expect(screen.queryByText('Task Timeline')).toBeNull();
      expect(screen.getByText('Task Force Map')).toBeTruthy();
    });
  });

  it('persists the focused Task Force Map workstream in the URL', async () => {
    render(
      <MemoryRouter
        initialEntries={['/tasks/task-root']}
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
      >
        <Routes>
          <Route
            path="/tasks/:id"
            element={
              <>
                <TaskDetailPage />
                <LocationProbe />
              </>
            }
          />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(
        screen.getAllByRole('button', { name: 'Focus' }).length
      ).toBeGreaterThan(0);
    });

    fireEvent.click(screen.getAllByRole('button', { name: 'Focus' })[1]);

    await waitFor(() => {
      const taskForceMapSection = screen
        .getByText('Task Force Map')
        .closest('section');
      if (!taskForceMapSection) {
        throw new Error('Expected Task Force Map section');
      }

      const taskForceMap = within(taskForceMapSection);
      expect(taskForceMap.getByText('Map focus')).toBeTruthy();
      expect(
        taskForceMap.getAllByText('Delegated: Validate messaging').length
      ).toBeGreaterThanOrEqual(1);
      expect(
        taskForceMap.getByRole('button', { name: 'Focused' })
      ).toBeTruthy();
      expect(screen.getByTestId('location-search').textContent).toContain(
        'taskFocus=task-child'
      );
    });

    fireEvent.click(screen.getByRole('button', { name: 'Clear focus' }));

    await waitFor(() => {
      const search = screen.getByTestId('location-search').textContent || '';
      expect(search).not.toContain('taskFocus=');
    });
  });

  it('restores the focused Task Force Map workstream from the URL', async () => {
    render(
      <MemoryRouter
        initialEntries={['/tasks/task-root?taskFocus=task-risk']}
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
      >
        <Routes>
          <Route path="/tasks/:id" element={<TaskDetailPage />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      const taskForceMapSection = screen
        .getByText('Task Force Map')
        .closest('section');
      if (!taskForceMapSection) {
        throw new Error('Expected Task Force Map section');
      }

      const taskForceMap = within(taskForceMapSection);
      expect(taskForceMap.getByText('Map focus')).toBeTruthy();
      expect(
        taskForceMap.getAllByText('Delegated: Pricing audit').length
      ).toBeGreaterThanOrEqual(1);
      expect(
        taskForceMap.getByRole('button', { name: 'Focused' })
      ).toBeTruthy();
    });
  });
});
