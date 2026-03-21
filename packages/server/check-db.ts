import { db } from './src/db/client.js';

async function run() {
  try {
    const res = await db.query('SELECT id, email, pwd_hash FROM users LIMIT 10');
    console.log(JSON.stringify(res.rows, null, 2));
  } catch (err) {
    console.error(err);
  } finally {
    process.exit(0);
  }
}
run();
