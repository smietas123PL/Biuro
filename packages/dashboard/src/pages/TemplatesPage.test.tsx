import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import TemplatesPage from './TemplatesPage';

const requestMock = vi.hoisted(() => vi.fn());
const useApiMock = vi.hoisted(() => vi.fn());
const useCompanyMock = vi.hoisted(() => vi.fn());

vi.mock('../hooks/useApi', () => ({
  useApi: () => useApiMock(),
}));

vi.mock('../context/CompanyContext', () => ({
  useCompany: () => useCompanyMock(),
}));

function buildMarketplacePreview() {
  return {
    preview: {
      preserve_company_identity: true,
      company: {
        resulting_name: 'QA Test Corp',
        resulting_mission: 'Run support ops.',
      },
      current: { goals: 1, agents: 1, tools: 1, policies: 1 },
      incoming: { goals: 3, agents: 2, tools: 2, policies: 1 },
      changes: {
        total_new_records: 5,
        tools_to_create: 1,
        tools_to_update: 1,
        budgets_to_add: 1,
      },
      collisions: {
        agent_names: [],
        goal_titles: [],
        policy_names: [],
        tool_names: [],
      },
      record_changes: {
        goals_to_add: ['Triage inbox'],
        agents_to_add: ['Riley'],
        policies_to_add: ['Escalation guardrail'],
        tools_to_create: ['web_search'],
        tools_to_update: [],
        budgets_to_add: [],
      },
      projected: {
        goals: { count: 2, names: ['Triage inbox'] },
        agents: { count: 2, names: ['Riley'] },
        tools: { count: 2, names: ['web_search'] },
        policies: { count: 2, names: ['Escalation guardrail'] },
        budgets: { count: 1, agent_names: ['Riley'] },
      },
      warnings: [],
    },
  };
}

describe('TemplatesPage', () => {
  beforeEach(() => {
    requestMock.mockReset();
    useApiMock.mockReset();
    useCompanyMock.mockReset();

    requestMock.mockImplementation(
      async (path: string, options?: RequestInit) => {
        if (path === '/templates/presets') {
          return [
            {
              id: 'local-1',
              name: 'Local Starter',
              description: 'Local preset',
              recommended_for: 'Internal teams',
              summary: { goals: 1, agents: 1, tools: 1, policies: 1 },
            },
          ];
        }

        if (path === '/templates/marketplace') {
          return {
            catalog: {
              name: 'Biuro Marketplace',
              source_type: 'remote',
              source_url: 'https://marketplace.test/templates.json',
            },
            templates: [
              {
                id: 'market-1',
                name: 'Support Ops Pack',
                description: 'External support template',
                recommended_for: 'Ops teams',
                vendor: 'Ops Guild',
                categories: ['support', 'ops'],
                badge: 'Featured',
                source_url: 'https://marketplace.test/support-ops-pack',
                summary: { goals: 3, agents: 2, tools: 2, policies: 1 },
              },
            ],
          };
        }

        if (path === '/agents?company_id=company-1') {
          return [
            {
              id: 'agent-1',
              name: 'Riley',
              role: 'ops_lead',
              title: 'Ops Lead',
              status: 'working',
            },
            {
              id: 'agent-2',
              name: 'Mina',
              role: 'researcher',
              title: 'Research Analyst',
              status: 'idle',
            },
          ];
        }

        if (path === '/templates/marketplace/market-1') {
          return {
            id: 'market-1',
            name: 'Support Ops Pack',
            description: 'External support template',
            recommended_for: 'Ops teams',
            vendor: 'Ops Guild',
            categories: ['support', 'ops'],
            badge: 'Featured',
            source_url: 'https://marketplace.test/support-ops-pack',
            template: {
              company: {
                name: 'Support Ops Pack',
                mission: 'Run support ops.',
              },
              goals: [{ title: 'Triage inbox' }],
              agents: [{ name: 'Riley', role: 'ops_lead' }],
              tools: [{ name: 'web_search', type: 'builtin' }],
              policies: [
                { name: 'Escalation guardrail', type: 'approval_required' },
              ],
            },
          };
        }

        if (path === '/templates/marketplace/market-1/dry-run') {
          return buildMarketplacePreview();
        }

        if (
          path === '/templates/import-marketplace/market-1' &&
          options?.method === 'POST'
        ) {
          return {
            template: {
              id: 'market-1',
              name: 'Support Ops Pack',
              vendor: 'Ops Guild',
            },
          };
        }

        if (path === '/templates/ai-suggest' && options?.method === 'POST') {
          return {
            suggestion: {
              title: 'Review competitor pricing changes',
              description:
                'Inspect recent competitor pricing updates, summarize the main deltas, and flag anything that needs a response from the team.',
              priority: 72,
              default_role: 'researcher',
              suggested_agent_id: 'agent-2',
              suggested_agent_name: 'Mina',
              confidence: 'high',
              warnings: [],
            },
            planner: {
              mode: 'llm',
              runtime: 'claude',
              model: 'claude-sonnet',
              fallback_reason: null,
            },
          };
        }

        if (path === '/tasks' && options?.method === 'POST') {
          return {
            id: 'task-ai-1',
            title: 'Review competitor pricing changes',
          };
        }

        throw new Error(`Unexpected request path: ${path}`);
      }
    );

    useApiMock.mockReturnValue({
      request: requestMock,
      loading: false,
      error: null,
    });
    useCompanyMock.mockReturnValue({
      selectedCompany: { id: 'company-1', name: 'QA Test Corp' },
      selectedCompanyId: 'company-1',
    });
  });

  it('loads marketplace templates and installs them through the dry-run flow', async () => {
    render(<TemplatesPage />);

    await waitFor(() => {
      expect(requestMock).toHaveBeenCalledWith('/templates/presets');
      expect(requestMock).toHaveBeenCalledWith('/templates/marketplace');
      expect(requestMock).toHaveBeenCalledWith(
        '/agents?company_id=company-1',
        undefined,
        {
          suppressError: true,
        }
      );
    });

    await waitFor(() => {
      expect(screen.getByText('Biuro Marketplace')).toBeTruthy();
    });

    expect(screen.getAllByText('Support Ops Pack').length).toBeGreaterThan(0);
    await waitFor(() => {
      expect(screen.getByText(/Published by:/)).toBeTruthy();
      expect(screen.getAllByText(/Ops Guild/).length).toBeGreaterThan(0);
      expect(screen.getByText('Dry run before install')).toBeTruthy();
    });

    fireEvent.change(screen.getByPlaceholderText('Type IMPORT to confirm'), {
      target: { value: 'IMPORT' },
    });
    fireEvent.click(
      screen.getByRole('button', { name: 'Install Into QA Test Corp' })
    );

    await waitFor(() => {
      expect(requestMock).toHaveBeenCalledWith(
        '/templates/import-marketplace/market-1',
        { method: 'POST' }
      );
    });

    expect(
      screen.getByText('Installed "Support Ops Pack" into QA Test Corp.')
    ).toBeTruthy();
  });

  it('generates an AI draft and creates a task from it', async () => {
    render(<TemplatesPage />);

    await waitFor(() => {
      expect(screen.getByText('AI Pre-fill')).toBeTruthy();
    });

    fireEvent.change(
      screen.getByLabelText('Describe the work in plain language'),
      {
        target: {
          value:
            'sprawdz czy konkurencja obniżyła ceny i przygotuj krótkie podsumowanie',
        },
      }
    );
    fireEvent.click(screen.getByRole('button', { name: 'Generate AI Draft' }));

    await waitFor(() => {
      expect(requestMock).toHaveBeenCalledWith(
        '/templates/ai-suggest',
        expect.objectContaining({
          method: 'POST',
        })
      );
      expect(
        screen.getByDisplayValue('Review competitor pricing changes')
      ).toBeTruthy();
      expect(screen.getByText('Planned by claude')).toBeTruthy();
    });

    fireEvent.click(
      screen.getByRole('button', { name: 'Create Task From Draft' })
    );

    await waitFor(() => {
      expect(requestMock).toHaveBeenCalledWith(
        '/tasks',
        expect.objectContaining({
          method: 'POST',
        })
      );
    });

    expect(
      screen.getByText(
        'Created task "Review competitor pricing changes" from AI draft.'
      )
    ).toBeTruthy();
  });
});
