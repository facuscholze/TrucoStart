import {
  DEFAULT_ACCESS_TOKEN_TTL_SECONDS,
  DEFAULT_REFRESH_TOKEN_TTL_SECONDS,
  DEFAULT_WS_TICKET_TTL_MS,
  LOGIN_ACCOUNT_CAPTCHA_THRESHOLD,
  LOGIN_FAILURE_WINDOW_MS,
} from '@truco/shared';
import type { CookieConfig } from './security/token-crypto.js';

export const AUTH_RUNTIME_CONFIG = Symbol('AUTH_RUNTIME_CONFIG');

export interface AuthRuntimeConfig {
  readonly sessionSecret: string;
  readonly cookieConfig: CookieConfig;
  readonly accessTtlSeconds: number;
  readonly refreshTtlSeconds: number;
  readonly wsTicketTtlMs: number;
  readonly loginCaptchaThreshold: number;
  readonly loginFailureWindowMs: number;
  readonly nicknameBlockedTerms?: readonly string[];
  readonly nowFn: () => number;
}

export interface RequestClientMeta {
  readonly ip: string;
  readonly userAgent: string | null;
}

export function deriveDeviceName(
  explicitName: string | undefined,
  userAgent: string | null,
): string {
  if (explicitName && explicitName.trim().length > 0) {
    return explicitName.trim().slice(0, 80);
  }
  if (!userAgent) return 'Navegador Web';
  if (/iphone|ipad|ios/i.test(userAgent)) return 'Safari / iOS';
  if (/android/i.test(userAgent)) return 'Navegador Android';
  if (/firefox/i.test(userAgent)) return 'Firefox';
  if (/edg/i.test(userAgent)) return 'Microsoft Edge';
  if (/chrome/i.test(userAgent)) return 'Google Chrome';
  return 'Navegador Web';
}

export function buildAuthRuntimeConfigFromEnv(
  overrides: Partial<AuthRuntimeConfig> = {},
): AuthRuntimeConfig {
  const sessionSecret =
    overrides.sessionSecret ??
    process.env['SESSION_SECRET'] ??
    'dev-only-placeholder-secret-minimum-32-chars!!';
  const accessTtlSeconds = overrides.accessTtlSeconds ?? DEFAULT_ACCESS_TOKEN_TTL_SECONDS;
  const refreshTtlSeconds = overrides.refreshTtlSeconds ?? DEFAULT_REFRESH_TOKEN_TTL_SECONDS;
  const wsTicketTtlMs = overrides.wsTicketTtlMs ?? DEFAULT_WS_TICKET_TTL_MS;
  const cookieDomain = process.env['COOKIE_DOMAIN'] ?? 'localhost';
  const rawBlocked = process.env['NICKNAME_BLOCKED_TERMS'] ?? '';
  const blockedFromEnv = rawBlocked
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);

  return {
    sessionSecret,
    accessTtlSeconds,
    refreshTtlSeconds,
    wsTicketTtlMs,
    loginCaptchaThreshold: overrides.loginCaptchaThreshold ?? LOGIN_ACCOUNT_CAPTCHA_THRESHOLD,
    loginFailureWindowMs: overrides.loginFailureWindowMs ?? LOGIN_FAILURE_WINDOW_MS,
    nicknameBlockedTerms: overrides.nicknameBlockedTerms ?? blockedFromEnv,
    nowFn: overrides.nowFn ?? Date.now,
    cookieConfig: overrides.cookieConfig ?? {
      cookieDomain,
      accessTtlSeconds,
      refreshTtlSeconds,
      sameSite: 'lax',
    },
  };
}
