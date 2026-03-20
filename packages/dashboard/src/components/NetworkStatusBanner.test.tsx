import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NetworkStatusBanner } from './NetworkStatusBanner';

function setOnlineStatus(value: boolean) {
  Object.defineProperty(window.navigator, 'onLine', {
    configurable: true,
    value,
  });
}

describe('NetworkStatusBanner', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setOnlineStatus(true);
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    setOnlineStatus(true);
  });

  it('shows the offline warning and then the recovery notice', () => {
    render(<NetworkStatusBanner />);

    expect(
      screen.queryByText(/Network connection lost/i)
    ).toBeNull();

    setOnlineStatus(false);
    act(() => {
      window.dispatchEvent(new Event('offline'));
    });

    expect(
      screen.getByText(
        'Network connection lost. We will keep the current screen open and retry safe requests when the connection comes back.'
      )
    ).toBeTruthy();

    setOnlineStatus(true);
    act(() => {
      window.dispatchEvent(new Event('online'));
    });

    expect(
      screen.getByText('Connection restored. The dashboard is back online.')
    ).toBeTruthy();

    act(() => {
      vi.advanceTimersByTime(4000);
    });

    expect(
      screen.queryByText('Connection restored. The dashboard is back online.')
    ).toBeNull();
  });

  it('renders the offline state immediately when the browser starts offline', () => {
    setOnlineStatus(false);

    render(<NetworkStatusBanner />);

    expect(
      screen.getByText(/Network connection lost/i)
    ).toBeTruthy();
  });
});
