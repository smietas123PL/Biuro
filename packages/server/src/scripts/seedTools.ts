import { db } from '../db/client.js';
import { seedDefaultTools } from '../tools/seed.js';

async function main() {
  const companyId = process.argv[2];
  if (!companyId) {
    throw new Error('Usage: pnpm --filter @biuro/server seed:tools <company-id>');
  }

  const summary = await db.transaction((client) => seedDefaultTools(client, companyId));
  console.log(JSON.stringify({ company_id: companyId, ...summary }, null, 2));
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.close();
  });
