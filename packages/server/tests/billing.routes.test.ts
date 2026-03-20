import express from 'express';
import { createServer, type Server } from 'http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const getBalanceMock = vi.hoisted(() => vi.fn());
const addCreditsMock = vi.hoisted(() => vi.fn());

vi.mock('../src/services/billing.js', () => ({
  BillingService: {
    getBalance: getBalanceMock,
    addCredits: addCreditsMock,
  },
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
      const testCompanyIdHeader = req.headers['x-test-company-id'];
      req.user = {
        id: 'user-1',
        companyId:
          typeof testCompanyIdHeader === 'string'
            ? testCompanyIdHeader
            : undefined,
        role: 'owner',
      };
      next();
    },
}));

import billingRouter from '../src/routes/billing.js';

describe('billing routes', () => {
  let server: Server;
  let baseUrl: string;

  beforeEach(async () => {
    getBalanceMock.mockReset();
    addCreditsMock.mockReset();

    const app = express();
    app.use(express.json());
    app.use('/api/billing', billingRouter);

    server = createServer(app);
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve());
    });

    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Expected server to listen on a TCP port');
    }

    baseUrl = `http://127.0.0.1:${address.port}/api/billing`;
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

  it('returns the balance using authenticated company context', async () => {
    getBalanceMock.mockResolvedValueOnce(42.5);

    const response = await fetch(`${baseUrl}/balance`, {
      headers: {
        'x-test-company-id': 'company-1',
      },
    });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({ balance: 42.5 });
    expect(getBalanceMock).toHaveBeenCalledWith('company-1');
  });

  it('creates a top-up using validated input and company context', async () => {
    addCreditsMock.mockResolvedValueOnce(undefined);

    const response = await fetch(`${baseUrl}/top-up`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-test-company-id': 'company-1',
      },
      body: JSON.stringify({
        amount: '25.5',
        paymentMethodId: 'pm_card_visa',
      }),
    });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(payload.amount).toBe(25.5);
    expect(addCreditsMock).toHaveBeenCalledWith(
      'company-1',
      25.5,
      'top-up',
      'Credit top-up via Stripe (pm_card_visa)',
      expect.stringMatching(/^ch_/)
    );
  });

  it('rejects billing calls without company context', async () => {
    const response = await fetch(`${baseUrl}/balance`);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: 'Missing company context' });
    expect(getBalanceMock).not.toHaveBeenCalled();
  });
});
