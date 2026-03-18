import { Router } from 'express';
import { db } from '../db/client.js';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { hashPassword, verifyPassword } from '../auth/password.js';
import { requireAuth } from '../middleware/auth.js';
import { AuthRequest } from '../utils/context.js';

const router: Router = Router();

const RegisterSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  fullName: z.string().optional(),
  companyId: z.string().uuid().optional(),
  companyName: z.string().min(1).optional(),
  companyMission: z.string().optional(),
}).superRefine((data, ctx) => {
  if (!data.companyId && !data.companyName) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['companyName'],
      message: 'companyName or companyId is required',
    });
  }
});

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

async function getUserCompanies(userId: string) {
  const companies = await db.query(
    `SELECT c.id, c.name, c.mission, ur.role
     FROM user_roles ur
     JOIN companies c ON c.id = ur.company_id
     WHERE ur.user_id = $1
     ORDER BY c.created_at DESC`,
    [userId]
  );

  return companies.rows;
}

async function buildSessionPayload(userId: string, token: string) {
  const userRes = await db.query(
    'SELECT id, email, full_name FROM users WHERE id = $1',
    [userId]
  );

  return {
    token,
    user: userRes.rows[0],
    companies: await getUserCompanies(userId),
  };
}

async function handleRegister(req: AuthRequest, res: any) {
  const result = RegisterSchema.safeParse(req.body);
  if (!result.success) return res.status(400).json({ error: result.error });

  const { email, password, fullName, companyId, companyName, companyMission } = result.data;

  try {
    const payload = await db.transaction(async (client) => {
      const pwdHash = await hashPassword(password);
      const userRes = await client.query(
        "INSERT INTO users (email, pwd_hash, full_name) VALUES ($1, $2, $3) RETURNING id",
        [email, pwdHash, fullName]
      );
      const userId = userRes.rows[0].id;

      let effectiveCompanyId = companyId;
      let assignedRole = 'admin';

      if (!effectiveCompanyId) {
        const companyRes = await client.query(
          'INSERT INTO companies (name, mission) VALUES ($1, $2) RETURNING id',
          [companyName, companyMission]
        );
        effectiveCompanyId = companyRes.rows[0].id;
        assignedRole = 'owner';

        await client.query(
          "INSERT INTO audit_log (company_id, action, entity_type, entity_id, details) VALUES ($1, 'company.created', 'company', $1, '{}')",
          [effectiveCompanyId]
        );
      }

      await client.query(
        'INSERT INTO user_roles (user_id, company_id, role) VALUES ($1, $2, $3)',
        [userId, effectiveCompanyId, assignedRole]
      );

      const token = uuidv4();
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 3);

      await client.query(
        'INSERT INTO user_sessions (user_id, token, expires_at) VALUES ($1, $2, $3)',
        [userId, token, expiresAt]
      );

      return { userId, token };
    });

    return res.status(201).json(await buildSessionPayload(payload.userId, payload.token));
  } catch (err: any) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'User with this email already exists' });
    }
    return res.status(500).json({ error: err.message });
  }
}

router.post('/signup', handleRegister);
router.post('/register', handleRegister);

router.post('/login', async (req, res) => {
  const result = LoginSchema.safeParse(req.body);
  if (!result.success) return res.status(400).json({ error: result.error });

  const { email, password } = result.data;

  try {
    const user = await db.query('SELECT * FROM users WHERE email = $1', [email]);
    if (user.rows.length === 0) return res.status(401).json({ error: 'Invalid credentials' });

    let validPassword = await verifyPassword(password, user.rows[0].pwd_hash);
    if (!validPassword && user.rows[0].pwd_hash === `hash_${password}`) {
      validPassword = true;
      const upgradedHash = await hashPassword(password);
      await db.query(
        'UPDATE users SET pwd_hash = $1 WHERE id = $2',
        [upgradedHash, user.rows[0].id]
      );
    }
    if (!validPassword) return res.status(401).json({ error: 'Invalid credentials' });

    const token = uuidv4();
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 3);

    await db.query(
      'INSERT INTO user_sessions (user_id, token, expires_at) VALUES ($1, $2, $3)',
      [user.rows[0].id, token, expiresAt]
    );

    return res.json(await buildSessionPayload(user.rows[0].id, token));
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

router.get('/me', requireAuth(), async (req: AuthRequest, res) => {
  if (!req.user?.id) return res.status(401).json({ error: 'Unauthorized' });

  const token = req.headers.authorization?.split(' ')[1];
  res.json(await buildSessionPayload(req.user.id, token || ''));
});

router.post('/logout', requireAuth(), async (req: AuthRequest, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (token) {
    await db.query('DELETE FROM user_sessions WHERE token = $1', [token]);
  }
  res.json({ success: true });
});

export default router;
