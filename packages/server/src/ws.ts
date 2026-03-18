import { WebSocketServer, WebSocket } from 'ws';
import { Server } from 'http';
import { db } from './db/client.js';
import { env } from './env.js';
import { logger } from './utils/logger.js';

export class WSHub {
  private wss: WebSocketServer;
  private clients: Map<string, Set<WebSocket>> = new Map(); // companyId -> Set of WS

  constructor(server: Server) {
    this.wss = new WebSocketServer({ server, path: '/ws' });

    this.wss.on('connection', (ws: WebSocket, req: any) => {
      void this.handleConnection(ws, req);
    });
  }

  private async handleConnection(ws: WebSocket, req: any) {
    try {
      const url = new URL(req.url || '', `http://${req.headers.host}`);
      const companyId = url.searchParams.get('companyId');
      const token = url.searchParams.get('token');

      if (!companyId) {
        ws.close(4400, 'Missing companyId');
        return;
      }

      if (env.AUTH_ENABLED) {
        if (!token) {
          ws.close(4401, 'Missing token');
          return;
        }

        const sessionRes = await db.query(
          `SELECT user_id
           FROM user_sessions
           WHERE token = $1
             AND expires_at > now()`,
          [token]
        );
        if (sessionRes.rows.length === 0) {
          ws.close(4401, 'Invalid session');
          return;
        }

        const userId = sessionRes.rows[0].user_id as string;
        const roleRes = await db.query(
          `SELECT role
           FROM user_roles
           WHERE user_id = $1
             AND company_id = $2`,
          [userId, companyId]
        );
        if (roleRes.rows.length === 0) {
          ws.close(4403, 'Forbidden');
          return;
        }

        logger.info({ companyId, userId, role: roleRes.rows[0].role }, 'Authorized WS connection');
      } else {
        logger.info({ companyId }, 'New WS connection');
      }

      if (!this.clients.has(companyId)) {
        this.clients.set(companyId, new Set());
      }
      this.clients.get(companyId)!.add(ws);

      ws.on('close', () => {
        this.clients.get(companyId)?.delete(ws);
      });
    } catch (err) {
      logger.error({ err }, 'Failed to authorize WS connection');
      this.closeClient(ws, 1011, 'Internal server error');
    }
  }

  private closeClient(ws: WebSocket, code: number, reason: string) {
    if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
      ws.close(code, reason);
    }
  }

  broadcast(companyId: string, event: string, data: any) {
    const targets = this.clients.get(companyId);
    if (!targets) return;

    const payload = JSON.stringify({ event, data, timestamp: new Date().toISOString() });
    
    for (const ws of targets) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(payload);
      }
    }
  }
}

let hub: WSHub | null = null;
export function initWSHub(server: Server) {
  hub = new WSHub(server);
  return hub;
}

export function getWSHub() {
  return hub;
}
