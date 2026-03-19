import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { CommandPalette } from './CommandPalette';

const requestMock = vi.hoisted(() => vi.fn());
const navigateMock = vi.hoisted(() => vi.fn());

vi.mock('../hooks/useApi', () => ({
  useApi: () => ({
    request: requestMock,
    loading: false,
    error: null,
    lastTrace: null,
  }),
}));

vi.mock('../context/CompanyContext', () => ({
  useCompany: () => ({
    selectedCompany: {
      id: 'company-1',
      name: 'Acme Labs',
      role: 'admin',
    },
    selectedCompanyId: 'company-1',
  }),
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => navigateMock,
  };
});

describe('CommandPalette natural language plan', () => {
  beforeEach(() => {
    requestMock.mockReset();
    navigateMock.mockReset();

    requestMock.mockImplementation(async (path: string, options?: RequestInit) => {
      if (path === '/companies/company-1/agents') {
        return [];
      }

      if (path === '/companies/company-1/tasks') {
        if (options?.method === 'POST') {
          return { id: 'task-1' };
        }
        return [];
      }

      if (path === '/companies/company-1/goals') {
        return [];
      }

      if (path === '/companies/company-1/tools') {
        return [];
      }

      if (path === '/companies/company-1/approvals') {
        return [];
      }

      if (path === '/nl-command') {
        return {
          source: 'rules',
          original_input: 'create task Prepare launch notes',
          summary: 'Prepared a 2-step execution plan.',
          reasoning: 'Matched the request against safe dashboard actions and existing company records.',
          warnings: [],
          can_execute: true,
          planner: {
            mode: 'llm',
            runtime: 'claude',
            model: 'claude-sonnet-4',
            attempts: [
              {
                runtime: 'claude',
                model: 'claude-sonnet-4',
                status: 'success',
              },
            ],
            fallback_reason: null,
          },
          actions: [
            {
              id: 'create-task',
              type: 'api_request',
              label: 'Create task: Prepare launch notes',
              description: 'Create a new task in the backlog.',
              endpoint: '/companies/company-1/tasks',
              method: 'POST',
              body: {
                title: 'Prepare launch notes',
              },
              requires_confirmation: true,
              success_message: 'Task "Prepare launch notes" created.',
            },
            {
              id: 'navigate-tasks',
              type: 'navigate',
              label: 'Open Tasks',
              description: 'Navigate to the tasks page after creation.',
              path: '/tasks',
              requires_confirmation: false,
            },
          ],
        };
      }

      throw new Error(`Unhandled request ${path}`);
    });
  });

  it('interprets a natural language command and executes the returned plan', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();

    render(
      <MemoryRouter>
        <CommandPalette open onClose={onClose} />
      </MemoryRouter>
    );

    await user.type(screen.getByPlaceholderText('Search Acme Labs or type a command...'), 'create task Prepare launch notes');
    await user.click(screen.getByRole('button', { name: 'Plan' }));

    await waitFor(() => {
      expect(screen.getByText('Prepared a 2-step execution plan.')).toBeTruthy();
    });
    expect(screen.getByText('Planned by Claude')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Execute plan' }));

    await waitFor(() => {
      expect(requestMock).toHaveBeenCalledWith(
        '/companies/company-1/tasks',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            title: 'Prepare launch notes',
          }),
        })
      );
    });

    expect(requestMock).toHaveBeenCalledWith(
      '/nl-command',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          input: 'create task Prepare launch notes',
        }),
      })
    );
    expect(navigateMock).toHaveBeenCalledWith('/tasks');
    expect(onClose).toHaveBeenCalled();
  });
});
