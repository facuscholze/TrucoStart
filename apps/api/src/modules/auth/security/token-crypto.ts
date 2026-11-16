import '@fastify/cookie';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import {
  ACCESS_COOKIE_NAME,
  DEFAULT_ACCESS_TOKEN_TTL_SECONDS,
  DEFAULT_REFRESH_TOKEN_TTL_SECONDS,
  LOCKOUT_DURATIONS_MS,
  LOCKOUT_THRESHOLD_ATTEMPTS,
  REFRESH_COOKIE_NAME,
  type UserRole,
} from '@truco/shared';
import type { FastifyReply } from 'fastify';
import { z } from 'zod';

export function generateOpaqueToken(byteLength = 32): string {
  return randomBytes(byteLength).toString('base64url');
}

export function hashOpaqueTokenSha256(rawToken: string): string {
  return createHash('sha256').update(rawToken, 'utf8').digest('hex');
}

const AccessClaimsSchema = z.object({
  userId: z.string().uuid(),
  sessionId: z.string().uuid(),
  role: z.enum(['PLAYER', 'SUPPORT', 'MODERATOR', 'ADMIN']),
  isGuest: z.boolean(),
  exp: z.number().int().positive(),
});

export type AccessTokenClaims = z.infer<typeof AccessClaimsSchema>;

export function signAccessSessionCookie(claims: AccessTokenClaims, secret: string): string {
  const payloadB64 = Buffer.from(JSON.stringify(claims), 'utf8').toString('base64url');
  const sigB64 = createHmac('sha256', `access-v1:${secret}`)
    .update(payloadB64, 'utf8')
    .digest('base64url');
  return `${payloadB64}.${sigB64}`;
}

export function verifyAccessSessionCookie(
  token: string | undefined,
  secret: string,
  nowMs = Date.now(),
): AccessTokenClaims | null {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [payloadB64, sigB64] = parts;
  if (!payloadB64 || !sigB64) return null;

  let actualSig: Buffer;
  try {
    actualSig = Buffer.from(sigB64, 'base64url');
  } catch {
    return null;
  }

  const expectedSig = createHmac('sha256', `access-v1:${secret}`)
    .update(payloadB64, 'utf8')
    .digest();
  if (actualSig.length !== expectedSig.length || !timingSafeEqual(actualSig, expectedSig)) {
    return null;
  }

  try {
    const raw = Buffer.from(payloadB64, 'base64url').toString('utf8');
    const parsed = AccessClaimsSchema.safeParse(JSON.parse(raw));
    if (!parsed.success || parsed.data.exp <= nowMs) return null;
    return parsed.data;
  } catch {
    return null;
  }
}

export interface CookieConfig {
  readonly cookieDomain?: string;
  readonly accessTtlSeconds?: number;
  readonly refreshTtlSeconds?: number;
  readonly sameSite?: 'lax' | 'strict';
}

export function setAuthCookiesOnReply(
  reply: FastifyReply,
  params: {
    readonly accessToken: string;
    readonly refreshToken: string;
    readonly config?: CookieConfig;
  },
): void {
  const accessMaxAge = params.config?.accessTtlSeconds ?? DEFAULT_ACCESS_TOKEN_TTL_SECONDS;
  const refreshMaxAge = params.config?.refreshTtlSeconds ?? DEFAULT_REFRESH_TOKEN_TTL_SECONDS;
  const sameSite = params.config?.sameSite ?? 'lax';
  const domain =
    params.config?.cookieDomain && params.config.cookieDomain !== 'localhost'
      ? params.config.cookieDomain
      : undefined;

  reply.setCookie(ACCESS_COOKIE_NAME, params.accessToken, {
    httpOnly: true,
    secure: true,
    sameSite,
    path: '/',
    maxAge: accessMaxAge,
    ...(domain ? { domain } : {}),
  });

  reply.setCookie(REFRESH_COOKIE_NAME, params.refreshToken, {
    httpOnly: true,
    secure: true,
    sameSite,
    path: '/v1/auth',
    maxAge: refreshMaxAge,
    ...(domain ? { domain } : {}),
  });
}

export function clearAuthCookiesOnReply(reply: FastifyReply, config?: CookieConfig): void {
  const sameSite = config?.sameSite ?? 'lax';
  const domain =
    config?.cookieDomain && config.cookieDomain !== 'localhost' ? config.cookieDomain : undefined;

  reply.clearCookie(ACCESS_COOKIE_NAME, {
    httpOnly: true,
    secure: true,
    sameSite,
    path: '/',
    ...(domain ? { domain } : {}),
  });

  reply.clearCookie(REFRESH_COOKIE_NAME, {
    httpOnly: true,
    secure: true,
    sameSite,
    path: '/v1/auth',
    ...(domain ? { domain } : {}),
  });
}

export function computeNextFailedLoginLockout(
  previousFailures: number,
  nowMs = Date.now(),
): { failedLoginCount: number; lockedUntil: Date | null } {
  const nextCount = previousFailures + 1;
  if (nextCount < LOCKOUT_THRESHOLD_ATTEMPTS) {
    return { failedLoginCount: nextCount, lockedUntil: null };
  }
  const tierIdx = Math.min(nextCount - LOCKOUT_THRESHOLD_ATTEMPTS, LOCKOUT_DURATIONS_MS.length - 1);
  const durationMs = LOCKOUT_DURATIONS_MS[tierIdx]!;
  return {
    failedLoginCount: nextCount,
    lockedUntil: new Date(nowMs + durationMs),
  };
}

export function createAccessCookieValue(params: {
  readonly userId: string;
  readonly sessionId: string;
  readonly role: UserRole;
  readonly isGuest: boolean;
  readonly secret: string;
  readonly nowMs?: number;
  readonly ttlSeconds?: number;
}): string {
  const now = params.nowMs ?? Date.now();
  const ttl = params.ttlSeconds ?? DEFAULT_ACCESS_TOKEN_TTL_SECONDS;
  return signAccessSessionCookie(
    {
      userId: params.userId,
      sessionId: params.sessionId,
      role: params.role,
      isGuest: params.isGuest,
      exp: now + ttl * 1000,
    },
    params.secret,
  );
}
