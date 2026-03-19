import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorBoundary } from './ErrorBoundary';

function ThrowingComponent(): never {
  throw new Error('Kaboom');
}

describe('ErrorBoundary', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('renders a recovery screen when a child component throws', () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    render(
      <ErrorBoundary>
        <ThrowingComponent />
      </ErrorBoundary>
    );

    expect(screen.getByText('Dashboard needs a clean refresh')).toBeTruthy();
    expect(screen.getByText('Kaboom')).toBeTruthy();

    consoleErrorSpy.mockRestore();
  });

  it('reloads the dashboard when the user chooses recovery', () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const assignMock = vi.fn();
    Object.defineProperty(window, 'location', {
      value: {
        ...window.location,
        assign: assignMock,
      },
      configurable: true,
    });

    render(
      <ErrorBoundary>
        <ThrowingComponent />
      </ErrorBoundary>
    );

    fireEvent.click(screen.getByRole('button', { name: 'Reload dashboard' }));

    expect(assignMock).toHaveBeenCalledWith('/');
    consoleErrorSpy.mockRestore();
  });
});
