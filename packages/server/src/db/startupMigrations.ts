import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type pg from 'pg';
import { applyPendingMigrations } from './migrationRunner.js';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const STARTUP_MIGRATION_LOCK_ID = 71640201;

function resolveMigrationsDir() {
  const candidates = [
    currentDir,
    path.resolve(currentDir, '../../src/db'),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(path.join(candidate, 'schema_v2.sql'))) {
      return candidate;
    }
  }

  return currentDir;
}

const migrationsDir = resolveMigrationsDir();

export async function runStartupMigrations(
  client: pg.PoolClient,
  logger: {
    info: (details: unknown, message: string) => void;
    error: (details: unknown, message: string) => void;
  }
) {
  await client.query('SELECT pg_advisory_lock($1)', [STARTUP_MIGRATION_LOCK_ID]);

  try {
    return await applyPendingMigrations(client, migrationsDir, logger);
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [
      STARTUP_MIGRATION_LOCK_ID,
    ]);
  }
}
