import { Response, NextFunction } from 'express';
import { db } from '../db/client.js';
import { AuthRequest, contextStore, getContext } from '../utils/context.js';
import { env } from '../env.js';

function getRequestCompanyId(req: AuthRequest): string | undefined {
  const normalize = (value: unknown): string | undefined => {
    if (typeof value === 'string') return value;
    if (Array.isArray(value) && typeof value[0] === 'string') return value[0];
    return undefined;
  };

  const explicitCompanyId =
    normalize(req.headers['x-company-id']) ||
    normalize(req.params?.companyId) ||
    normalize(req.query?.companyId) ||
    normalize(req.query?.company_id) ||
    normalize(req.body?.companyId) ||
    normalize(req.body?.company_id);

  if (explicitCompanyId) {
    return explicitCompanyId;
  }

  if (
    req.baseUrl?.includes('/companies') ||
    req.originalUrl?.includes('/companies/')
  ) {
    return normalize(req.params?.id);
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

async function getUserRoleForCompany(userId: string, companyId: string) {
  const roleRes = await db.query(
    'SELECT role FROM user_roles WHERE user_id = $1 AND company_id = $2',
    [userId, companyId]
  );

  return roleRes.rows[0]?.role as string | undefined;
}

export function requireAuth() {
  return async (req: AuthRequest, res: Response, next: NextFunction) => {
    const companyId = getRequestCompanyId(req);
    const token = req.headers.authorization?.split(' ')[1];
    const existingContext = getContext();

    if (!env.AUTH_ENABLED) {
      req.user = {
        id: '00000000-0000-0000-0000-000000000000',
        companyId,
        role: companyId ? 'owner' : undefined,
      };
      return contextStore.run(
        companyId
          ? {
              ...existingContext,
              companyId,
              userId: req.user.id,
              role: req.user.role,
            }
          : { ...existingContext, userId: req.user.id },
        () => {
          next();
        }
      );
    }

    if (!token) {
      return res.status(401).json({ error: 'Unauthorized: Missing token' });
    }

    try {
      const session = await getSession(token);
      if (!session) {
        return res.status(401).json({ error: 'Unauthorized: Invalid token' });
      }

      let role: string | undefined;
      if (companyId) {
        role = await getUserRoleForCompany(session.user_id, companyId);
        if (!role) {
          return res
            .status(403)
            .json({ error: 'Forbidden: Company access denied' });
        }
      }

      req.user = { id: session.user_id, companyId, role };
      return contextStore.run(
        companyId
          ? {
              ...existingContext,
              companyId,
              userId: session.user_id,
              role,
            }
          : { ...existingContext, userId: session.user_id },
        () => {
          next();
        }
      );
    } catch (err) {
      return res.status(500).json({ error: 'Auth check failed' });
    }
  };
}

export function requireRole(roles: string[]) {
  return async (req: AuthRequest, res: Response, next: NextFunction) => {
    const companyId = getRequestCompanyId(req);
    const token = req.headers.authorization?.split(' ')[1];
    const existingContext = getContext();

    if (!env.AUTH_ENABLED) {
      req.user = {
        id: '00000000-0000-0000-0000-000000000000',
        companyId,
        role: companyId ? 'owner' : undefined,
      };
      return contextStore.run(
        companyId
          ? {
              ...existingContext,
              companyId,
              role: 'owner',
              userId: req.user.id,
            }
          : { ...existingContext, userId: req.user.id },
        () => {
          next();
        }
      );
    }

    if (!token || !companyId) {
      return res
        .status(401)
        .json({ error: 'Unauthorized: Missing token or companyId' });
    }

    try {
      const session = await getSession(token);
      if (!session) {
        return res.status(401).json({ error: 'Unauthorized: Invalid token' });
      }

      const userId = session.user_id;
      const role = await getUserRoleForCompany(userId, companyId);

      if (!role || !roles.includes(role)) {
        return res
          .status(403)
          .json({ error: 'Forbidden: Insufficient permissions' });
      }

      const authData = { id: userId, companyId, role };
      req.user = authData;

      // Wrap subsequent middleware/routes in company context for RLS
      contextStore.run(
        {
          ...existingContext,
          companyId,
          userId,
          role: authData.role,
        },
        () => {
        next();
        }
      );
    } catch (err) {
      res.status(500).json({ error: 'Auth check failed' });
    }
  };
}
