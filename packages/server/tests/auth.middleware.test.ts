import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbMock = vi.hoisted(() => ({
  query: vi.fn(),
}));

const envMock = vi.hoisted(() => ({
  AUTH_ENABLED: true,
}));

vi.mock('../src/db/client.js', () => ({
  db: dbMock,
}));

vi.mock('../src/env.js', () => ({
  env: envMock,
}));

import { requireAuth } from '../src/middleware/auth.js';

function createResponse() {
  const response = {
    status: vi.fn(),
    json: vi.fn(),
  };

  response.status.mockReturnValue(response);
  return response;
}

describe('auth middleware', () => {
  beforeEach(() => {
    dbMock.query.mockReset();
  });

  it('blocks authenticated requests that spoof a company they do not belong to', async () => {
    dbMock.query
      .mockResolvedValueOnce({
        rows: [
          {
            user_id: 'user-1',
            email: 'test@example.com',
            full_name: 'Test User',
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [],
      });

    const middleware = requireAuth();
    const req = {
      headers: {
        authorization: 'Bearer token-123',
        'x-company-id': 'company-9',
      },
    } as any;
    const res = createResponse();
    const next = vi.fn();

    await middleware(req, res as any, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({
      error: 'Forbidden: Company access denied',
    });
    expect(next).not.toHaveBeenCalled();
  });

  it('allows authenticated requests without company scope checks when no companyId is present', async () => {
    dbMock.query.mockResolvedValueOnce({
      rows: [
        {
          user_id: 'user-1',
          email: 'test@example.com',
          full_name: 'Test User',
        },
      ],
    });

    const middleware = requireAuth();
    const req = {
      headers: {
        authorization: 'Bearer token-123',
      },
    } as any;
    const res = createResponse();
    const next = vi.fn();

    await middleware(req, res as any, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.user).toEqual({
      id: 'user-1',
      companyId: undefined,
      role: undefined,
    });
  });
});
