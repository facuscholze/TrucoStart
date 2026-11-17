/**
 * Cabeceras de seguridad por superficie (API, web de jugadores, panel admin).
 * Se aplican en el servidor (Fastify/nginx) y en el preview de Vite para que el
 * comportamiento local sea el mismo que en producción.
 */

export type SecurityHeaders = Readonly<Record<string, string>>;

/** Cabeceras de la API: no se sirve HTML, así que CSP es la más restrictiva. */
export function apiSecurityHeaders(options: {
  readonly production: boolean;
  readonly hstsMaxAgeSeconds?: number;
}): SecurityHeaders {
  const headers: Record<string, string> = {
    'content-security-policy':
      "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
    'cross-origin-opener-policy': 'same-origin',
    'cross-origin-resource-policy': 'same-site',
    'x-frame-options': 'DENY',
  };
  if (options.production) {
    headers['strict-transport-security'] =
      `max-age=${options.hstsMaxAgeSeconds ?? 31_536_000}; includeSubDomains; preload`;
  }
  return headers;
}

/**
 * Cabeceras de la SPA de jugadores. `connect-src`/`img-src` incluyen los orígenes
 * de API y game-server configurados (`VITE_API_URL`, `VITE_GAME_SERVER_URL`).
 */
export function webSecurityHeaders(options: {
  readonly production: boolean;
  readonly apiOrigin: string;
  readonly gameServerOrigin: string;
  readonly hstsMaxAgeSeconds?: number;
}): SecurityHeaders {
  const connect = [`'self'`, options.apiOrigin, options.gameServerOrigin].filter(Boolean);
  const wsConnect = connect.map((origin) =>
    origin.startsWith('https://')
      ? `wss://${origin.slice('https://'.length)}`
      : origin.startsWith('http://')
        ? `ws://${origin.slice('http://'.length)}`
        : origin,
  );
  const csp = [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src ${[...new Set([...connect, ...wsConnect])].join(' ')}`,
    "manifest-src 'self'",
    "worker-src 'self'",
  ].join('; ');

  const headers: Record<string, string> = {
    'content-security-policy': csp,
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'strict-origin-when-cross-origin',
    'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
    'cross-origin-opener-policy': 'same-origin-allow-popups',
    'x-frame-options': 'DENY',
  };
  if (options.production) {
    headers['strict-transport-security'] =
      `max-age=${options.hstsMaxAgeSeconds ?? 31_536_000}; includeSubDomains; preload`;
  }
  return headers;
}

/**
 * Cabeceras del panel admin: origen distinto al de jugadores, sin terceros, sin
 * frames y con `connect-src` limitado a la API.
 */
export function adminSecurityHeaders(options: {
  readonly production: boolean;
  readonly apiOrigin: string;
  readonly hstsMaxAgeSeconds?: number;
}): SecurityHeaders {
  const csp = [
    "default-src 'self'",
    "base-uri 'none'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self' data:",
    `connect-src 'self' ${options.apiOrigin}`.trim(),
    "manifest-src 'none'",
  ].join('; ');

  const headers: Record<string, string> = {
    'content-security-policy': csp,
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
    'cross-origin-opener-policy': 'same-origin',
    'cross-origin-resource-policy': 'same-origin',
    'x-frame-options': 'DENY',
    'cache-control': 'no-store',
  };
  if (options.production) {
    headers['strict-transport-security'] =
      `max-age=${options.hstsMaxAgeSeconds ?? 31_536_000}; includeSubDomains; preload`;
  }
  return headers;
}
