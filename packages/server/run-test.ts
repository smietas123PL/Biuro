import { db } from './src/db/client.js';
import { hashPassword, verifyPassword } from './src/auth/password.js';

async function run() {
  const email = 'testuser123@example.com';
  const password = 'Password@123';
  
  try {
    const hash = await hashPassword(password);
    console.log('hash generated:', hash);
    
    await db.query("INSERT INTO users (email, pwd_hash, full_name) VALUES ($1, $2, 'Test') ON CONFLICT (email) DO UPDATE SET pwd_hash=$2", [email, hash]);
    
    const res = await db.query('SELECT pwd_hash FROM users WHERE email = $1', [email]);
    const storedHash = res.rows[0].pwd_hash;
    console.log('stored hash:', storedHash);
    
    const valid = await verifyPassword(password, storedHash);
    console.log('Is valid:', valid);
  } catch (err) {
    console.error(err);
  } finally {
    process.exit(0);
  }
}
run();
