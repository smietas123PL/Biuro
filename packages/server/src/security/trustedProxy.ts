import { env } from '../env.js';

function normalizeIp(ip: string | null | undefined) {
  if (!ip) {
    return null;
  }

  const trimmed = ip.trim();
  if (!trimmed) {
    return null;
  }

  if (trimmed.startsWith('::ffff:')) {
    return trimmed.slice(7);
  }

  return trimmed;
}

function getForwardedClientIp(value: unknown) {
  if (typeof value === 'string') {
    return normalizeIp(value.split(',')[0]);
  }

  if (Array.isArray(value) && value.length > 0) {
    return normalizeIp(String(value[0]).split(',')[0]);
  }

  return null;
}

export function isTrustedProxyIp(
  remoteAddress: string | null | undefined,
  trustedProxyIps: string[] = env.TRUSTED_PROXY_IPS
) {
  const normalized = normalizeIp(remoteAddress);
  if (!normalized) {
    return false;
  }

  return trustedProxyIps.map((ip) => normalizeIp(ip)).includes(normalized);
}

export function resolveClientIp(
  req: Pick<
    { headers: Record<string, unknown>; socket?: { remoteAddress?: string | null } },
    'headers' | 'socket'
  >
) {
  const remoteAddress = normalizeIp(req.socket?.remoteAddress) ?? 'unknown';

  if (!isTrustedProxyIp(remoteAddress)) {
    return remoteAddress;
  }

  return getForwardedClientIp(req.headers['x-forwarded-for']) ?? remoteAddress;
}
