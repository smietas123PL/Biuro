import { describe, it, expect, vi, beforeEach } from 'vitest';
import { resolveClientIp } from '../src/security/trustedProxy.js';
import { createCsrfToken, requireCsrfProtection } from '../src/security/csrf.js';

const envMock = vi.hoisted(() => ({
  TRUSTED_PROXY_IPS: [] as string[],
  CSRF_PROTECTION_ENABLED: true,
  CSRF_SECRET: 'test-csrf-secret-at-least-thirty-two-chars-long',
}));

vi.mock('../src/env.js', () => ({
  env: envMock,
}));

describe('Security Modules', () => {
  describe('trustedProxy', () => {
    beforeEach(() => {
      envMock.TRUSTED_PROXY_IPS = [];
    });

    it('resolves direct client IP when no trusted proxies are configured', () => {
      const req = {
        headers: {},
        socket: { remoteAddress: '192.168.1.1' }
      } as any;
      expect(resolveClientIp(req)).toBe('192.168.1.1');
    });

    it('resolves x-forwarded-for when request comes from a trusted proxy', () => {
      envMock.TRUSTED_PROXY_IPS = ['127.0.0.1'];
      const req = {
        headers: { 'x-forwarded-for': '203.0.113.10' },
        socket: { remoteAddress: '127.0.0.1' }
      } as any;
      expect(resolveClientIp(req)).toBe('203.0.113.10');
    });

    it('ignores x-forwarded-for when request comes from an untrusted IP', () => {
      envMock.TRUSTED_PROXY_IPS = ['127.0.0.1'];
      const req = {
        headers: { 'x-forwarded-for': '203.0.113.10' },
        socket: { remoteAddress: '192.168.1.1' }
      } as any;
      expect(resolveClientIp(req)).toBe('192.168.1.1');
    });

    it('handles IPv6 mapped IPv4 addresses correctly', () => {
      envMock.TRUSTED_PROXY_IPS = ['127.0.0.1'];
      const req = {
        headers: { 'x-forwarded-for': '203.0.113.10' },
        socket: { remoteAddress: '::ffff:127.0.0.1' }
      } as any;
      expect(resolveClientIp(req)).toBe('203.0.113.10');
    });

    it('takes the first IP from a comma-separated x-forwarded-for list', () => {
      envMock.TRUSTED_PROXY_IPS = ['127.0.0.1'];
      const req = {
        headers: { 'x-forwarded-for': '203.0.113.10, 10.0.0.1' },
        socket: { remoteAddress: '127.0.0.1' }
      } as any;
      expect(resolveClientIp(req)).toBe('203.0.113.10');
    });
  });

  describe('csrf', () => {
    beforeEach(() => {
      envMock.CSRF_PROTECTION_ENABLED = true;
    });

    it('creates stable tokens for the same session token', () => {
      const session = 'session-123';
      const token1 = createCsrfToken(session);
      const token2 = createCsrfToken(session);
      expect(token1).toBe(token2);
      expect(token1.length).toBeGreaterThan(32);
    });

    it('allows SAFE methods without a CSRF token', () => {
      const middleware = requireCsrfProtection();
      const req = { method: 'GET', headers: {} } as any;
      const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as any;
      const next = vi.fn();

      middleware(req, res, next);
      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });

    it('allows requests without a token when CSRF protection is disabled', () => {
      envMock.CSRF_PROTECTION_ENABLED = false;
      const middleware = requireCsrfProtection();
      const req = { method: 'POST', headers: {} } as any;
      const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as any;
      const next = vi.fn();

      middleware(req, res, next);
      expect(next).toHaveBeenCalled();
    });

    it('rejects browser-like POST requests without x-csrf-token', () => {
      const middleware = requireCsrfProtection();
      const req = { 
        method: 'POST', 
        headers: { 
          'authorization': 'Bearer session-123',
          'origin': 'http://localhost:3000' 
        } 
      } as any;
      const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as any;
      const next = vi.fn();

      middleware(req, res, next);
      expect(res.status).toHaveBeenCalledWith(403);
      expect(next).not.toHaveBeenCalled();
    });

    it('rejects POST requests with an invalid x-csrf-token', () => {
      const middleware = requireCsrfProtection();
      const req = { 
        method: 'POST', 
        headers: { 
          'authorization': 'Bearer session-123',
          'origin': 'http://localhost:3000',
          'x-csrf-token': 'wrong-token'
        } 
      } as any;
      const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as any;
      const next = vi.fn();

      middleware(req, res, next);
      expect(res.status).toHaveBeenCalledWith(403);
    });

    it('accepts POST requests with a valid x-csrf-token', () => {
      const session = 'session-123';
      const validToken = createCsrfToken(session);
      const middleware = requireCsrfProtection();
      const req = { 
        method: 'POST', 
        headers: { 
          'authorization': `Bearer ${session}`,
          'origin': 'http://localhost:3000',
          'x-csrf-token': validToken
        } 
      } as any;
      const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as any;
      const next = vi.fn();

      middleware(req, res, next);
      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });

    it('allows non-browser requests (no origin/sec-fetch headers) for programmatic access', () => {
        const middleware = requireCsrfProtection();
        const req = { 
          method: 'POST', 
          headers: { 
            'authorization': 'Bearer session-123'
             // No origin, no sec-fetch headers
          } 
        } as any;
        const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as any;
        const next = vi.fn();
  
        middleware(req, res, next);
        expect(next).toHaveBeenCalled();
      });
  });
});
