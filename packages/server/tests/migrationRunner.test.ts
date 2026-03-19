import { mkdtemp, readFile, rm } from 'fs/promises';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildMigrationFilename,
  computeMigrationStatus,
  createMigrationTemplate,
  getMigrationVersion,
  listMigrationFiles,
  slugifyMigrationName,
} from '../src/db/migrationRunner.js';

describe('migration runner utilities', () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
    tempDirs.length = 0;
  });

  it('parses and sorts legacy plus named migration files', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'biuro-migrations-'));
    tempDirs.push(dir);

    fs.writeFileSync(path.join(dir, 'schema_v10_add_flags.sql'), '-- ten');
    fs.writeFileSync(path.join(dir, 'schema.sql'), '-- one');
    fs.writeFileSync(path.join(dir, 'schema_v2.sql'), '-- two');

    const files = listMigrationFiles(dir);
    expect(files.map((file) => `${file.version}:${file.filename}`)).toEqual([
      '1:schema.sql',
      '2:schema_v2.sql',
      '10:schema_v10_add_flags.sql',
    ]);
  });

  it('marks pending, applied, drifted, and missing migrations distinctly', () => {
    const statuses = computeMigrationStatus(
      [
        { version: 1, filename: 'schema.sql', filepath: 'schema.sql', checksum: 'aaa' },
        { version: 2, filename: 'schema_v2_add_users.sql', filepath: 'schema_v2_add_users.sql', checksum: 'bbb' },
        { version: 3, filename: 'schema_v3.sql', filepath: 'schema_v3.sql', checksum: 'ccc' },
      ],
      [
        { version: 1, filename: 'schema.sql', checksum: 'aaa', applied_at: '2026-03-19T10:00:00.000Z', execution_time_ms: 12 },
        { version: 2, filename: 'schema_v2.sql', checksum: 'old', applied_at: '2026-03-19T10:01:00.000Z', execution_time_ms: 13 },
        { version: 99, filename: 'schema_v99.sql', checksum: 'zzz', applied_at: '2026-03-19T10:02:00.000Z', execution_time_ms: 14 },
      ]
    );

    expect(statuses.map((item) => `${item.version}:${item.status}`)).toEqual([
      '1:applied',
      '2:drifted',
      '3:pending',
      '99:missing_file',
    ]);
    expect(statuses.find((item) => item.version === 2)?.reason).toContain('Recorded filename');
  });

  it('creates standardized filenames and templates for new migrations', async () => {
    expect(getMigrationVersion('schema_v14_add_budget_indexes.sql')).toBe(14);
    expect(slugifyMigrationName('Add Budget Indexes!')).toBe('add_budget_indexes');
    expect(buildMigrationFilename(14, 'Add Budget Indexes!')).toBe('schema_v14_add_budget_indexes.sql');

    const template = createMigrationTemplate(14, 'Add Budget Indexes');
    expect(template).toContain('Schema v14 (Add Budget Indexes)');
    expect(template).toContain('BEGIN;');
    expect(template).toContain('COMMIT;');

    const dir = await mkdtemp(path.join(os.tmpdir(), 'biuro-migration-template-'));
    tempDirs.push(dir);
    const target = path.join(dir, buildMigrationFilename(14, 'Add Budget Indexes'));
    fs.writeFileSync(target, template, 'utf8');
    const persisted = await readFile(target, 'utf8');
    expect(persisted).toContain('-- Write migration here');
  });
});
