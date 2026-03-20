import express from 'express';
import { createServer, type Server } from 'http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const dbMock = vi.hoisted(() => ({
  query: vi.fn(),
}));
const resolveApprovalMock = vi.hoisted(() => vi.fn());

vi.mock('../src/db/client.js', () => ({
  db: dbMock,
}));

vi.mock('../src/governance/approvals.js', () => ({
  resolveApproval: resolveApprovalMock,
}));

vi.mock('../src/middleware/auth.js', () => ({
  requireRole:
    () =>
    (
      req: express.Request & {
        user?: { id: string; companyId?: string; role?: string };
      },
      _res: express.Response,
      next: express.NextFunction
    ) => {
      const companyId = req.headers['x-test-company-id'];
      req.user =
        typeof companyId === 'string'
          ? { id: 'user-1', companyId, role: 'owner' }
          : { id: 'user-1', role: 'owner' };
      next();
    },
}));

import approvalsRouter from '../src/routes/approvals.js';

describe('approvals routes', () => {
  let server: Server;
  let baseUrl: string;

  beforeEach(async () => {
    dbMock.query.mockReset();
    resolveApprovalMock.mockReset();

    const app = express();
    app.use(express.json());
    app.use('/api/approvals', approvalsRouter);

    server = createServer(app);
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve());
    });

    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Expected server to listen on a TCP port');
    }

    baseUrl = `http://127.0.0.1:${address.port}/api/approvals`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => {
        if (err) {
          reject(err);
          return;
        }
        resolve();
      });
    });
  });

  it('lists approvals for the active company', async () => {
    dbMock.query.mockResolvedValueOnce({
      rows: [{ id: 'approval-1', status: 'pending' }],
    });

    const response = await fetch(baseUrl, {
      headers: {
        'x-test-company-id': 'company-1',
      },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual([
      { id: 'approval-1', status: 'pending' },
    ]);
    expect(dbMock.query).toHaveBeenCalledWith(
      'SELECT * FROM approvals WHERE company_id = $1 ORDER BY created_at DESC',
      ['company-1']
    );
  });

  it('rejects listing approvals without company access', async () => {
    const response = await fetch(baseUrl);

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: 'Forbidden: Company access denied',
    });
    expect(dbMock.query).not.toHaveBeenCalled();
  });

  it('resolves approvals with dashboard context metadata', async () => {
    resolveApprovalMock.mockResolvedValueOnce({
      id: 'approval-1',
      status: 'approved',
    });

    const response = await fetch(`${baseUrl}/approval-1/resolve`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-test-company-id': 'company-1',
      },
      body: JSON.stringify({
        status: 'approved',
        notes: 'Ship it',
      }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      id: 'approval-1',
      status: 'approved',
    });
    expect(resolveApprovalMock).toHaveBeenCalledWith(
      'approval-1',
      'approved',
      'Ship it',
      {
        companyId: 'company-1',
        source: 'dashboard',
        resolvedBy: 'user-1',
      }
    );
  });

  it('returns 404 when the approval does not exist', async () => {
    resolveApprovalMock.mockResolvedValueOnce(null);

    const response = await fetch(`${baseUrl}/missing/resolve`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-test-company-id': 'company-1',
      },
      body: JSON.stringify({
        status: 'rejected',
      }),
    });

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: 'Approval not found',
    });
  });
});
