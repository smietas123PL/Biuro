import { db } from '../db/client.js';
import { contextStore } from '../utils/context.js';
import { logger } from '../utils/logger.js';
import { v4 as uuidv4 } from 'uuid';

async function verifyIsolation() {
  logger.info('Starting Multi-tenancy Isolation Test...');

  try {
    // 1. Setup two companies
    const c1Id = uuidv4();
    const c2Id = uuidv4();

    await db.query(
      "INSERT INTO companies (id, name, mission) VALUES ($1, 'Company Alpha', 'Mission A')",
      [c1Id]
    );
    await db.query(
      "INSERT INTO companies (id, name, mission) VALUES ($1, 'Company Beta', 'Mission B')",
      [c2Id]
    );

    // 2. Insert data into Company Alpha
    await db.query(
      "INSERT INTO agents (company_id, name, role, runtime) VALUES ($1, 'Agent Alpha', 'Sec-Ops', 'openai')",
      [c1Id]
    );

    // 3. Test RLS as Company Beta (Should NOT see Agent Alpha)
    await contextStore.run({ companyId: c2Id }, async () => {
      const agents = await db.query('SELECT * FROM agents');
      console.log(
        `Company Beta sees ${agents.rows.length} agents (Expected: 0)`
      );
      if (agents.rows.length > 0) throw new Error('RLS LEAK DETECTED!');
    });

    // 4. Test RLS as Company Alpha (Should see Agent Alpha)
    await contextStore.run({ companyId: c1Id }, async () => {
      const agents = await db.query('SELECT * FROM agents');
      console.log(
        `Company Alpha sees ${agents.rows.length} agents (Expected: 1)`
      );
      if (agents.rows.length !== 1)
        throw new Error('RLS NOT WORKING AS EXPECTED!');
    });

    logger.info('Multi-tenancy Isolation Test PASSED!');
    process.exit(0);
  } catch (err: any) {
    logger.error({ err: err.message }, 'Isolation Test FAILED');
    process.exit(1);
  }
}

// verifyIsolation();
console.log('Isolation test script prepared.');
