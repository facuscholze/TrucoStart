import { randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
  generateGuestNickname,
  type GoogleAuthRequest,
  type GuestCreateRequest,
  type LoginRequest,
  normalizeNicknameLower,
  type PromoteGuestRequest,
  type RegisterRequest,
  validateNickname,
} from '@truco/shared';
import { DomainApiException } from '../../common/api-exception.js';
import type { UserRow } from '../../db/schema/index.js';
import { AuditRepository } from '../audit/audit.repository.js';
import {
  AUTH_RUNTIME_CONFIG,
  type AuthRuntimeConfig,
  type RequestClientMeta,
} from './auth.config.js';
import { AuthRecoveryService } from './auth-recovery.service.js';
import { AuthRepository } from './auth.repository.js';
import { AuthSessionService, type SessionIssueBundle } from './auth-session.service.js';
import type { AuthenticatedPrincipal } from './guards/session-auth.guard.js';
import { CAPTCHA_VERIFIER, type CaptchaVerifier } from './providers/captcha.verifier.js';
import {
  GOOGLE_OAUTH_VERIFIER,
  type GoogleOAuthVerifier,
} from './providers/google-oauth.verifier.js';
import { HttpAuthRateLimiter } from './security/http-rate-limiter.js';
import { PasswordHasher } from './security/password-hasher.js';

@Injectable()
export class AuthService {
  constructor(
    @Inject(AUTH_RUNTIME_CONFIG) private readonly config: AuthRuntimeConfig,
    @Inject(AuthRepository) private readonly repo: AuthRepository,
    @Inject(AuthSessionService) private readonly sessionService: AuthSessionService,
    @Inject(AuthRecoveryService) private readonly recoveryService: AuthRecoveryService,
    @Inject(AuditRepository) private readonly audit: AuditRepository,
    @Inject(PasswordHasher) private readonly passwordHasher: PasswordHasher,
    @Inject(HttpAuthRateLimiter) private readonly rateLimiter: HttpAuthRateLimiter,
    @Inject(CAPTCHA_VERIFIER) private readonly captchaVerifier: CaptchaVerifier,
    @Inject(GOOGLE_OAUTH_VERIFIER) private readonly googleVerifier: GoogleOAuthVerifier,
  ) {}

  private assertValidAndAvailableNickname(
    nickname: string,
    existingOwner: UserRow | null,
    allowedUserId?: string,
  ): string {
    const check = validateNickname(nickname, {
      extraBlockedTerms: this.config.nicknameBlockedTerms,
    });
    if (!check.valid) {
      throw new DomainApiException(400, 'VALIDATION_ERROR', check.reason ?? 'Apodo no permitido', {
        field: 'nickname',
      });
    }
    if (existingOwner && existingOwner.id !== allowedUserId) {
      throw new DomainApiException(
        409,
        'CONFLICT',
        'Ese apodo ya está en uso (sin distinción de mayúsculas). Elegí otro.',
        { field: 'nickname' },
      );
    }
    return check.normalizedLower;
  }

  private async allocateAvailableGuestNickname(preferred?: string): Promise<{
    nickname: string;
    nicknameLower: string;
  }> {
    if (preferred) {
      const trimmed = preferred.trim();
      const owner = await this.repo.findUserByNicknameLower(normalizeNicknameLower(trimmed));
      const lower = this.assertValidAndAvailableNickname(trimmed, owner);
      return { nickname: trimmed, nicknameLower: lower };
    }

    for (let attempt = 0; attempt < 16; attempt++) {
      const candidate = generateGuestNickname(randomBytes(6));
      const check = validateNickname(candidate, {
        extraBlockedTerms: this.config.nicknameBlockedTerms,
      });
      if (!check.valid) continue;
      const owner = await this.repo.findUserByNicknameLower(check.normalizedLower);
      if (!owner) {
        return { nickname: candidate, nicknameLower: check.normalizedLower };
      }
    }
    throw new DomainApiException(500, 'INTERNAL_ERROR', 'No se pudo asignar un apodo temporal');
  }

  async createGuestSession(
    input: GuestCreateRequest,
    meta: RequestClientMeta,
  ): Promise<SessionIssueBundle> {
    await this.rateLimiter.enforce({ endpointGroup: 'auth:guest', ip: meta.ip });

    const now = new Date(this.config.nowFn());
    const { nickname, nicknameLower } = await this.allocateAvailableGuestNickname();
    const { user } = await this.repo.createUserWithProfile({
      email: null,
      passwordHash: null,
      nickname,
      nicknameLower,
      isGuest: true,
      now,
    });

    await this.audit.record({
      actorId: user.id,
      action: 'AUTH_GUEST_CREATED',
      entity: 'user',
      entityId: user.id,
      afterState: { nickname: user.nickname, isGuest: true },
      ip: meta.ip,
      now,
    });

    return this.sessionService.issueCookiesForUser(user, meta, now, input.deviceName);
  }

  async register(input: RegisterRequest, meta: RequestClientMeta): Promise<SessionIssueBundle> {
    const emailLower = input.email.trim().toLowerCase();
    await this.rateLimiter.enforce({
      endpointGroup: 'auth:register',
      ip: meta.ip,
      accountKey: emailLower,
    });
    await this.captchaVerifier.verifyOrThrow(input.captchaToken, meta.ip);

    const nicknameTrimmed = input.nickname.trim();
    const existingNick = await this.repo.findUserByNicknameLower(
      normalizeNicknameLower(nicknameTrimmed),
    );
    const nicknameLower = this.assertValidAndAvailableNickname(nicknameTrimmed, existingNick);

    const existingEmail = await this.repo.findUserByEmail(emailLower);
    if (existingEmail) {
      throw new DomainApiException(
        409,
        'CONFLICT',
        'No fue posible completar el registro con ese correo electrónico.',
        { field: 'email' },
      );
    }

    const now = new Date(this.config.nowFn());
    const passwordHash = await this.passwordHasher.hashPassword(input.password);
    const { user } = await this.repo.createUserWithProfile({
      email: emailLower,
      passwordHash,
      nickname: nicknameTrimmed,
      nicknameLower,
      isGuest: false,
      now,
    });

    await this.recoveryService.issueVerificationEmailForUser(user, now);
    await this.audit.record({
      actorId: user.id,
      action: 'AUTH_REGISTERED',
      entity: 'user',
      entityId: user.id,
      afterState: { email: user.email, nickname: user.nickname },
      ip: meta.ip,
      now,
    });

    return this.sessionService.issueCookiesForUser(user, meta, now, input.deviceName);
  }

  async promoteGuest(
    principal: AuthenticatedPrincipal,
    input: PromoteGuestRequest,
    meta: RequestClientMeta,
  ): Promise<SessionIssueBundle> {
    const emailLower = input.email.trim().toLowerCase();
    await this.rateLimiter.enforce({
      endpointGroup: 'auth:promote-guest',
      ip: meta.ip,
      accountKey: principal.userId,
    });
    await this.captchaVerifier.verifyOrThrow(input.captchaToken, meta.ip);

    const currentUser = await this.repo.findUserById(principal.userId);
    if (!currentUser || !currentUser.isGuest) {
      throw new DomainApiException(
        409,
        'CONFLICT',
        'Solo una cuenta invitada activa puede vincularse como cuenta registrada.',
      );
    }

    const existingEmail = await this.repo.findUserByEmail(emailLower);
    if (existingEmail && existingEmail.id !== currentUser.id) {
      throw new DomainApiException(
        409,
        'CONFLICT',
        'Ese correo electrónico ya está asociado a otra cuenta.',
        { field: 'email' },
      );
    }

    const targetNickname = (input.nickname ?? currentUser.nickname).trim();
    const nickOwner = await this.repo.findUserByNicknameLower(
      normalizeNicknameLower(targetNickname),
    );
    const targetLower = this.assertValidAndAvailableNickname(
      targetNickname,
      nickOwner,
      currentUser.id,
    );

    const now = new Date(this.config.nowFn());
    const passwordHash = await this.passwordHasher.hashPassword(input.password);
    const promotedUser = await this.repo.promoteGuestInPlace({
      userId: currentUser.id,
      email: emailLower,
      passwordHash,
      nickname: targetNickname,
      nicknameLower: targetLower,
      now,
    });

    await this.repo.revokeAllUserSessions(promotedUser.id, 'LOGOUT_ALL', now);
    await this.recoveryService.issueVerificationEmailForUser(promotedUser, now);

    await this.audit.record({
      actorId: promotedUser.id,
      action: 'AUTH_GUEST_PROMOTED',
      entity: 'user',
      entityId: promotedUser.id,
      beforeState: { isGuest: true, nickname: currentUser.nickname },
      afterState: { isGuest: false, email: promotedUser.email, nickname: promotedUser.nickname },
      ip: meta.ip,
      now,
    });

    return this.sessionService.issueCookiesForUser(promotedUser, meta, now);
  }

  async login(input: LoginRequest, meta: RequestClientMeta): Promise<SessionIssueBundle> {
    const emailLower = input.email.trim().toLowerCase();
    await this.rateLimiter.enforce({
      endpointGroup: 'auth:login',
      ip: meta.ip,
      accountIpKey: emailLower,
    });

    const nowMs = this.config.nowFn();
    const now = new Date(nowMs);

    // 1. Lockout progresivo estrictamente por combinación (cuenta + IP) para evitar DoS sobre terceros
    const ipAcctLock = await this.rateLimiter.getLoginLockoutState(emailLower, meta.ip);
    if (ipAcctLock.lockedUntilMs !== null && ipAcctLock.lockedUntilMs > nowMs) {
      await this.passwordHasher.verifyPasswordTimingSafe(input.password, null);
      const retryAfterSeconds = Math.max(1, Math.ceil((ipAcctLock.lockedUntilMs - nowMs) / 1000));
      throw new DomainApiException(
        423,
        'ACCOUNT_LOCKED',
        'Demasiados intentos fallidos desde esta dirección IP para esta cuenta.',
        { retryAfterSeconds, scope: 'account_ip' },
      );
    }

    // 2. Umbral de fallos por cuenta global -> exige Captcha en vez de bloquear la cuenta
    const accountFailures = await this.rateLimiter.getAccountLoginFailures(
      emailLower,
      this.config.loginFailureWindowMs,
    );
    if (accountFailures >= this.config.loginCaptchaThreshold) {
      if (!input.captchaToken || input.captchaToken.trim().length === 0) {
        await this.passwordHasher.verifyPasswordTimingSafe(input.password, null);
        throw new DomainApiException(
          400,
          'CAPTCHA_FAILED',
          'Se requiere verificación Captcha tras múltiples intentos fallidos sobre esta cuenta.',
          { captchaRequired: true },
        );
      }
      await this.captchaVerifier.verifyOrThrow(input.captchaToken, meta.ip);
    } else if (input.captchaToken !== undefined) {
      await this.captchaVerifier.verifyOrThrow(input.captchaToken, meta.ip);
    }

    const user = await this.repo.findUserByEmail(emailLower);
    const passwordMatches = await this.passwordHasher.verifyPasswordTimingSafe(
      input.password,
      user?.passwordHash ?? null,
    );

    if (!user || user.isGuest || user.deletedAt !== null || !passwordMatches) {
      const { lockout: nextLock } = await this.rateLimiter.recordLoginFailure(
        emailLower,
        meta.ip,
        nowMs,
        this.config.loginFailureWindowMs,
      );

      if (user && !user.isGuest && user.deletedAt === null) {
        await this.repo.updateLoginFailureState({
          userId: user.id,
          failedLoginCount: user.failedLoginCount + 1,
          lockedUntil: null,
          now,
        });
        if (nextLock.lockedUntilMs !== null) {
          await this.audit.record({
            actorId: user.id,
            action: 'AUTH_ACCOUNT_IP_LOCKED',
            entity: 'user',
            entityId: user.id,
            afterState: {
              failedCount: nextLock.failedCount,
              lockedUntil: new Date(nextLock.lockedUntilMs).toISOString(),
            },
            ip: meta.ip,
            now,
          });
        }
      }
      throw new DomainApiException(
        401,
        'UNAUTHORIZED',
        'Correo electrónico o contraseña inválidos.',
      );
    }

    if (user.status !== 'ACTIVE') {
      throw new DomainApiException(403, 'FORBIDDEN', 'Esta cuenta está suspendida.');
    }

    await this.rateLimiter.clearLoginFailuresOnSuccess(emailLower, meta.ip);
    const updatedUser = await this.repo.recordSuccessfulLogin(user.id, now);
    await this.audit.record({
      actorId: updatedUser.id,
      action: 'AUTH_LOGIN_SUCCESS',
      entity: 'user',
      entityId: updatedUser.id,
      ip: meta.ip,
      now,
    });

    return this.sessionService.issueCookiesForUser(updatedUser, meta, now, input.deviceName);
  }

  async loginWithGoogle(
    input: GoogleAuthRequest,
    meta: RequestClientMeta,
  ): Promise<SessionIssueBundle> {
    await this.rateLimiter.enforce({ endpointGroup: 'auth:google', ip: meta.ip });
    const identity = await this.googleVerifier.verifyIdToken(input.idToken);
    const now = new Date(this.config.nowFn());

    let user = await this.repo.findUserByGoogleSub(identity.sub);
    if (!user) {
      const byEmail = await this.repo.findUserByEmail(identity.email);
      if (byEmail && byEmail.deletedAt === null) {
        user = await this.repo.linkGoogleIdentity(
          byEmail.id,
          identity.sub,
          identity.emailVerified,
          now,
        );
      } else {
        const sanitizedBase = identity.displayName.replace(/[^A-Za-z0-9_]/g, '').slice(0, 16);
        let alloc: { nickname: string; nicknameLower: string };
        try {
          alloc = await this.allocateAvailableGuestNickname(
            sanitizedBase.length >= 3 ? sanitizedBase : undefined,
          );
        } catch {
          alloc = await this.allocateAvailableGuestNickname(undefined);
        }
        const created = await this.repo.createUserWithProfile({
          email: identity.email,
          passwordHash: null,
          googleSub: identity.sub,
          nickname: alloc.nickname,
          nicknameLower: alloc.nicknameLower,
          isGuest: false,
          emailVerifiedAt: identity.emailVerified ? now : null,
          now,
        });
        user = created.user;
      }
    } else {
      user = await this.repo.recordSuccessfulLogin(user.id, now);
    }

    if (user.deletedAt !== null || user.status !== 'ACTIVE') {
      throw new DomainApiException(403, 'FORBIDDEN', 'Esta cuenta no está habilitada.');
    }

    await this.audit.record({
      actorId: user.id,
      action: 'AUTH_GOOGLE_LOGIN',
      entity: 'user',
      entityId: user.id,
      ip: meta.ip,
      now,
    });

    return this.sessionService.issueCookiesForUser(user, meta, now, input.deviceName);
  }
}
