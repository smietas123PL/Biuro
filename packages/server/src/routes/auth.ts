import { Router } from 'express';
import { db } from '../db/client.js';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';

const router: Router = Router();

const SignupSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  fullName: z.string().optional(),
  companyId: z.string().uuid()
});

router.post('/signup', async (req, res) => {
  const result = SignupSchema.safeParse(req.body);
  if (!result.success) return res.status(400).json({ error: result.error });

  const { email, password, fullName, companyId } = result.data;

  try {
    // In a real app, use bcrypt. For this skeleton, we use a placeholder.
    const pwdHash = `hash_${password}`; 
    
    const userRes = await db.query(
      "INSERT INTO users (email, pwd_hash, full_name) VALUES ($1, $2, $3) RETURNING id",
      [email, pwdHash, fullName]
    );
    const userId = userRes.rows[0].id;

    await db.query(
      "INSERT INTO user_roles (user_id, company_id, role) VALUES ($1, $2, 'admin')",
      [userId, companyId]
    );

    res.json({ success: true, userId });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  const pwdHash = `hash_${password}`;

  try {
    const user = await db.query("SELECT * FROM users WHERE email = $1 AND pwd_hash = $2", [email, pwdHash]);
    if (user.rows.length === 0) return res.status(401).json({ error: 'Invalid credentials' });

    const token = uuidv4();
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 3); // 3 days

    await db.query(
      "INSERT INTO user_sessions (user_id, token, expires_at) VALUES ($1, $2, $3)",
      [user.rows[0].id, token, expiresAt]
    );

    res.json({ token, userId: user.rows[0].id });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
