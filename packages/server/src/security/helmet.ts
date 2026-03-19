import type { HelmetOptions } from 'helmet';

function toWebSocketOrigin(origin: string) {
  if (origin.startsWith('https://')) {
    return origin.replace('https://', 'wss://');
  }

  if (origin.startsWith('http://')) {
    return origin.replace('http://', 'ws://');
  }

  return origin;
}

export function buildHelmetOptions(
  allowedOrigins: Iterable<string>
): HelmetOptions {
  const normalizedOrigins = Array.from(
    new Set(Array.from(allowedOrigins).filter(Boolean))
  );
  const connectSources = Array.from(
    new Set([
      "'self'",
      ...normalizedOrigins,
      ...normalizedOrigins.map((origin) => toWebSocketOrigin(origin)),
    ])
  );

  return {
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        defaultSrc: ["'self'"],
        baseUri: ["'self'"],
        frameAncestors: ["'none'"],
        objectSrc: ["'none'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
        imgSrc: ["'self'", 'data:', 'blob:'],
        connectSrc: connectSources,
      },
    },
    crossOriginEmbedderPolicy: false,
  };
}
