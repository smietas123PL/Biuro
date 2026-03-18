import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { db } from './client.js';
import { logger } from '../utils/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function getMigrationVersion(file: string): number {
  if (file === 'schema.sql') return 1;
  const match = file.match(/^schema_v(\d+)\.sql$/);
  if (!match) {
    throw new Error(`Unsupported migration filename: ${file}`);
  }
  return parseInt(match[1], 10);
}

async function migrate() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INT PRIMARY KEY,
      filename TEXT NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  const appliedRes = await db.query<{ version: number }>(
    'SELECT version FROM schema_migrations'
  );
  const appliedVersions = new Set(appliedRes.rows.map((row) => row.version));

  const schemaFiles = fs.readdirSync(__dirname)
    .filter(f => f.startsWith('schema') && f.endsWith('.sql'))
    .sort((a, b) => {
      if (a === 'schema.sql') return -1;
      if (b === 'schema.sql') return 1;
      return a.localeCompare(b, undefined, { numeric: true });
    });

  logger.info({ schemaFiles }, 'Applying migrations');

  for (const file of schemaFiles) {
    const version = getMigrationVersion(file);
    if (appliedVersions.has(version)) {
      logger.info({ file, version }, 'Migration already recorded, skipping');
      continue;
    }

    const schema = fs.readFileSync(path.join(__dirname, file), 'utf-8');
    try {
      await db.transaction(async (client) => {
        await client.query(schema);
        await client.query(
          'INSERT INTO schema_migrations (version, filename) VALUES ($1, $2)',
          [version, file]
        );
      });
      logger.info({ file, version }, 'Migration applied successfully');
    } catch (err: any) {
      // 42P07: duplicate_table
      // 42701: duplicate_column
      // 42P16: duplicate_object (policies, etc)
      // 42710: duplicate_object (policy already exists)
      if (['42P07', '42701', '42P16', '42710'].includes(err.code || (err as any).code)) {
        await db.query(
          'INSERT INTO schema_migrations (version, filename) VALUES ($1, $2) ON CONFLICT (version) DO NOTHING',
          [version, file]
        );
        logger.info({ file, version, code: (err as any).code || err.code }, 'Objects already exist, marking migration as applied');
      } else {
        logger.error({ file, err }, 'Migration failed');
        throw err;
      }
    }
  }
}

migrate();
