import { beforeEach, describe, expect, it, vi } from 'vitest';

const envMock = vi.hoisted(() => ({
  CSRF_PROTECTION_ENABLED: true,
  CSRF_SECRET: 'test-csrf-secret-123',
}));

vi.mock('../src/env.js', () => ({
  env: envMock,
}));

import {
  createCsrfToken,
  requireCsrfProtection,
} from '../src/security/csrf.js';

function createResponse() {
  const response = {
    status: vi.fn(),
    json: vi.fn(),
  };

  response.status.mockReturnValue(response);
  return response;
}

describe('csrf middleware', () => {
  beforeEach(() => {
    envMock.CSRF_PROTECTION_ENABLED = true;
    envMock.CSRF_SECRET = 'test-csrf-secret-1234567890abcdef';
  });

  it('allows safe requests without a csrf token', () => {
    const middleware = requireCsrfProtection();
    const req = {
      method: 'GET',
      headers: {
        authorization: 'Bearer token-123',
      },
    } as any;
    const res = createResponse();
    const next = vi.fn();

    middleware(req, res as any, next);

    expect(next).toHaveBeenCalledTimes(1);
  });

  it('blocks browser mutation requests with a missing csrf token', () => {
    const middleware = requireCsrfProtection();
    const req = {
      method: 'POST',
      headers: {
        authorization: 'Bearer token-123',
        origin: 'http://localhost:5173',
      },
    } as any;
    const res = createResponse();
    const next = vi.fn();

    middleware(req, res as any, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({
      error: 'Forbidden: Invalid CSRF token',
    });
    expect(next).not.toHaveBeenCalled();
  });

  it('allows browser mutation requests with a valid csrf token', () => {
    const middleware = requireCsrfProtection();
    const req = {
      method: 'PATCH',
      headers: {
        authorization: 'Bearer token-123',
        origin: 'http://localhost:5173',
        'x-csrf-token': createCsrfToken('token-123'),
      },
    } as any;
    const res = createResponse();
    const next = vi.fn();

    middleware(req, res as any, next);

    expect(next).toHaveBeenCalledTimes(1);
  });

  it('blocks browser mutation requests with an invalid csrf token', () => {
    const middleware = requireCsrfProtection();
    const req = {
      method: 'DELETE',
      headers: {
        authorization: 'Bearer token-123',
        origin: 'http://localhost:5173',
        'x-csrf-token': createCsrfToken('different-token'),
      },
    } as any;
    const res = createResponse();
    const next = vi.fn();

    middleware(req, res as any, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({
      error: 'Forbidden: Invalid CSRF token',
    });
    expect(next).not.toHaveBeenCalled();
  });

  it('treats sec-fetch headers as browser-like requests', () => {
    const middleware = requireCsrfProtection();
    const req = {
      method: 'POST',
      headers: {
        authorization: 'Bearer token-123',
        'sec-fetch-site': 'same-origin',
      },
    } as any;
    const res = createResponse();
    const next = vi.fn();

    middleware(req, res as any, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('accepts csrf tokens passed as an array header value', () => {
    const middleware = requireCsrfProtection();
    const req = {
      method: 'POST',
      headers: {
        authorization: 'Bearer token-123',
        'sec-fetch-mode': 'cors',
        'x-csrf-token': [createCsrfToken('token-123')],
      },
    } as any;
    const res = createResponse();
    const next = vi.fn();

    middleware(req, res as any, next);

    expect(next).toHaveBeenCalledTimes(1);
  });

  it('skips csrf enforcement for non-browser authenticated scripts', () => {
    const middleware = requireCsrfProtection();
    const req = {
      method: 'POST',
      headers: {
        authorization: 'Bearer token-123',
      },
    } as any;
    const res = createResponse();
    const next = vi.fn();

    middleware(req, res as any, next);

    expect(next).toHaveBeenCalledTimes(1);
  });

  it('skips csrf enforcement for browser-like requests without a bearer token', () => {
    const middleware = requireCsrfProtection();
    const req = {
      method: 'POST',
      headers: {
        origin: 'http://localhost:5173',
      },
    } as any;
    const res = createResponse();
    const next = vi.fn();

    middleware(req, res as any, next);

    expect(next).toHaveBeenCalledTimes(1);
  });

  it('skips csrf enforcement when protection is disabled', () => {
    envMock.CSRF_PROTECTION_ENABLED = false;

    const middleware = requireCsrfProtection();
    const req = {
      method: 'POST',
      headers: {
        authorization: 'Bearer token-123',
        origin: 'http://localhost:5173',
      },
    } as any;
    const res = createResponse();
    const next = vi.fn();

    middleware(req, res as any, next);

    expect(next).toHaveBeenCalledTimes(1);
  });

  it('derives deterministic tokens from the session token and secret', () => {
    const first = createCsrfToken('token-123');
    const second = createCsrfToken('token-123');

    envMock.CSRF_SECRET = 'another-test-csrf-secret-abcdef123456';
    const third = createCsrfToken('token-123');

    expect(first).toBe(second);
    expect(third).not.toBe(first);
    expect(first).toMatch(/^[a-f0-9]{64}$/);
  });
});
