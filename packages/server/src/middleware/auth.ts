import { Response, NextFunction } from 'express';
import { db } from '../db/client.js';
import { AuthRequest, contextStore } from '../utils/context.js';
import { env } from '../env.js';

function getRequestCompanyId(req: AuthRequest): string | undefined {
  const normalize = (value: unknown): string | undefined => {
    if (typeof value === 'string') return value;
    if (Array.isArray(value) && typeof value[0] === 'string') return value[0];
    return undefined;
  };

  const explicitCompanyId =
    normalize(req.headers['x-company-id']) ||
    normalize(req.params.companyId) ||
    normalize(req.query.companyId) ||
    normalize(req.query.company_id) ||
    normalize(req.body?.companyId) ||
    normalize(req.body?.company_id);

  if (explicitCompanyId) {
    return explicitCompanyId;
  }

  if (req.baseUrl.includes('/companies') || req.originalUrl.includes('/companies/')) {
    return normalize(req.params.id);
  }

  return undefined;
}

async function getSession(token?: string) {
  if (!token) return null;

  const session = await db.query(
    `SELECT us.user_id, u.email, u.full_name
     FROM user_sessions us
     JOIN users u ON u.id = us.user_id
     WHERE us.token = $1 AND us.expires_at > now()`,
    [token]
  );

  return session.rows[0] || null;
}

export function requireAuth() {
  return async (req: AuthRequest, res: Response, next: NextFunction) => {
    const companyId = getRequestCompanyId(req);
    const token = req.headers.authorization?.split(' ')[1];

    if (!env.AUTH_ENABLED) {
      req.user = { id: 'dev-user', companyId, role: companyId ? 'owner' : undefined };
      return contextStore.run(companyId ? { companyId, userId: req.user.id, role: req.user.role } : {}, () => {
        next();
      });
    }

    if (!token) {
      return res.status(401).json({ error: 'Unauthorized: Missing token' });
    }

    try {
      const session = await getSession(token);
      if (!session) {
        return res.status(401).json({ error: 'Unauthorized: Invalid token' });
      }

      req.user = { id: session.user_id, companyId };
      return contextStore.run(companyId ? { companyId, userId: session.user_id } : { userId: session.user_id }, () => {
        next();
      });
    } catch (err) {
      return res.status(500).json({ error: 'Auth check failed' });
    }
  };
}

export function requireRole(roles: string[]) {
  return async (req: AuthRequest, res: Response, next: NextFunction) => {
    const companyId = getRequestCompanyId(req);
    const token = req.headers.authorization?.split(' ')[1];

    if (!env.AUTH_ENABLED) {
      req.user = { id: 'dev-user', companyId, role: companyId ? 'owner' : undefined };
      return contextStore.run(companyId ? { companyId, role: 'owner' } : {}, () => {
        next();
      });
    }

    if (!token || !companyId) {
      return res.status(401).json({ error: 'Unauthorized: Missing token or companyId' });
    }

    try {
      const session = await getSession(token);
      if (!session) {
        return res.status(401).json({ error: 'Unauthorized: Invalid token' });
      }

      const userId = session.user_id;
      const roleRes = await db.query(
        "SELECT role FROM user_roles WHERE user_id = $1 AND company_id = $2",
        [userId, companyId]
      );

      if (roleRes.rows.length === 0 || !roles.includes(roleRes.rows[0].role)) {
        return res.status(403).json({ error: 'Forbidden: Insufficient permissions' });
      }

      const authData = { id: userId, companyId, role: roleRes.rows[0].role };
      req.user = authData;

      // Wrap subsequent middleware/routes in company context for RLS
      contextStore.run({ companyId, userId, role: authData.role }, () => {
        next();
      });
    } catch (err) {
      res.status(500).json({ error: 'Auth check failed' });
    }
  };
}
