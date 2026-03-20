import pg from 'pg';
import { env } from '../env.js';
import { logger } from '../utils/logger.js';

import { contextStore } from '../utils/context.js';
import {
  computeExponentialBackoffDelay,
  waitForDelay,
} from '../utils/backoff.js';

const pool = new pg.Pool({
  connectionString: env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30000,
});

pool.on('error', (err) => {
  logger.error({ err }, 'Unexpected database pool error');
});

async function applyRequestContext(client: pg.PoolClient) {
  const context = contextStore.getStore();

  if (context?.companyId) {
    await client.query(
      `SELECT set_config('app.current_company_id', $1, true)`,
      [context.companyId]
    );
  }

  if (context?.userId) {
    await client.query(`SELECT set_config('app.current_user_id', $1, true)`, [
      context.userId,
    ]);
  }

  return context;
}

const RETRYABLE_TRANSACTION_ERROR_CODES = new Set(['40P01', '40001']);

function isRetryableTransactionError(error: unknown) {
  if (!error || typeof error !== 'object') {
    return false;
  }

  const candidate = error as { code?: string };
  return Boolean(candidate.code && RETRYABLE_TRANSACTION_ERROR_CODES.has(candidate.code));
}

export const db = {
  query: async <T extends pg.QueryResultRow = any>(
    text: string,
    params?: any[]
  ) => {
    const context = contextStore.getStore();
    if (context?.companyId || context?.userId) {
      // If we have a context, we MUST use a dedicated client from the pool
      // to ensure set_config is scoped to this query execution.
      // For simplicity in a single-call pool.query, we'll wrap it.
      const client = await pool.connect();
      try {
        await applyRequestContext(client);
        return await client.query<T>(text, params);
      } finally {
        client.release();
      }
    }
    return pool.query<T>(text, params);
  },

  getClient: () => pool.connect(),

  transaction: async <T>(
    fn: (client: pg.PoolClient) => Promise<T>
  ): Promise<T> => {
    const maxRetries = env.DB_TRANSACTION_RETRY_MAX ?? 2;

    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      const client = await pool.connect();
      let transactionOpened = false;

      try {
        await client.query('BEGIN');
        transactionOpened = true;
        await applyRequestContext(client);
        const result = await fn(client);
        await client.query('COMMIT');
        return result;
      } catch (err) {
        if (transactionOpened) {
          await client.query('ROLLBACK').catch((rollbackErr) => {
            logger.warn(
              { err: rollbackErr },
              'Rollback failed after transaction error'
            );
          });
        }

        const shouldRetry =
          isRetryableTransactionError(err) && attempt < maxRetries;
        if (!shouldRetry) {
          throw err;
        }

        const delayMs = computeExponentialBackoffDelay(
          attempt,
          env.DB_TRANSACTION_RETRY_BASE_DELAY_MS ?? 25,
          env.DB_TRANSACTION_RETRY_MAX_DELAY_MS ?? 250
        );
        logger.warn(
          {
            err,
            attempt: attempt + 1,
            maxRetries,
            delayMs,
          },
          'Retrying database transaction after transient error'
        );
        await waitForDelay(delayMs);
      } finally {
        client.release();
      }
    }

    throw new Error('Database transaction exhausted retries');
  },

  withCompanyContext: async <T>(
    companyId: string,
    fn: (client: pg.PoolClient) => Promise<T>
  ): Promise<T> => {
    const client = await pool.connect();
    try {
      await client.query(
        `SELECT set_config('app.current_company_id', $1, true)`,
        [companyId]
      );
      const context = contextStore.getStore();
      if (context?.userId) {
        await client.query(
          `SELECT set_config('app.current_user_id', $1, true)`,
          [context.userId]
        );
      }
      return await fn(client);
    } finally {
      client.release();
    }
  },

  close: () => pool.end(),
};
