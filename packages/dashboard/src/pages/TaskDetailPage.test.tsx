import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
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

describe('TaskDetailPage', () => {
  beforeEach(() => {
    requestMock.mockReset();
    useApiMock.mockReset();
    useWebSocketMock.mockReset();
    useCompanyMock.mockReset();

    requestMock.mockImplementation(async (path: string, options?: RequestInit) => {
      if (path === '/tasks/task-root/collaboration') {
        return {
          generated_at: '2026-03-18T22:10:00.000Z',
          root_task: {
            id: 'task-root',
            title: 'Ship launch plan',
            description: 'Coordinate launch prep across a tight AI strike team.',
            status: 'in_progress',
          },
          current_task: {
            id: 'task-root',
            title: 'Ship launch plan',
            description: 'Coordinate launch prep across a tight AI strike team.',
            status: 'in_progress',
          },
          tasks: [
            {
              id: 'task-root',
              parent_id: null,
              title: 'Ship launch plan',
              description: 'Coordinate launch prep across a tight AI strike team.',
              status: 'in_progress',
              assigned_to: 'agent-1',
              assigned_to_name: 'Ada',
              assigned_to_role: 'Lead Strategist',
              assigned_to_status: 'working',
              priority: 10,
              depth: 0,
              created_at: '2026-03-18T22:00:00.000Z',
              updated_at: '2026-03-18T22:04:00.000Z',
            },
            {
              id: 'task-child',
              parent_id: 'task-root',
              title: 'Delegated: Validate messaging',
              description: 'Pressure-test the hero headline.',
              status: 'assigned',
              assigned_to: 'agent-2',
              assigned_to_name: 'Ben',
              assigned_to_role: 'Messaging Specialist',
              assigned_to_status: 'idle',
              priority: 0,
              depth: 1,
              created_at: '2026-03-18T22:02:00.000Z',
              updated_at: '2026-03-18T22:03:00.000Z',
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
              content: 'Ben should challenge the narrative before we lock the copy.',
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
              metadata: {},
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
            task_count: 2,
            participant_count: 2,
            thought_count: 1,
            message_count: 1,
            delegation_count: 1,
          },
        };
      }

      if (path === '/tasks/task-root/messages' && options?.method === 'POST') {
        return { id: 'msg-new' };
      }

      throw new Error(`Unexpected request path: ${path}`);
    });

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

  it('renders task force mode with live co-reasoning and delegated workstreams', async () => {
    render(
      <MemoryRouter initialEntries={['/tasks/task-root']} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <Routes>
          <Route path="/tasks/:id" element={<TaskDetailPage />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(requestMock).toHaveBeenCalledWith('/tasks/task-root/collaboration', undefined, undefined);
    });

    expect(screen.getByText('Task Force Mode')).toBeTruthy();
    expect(screen.getByText('Live Co-Reasoning Window')).toBeTruthy();
    expect(screen.getAllByText('Ship launch plan').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Ada reasoned out loud.')).toBeTruthy();
    expect(screen.getByText('Pressure-test the new headline stack before noon.')).toBeTruthy();
    expect(screen.getByText('Task Force Map')).toBeTruthy();
    expect(screen.getAllByText('Delegated: Validate messaging').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Team Readout')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Open in Grafana' }).getAttribute('href')).toContain('task-trace-1234abcd');

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
  });
});
