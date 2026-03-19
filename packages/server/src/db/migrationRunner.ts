import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import type pg from 'pg';

const DUPLICATE_OBJECT_CODES = new Set(['42P07', '42701', '42P16', '42710']);

export type MigrationFile = {
  version: number;
  filename: string;
  filepath: string;
  checksum: string;
};

export type AppliedMigrationRecord = {
  version: number;
  filename: string;
  checksum: string | null;
  applied_at: string | Date;
  execution_time_ms: number | null;
};

export type MigrationStatusItem = {
  version: number;
  filename: string;
  checksum: string | null;
  status: 'applied' | 'pending' | 'drifted' | 'missing_file';
  applied_at: string | Date | null;
  execution_time_ms: number | null;
  reason?: string;
};

export function getMigrationVersion(filename: string): number {
  if (filename === 'schema.sql') {
    return 1;
  }

  const match = filename.match(/^schema_v(\d+)(?:_[a-z0-9_]+)?\.sql$/i);
  if (!match) {
    throw new Error(`Unsupported migration filename: ${filename}`);
  }

  return Number.parseInt(match[1], 10);
}

export function createMigrationChecksum(contents: string) {
  return crypto.createHash('sha256').update(contents, 'utf8').digest('hex');
}

export function listMigrationFiles(migrationsDir: string): MigrationFile[] {
  return fs
    .readdirSync(migrationsDir)
    .filter(
      (filename) =>
        filename === 'schema.sql' ||
        /^schema_v\d+(?:_[a-z0-9_]+)?\.sql$/i.test(filename)
    )
    .sort((left, right) => {
      const leftVersion = getMigrationVersion(left);
      const rightVersion = getMigrationVersion(right);
      if (leftVersion !== rightVersion) {
        return leftVersion - rightVersion;
      }

      return left.localeCompare(right, undefined, { numeric: true });
    })
    .map((filename) => {
      const filepath = path.join(migrationsDir, filename);
      const contents = fs.readFileSync(filepath, 'utf8');

      return {
        version: getMigrationVersion(filename),
        filename,
        filepath,
        checksum: createMigrationChecksum(contents),
      };
    });
}

export function slugifyMigrationName(name: string) {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_+/g, '_');
}

export function buildMigrationFilename(version: number, name?: string) {
  const suffix = name ? `_${slugifyMigrationName(name)}` : '';
  return `schema_v${version}${suffix}.sql`;
}

export function createMigrationTemplate(version: number, name?: string) {
  const label = name ? ` (${name.trim()})` : '';
  return `-- ================================================\n-- AUTONOMICZNE BIURO - Schema v${version}${label}\n-- ================================================\n\nBEGIN;\n\n-- Write migration here\n\nCOMMIT;\n`;
}

export function computeMigrationStatus(
  migrationFiles: MigrationFile[],
  appliedMigrations: AppliedMigrationRecord[]
): MigrationStatusItem[] {
  const filesByVersion = new Map(
    migrationFiles.map((file) => [file.version, file])
  );
  const statuses: MigrationStatusItem[] = migrationFiles.map((file) => {
    const applied = appliedMigrations.find(
      (item) => item.version === file.version
    );
    if (!applied) {
      return {
        version: file.version,
        filename: file.filename,
        checksum: file.checksum,
        status: 'pending',
        applied_at: null,
        execution_time_ms: null,
      };
    }

    if (applied.filename !== file.filename) {
      return {
        version: file.version,
        filename: file.filename,
        checksum: file.checksum,
        status: 'drifted',
        applied_at: applied.applied_at,
        execution_time_ms: applied.execution_time_ms,
        reason: `Recorded filename ${applied.filename} does not match ${file.filename}`,
      };
    }

    if (applied.checksum && applied.checksum !== file.checksum) {
      return {
        version: file.version,
        filename: file.filename,
        checksum: file.checksum,
        status: 'drifted',
        applied_at: applied.applied_at,
        execution_time_ms: applied.execution_time_ms,
        reason: 'Checksum mismatch',
      };
    }

    return {
      version: file.version,
      filename: file.filename,
      checksum: file.checksum,
      status: 'applied',
      applied_at: applied.applied_at,
      execution_time_ms: applied.execution_time_ms,
    };
  });

  for (const applied of appliedMigrations) {
    if (!filesByVersion.has(applied.version)) {
      statuses.push({
        version: applied.version,
        filename: applied.filename,
        checksum: applied.checksum,
        status: 'missing_file',
        applied_at: applied.applied_at,
        execution_time_ms: applied.execution_time_ms,
        reason: 'Migration recorded in database but file is missing',
      });
    }
  }

  return statuses.sort((left, right) => left.version - right.version);
}

export async function ensureSchemaMigrationsTable(client: pg.PoolClient) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INT PRIMARY KEY,
      filename TEXT NOT NULL,
      checksum TEXT,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      execution_time_ms INT
    )
  `);

  await client.query(
    `ALTER TABLE schema_migrations ADD COLUMN IF NOT EXISTS checksum TEXT`
  );
  await client.query(
    `ALTER TABLE schema_migrations ADD COLUMN IF NOT EXISTS execution_time_ms INT`
  );
}

export async function readAppliedMigrations(
  client: pg.PoolClient
): Promise<AppliedMigrationRecord[]> {
  const result = await client.query<AppliedMigrationRecord>(
    `SELECT version, filename, checksum, applied_at, execution_time_ms
     FROM schema_migrations
     ORDER BY version ASC`
  );

  return result.rows;
}

export async function getMigrationStatus(
  client: pg.PoolClient,
  migrationsDir: string
) {
  await ensureSchemaMigrationsTable(client);
  const [migrationFiles, appliedMigrations] = await Promise.all([
    Promise.resolve(listMigrationFiles(migrationsDir)),
    readAppliedMigrations(client),
  ]);

  return computeMigrationStatus(migrationFiles, appliedMigrations);
}

export async function verifyMigrations(
  client: pg.PoolClient,
  migrationsDir: string
) {
  const statuses = await getMigrationStatus(client, migrationsDir);
  const driftItems = statuses.filter(
    (item) => item.status === 'drifted' || item.status === 'missing_file'
  );

  if (driftItems.length > 0) {
    const summary = driftItems
      .map(
        (item) =>
          `${item.version}:${item.filename}:${item.reason ?? item.status}`
      )
      .join(', ');
    throw new Error(`Migration verification failed: ${summary}`);
  }

  return statuses;
}

export async function applyPendingMigrations(
  client: pg.PoolClient,
  migrationsDir: string,
  logger: {
    info: (details: unknown, message: string) => void;
    error: (details: unknown, message: string) => void;
  }
) {
  const statuses = await verifyMigrations(client, migrationsDir);
  const pending = statuses.filter((item) => item.status === 'pending');

  for (const migration of pending) {
    const filepath = path.join(migrationsDir, migration.filename);
    const sql = fs.readFileSync(filepath, 'utf8');
    const startedAt = Date.now();

    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query(
        `INSERT INTO schema_migrations (version, filename, checksum, execution_time_ms)
         VALUES ($1, $2, $3, $4)`,
        [
          migration.version,
          migration.filename,
          migration.checksum,
          Date.now() - startedAt,
        ]
      );
      await client.query('COMMIT');
      logger.info(
        { version: migration.version, filename: migration.filename },
        'Migration applied successfully'
      );
    } catch (err: any) {
      await client.query('ROLLBACK');

      if (DUPLICATE_OBJECT_CODES.has(err?.code)) {
        await client.query(
          `INSERT INTO schema_migrations (version, filename, checksum, execution_time_ms)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (version)
           DO UPDATE SET filename = EXCLUDED.filename, checksum = EXCLUDED.checksum, execution_time_ms = EXCLUDED.execution_time_ms`,
          [
            migration.version,
            migration.filename,
            migration.checksum,
            Date.now() - startedAt,
          ]
        );
        logger.info(
          {
            version: migration.version,
            filename: migration.filename,
            code: err.code,
          },
          'Migration objects already existed, recorded migration metadata'
        );
        continue;
      }

      logger.error(
        { version: migration.version, filename: migration.filename, err },
        'Migration failed'
      );
      throw err;
    }
  }

  return pending.length;
}
