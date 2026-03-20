import express from 'express';
import { createServer, type Server } from 'http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const dbMock = vi.hoisted(() => ({
  query: vi.fn(),
}));

vi.mock('../src/db/client.js', () => ({
  db: dbMock,
}));

import auditRouter from '../src/routes/audit.js';

describe('audit routes', () => {
  let server: Server;
  let baseUrl: string;

  beforeEach(async () => {
    dbMock.query.mockReset();

    const app = express();
    app.use('/api/audit', auditRouter);

    server = createServer(app);
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve());
    });

    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Expected server to listen on a TCP port');
    }

    baseUrl = `http://127.0.0.1:${address.port}/api/audit`;
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

  it('rejects requests without company scope', async () => {
    const response = await fetch(`${baseUrl}?limit=10`);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBeTruthy();
    expect(dbMock.query).not.toHaveBeenCalled();
  });

  it('returns audit entries scoped to the requested company', async () => {
    dbMock.query.mockResolvedValueOnce({
      rows: [
        {
          id: 'audit-1',
          company_id: '11111111-1111-1111-1111-111111111111',
          action: 'task.created',
        },
      ],
    });

    const response = await fetch(
      `${baseUrl}?company_id=11111111-1111-1111-1111-111111111111&limit=25`
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual([
      expect.objectContaining({
        id: 'audit-1',
        action: 'task.created',
      }),
    ]);
    expect(dbMock.query).toHaveBeenCalledWith(
      'SELECT * FROM audit_log WHERE company_id = $1 ORDER BY created_at DESC LIMIT $2',
      ['11111111-1111-1111-1111-111111111111', 25]
    );
  });
});
