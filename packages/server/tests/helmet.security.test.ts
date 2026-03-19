import express from 'express';
import helmet from 'helmet';
import { createServer, type Server } from 'http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildHelmetOptions } from '../src/security/helmet.js';

describe('helmet security config', () => {
  let server: Server;
  let baseUrl: string;

  beforeEach(async () => {
    const app = express();
    app.use(
      helmet(
        buildHelmetOptions([
          'http://localhost:5173',
          'https://biuro.example.com',
        ])
      )
    );
    app.get('/health', (_req, res) => {
      res.json({ ok: true });
    });

    server = createServer(app);
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve());
    });

    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Expected server to listen on a TCP port');
    }

    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => {
        if (err) {
          reject(err);
          return;
        }
        resolve();
      });
    });
  });

  it('sets a restrictive content security policy with no inline scripts', async () => {
    const response = await fetch(`${baseUrl}/health`);

    expect(response.status).toBe(200);
    const csp = response.headers.get('content-security-policy');
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("script-src 'self'");
    expect(csp).not.toContain("'unsafe-inline'");
    expect(csp).toContain('connect-src');
    expect(csp).toContain('http://localhost:5173');
    expect(csp).toContain('ws://localhost:5173');
    expect(csp).toContain('https://biuro.example.com');
    expect(csp).toContain('wss://biuro.example.com');
  });
});
