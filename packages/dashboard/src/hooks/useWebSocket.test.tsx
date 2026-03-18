import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useWebSocket } from './useApi';
import { AUTH_TOKEN_KEY, setAuthToken } from '../lib/session';

class MockWebSocket {
  static instances: MockWebSocket[] = [];

  onmessage: ((event: MessageEvent<string>) => void) | null = null;
  close = vi.fn();

  constructor(public url: string) {
    MockWebSocket.instances.push(this);
  }
}

describe('useWebSocket', () => {
  beforeEach(() => {
    MockWebSocket.instances = [];
    localStorage.setItem(AUTH_TOKEN_KEY, 'token-1');
    vi.stubGlobal('WebSocket', MockWebSocket as unknown as typeof WebSocket);
  });

  it('opens a websocket with company and token, then reconnects after an auth change', async () => {
    const { result } = renderHook(() => useWebSocket('company-1'));

    await waitFor(() => {
      expect(MockWebSocket.instances).toHaveLength(1);
    });

    expect(MockWebSocket.instances[0]?.url).toContain('/ws?');
    expect(MockWebSocket.instances[0]?.url).toContain('companyId=company-1');
    expect(MockWebSocket.instances[0]?.url).toContain('token=token-1');

    act(() => {
      MockWebSocket.instances[0]?.onmessage?.({
        data: JSON.stringify({ type: 'agent.working', agentId: 'agent-1' }),
      } as MessageEvent<string>);
    });

    expect(result.current).toEqual({
      type: 'agent.working',
      agentId: 'agent-1',
    });

    act(() => {
      setAuthToken('token-2');
    });

    await waitFor(() => {
      expect(MockWebSocket.instances).toHaveLength(2);
    });

    expect(MockWebSocket.instances[0]?.close).toHaveBeenCalledTimes(1);
    expect(MockWebSocket.instances[1]?.url).toContain('companyId=company-1');
    expect(MockWebSocket.instances[1]?.url).toContain('token=token-2');
  });

  it('does not open a websocket without a selected company', () => {
    const { result } = renderHook(() => useWebSocket(undefined));

    expect(MockWebSocket.instances).toHaveLength(0);
    expect(result.current).toBeNull();
  });
});
