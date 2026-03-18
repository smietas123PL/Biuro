import { Response, NextFunction } from 'express';
import { db } from '../db/client.js';
import { AuthRequest, contextStore } from '../utils/context.js';

export function requireRole(roles: string[]) {
  return async (req: AuthRequest, res: Response, next: NextFunction) => {
    const companyId = (req.headers['x-company-id'] || req.query.companyId || req.body.companyId) as string;
    const token = req.headers.authorization?.split(' ')[1];

    if (!token || !companyId) {
      return res.status(401).json({ error: 'Unauthorized: Missing token or companyId' });
    }

    try {
      const session = await db.query(
        "SELECT user_id FROM user_sessions WHERE token = $1 AND expires_at > now()",
        [token]
      );

      if (session.rows.length === 0) {
        return res.status(401).json({ error: 'Unauthorized: Invalid token' });
      }

      const userId = session.rows[0].user_id;
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
