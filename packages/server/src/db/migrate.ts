import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { db } from './client.js';
import {
  applyPendingMigrations,
  buildMigrationFilename,
  createMigrationTemplate,
  getMigrationStatus,
  listMigrationFiles,
  verifyMigrations,
} from './migrationRunner.js';
import { logger } from '../utils/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function printStatusTable(
  statuses: Awaited<ReturnType<typeof getMigrationStatus>>
) {
  for (const item of statuses) {
    logger.info(
      {
        version: item.version,
        filename: item.filename,
        status: item.status,
        applied_at: item.applied_at,
        execution_time_ms: item.execution_time_ms,
        reason: item.reason,
      },
      'Migration status'
    );
  }
}

async function runUp() {
  const client = await db.getClient();
  try {
    const appliedCount = await applyPendingMigrations(client, __dirname, logger);
    logger.info({ appliedCount }, 'Migration run completed');
  } finally {
    client.release();
  }
}

async function runStatus() {
  const client = await db.getClient();
  try {
    const statuses = await getMigrationStatus(client, __dirname);
    printStatusTable(statuses);
  } finally {
    client.release();
  }
}

async function runVerify() {
  const client = await db.getClient();
  try {
    const statuses = await verifyMigrations(client, __dirname);
    printStatusTable(statuses);
    logger.info({ verified: true }, 'Migration verification succeeded');
  } finally {
    client.release();
  }
}

async function runCreate(nameArg: string | undefined) {
  const migrationFiles = listMigrationFiles(__dirname);
  const nextVersion = migrationFiles.reduce((highest, migration) => Math.max(highest, migration.version), 0) + 1;
  const filename = buildMigrationFilename(nextVersion, nameArg);
  const filepath = path.join(__dirname, filename);

  if (fs.existsSync(filepath)) {
    throw new Error(`Migration file already exists: ${filename}`);
  }

  fs.writeFileSync(filepath, createMigrationTemplate(nextVersion, nameArg), 'utf8');
  logger.info({ filename, filepath }, 'Created migration file');
}

async function main() {
  const command = (process.argv[2] ?? 'up').toLowerCase();

  switch (command) {
    case 'up':
    case 'apply':
      await runUp();
      break;
    case 'status':
      await runStatus();
      break;
    case 'verify':
      await runVerify();
      break;
    case 'create':
      await runCreate(process.argv.slice(3).join(' ').trim() || undefined);
      break;
    default:
      throw new Error(`Unsupported migration command: ${command}`);
  }
}

main()
  .catch((err) => {
    logger.error({ err }, 'Migration command failed');
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.close();
  });
