import { beforeEach, describe, expect, it, vi } from 'vitest';

const queryMock = vi.hoisted(() => vi.fn());
const transactionMock = vi.hoisted(() => vi.fn());

vi.mock('../src/db/client.js', () => ({
  db: {
    query: queryMock,
    transaction: transactionMock,
  },
}));

import { BillingService } from '../src/services/billing.js';

describe('billing service', () => {
  beforeEach(() => {
    queryMock.mockReset();
    transactionMock.mockReset();
  });

  it('returns zero balance when the company has no credit row', async () => {
    queryMock.mockResolvedValueOnce({ rows: [] });

    await expect(BillingService.getBalance('company-1')).resolves.toBe(0);
    expect(queryMock).toHaveBeenCalledWith(
      'SELECT balance FROM company_credits WHERE company_id = $1',
      ['company-1']
    );
  });

  it('adds credits inside a transaction and records the billing event', async () => {
    const client = {
      query: vi.fn().mockResolvedValue({}),
    };
    transactionMock.mockImplementationOnce(async (fn) => fn(client as any));

    await BillingService.addCredits(
      'company-1',
      25,
      'top-up',
      'Manual top-up',
      'ch_123'
    );

    expect(client.query).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('INSERT INTO company_credits'),
      ['company-1', 25]
    );
    expect(client.query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('INSERT INTO billing_transactions'),
      ['company-1', 25, 'top-up', 'Manual top-up', 'ch_123']
    );
  });

  it('records usage as a negative credit adjustment', async () => {
    const addCreditsSpy = vi.spyOn(BillingService, 'addCredits');
    addCreditsSpy.mockResolvedValueOnce(undefined as never);

    await BillingService.recordUsage('company-1', 13.75, 'LLM usage');

    expect(addCreditsSpy).toHaveBeenCalledWith(
      'company-1',
      -13.75,
      'usage',
      'LLM usage'
    );

    addCreditsSpy.mockRestore();
  });
});
