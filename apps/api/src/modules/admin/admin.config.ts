import { ADMIN_SESSION_TTL_SECONDS } from '@truco/shared';

export const ADMIN_RUNTIME_CONFIG = Symbol('ADMIN_RUNTIME_CONFIG');

export interface AdminRuntimeConfig {
  /** Clave para cifrar los secretos TOTP en reposo (AES-256-GCM). */
  readonly totpEncryptionKey: string;
  readonly sessionTtlSeconds: number;
  readonly nowFn: () => number;
  readonly cookieSecure: boolean;
  readonly cookieDomain: string | null;
  /** Intentos de login del panel por IP y por minuto. */
  readonly loginMaxPerMinute: number;
}

export interface AdminRuntimeConfigOverrides {
  readonly totpEncryptionKey?: string;
  readonly sessionTtlSeconds?: number;
  readonly nowFn?: () => number;
  readonly cookieSecure?: boolean;
  readonly cookieDomain?: string | null;
  readonly loginMaxPerMinute?: number;
}

export function buildAdminRuntimeConfig(
  overrides: AdminRuntimeConfigOverrides = {},
  fallbackSecret?: string,
): AdminRuntimeConfig {
  const encryptionKey =
    overrides.totpEncryptionKey ??
    process.env['ADMIN_TOTP_ENCRYPTION_KEY'] ??
    process.env['SESSION_SECRET'] ??
    fallbackSecret ??
    'admin-totp-dev-key-minimo-32-caracteres!!';
  return {
    totpEncryptionKey: encryptionKey,
    sessionTtlSeconds: overrides.sessionTtlSeconds ?? ADMIN_SESSION_TTL_SECONDS,
    nowFn: overrides.nowFn ?? Date.now,
    cookieSecure: overrides.cookieSecure ?? process.env['NODE_ENV'] === 'production',
    cookieDomain: overrides.cookieDomain ?? process.env['COOKIE_DOMAIN'] ?? null,
    loginMaxPerMinute:
      overrides.loginMaxPerMinute ?? Number(process.env['ADMIN_LOGIN_MAX_PER_MINUTE'] ?? 10),
  };
}
