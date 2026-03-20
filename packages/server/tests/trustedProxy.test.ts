import { describe, expect, it, vi } from 'vitest';

const envMock = vi.hoisted(() => ({
  TRUSTED_PROXY_IPS: [] as string[],
}));

vi.mock('../src/env.js', () => ({
  env: envMock,
}));

import {
  isTrustedProxyIp,
  resolveClientIp,
} from '../src/security/trustedProxy.js';

describe('trusted proxy resolution', () => {
  it('uses the socket address when the proxy is not trusted', () => {
    envMock.TRUSTED_PROXY_IPS = [];

    expect(
      resolveClientIp({
        headers: {
          'x-forwarded-for': '203.0.113.10',
        },
        socket: {
          remoteAddress: '127.0.0.1',
        },
      })
    ).toBe('127.0.0.1');
  });

  it('uses x-forwarded-for when the remote address is trusted', () => {
    envMock.TRUSTED_PROXY_IPS = ['127.0.0.1'];

    expect(
      resolveClientIp({
        headers: {
          'x-forwarded-for': '203.0.113.10, 10.0.0.2',
        },
        socket: {
          remoteAddress: '::ffff:127.0.0.1',
        },
      })
    ).toBe('203.0.113.10');
  });

  it('normalizes mapped IPv4 loopback addresses for trust checks', () => {
    envMock.TRUSTED_PROXY_IPS = ['127.0.0.1'];

    expect(isTrustedProxyIp('::ffff:127.0.0.1')).toBe(true);
    expect(isTrustedProxyIp('10.10.10.10')).toBe(false);
  });

  it('falls back to unknown when the socket address is missing', () => {
    envMock.TRUSTED_PROXY_IPS = ['127.0.0.1'];

    expect(
      resolveClientIp({
        headers: {
          'x-forwarded-for': '203.0.113.10',
        },
        socket: {},
      })
    ).toBe('unknown');
  });

  it('ignores empty and whitespace trusted proxy values', () => {
    expect(isTrustedProxyIp(null, ['127.0.0.1'])).toBe(false);
    expect(isTrustedProxyIp('   ', ['127.0.0.1'])).toBe(false);
    expect(isTrustedProxyIp('127.0.0.1', ['   ', '', '127.0.0.1'])).toBe(true);
  });

  it('uses the first forwarded client IP when x-forwarded-for is provided as an array', () => {
    envMock.TRUSTED_PROXY_IPS = ['127.0.0.1'];

    expect(
      resolveClientIp({
        headers: {
          'x-forwarded-for': [' 203.0.113.10, 10.0.0.2 '],
        },
        socket: {
          remoteAddress: '127.0.0.1',
        },
      })
    ).toBe('203.0.113.10');
  });

  it('falls back to the trusted proxy address when x-forwarded-for is empty', () => {
    envMock.TRUSTED_PROXY_IPS = ['127.0.0.1'];

    expect(
      resolveClientIp({
        headers: {
          'x-forwarded-for': '   ',
        },
        socket: {
          remoteAddress: '127.0.0.1',
        },
      })
    ).toBe('127.0.0.1');
  });
});
