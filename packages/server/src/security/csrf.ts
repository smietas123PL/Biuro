import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { env } from '../env.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function normalizeHeaderValue(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return value;
  }

  if (Array.isArray(value) && typeof value[0] === 'string') {
    return value[0];
  }

  return undefined;
}

function isBrowserLikeRequest(req: Request) {
  return Boolean(
    normalizeHeaderValue(req.headers.origin) ||
      normalizeHeaderValue(req.headers['sec-fetch-site']) ||
      normalizeHeaderValue(req.headers['sec-fetch-mode'])
  );
}

function getBearerToken(req: Request) {
  return req.headers.authorization?.split(' ')[1];
}

export function createCsrfToken(sessionToken: string) {
  return crypto
    .createHmac('sha256', env.CSRF_SECRET)
    .update(sessionToken, 'utf8')
    .digest('hex');
}

function isValidCsrfToken(sessionToken: string, csrfToken: string) {
  const expected = createCsrfToken(sessionToken);
  const expectedBuffer = Buffer.from(expected, 'utf8');
  const providedBuffer = Buffer.from(csrfToken, 'utf8');

  if (expectedBuffer.length !== providedBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(expectedBuffer, providedBuffer);
}

export function requireCsrfProtection() {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!env.CSRF_PROTECTION_ENABLED) {
      next();
      return;
    }

    if (SAFE_METHODS.has(req.method.toUpperCase())) {
      next();
      return;
    }

    const sessionToken = getBearerToken(req);
    if (!sessionToken || !isBrowserLikeRequest(req)) {
      next();
      return;
    }

    const csrfToken = normalizeHeaderValue(req.headers['x-csrf-token']);
    if (!csrfToken || !isValidCsrfToken(sessionToken, csrfToken)) {
      res.status(403).json({ error: 'Forbidden: Invalid CSRF token' });
      return;
    }

    next();
  };
}
