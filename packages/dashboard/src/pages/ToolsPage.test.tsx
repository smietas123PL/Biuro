import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ToolsPage from './ToolsPage';

const requestMock = vi.hoisted(() => vi.fn());
const useApiMock = vi.hoisted(() => vi.fn());
const useCompanyMock = vi.hoisted(() => vi.fn());

vi.mock('../hooks/useApi', () => ({
  useApi: () => useApiMock(),
}));

vi.mock('../context/CompanyContext', () => ({
  useCompany: () => useCompanyMock(),
}));

const toolsResponse = [
  {
    id: 'tool-1',
    name: 'web_search',
    description: 'Search current public information.',
    type: 'builtin' as const,
    config: { builtin: 'web_search' },
    agent_count: 1,
    assigned_agents: [{ agent_id: 'agent-1', agent_name: 'Ada' }],
    usage: {
      total_calls: 12,
      success_count: 9,
      error_count: 3,
      last_called_at: '2026-03-18T11:10:00.000Z',
      last_status: 'error' as const,
    },
    recent_calls: [
      {
        id: 'call-2',
        task_id: 'task-2',
        agent_id: 'agent-1',
        task_title: 'Prepare launch notes',
        agent_name: 'Ada',
        status: 'error' as const,
        duration_ms: 1200,
        created_at: '2026-03-18T11:10:00.000Z',
      },
    ],
  },
  {
    id: 'tool-2',
    name: 'deploy_script',
    description: 'Deploys the latest release candidate.',
    type: 'bash' as const,
    config: { allowed_commands: ['git status'] },
    agent_count: 0,
    assigned_agents: [],
    usage: {
      total_calls: 0,
      success_count: 0,
      error_count: 0,
      last_called_at: null,
      last_status: null,
    },
    recent_calls: [],
  },
];

const agentsResponse = [
  { id: 'agent-1', name: 'Ada', role: 'research', status: 'idle' },
  { id: 'agent-2', name: 'Ben', role: 'ops', status: 'idle' },
];

const baseHistoryResponse = {
  tool: {
    id: 'tool-1',
    company_id: 'company-1',
    name: 'web_search',
    description: 'Search current public information.',
    type: 'builtin' as const,
    created_at: '2026-03-18T10:00:00.000Z',
  },
  filters: {
    status: null,
    agent_id: null,
  },
  pagination: {
    page: 1,
    limit: 10,
    total: 12,
    total_pages: 2,
    has_more: true,
  },
  summary: {
    total_calls: 12,
    success_count: 9,
    error_count: 3,
    last_called_at: '2026-03-18T11:10:00.000Z',
  },
  items: [
    {
      id: 'call-12',
      task_id: 'task-12',
      agent_id: 'agent-1',
      task_title: 'Prepare launch notes',
      agent_name: 'Ada',
      status: 'error' as const,
      duration_ms: 1200,
      created_at: '2026-03-18T11:10:00.000Z',
      input: { query: 'launch blockers' },
      output: { error: 'Provider timeout' },
    },
  ],
};

describe('ToolsPage', () => {
  beforeEach(() => {
    requestMock.mockReset();
    useApiMock.mockReset();
    useCompanyMock.mockReset();
    vi.stubGlobal('confirm', vi.fn(() => true));

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

  it('supports CRUD, bootstrap, assignment, testing, and history detail', async () => {
    requestMock.mockImplementation((path: string, options?: RequestInit) => {
      if (path === '/companies/company-1/tools') return Promise.resolve(toolsResponse);
      if (path === '/companies/company-1/agents') return Promise.resolve(agentsResponse);
      if (path === '/companies/company-1/tools/tool-1/calls?page=1&limit=10') return Promise.resolve(baseHistoryResponse);
      if (path === '/companies/company-1/tools/seed') return Promise.resolve({ inserted: ['file_write'], existing: ['web_search'] });
      if (path === '/companies/company-1/tools' && options?.method === 'POST') return Promise.resolve({ id: 'tool-3', name: 'file_write' });
      if (path === '/companies/company-1/tools/tool-1' && options?.method === 'PATCH') return Promise.resolve({ ok: true });
      if (path === '/companies/company-1/tools/tool-1/test') return Promise.resolve({ ok: true, duration_ms: 42, output: { ok: true } });
      if (path === '/companies/company-1/tools/tool-1/assign') return Promise.resolve({ ok: true });
      if (path === '/companies/company-1/tools/tool-1/assign/agent-1') return Promise.resolve({ ok: true });
      if (path === '/companies/company-1/tools/tool-1' && options?.method === 'DELETE') return Promise.resolve({ ok: true });
      return Promise.reject(new Error(`Unexpected request path: ${path}`));
    });

    render(
      <MemoryRouter initialEntries={['/tools?tool=tool-1']}>
        <ToolsPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(requestMock).toHaveBeenCalledWith('/companies/company-1/tools');
      expect(requestMock).toHaveBeenCalledWith('/companies/company-1/agents');
    });

    await waitFor(() => {
      expect(requestMock).toHaveBeenCalledWith(
        '/companies/company-1/tools/tool-1/calls?page=1&limit=10',
        undefined,
        { suppressError: true }
      );
    });

    fireEvent.click(screen.getByRole('button', { name: 'Seed default tools' }));
    await waitFor(() => {
      expect(requestMock).toHaveBeenCalledWith('/companies/company-1/tools/seed', { method: 'POST' });
    });
    expect(screen.getByText('Seeded defaults: 1 inserted, 1 already present.')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Edit tool name'), { target: { value: 'web_search_v2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save tool changes' }));
    await waitFor(() => {
      expect(requestMock).toHaveBeenCalledWith('/companies/company-1/tools/tool-1', {
        method: 'PATCH',
        body: JSON.stringify({
          name: 'web_search_v2',
          description: 'Search current public information.',
          type: 'builtin',
          config: { builtin: 'web_search' },
        }),
      });
    });

    fireEvent.change(screen.getByLabelText('Tool test input'), {
      target: { value: JSON.stringify({ query: 'Biuro' }, null, 2) },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Run tool test' }));
    await waitFor(() => {
      expect(requestMock).toHaveBeenCalledWith(
        '/companies/company-1/tools/tool-1/test',
        {
          method: 'POST',
          body: JSON.stringify({ input: { query: 'Biuro' } }),
        },
        { suppressError: true }
      );
    });
    expect(screen.getByText('42 ms')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Assign tool to agent'), { target: { value: 'agent-2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Assign to agent' }));
    await waitFor(() => {
      expect(requestMock).toHaveBeenCalledWith('/companies/company-1/tools/tool-1/assign', {
        method: 'POST',
        body: JSON.stringify({ agent_id: 'agent-2' }),
      });
    });

    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    await waitFor(() => {
      expect(requestMock).toHaveBeenCalledWith('/companies/company-1/tools/tool-1/assign/agent-1', {
        method: 'DELETE',
      });
    });

    expect(screen.getByText('Execution history')).toBeTruthy();
    expect(screen.getByText('Selected call payload')).toBeTruthy();
    expect(screen.getAllByText((content) => content.includes('Provider timeout')).length).toBeGreaterThanOrEqual(1);

    fireEvent.click(screen.getByRole('button', { name: 'Delete tool' }));
    await waitFor(() => {
      expect(requestMock).toHaveBeenCalledWith('/companies/company-1/tools/tool-1', { method: 'DELETE' });
    });

    fireEvent.change(screen.getByLabelText('Create tool name'), { target: { value: 'file_write' } });
    fireEvent.change(screen.getByLabelText('Create tool config'), {
      target: { value: JSON.stringify({ builtin: 'file_write' }, null, 2) },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create tool' }));
    await waitFor(() => {
      expect(requestMock).toHaveBeenCalledWith('/companies/company-1/tools', {
        method: 'POST',
        body: JSON.stringify({
          company_id: 'company-1',
          name: 'file_write',
          description: undefined,
          type: 'builtin',
          config: { builtin: 'file_write' },
        }),
      });
    });
  });
});
