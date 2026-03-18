import { WebSocketServer, WebSocket } from 'ws';
import { Server } from 'http';
import { logger } from './utils/logger.js';

export class WSHub {
  private wss: WebSocketServer;
  private clients: Map<string, Set<WebSocket>> = new Map(); // companyId -> Set of WS

  constructor(server: Server) {
    this.wss = new WebSocketServer({ server, path: '/ws' });

    this.wss.on('connection', (ws: WebSocket, req: any) => {
      const url = new URL(req.url || '', `http://${req.headers.host}`);
      const companyId = url.searchParams.get('companyId');

      if (!companyId) {
        ws.close();
        return;
      }

      logger.info({ companyId }, 'New WS connection');

      if (!this.clients.has(companyId)) {
        this.clients.set(companyId, new Set());
      }
      this.clients.get(companyId)!.add(ws);

      ws.on('close', () => {
        this.clients.get(companyId)?.delete(ws);
      });
    });
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
