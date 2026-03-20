import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AuthPage from './AuthPage';

const navigateMock = vi.hoisted(() => vi.fn());
const loginMock = vi.hoisted(() => vi.fn());
const registerMock = vi.hoisted(() => vi.fn());
const useAuthMock = vi.hoisted(() => vi.fn());

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>(
    'react-router-dom'
  );

  return {
    ...actual,
    useNavigate: () => navigateMock,
  };
});

vi.mock('../context/AuthContext', () => ({
  useAuth: () => useAuthMock(),
}));

function getPrimaryButton(name: string) {
  return screen.getAllByRole('button', { name }).at(-1) as HTMLButtonElement;
}

describe('AuthPage', () => {
  beforeEach(() => {
    navigateMock.mockReset();
    loginMock.mockReset();
    registerMock.mockReset();
    useAuthMock.mockReset();

    useAuthMock.mockReturnValue({
      login: loginMock,
      register: registerMock,
      loading: false,
      error: null,
    });
  });

  it('logs in and redirects to the dashboard', async () => {
    loginMock.mockResolvedValueOnce(undefined);

    render(<AuthPage />);

    expect(screen.getByText('Sign in to run the company.')).toBeTruthy();
    expect(getPrimaryButton('Log in').disabled).toBe(true);

    fireEvent.change(screen.getByLabelText('Email'), {
      target: { value: 'owner@example.com' },
    });
    fireEvent.change(screen.getByLabelText('Password'), {
      target: { value: 'super-secret' },
    });

    fireEvent.click(getPrimaryButton('Log in'));

    await waitFor(() => {
      expect(loginMock).toHaveBeenCalledWith({
        email: 'owner@example.com',
        password: 'super-secret',
      });
      expect(navigateMock).toHaveBeenCalledWith('/', { replace: true });
    });
  });

  it('shows a local login error when authentication fails', async () => {
    loginMock.mockRejectedValueOnce(new Error('Invalid credentials'));

    render(<AuthPage />);

    fireEvent.change(screen.getByLabelText('Email'), {
      target: { value: 'owner@example.com' },
    });
    fireEvent.change(screen.getByLabelText('Password'), {
      target: { value: 'wrong-password' },
    });

    fireEvent.click(getPrimaryButton('Log in'));

    expect(await screen.findByText('Invalid credentials')).toBeTruthy();
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it('registers a new company owner and omits empty optional fields', async () => {
    registerMock.mockResolvedValueOnce(undefined);

    render(<AuthPage />);

    fireEvent.click(screen.getAllByRole('button', { name: 'Create account' })[0]);

    expect(getPrimaryButton('Create account').disabled).toBe(true);

    fireEvent.change(screen.getByLabelText('Email'), {
      target: { value: 'founder@example.com' },
    });
    fireEvent.change(screen.getByLabelText('Password'), {
      target: { value: 'super-secret' },
    });
    fireEvent.change(screen.getByLabelText('Company name'), {
      target: { value: 'Acme AI Labs' },
    });

    fireEvent.click(getPrimaryButton('Create account'));

    await waitFor(() => {
      expect(registerMock).toHaveBeenCalledWith({
        email: 'founder@example.com',
        password: 'super-secret',
        fullName: undefined,
        companyName: 'Acme AI Labs',
        companyMission: undefined,
      });
      expect(navigateMock).toHaveBeenCalledWith('/', { replace: true });
    });
  });

  it('renders an auth-provider error and loading state', () => {
    useAuthMock.mockReturnValue({
      login: loginMock,
      register: registerMock,
      loading: true,
      error: 'Session expired',
    });

    render(<AuthPage />);

    expect(screen.getByText('Session expired')).toBeTruthy();
    expect(getPrimaryButton('Logging in...').disabled).toBe(true);
  });
});
