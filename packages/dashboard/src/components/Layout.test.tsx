import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Layout } from './Layout';

const useCompanyMock = vi.hoisted(() => vi.fn());
const useAuthMock = vi.hoisted(() => vi.fn());
const startTutorialMock = vi.hoisted(() => vi.fn());
const createCompanyMock = vi.hoisted(() => vi.fn());
const setSelectedCompanyIdMock = vi.hoisted(() => vi.fn());
const logoutMock = vi.hoisted(() => vi.fn());

vi.mock('../context/CompanyContext', () => ({
  useCompany: () => useCompanyMock(),
}));

vi.mock('../context/AuthContext', () => ({
  useAuth: () => useAuthMock(),
}));

vi.mock('../context/OnboardingContext', () => ({
  OnboardingProvider: ({ children }: { children: ReactNode }) => children,
  useOnboarding: () => ({
    startTutorial: startTutorialMock,
  }),
}));

vi.mock('./CommandPalette', () => ({
  CommandPalette: ({
    open,
    onClose,
  }: {
    open: boolean;
    onClose: () => void;
  }) => (
    open ? (
      <div>
        <div>Command palette open</div>
        <button onClick={onClose}>Close palette</button>
      </div>
    ) : null
  ),
}));

vi.mock('./OnboardingTour', () => ({
  OnboardingTour: () => <div>Tour mounted</div>,
}));

function renderLayout() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<div>Dashboard outlet</div>} />
          <Route path="settings" element={<div>Settings outlet</div>} />
        </Route>
      </Routes>
    </MemoryRouter>
  );
}

describe('Layout', () => {
  beforeEach(() => {
    useCompanyMock.mockReset();
    useAuthMock.mockReset();
    startTutorialMock.mockReset();
    createCompanyMock.mockReset();
    setSelectedCompanyIdMock.mockReset();
    logoutMock.mockReset();

    createCompanyMock.mockResolvedValue(undefined);
    logoutMock.mockResolvedValue(undefined);
    useAuthMock.mockReturnValue({
      user: {
        full_name: 'Ada Lovelace',
        email: 'ada@example.com',
      },
      logout: logoutMock,
    });
  });

  it('shows the empty company state when no company is selected', () => {
    useCompanyMock.mockReturnValue({
      companies: [],
      selectedCompany: null,
      selectedCompanyId: null,
      setSelectedCompanyId: setSelectedCompanyIdMock,
      createCompany: createCompanyMock,
      loading: false,
    });

    renderLayout();

    expect(
      screen.getByText(
        'Create or choose a company to start working with agents and tasks.'
      )
    ).toBeTruthy();
    expect(screen.getByDisplayValue('No companies yet')).toBeTruthy();
    expect((screen.getByRole('combobox') as HTMLSelectElement).disabled).toBe(
      true
    );
    expect(screen.getByText('Tour mounted')).toBeTruthy();
  });

  it('creates a company, changes selection, opens the command palette, and triggers tutorial/logout actions', async () => {
    useCompanyMock.mockReturnValue({
      companies: [
        { id: 'company-1', name: 'QA Test Corp' },
        { id: 'company-2', name: 'Ops Lab' },
      ],
      selectedCompany: { id: 'company-1', name: 'QA Test Corp' },
      selectedCompanyId: 'company-1',
      setSelectedCompanyId: setSelectedCompanyIdMock,
      createCompany: createCompanyMock,
      loading: false,
    });

    renderLayout();

    expect(screen.getByText('Dashboard outlet')).toBeTruthy();
    expect(screen.getByText('Ada Lovelace')).toBeTruthy();

    fireEvent.change(screen.getByRole('combobox'), {
      target: { value: 'company-2' },
    });

    expect(setSelectedCompanyIdMock).toHaveBeenCalledWith('company-2');

    fireEvent.click(screen.getByRole('button', { name: 'New Company' }));

    fireEvent.change(screen.getByPlaceholderText('Company name'), {
      target: { value: '  New Horizon AI  ' },
    });
    fireEvent.change(screen.getByPlaceholderText('Mission (optional)'), {
      target: { value: '  Build safer automations  ' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => {
      expect(createCompanyMock).toHaveBeenCalledWith({
        name: 'New Horizon AI',
        mission: 'Build safer automations',
      });
    });

    expect(screen.queryByPlaceholderText('Company name')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Start tutorial' }));
    expect(startTutorialMock).toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /Search/ }));
    expect(screen.getByText('Command palette open')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Close palette' }));
    expect(screen.queryByText('Command palette open')).toBeNull();

    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    expect(screen.getByText('Command palette open')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Log out' }));
    await waitFor(() => {
      expect(logoutMock).toHaveBeenCalled();
    });
  });
});
