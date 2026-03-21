import { db } from './src/db/client.js';
async function run() {
  try {
    const res = await db.query("SELECT pg_get_triggerdef(oid) FROM pg_trigger WHERE tgrelid = 'users'::regclass");
    console.log(res.rows);
  } catch (err) {
    console.error(err);
  } finally {
    process.exit(0);
  }
}
run();
