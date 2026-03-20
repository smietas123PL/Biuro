import { beforeEach, describe, expect, it, vi } from 'vitest';

const envMock = vi.hoisted(() => ({
  DATABASE_URL: 'postgres://user:pass@localhost:5432/db',
  DB_TRANSACTION_RETRY_MAX: 2,
  DB_TRANSACTION_RETRY_BASE_DELAY_MS: 0,
  DB_TRANSACTION_RETRY_MAX_DELAY_MS: 0,
}));

const loggerMock = vi.hoisted(() => ({
  error: vi.fn(),
  warn: vi.fn(),
}));

const contextStoreMock = vi.hoisted(() => ({
  getStore: vi.fn(() => undefined),
}));

const connectMock = vi.hoisted(() => vi.fn());
const poolQueryMock = vi.hoisted(() => vi.fn());
const poolEndMock = vi.hoisted(() => vi.fn());
const poolOnMock = vi.hoisted(() => vi.fn());

vi.mock('../src/env.js', () => ({
  env: envMock,
}));

vi.mock('../src/utils/logger.js', () => ({
  logger: loggerMock,
}));

vi.mock('../src/utils/context.js', () => ({
  contextStore: contextStoreMock,
}));

vi.mock('pg', () => ({
  default: {
    Pool: vi.fn(() => ({
      connect: connectMock,
      query: poolQueryMock,
      end: poolEndMock,
      on: poolOnMock,
    })),
  },
}));

describe('db client transaction retries', () => {
  beforeEach(() => {
    vi.resetModules();
    connectMock.mockReset();
    poolQueryMock.mockReset();
    poolEndMock.mockReset();
    poolOnMock.mockReset();
    loggerMock.error.mockReset();
    loggerMock.warn.mockReset();
    contextStoreMock.getStore.mockReturnValue(undefined);
    envMock.DB_TRANSACTION_RETRY_MAX = 2;
    envMock.DB_TRANSACTION_RETRY_BASE_DELAY_MS = 0;
    envMock.DB_TRANSACTION_RETRY_MAX_DELAY_MS = 0;
  });

  it('retries deadlocked transactions and succeeds on a later attempt', async () => {
    const firstClient = {
      query: vi.fn(async (text: string) => {
        if (text === 'BEGIN' || text === 'ROLLBACK') {
          return {};
        }
        if (text === 'SELECT 1') {
          const error = Object.assign(new Error('deadlock detected'), {
            code: '40P01',
          });
          throw error;
        }
        throw new Error(`Unexpected query ${text}`);
      }),
      release: vi.fn(),
    };
    const secondClient = {
      query: vi.fn(async (text: string) => {
        if (text === 'BEGIN' || text === 'COMMIT' || text === 'SELECT 1') {
          return {};
        }
        throw new Error(`Unexpected query ${text}`);
      }),
      release: vi.fn(),
    };
    connectMock.mockResolvedValueOnce(firstClient).mockResolvedValueOnce(secondClient);

    const { db } = await import('../src/db/client.js');

    const result = await db.transaction(async (client) => {
      await client.query('SELECT 1');
      return 'ok';
    });

    expect(result).toBe('ok');
    expect(connectMock).toHaveBeenCalledTimes(2);
    expect(firstClient.release).toHaveBeenCalledTimes(1);
    expect(secondClient.release).toHaveBeenCalledTimes(1);
    expect(loggerMock.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        attempt: 1,
        maxRetries: 2,
        delayMs: 0,
      }),
      'Retrying database transaction after transient error'
    );
  });

  it('does not retry non-retryable transaction errors', async () => {
    const client = {
      query: vi.fn(async (text: string) => {
        if (text === 'BEGIN' || text === 'ROLLBACK') {
          return {};
        }
        if (text === 'SELECT 1') {
          const error = Object.assign(new Error('constraint failed'), {
            code: '23505',
          });
          throw error;
        }
        throw new Error(`Unexpected query ${text}`);
      }),
      release: vi.fn(),
    };
    connectMock.mockResolvedValueOnce(client);

    const { db } = await import('../src/db/client.js');

    await expect(
      db.transaction(async (transactionClient) => {
        await transactionClient.query('SELECT 1');
        return 'ok';
      })
    ).rejects.toMatchObject({ code: '23505' });

    expect(connectMock).toHaveBeenCalledTimes(1);
    expect(loggerMock.warn).not.toHaveBeenCalledWith(
      expect.anything(),
      'Retrying database transaction after transient error'
    );
  });
});
