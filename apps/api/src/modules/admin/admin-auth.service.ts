import { Inject, Injectable } from '@nestjs/common';
import {
  ADMIN_ROLE_PERMISSIONS,
  type AdminLoginRequest,
  type AdminPermission,
  type AdminSessionSummary,
  type AdminRole,
  maskEmail,
} from '@truco/shared';
import type { FastifyReply } from 'fastify';
import { resolveEffectiveAccountStatus } from '../../common/account-status.js';
import { DomainApiException } from '../../common/api-exception.js';
import {
  RATE_LIMIT_STORE,
  type RateLimitStore,
} from '../../common/rate-limit/rate-limit-store.interface.js';
import { AuditRepository } from '../audit/audit.repository.js';
import type { RequestClientMeta } from '../auth/auth.config.js';
import { PasswordHasher } from '../auth/security/password-hasher.js';
import { generateOpaqueToken, hashOpaqueTokenSha256 } from '../auth/security/token-crypto.js';
import { ADMIN_RUNTIME_CONFIG, type AdminRuntimeConfig } from './admin.config.js';
import { AdminRepository } from './admin.repository.js';
import {
  decryptTotpSecret,
  encryptTotpSecret,
  generateRecoveryCodes,
  generateTotpSecret,
  hashRecoveryCode,
  verifyTotpCode,
} from './security/totp.js';

export interface AdminPrincipal {
  readonly userId: string;
  readonly sessionId: string;
  readonly nickname: string;
  readonly email: string | null;
  readonly role: AdminRole;
  readonly permissions: readonly AdminPermission[];
}

export interface AdminLoginBundle {
  readonly session: AdminSessionSummary;
  readonly cookieValue: string;
  readonly cookieMaxAgeSeconds: number;
}

export interface AdminTwoFactorBootstrap {
  readonly secret: string;
  readonly otpauthUri: string;
  readonly recoveryCodes: string[];
}

/** Cookie separada de la del jugador, corta y revocable. */
@Injectable()
export class AdminAuthService {
  constructor(
    @Inject(ADMIN_RUNTIME_CONFIG) private readonly config: AdminRuntimeConfig,
    @Inject(AdminRepository) private readonly repo: AdminRepository,
    @Inject(PasswordHasher) private readonly passwordHasher: PasswordHasher,
    @Inject(RATE_LIMIT_STORE) private readonly rateLimit: RateLimitStore,
    @Inject(AuditRepository) private readonly audit: AuditRepository,
  ) {}

  /** Alta del primer admin (solo CLI): genera secreto TOTP + códigos de recuperación. */
  async bootstrapTwoFactor(userId: string): Promise<AdminTwoFactorBootstrap> {
    const user = await this.repo.findUserById(userId);
    if (!user) throw new Error('Usuario inexistente');
    const secret = generateTotpSecret();
    const recoveryCodes = generateRecoveryCodes();
    const now = new Date(this.config.nowFn());
    await this.repo.upsertTwoFactor({
      userId,
      secretEncrypted: encryptTotpSecret(secret, this.config.totpEncryptionKey),
      recoveryCodes: recoveryCodes.map((code) => ({ hash: hashRecoveryCode(code), usedAt: null })),
      confirmedAt: now,
      now,
    });
    return {
      secret,
      otpauthUri: `otpauth://totp/${encodeURIComponent('Mesa de Truco')}:${encodeURIComponent(
        user.email ?? user.nickname,
      )}?secret=${secret}&issuer=Mesa%20de%20Truco&algorithm=SHA1&digits=6&period=30`,
      recoveryCodes,
    };
  }

  async login(input: AdminLoginRequest, meta: RequestClientMeta): Promise<AdminLoginBundle> {
    const nowMs = this.config.nowFn();
    const now = new Date(nowMs);
    const emailLower = input.email.trim().toLowerCase();

    const limit = await this.rateLimit.consumeWindow(
      'admin:login:ip:' + meta.ip,
      this.config.loginMaxPerMinute,
      60_000,
    );
    if (!limit.allowed) {
      throw new DomainApiException(
        429,
        'RATE_LIMITED',
        'Demasiados intentos de acceso al panel. Esperá un minuto.',
        { retryAfterMs: limit.retryAfterMs },
      );
    }

    const user = await this.repo.findUserByEmail(emailLower);
    const passwordMatches = await this.passwordHasher.verifyPasswordTimingSafe(
      input.password,
      user?.passwordHash ?? null,
    );

    if (!user || user.deletedAt !== null || !passwordMatches || user.role === 'PLAYER') {
      await this.audit.record({
        actorId: user?.id ?? null,
        action: 'ADMIN_LOGIN_FAILED',
        entity: 'admin_session',
        entityId: null,
        reason: 'Credenciales inválidas o rol insuficiente',
        ip: meta.ip,
        now,
      });
      throw new DomainApiException(401, 'UNAUTHORIZED', 'Credenciales inválidas.');
    }

    const effective = resolveEffectiveAccountStatus(user, now);
    if (effective.status !== 'ACTIVE') {
      throw new DomainApiException(403, 'FORBIDDEN', 'Esta cuenta administrativa está bloqueada.');
    }

    const twoFactor = await this.repo.findTwoFactor(user.id);
    if (!twoFactor || twoFactor.confirmedAt === null) {
      // 2FA obligatorio: sin segundo factor configurado no hay acceso (se crea por CLI).
      throw new DomainApiException(
        403,
        'FORBIDDEN',
        'El segundo factor (TOTP) no está configurado. Un administrador debe generarlo por CLI.',
        { reason: 'ADMIN_2FA_NOT_CONFIGURED' },
      );
    }

    let secret: string;
    try {
      secret = decryptTotpSecret(twoFactor.secretEncrypted, this.config.totpEncryptionKey);
    } catch {
      // El secreto no se puede descifrar: casi siempre `ADMIN_TOTP_ENCRYPTION_KEY` cambió.
      throw new DomainApiException(
        500,
        'INTERNAL_ERROR',
        'No se pudo leer el segundo factor: verificá ADMIN_TOTP_ENCRYPTION_KEY.',
        { reason: 'ADMIN_2FA_MISCONFIGURED' },
      );
    }
    const isRecoveryCode = /^\d{4}-?\d{4}$/.test(input.totpCode.replace(/\s/g, ''));
    let verified = false;
    let usedStep: number | null = null;

    if (isRecoveryCode) {
      const hash = hashRecoveryCode(input.totpCode);
      const codes = [...twoFactor.recoveryCodes];
      const index = codes.findIndex((entry) => entry.hash === hash && entry.usedAt === null);
      if (index >= 0) {
        codes[index] = { ...codes[index]!, usedAt: now.toISOString() };
        await this.repo.updateRecoveryCodes(user.id, codes, twoFactor.lastUsedStep ?? null, now);
        verified = true;
      }
    } else {
      const result = verifyTotpCode(secret, input.totpCode, nowMs, {
        lastUsedStep: twoFactor.lastUsedStep ?? null,
      });
      if (result.valid && result.step !== null) {
        await this.repo.updateRecoveryCodes(
          user.id,
          [...twoFactor.recoveryCodes],
          result.step,
          now,
        );
        verified = true;
        usedStep = result.step;
      }
    }

    if (!verified) {
      await this.audit.record({
        actorId: user.id,
        action: 'ADMIN_LOGIN_FAILED',
        entity: 'admin_session',
        entityId: null,
        reason: 'Código 2FA inválido',
        ip: meta.ip,
        now,
      });
      throw new DomainApiException(401, 'UNAUTHORIZED', 'Código 2FA inválido o ya utilizado.', {
        reason: 'ADMIN_2FA_INVALID',
      });
    }

    const rawToken = generateOpaqueToken(32);
    const expiresAt = new Date(nowMs + this.config.sessionTtlSeconds * 1000);
    const sessionId = await this.repo.createAdminSession({
      userId: user.id,
      tokenHash: hashOpaqueTokenSha256(rawToken),
      ip: meta.ip,
      userAgent: meta.userAgent,
      expiresAt,
      now,
    });

    await this.audit.record({
      actorId: user.id,
      action: 'ADMIN_LOGIN_SUCCESS',
      entity: 'admin_session',
      entityId: sessionId,
      reason: isRecoveryCode ? 'Acceso con código de recuperación' : `TOTP step ${usedStep}`,
      ip: meta.ip,
      now,
    });

    return {
      session: this.toSummary(user, expiresAt),
      cookieValue: rawToken,
      cookieMaxAgeSeconds: this.config.sessionTtlSeconds,
    };
  }

  async authenticate(rawCookie: string | undefined): Promise<AdminPrincipal> {
    if (!rawCookie) {
      throw new DomainApiException(401, 'UNAUTHORIZED', 'Sesión administrativa ausente.');
    }
    const session = await this.repo.findAdminSessionByTokenHash(hashOpaqueTokenSha256(rawCookie));
    const nowMs = this.config.nowFn();
    if (!session || session.revokedAt !== null || session.expiresAt.getTime() <= nowMs) {
      throw new DomainApiException(
        401,
        'UNAUTHORIZED',
        'Sesión administrativa vencida o revocada.',
      );
    }
    const user = await this.repo.findUserById(session.userId);
    if (!user || user.role === 'PLAYER' || user.deletedAt !== null) {
      throw new DomainApiException(403, 'FORBIDDEN', 'El rol del operador ya no es suficiente.');
    }
    if (resolveEffectiveAccountStatus(user, new Date(nowMs)).status !== 'ACTIVE') {
      throw new DomainApiException(403, 'FORBIDDEN', 'La cuenta administrativa está bloqueada.');
    }
    return {
      userId: user.id,
      sessionId: session.id,
      nickname: user.nickname,
      email: user.email,
      role: user.role,
      permissions: ADMIN_ROLE_PERMISSIONS[user.role],
    };
  }

  async logout(rawCookie: string | undefined, ip: string | null): Promise<void> {
    if (!rawCookie) return;
    const session = await this.repo.findAdminSessionByTokenHash(hashOpaqueTokenSha256(rawCookie));
    if (!session) return;
    const now = new Date(this.config.nowFn());
    await this.repo.revokeAdminSession(session.id, now);
    await this.audit.record({
      actorId: session.userId,
      action: 'ADMIN_LOGOUT',
      entity: 'admin_session',
      entityId: session.id,
      ip,
      now,
    });
  }

  /** Revoca todas las sesiones del panel de un operador (al sancionarlo o bajarle el rol). */
  async revokeAllSessions(userId: string, reason: string): Promise<number> {
    const now = new Date(this.config.nowFn());
    const revoked = await this.repo.revokeAllAdminSessionsForUser(userId, now);
    await this.audit.record({
      actorId: null,
      action: 'ADMIN_SESSIONS_REVOKED',
      entity: 'user',
      entityId: userId,
      reason,
      now,
    });
    return revoked;
  }

  toSummary(
    user: { id: string; nickname: string; email: string | null; role: string },
    expiresAt: Date,
    permissionsOverride?: readonly AdminPermission[],
  ): AdminSessionSummary {
    const role = user.role as AdminRole;
    const permissions = permissionsOverride ?? ADMIN_ROLE_PERMISSIONS[role];
    const canSeePii = permissions.includes('users:read_pii');
    return {
      userId: user.id,
      nickname: user.nickname,
      role,
      permissions: [...permissions],
      emailMasked: canSeePii ? (user.email ?? '') : (maskEmail(user.email) ?? ''),
      expiresAt: expiresAt.toISOString(),
      twoFactorEnabled: true,
    };
  }

  applyCookie(reply: FastifyReply, cookieValue: string, maxAgeSeconds: number): void {
    reply.setCookie(ADMIN_SESSION_COOKIE, cookieValue, {
      path: '/v1/admin',
      httpOnly: true,
      secure: this.config.cookieSecure,
      sameSite: 'strict',
      maxAge: maxAgeSeconds,
      ...(this.config.cookieDomain ? { domain: this.config.cookieDomain } : {}),
    });
  }

  clearCookie(reply: FastifyReply): void {
    reply.clearCookie(ADMIN_SESSION_COOKIE, { path: '/v1/admin' });
  }
}

export const ADMIN_SESSION_COOKIE = 'truco_admin_access';
