import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { db } from './client.js';
import { logger } from '../utils/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function migrate() {
  const schemaFiles = fs.readdirSync(__dirname)
    .filter(f => f.startsWith('schema') && f.endsWith('.sql'))
    .sort((a, b) => {
      if (a === 'schema.sql') return -1;
      if (b === 'schema.sql') return 1;
      return a.localeCompare(b, undefined, { numeric: true });
    });

  logger.info({ schemaFiles }, 'Applying migrations');

  for (const file of schemaFiles) {
    const schema = fs.readFileSync(path.join(__dirname, file), 'utf-8');
    try {
      // Use a separate client for each file to handle RLS/Session issues if needed
      await db.query(schema);
      logger.info({ file }, 'Migration applied successfully');
    } catch (err: any) {
      // 42P07: duplicate_table
      // 42701: duplicate_column
      // 42P16: duplicate_object (policies, etc)
      // 42710: duplicate_object (policy already exists)
      if (['42P07', '42701', '42P16', '42710'].includes(err.code || (err as any).code)) {
        logger.info({ file, code: (err as any).code || err.code }, 'Objects already exist, skipping');
      } else {
        logger.error({ file, err }, 'Migration failed');
        // Don't throw, try next? Or throw to be safe? 
        // Throwing is safer for deterministic state.
        throw err;
      }
    }
  }
}

migrate();
