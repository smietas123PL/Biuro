import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import GoalsPage from './GoalsPage';

const requestMock = vi.hoisted(() => vi.fn());
const useApiMock = vi.hoisted(() => vi.fn());
const useCompanyMock = vi.hoisted(() => vi.fn());

vi.mock('../hooks/useApi', () => ({
  useApi: () => useApiMock(),
}));

vi.mock('../context/CompanyContext', () => ({
  useCompany: () => useCompanyMock(),
}));

describe('GoalsPage', () => {
  beforeEach(() => {
    requestMock.mockReset();
    useApiMock.mockReset();
    useCompanyMock.mockReset();

    requestMock.mockImplementation(
      async (path: string, options?: RequestInit) => {
        if (path === '/companies/company-1/goals') {
          return [
            {
              id: 'goal-existing',
              parent_id: null,
              title: 'Existing operating cadence',
              description: 'Keep the weekly delivery rhythm visible.',
              status: 'active',
            },
          ];
        }

        if (path === '/companies/company-1/agents') {
          return [
            {
              id: 'agent-1',
              name: 'Mina',
              role: 'partnerships',
              title: 'Partnership Lead',
            },
          ];
        }

        if (path === '/companies/company-1/goals/ai-decompose') {
          expect(options).toMatchObject({
            method: 'POST',
          });

          return {
            suggestion: {
              title: 'Launch the partner program',
              description:
                'Coordinate the partner launch with clear sequencing and ownership.',
              goals: [
                {
                  ref: 'goal-root',
                  parent_ref: null,
                  title: 'Launch the partner program',
                  description:
                    'Coordinate the partner launch with clear sequencing and ownership.',
                  status: 'active',
                },
                {
                  ref: 'goal-scope',
                  parent_ref: 'goal-root',
                  title: 'Define the launch scope',
                  description: 'Lock the target segment, offer, and timing.',
                  status: 'active',
                },
              ],
              starter_tasks: [
                {
                  ref: 'task-1',
                  goal_ref: 'goal-scope',
                  title: 'Starter: Define the launch scope',
                  description:
                    'Write the first scope draft and list open launch decisions.',
                  priority: 80,
                  suggested_agent_id: 'agent-1',
                  suggested_agent_name: 'Mina',
                },
              ],
              confidence: 'high',
              warnings: [],
            },
            planner: {
              mode: 'llm',
              runtime: 'claude',
            },
          };
        }

        if (path === '/companies/company-1/goals/ai-decompose/apply') {
          expect(options).toMatchObject({
            method: 'POST',
          });
          expect(JSON.parse(String(options?.body))).toMatchObject({
            suggestion: {
              title: 'Launch the partner program',
              goals: [
                expect.objectContaining({
                  title: 'Launch the partner program',
                }),
                expect.objectContaining({
                  title: 'Define the launch scope (edited)',
                }),
              ],
              starter_tasks: [
                expect.objectContaining({
                  title: 'Starter: Define the launch scope (edited)',
                  priority: 85,
                  suggested_agent_id: 'agent-1',
                  suggested_agent_name: 'Mina',
                }),
              ],
            },
          });

          return {
            ok: true,
            root_goal_id: 'goal-new-root',
            created_goal_ids: ['goal-new-root', 'goal-new-child'],
            created_goal_count: 2,
            created_task_ids: ['task-new-1'],
            created_task_count: 1,
          };
        }

        throw new Error(`Unexpected request path: ${path}`);
      }
    );

    useApiMock.mockReturnValue({
      request: requestMock,
      loading: false,
      error: null,
      lastTrace: null,
    });

    useCompanyMock.mockReturnValue({
      selectedCompany: {
        id: 'company-1',
        name: 'Acme Labs',
      },
      selectedCompanyId: 'company-1',
    });
  });

  it('generates and applies an AI goal decomposition', async () => {
    render(
      <MemoryRouter>
        <GoalsPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(requestMock).toHaveBeenCalledWith('/companies/company-1/goals');
      expect(requestMock).toHaveBeenCalledWith('/companies/company-1/agents');
    });

    fireEvent.change(
      screen.getByLabelText('Describe the mission in plain language'),
      {
        target: {
          value: 'launch our partner program in Q2 and keep ownership clear',
        },
      }
    );
    fireEvent.click(screen.getByRole('button', { name: 'Generate Goal Tree' }));

    await waitFor(() => {
      expect(screen.getByText('AI-generated goal tree')).toBeTruthy();
      expect(screen.getByText('Planned by claude')).toBeTruthy();
      expect(screen.getByDisplayValue('Define the launch scope')).toBeTruthy();
      expect(
        screen.getByDisplayValue('Starter: Define the launch scope')
      ).toBeTruthy();
      expect(screen.getByText('1 starter task')).toBeTruthy();
      expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe(
        'agent-1'
      );
    });

    fireEvent.change(screen.getByDisplayValue('Define the launch scope'), {
      target: { value: 'Define the launch scope (edited)' },
    });
    fireEvent.change(
      screen.getByDisplayValue('Starter: Define the launch scope'),
      {
        target: { value: 'Starter: Define the launch scope (edited)' },
      }
    );
    fireEvent.change(screen.getByDisplayValue('80'), {
      target: { value: '85' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Apply Goal Tree' }));

    await waitFor(() => {
      expect(requestMock).toHaveBeenCalledWith(
        '/companies/company-1/goals/ai-decompose/apply',
        expect.objectContaining({
          method: 'POST',
        })
      );
    });

    await waitFor(() => {
      expect(
        screen.getByText(
          'Applied AI decomposition with 2 goals and 1 starter task.'
        )
      ).toBeTruthy();
    });
  });
});
