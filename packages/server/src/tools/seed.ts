import type pg from 'pg';
import { DEFAULT_TOOL_BLUEPRINTS } from './defaults.js';

type Queryable = Pick<pg.PoolClient, 'query'>;

export async function seedDefaultTools(client: Queryable, companyId: string) {
  const inserted: string[] = [];
  const existing: string[] = [];

  for (const blueprint of DEFAULT_TOOL_BLUEPRINTS) {
    const result = await client.query(
      `INSERT INTO tools (company_id, name, description, type, config)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (company_id, name) DO NOTHING
       RETURNING id, name`,
      [
        companyId,
        blueprint.name,
        blueprint.description,
        blueprint.type,
        JSON.stringify(blueprint.config),
      ]
    );

    if (result.rowCount && result.rowCount > 0) {
      inserted.push(result.rows[0].name as string);
    } else {
      existing.push(blueprint.name);
    }
  }

  return {
    inserted,
    existing,
    total_defaults: DEFAULT_TOOL_BLUEPRINTS.length,
  };
}
