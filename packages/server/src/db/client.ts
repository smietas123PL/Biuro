import pg from 'pg';
import { env } from '../env.js';
import { logger } from '../utils/logger.js';

import { contextStore } from '../utils/context.js';

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
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await applyRequestContext(client);
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
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
