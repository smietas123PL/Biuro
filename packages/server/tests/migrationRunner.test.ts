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
    await Promise.all(
      tempDirs.map((dir) => rm(dir, { recursive: true, force: true }))
    );
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
        {
          version: 1,
          filename: 'schema.sql',
          filepath: 'schema.sql',
          checksum: 'aaa',
        },
        {
          version: 2,
          filename: 'schema_v2_add_users.sql',
          filepath: 'schema_v2_add_users.sql',
          checksum: 'bbb',
        },
        {
          version: 3,
          filename: 'schema_v3.sql',
          filepath: 'schema_v3.sql',
          checksum: 'ccc',
        },
      ],
      [
        {
          version: 1,
          filename: 'schema.sql',
          checksum: 'aaa',
          applied_at: '2026-03-19T10:00:00.000Z',
          execution_time_ms: 12,
        },
        {
          version: 2,
          filename: 'schema_v2.sql',
          checksum: 'old',
          applied_at: '2026-03-19T10:01:00.000Z',
          execution_time_ms: 13,
        },
        {
          version: 99,
          filename: 'schema_v99.sql',
          checksum: 'zzz',
          applied_at: '2026-03-19T10:02:00.000Z',
          execution_time_ms: 14,
        },
      ]
    );

    expect(statuses.map((item) => `${item.version}:${item.status}`)).toEqual([
      '1:applied',
      '2:drifted',
      '3:pending',
      '99:missing_file',
    ]);
    expect(statuses.find((item) => item.version === 2)?.reason).toContain(
      'Recorded filename'
    );
  });

  it('creates standardized filenames and templates for new migrations', async () => {
    expect(getMigrationVersion('schema_v14_add_budget_indexes.sql')).toBe(14);
    expect(slugifyMigrationName('Add Budget Indexes!')).toBe(
      'add_budget_indexes'
    );
    expect(buildMigrationFilename(14, 'Add Budget Indexes!')).toBe(
      'schema_v14_add_budget_indexes.sql'
    );

    const template = createMigrationTemplate(14, 'Add Budget Indexes');
    expect(template).toContain('Schema v14 (Add Budget Indexes)');
    expect(template).toContain('BEGIN;');
    expect(template).toContain('COMMIT;');

    const dir = await mkdtemp(
      path.join(os.tmpdir(), 'biuro-migration-template-')
    );
    tempDirs.push(dir);
    const target = path.join(
      dir,
      buildMigrationFilename(14, 'Add Budget Indexes')
    );
    fs.writeFileSync(target, template, 'utf8');
    const persisted = await readFile(target, 'utf8');
    expect(persisted).toContain('-- Write migration here');
  });

  it('ships the named RLS refresh migration for sprint 3', async () => {
    const repoMigration = path.resolve(
      import.meta.dirname,
      '../src/db/schema_v14_refresh_rls_policies.sql'
    );

    const sql = await readFile(repoMigration, 'utf8');
    expect(sql).toContain('CREATE OR REPLACE FUNCTION biuro_current_user_id()');
    expect(sql).toContain('CREATE POLICY companies_select_policy ON companies');
    expect(sql).toContain(
      'CREATE POLICY budgets_company_scope_policy ON budgets'
    );
    expect(sql).toContain(
      'CREATE POLICY tool_calls_company_scope_policy ON tool_calls'
    );
    expect(sql).toContain(
      'CREATE POLICY user_roles_scope_policy ON user_roles'
    );
  });

  it('ships the query index migration from the audit follow-up', async () => {
    const repoMigration = path.resolve(
      import.meta.dirname,
      '../src/db/schema_v15_add_query_indexes.sql'
    );

    const sql = await readFile(repoMigration, 'utf8');
    expect(sql).toContain('CREATE INDEX IF NOT EXISTS idx_heartbeats_agent_created');
    expect(sql).toContain('CREATE INDEX IF NOT EXISTS idx_tasks_assigned_status');
    expect(sql).toContain('CREATE INDEX IF NOT EXISTS idx_audit_log_company_created');
    expect(sql).toContain('CREATE INDEX IF NOT EXISTS idx_policies_company_type_active');
  });

  it('ships the tasks created_by user migration for sprint B', async () => {
    const repoMigration = path.resolve(
      import.meta.dirname,
      '../src/db/schema_v16_tasks_created_by_user.sql'
    );

    const sql = await readFile(repoMigration, 'utf8');
    expect(sql).toContain(
      'ADD COLUMN IF NOT EXISTS created_by_user UUID REFERENCES users(id) ON DELETE SET NULL'
    );
    expect(sql).toContain('u.id::text = t.created_by');
    expect(sql).toContain('DROP COLUMN IF EXISTS created_by');
    expect(sql).toContain('RENAME COLUMN created_by_user TO created_by');
    expect(sql).toContain('CREATE INDEX IF NOT EXISTS idx_tasks_created_by');
  });

  it('ships the query-index deduplication migration for sprint follow-up', async () => {
    const repoMigration = path.resolve(
      import.meta.dirname,
      '../src/db/schema_v17_deduplicate_query_indexes.sql'
    );

    const sql = await readFile(repoMigration, 'utf8');
    expect(sql).toContain('DROP INDEX IF EXISTS idx_heartbeats_agent_time');
    expect(sql).toContain('DROP INDEX IF EXISTS idx_tasks_agent_status');
    expect(sql).toContain('DROP INDEX IF EXISTS idx_audit_company_time');
    expect(sql).toContain('CREATE INDEX IF NOT EXISTS idx_heartbeats_agent_created');
    expect(sql).toContain('CREATE INDEX IF NOT EXISTS idx_tasks_assigned_status');
    expect(sql).toContain('CREATE INDEX IF NOT EXISTS idx_audit_log_company_created');
  });

  it('ships the refined query-index migration for the audit follow-up', async () => {
    const repoMigration = path.resolve(
      import.meta.dirname,
      '../src/db/schema_v18_refine_query_indexes.sql'
    );

    const sql = await readFile(repoMigration, 'utf8');
    expect(sql).toContain(
      'CREATE INDEX IF NOT EXISTS idx_heartbeats_agent_created'
    );
    expect(sql).toContain('DROP INDEX IF EXISTS idx_tasks_assigned_status');
    expect(sql).toContain("WHERE status NOT IN ('done', 'cancelled')");
    expect(sql).toContain(
      'CREATE INDEX IF NOT EXISTS idx_audit_log_company_created'
    );
    expect(sql).toContain(
      'DROP INDEX IF EXISTS idx_policies_company_type_active'
    );
    expect(sql).toContain('DROP INDEX IF EXISTS idx_policies_company_type');
    expect(sql).toContain('CREATE INDEX idx_policies_company_type');
    expect(sql).toContain('WHERE is_active = true');
  });
});
