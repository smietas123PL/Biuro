import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AgentsPage from './AgentsPage';

const requestMock = vi.hoisted(() => vi.fn());
const useApiMock = vi.hoisted(() => vi.fn());
const useCompanyMock = vi.hoisted(() => vi.fn());
const useOnboardingMock = vi.hoisted(() => vi.fn());

vi.mock('../hooks/useApi', () => ({
  useApi: () => useApiMock(),
}));

vi.mock('../context/CompanyContext', () => ({
  useCompany: () => useCompanyMock(),
}));

vi.mock('../context/OnboardingContext', () => ({
  useOnboarding: () => useOnboardingMock(),
}));

const initialAgents = [
  {
    id: 'agent-1',
    name: 'Ada',
    role: 'ceo',
    title: 'Chief Executive Officer',
    runtime: 'claude',
    system_prompt: 'Lead the company',
    monthly_budget_usd: 150,
    reports_to: null,
    status: 'idle',
  },
  {
    id: 'agent-2',
    name: 'Ben',
    role: 'engineer',
    title: 'Backend Engineer',
    runtime: 'openai',
    system_prompt: 'Ship reliable services',
    monthly_budget_usd: 80,
    reports_to: 'agent-1',
    status: 'paused',
  },
];

describe('AgentsPage', () => {
  beforeEach(() => {
    requestMock.mockReset();
    useApiMock.mockReset();
    useCompanyMock.mockReset();
    useOnboardingMock.mockReset();

    useApiMock.mockReturnValue({
      request: requestMock,
      loading: false,
      error: null,
    });
    useOnboardingMock.mockReturnValue({
      currentStep: null,
      status: 'idle',
    });
  });

  it('shows an empty state when no company is selected', () => {
    useCompanyMock.mockReturnValue({
      selectedCompany: null,
      selectedCompanyId: null,
    });

    render(
      <MemoryRouter>
        <AgentsPage />
      </MemoryRouter>
    );

    expect(screen.getByText('Choose a company to manage agents.')).toBeTruthy();
    expect(requestMock).not.toHaveBeenCalled();
  });

  it('renders the org chart, hires a new agent, and resumes a paused teammate', async () => {
    useCompanyMock.mockReturnValue({
      selectedCompany: { id: 'company-1', name: 'QA Test Corp', role: 'owner' },
      selectedCompanyId: 'company-1',
    });

    requestMock.mockImplementation((path: string, init?: RequestInit) => {
      if (path === '/companies/company-1/agents' && !init) {
        return Promise.resolve(initialAgents);
      }

      if (
        path === '/companies/company-1/agents' &&
        init?.method === 'POST'
      ) {
        return Promise.resolve({
          id: 'agent-3',
        });
      }

      if (path === '/agents/agent-2/resume' && init?.method === 'POST') {
        return Promise.resolve({ ok: true });
      }

      throw new Error(`Unexpected request: ${path}`);
    });

    render(
      <MemoryRouter>
        <AgentsPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(requestMock).toHaveBeenCalledWith('/companies/company-1/agents');
    });

    expect(screen.getByRole('heading', { name: 'Agents' })).toBeTruthy();
    expect(screen.getByText(/Hierarchy built from `reports_to`/)).toBeTruthy();
    expect(screen.getByText('2 active agents')).toBeTruthy();
    expect(screen.getByText('1 managers')).toBeTruthy();
    expect(screen.getByText('1 direct report')).toBeTruthy();
    expect(screen.getByText('Reports into manager')).toBeTruthy();
    expect(
      screen
        .getAllByRole('link', { name: 'Ada' })
        .every((link) => link.getAttribute('href') === '/agents/agent-1')
    ).toBe(true);

    fireEvent.click(screen.getAllByRole('button', { name: 'Hire Agent' })[0]);

    fireEvent.change(screen.getByPlaceholderText('Name'), {
      target: { value: 'Cara' },
    });
    fireEvent.change(screen.getByPlaceholderText('Role'), {
      target: { value: 'designer' },
    });
    fireEvent.change(screen.getByPlaceholderText('Title'), {
      target: { value: 'Product Designer' },
    });
    fireEvent.change(screen.getAllByRole('combobox')[0], {
      target: { value: 'gemini' },
    });
    fireEvent.change(screen.getByPlaceholderText('Monthly budget (USD)'), {
      target: { value: '25' },
    });
    fireEvent.change(screen.getAllByRole('combobox')[1], {
      target: { value: 'agent-1' },
    });
    fireEvent.change(screen.getByPlaceholderText('System prompt (optional)'), {
      target: { value: 'Design a calmer workspace' },
    });

    fireEvent.click(screen.getAllByRole('button', { name: 'Hire Agent' }).at(-1) as HTMLButtonElement);

    await waitFor(() => {
      expect(requestMock).toHaveBeenCalledWith('/companies/company-1/agents', {
        method: 'POST',
        body: JSON.stringify({
          name: 'Cara',
          role: 'designer',
          title: 'Product Designer',
          runtime: 'gemini',
          system_prompt: 'Design a calmer workspace',
          monthly_budget_usd: 25,
          reports_to: 'agent-1',
        }),
      });
    });

    fireEvent.click(screen.getByTitle('Resume'));

    await waitFor(() => {
      expect(requestMock).toHaveBeenCalledWith('/agents/agent-2/resume', {
        method: 'POST',
      });
    });
  });
});
