import { WebSocketServer, WebSocket } from 'ws';
import { Server } from 'http';
import { db } from './db/client.js';
import { env } from './env.js';
import { logger } from './utils/logger.js';
import {
  setWsSnapshot,
  wsBroadcastEventsTotal,
  wsConnectionAttemptsTotal,
} from './observability/metrics.js';
import { resolveClientIp } from './security/trustedProxy.js';

export class WSHub {
  private wss: WebSocketServer;
  private clients: Map<string, Set<WebSocket>> = new Map(); // companyId -> Set of WS
  private connectionAttempts: Map<string, number[]> = new Map();
  private messageAttempts: Map<string, number[]> = new Map();
  private broadcastAttempts: Map<string, number[]> = new Map();

  constructor(server: Server) {
    this.wss = new WebSocketServer({ server, path: '/ws' });
    this.updateSnapshot();

    this.wss.on('connection', (ws: WebSocket, req: any) => {
      void this.handleConnection(ws, req);
    });
  }

  private async handleConnection(ws: WebSocket, req: any) {
    try {
      const clientIp = this.getClientIp(req);
      if (!this.allowConnection(clientIp)) {
        wsConnectionAttemptsTotal.inc({ outcome: 'rate_limited' });
        logger.warn({ clientIp }, 'WS connection rate limit exceeded');
        this.closeClient(ws, 4429, 'Too many websocket connection attempts');
        return;
      }

      const url = new URL(req.url || '', `http://${req.headers.host}`);
      const companyId = url.searchParams.get('companyId');
      const token = url.searchParams.get('token');

      if (!companyId) {
        wsConnectionAttemptsTotal.inc({ outcome: 'missing_company' });
        ws.close(4400, 'Missing companyId');
        return;
      }

      if (env.AUTH_ENABLED) {
        if (!token) {
          wsConnectionAttemptsTotal.inc({ outcome: 'missing_token' });
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
          wsConnectionAttemptsTotal.inc({ outcome: 'invalid_session' });
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
          wsConnectionAttemptsTotal.inc({ outcome: 'forbidden' });
          ws.close(4403, 'Forbidden');
          return;
        }

        logger.info(
          { companyId, userId, role: roleRes.rows[0].role },
          'Authorized WS connection'
        );
      } else {
        logger.info({ companyId }, 'New WS connection');
      }

      if (!this.clients.has(companyId)) {
        this.clients.set(companyId, new Set());
      }
      this.clients.get(companyId)!.add(ws);
      wsConnectionAttemptsTotal.inc({ outcome: 'accepted' });
      this.updateSnapshot();

      ws.on('message', () => {
        const messageKey = `${companyId}:${clientIp}`;
        if (!this.allowMessage(messageKey)) {
          logger.warn({ companyId, clientIp }, 'WS message rate limit exceeded');
          this.closeClient(ws, 4429, 'Too many websocket messages');
        }
      });

      ws.on('close', () => {
        const companyClients = this.clients.get(companyId);
        companyClients?.delete(ws);
        if (companyClients && companyClients.size === 0) {
          this.clients.delete(companyId);
        }
        this.updateSnapshot();
      });
    } catch (err) {
      wsConnectionAttemptsTotal.inc({ outcome: 'error' });
      logger.error({ err }, 'Failed to authorize WS connection');
      this.closeClient(ws, 1011, 'Internal server error');
    }
  }

  private closeClient(ws: WebSocket, code: number, reason: string) {
    if (
      ws.readyState === WebSocket.OPEN ||
      ws.readyState === WebSocket.CONNECTING
    ) {
      ws.close(code, reason);
    }
  }

  private getClientIp(req: any) {
    return resolveClientIp(req);
  }

  private allowConnection(clientIp: string) {
    const now = Date.now();
    const windowStart = now - env.WS_RATE_LIMIT_WINDOW_MS;
    const recentAttempts = (this.connectionAttempts.get(clientIp) ?? []).filter(
      (timestamp) => timestamp > windowStart
    );

    if (recentAttempts.length >= env.WS_RATE_LIMIT_MAX) {
      this.connectionAttempts.set(clientIp, recentAttempts);
      return false;
    }

    recentAttempts.push(now);
    this.connectionAttempts.set(clientIp, recentAttempts);
    return true;
  }

  private allowMessage(messageKey: string) {
    const now = Date.now();
    const windowStart = now - env.WS_MESSAGE_RATE_LIMIT_WINDOW_MS;
    const recentAttempts = (this.messageAttempts.get(messageKey) ?? []).filter(
      (timestamp) => timestamp > windowStart
    );

    if (recentAttempts.length >= env.WS_MESSAGE_RATE_LIMIT_MAX) {
      this.messageAttempts.set(messageKey, recentAttempts);
      return false;
    }

    recentAttempts.push(now);
    this.messageAttempts.set(messageKey, recentAttempts);
    return true;
  }

  private allowBroadcast(companyId: string) {
    const now = Date.now();
    const windowStart = now - env.WS_BROADCAST_RATE_LIMIT_WINDOW_MS;
    const recentBroadcasts = (this.broadcastAttempts.get(companyId) ?? []).filter(
      (timestamp) => timestamp > windowStart
    );

    if (recentBroadcasts.length >= env.WS_BROADCAST_RATE_LIMIT_MAX) {
      this.broadcastAttempts.set(companyId, recentBroadcasts);
      return false;
    }

    recentBroadcasts.push(now);
    this.broadcastAttempts.set(companyId, recentBroadcasts);
    return true;
  }

  broadcast(companyId: string, event: string, data: any) {
    const targets = this.clients.get(companyId);
    if (!targets) return;

    if (!this.allowBroadcast(companyId)) {
      logger.warn(
        { companyId, event },
        'Dropping websocket broadcast because broadcast rate limit was exceeded'
      );
      return;
    }

    const payload = JSON.stringify({
      event,
      data,
      timestamp: new Date().toISOString(),
    });
    wsBroadcastEventsTotal.inc({ event });

    for (const ws of targets) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(payload);
      }
    }
  }

  private updateSnapshot() {
    let connections = 0;
    for (const companyClients of this.clients.values()) {
      connections += companyClients.size;
    }

    setWsSnapshot({
      connections,
      rooms: this.clients.size,
    });
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
