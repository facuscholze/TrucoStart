import { Inject, Injectable } from '@nestjs/common';
import {
  DEFAULT_EMAIL_VERIFY_TTL_MS,
  DEFAULT_PASSWORD_RESET_TTL_MS,
  type ForgotPasswordRequest,
  type NonEnumeratingAckResponse,
  type ResendVerificationRequest,
  type ResetPasswordRequest,
  type VerifyEmailRequest,
} from '@truco/shared';
import { DomainApiException } from '../../common/api-exception.js';
import type { UserRow } from '../../db/schema/index.js';
import { AuditRepository } from '../audit/audit.repository.js';
import {
  AUTH_RUNTIME_CONFIG,
  type AuthRuntimeConfig,
  type RequestClientMeta,
} from './auth.config.js';
import { AuthRepository } from './auth.repository.js';
import { EMAIL_PROVIDER, type EmailProvider } from './providers/email.provider.js';
import { HttpAuthRateLimiter } from './security/http-rate-limiter.js';
import { PasswordHasher } from './security/password-hasher.js';
import { generateOpaqueToken, hashOpaqueTokenSha256 } from './security/token-crypto.js';

export const ANTI_ENUMERATION_RECOVERY_MESSAGE =
  'Si existe una cuenta activa asociada a ese correo electrónico, vas a recibir las instrucciones en breve.';

export const ANTI_ENUMERATION_VERIFY_MESSAGE =
  'Si la cuenta existe y aún requiere verificación, enviamos un nuevo enlace a tu correo.';

@Injectable()
export class AuthRecoveryService {
  constructor(
    @Inject(AUTH_RUNTIME_CONFIG) private readonly config: AuthRuntimeConfig,
    @Inject(AuthRepository) private readonly repo: AuthRepository,
    @Inject(AuditRepository) private readonly audit: AuditRepository,
    @Inject(PasswordHasher) private readonly passwordHasher: PasswordHasher,
    @Inject(HttpAuthRateLimiter) private readonly rateLimiter: HttpAuthRateLimiter,
    @Inject(EMAIL_PROVIDER) private readonly emailProvider: EmailProvider,
  ) {}

  async issueVerificationEmailForUser(user: UserRow, now: Date): Promise<void> {
    if (!user.email) return;
    const rawToken = generateOpaqueToken(32);
    const tokenHash = hashOpaqueTokenSha256(rawToken);
    const expiresAt = new Date(now.getTime() + DEFAULT_EMAIL_VERIFY_TTL_MS);

    await this.repo.createAuthToken({
      userId: user.id,
      purpose: 'EMAIL_VERIFY',
      tokenHash,
      expiresAt,
      now,
    });

    await this.emailProvider.sendVerificationEmail({
      to: user.email,
      nickname: user.nickname,
      token: rawToken,
      expiresAt,
    });
  }

  async requestPasswordReset(
    input: ForgotPasswordRequest,
    meta: RequestClientMeta,
  ): Promise<NonEnumeratingAckResponse> {
    const emailLower = input.email.trim().toLowerCase();
    this.rateLimiter.enforce({
      endpointGroup: 'auth:forgot',
      ip: meta.ip,
      accountKey: emailLower,
    });

    const now = new Date(this.config.nowFn());
    const user = await this.repo.findUserByEmail(emailLower);

    if (
      user &&
      !user.isGuest &&
      user.deletedAt === null &&
      user.status === 'ACTIVE' &&
      user.email
    ) {
      const rawToken = generateOpaqueToken(32);
      const tokenHash = hashOpaqueTokenSha256(rawToken);
      const expiresAt = new Date(now.getTime() + DEFAULT_PASSWORD_RESET_TTL_MS);

      await this.repo.createAuthToken({
        userId: user.id,
        purpose: 'PASSWORD_RESET',
        tokenHash,
        expiresAt,
        now,
      });

      await this.emailProvider.sendPasswordResetEmail({
        to: user.email,
        nickname: user.nickname,
        token: rawToken,
        expiresAt,
      });

      await this.audit.record({
        actorId: user.id,
        action: 'AUTH_PASSWORD_RESET_REQUESTED',
        entity: 'user',
        entityId: user.id,
        ip: meta.ip,
        now,
      });
    }

    return { accepted: true, message: ANTI_ENUMERATION_RECOVERY_MESSAGE };
  }

  async confirmPasswordReset(
    input: ResetPasswordRequest,
    meta: RequestClientMeta,
  ): Promise<NonEnumeratingAckResponse> {
    this.rateLimiter.enforce({ endpointGroup: 'auth:reset', ip: meta.ip });
    const now = new Date(this.config.nowFn());
    const tokenHash = hashOpaqueTokenSha256(input.token);
    const consumed = await this.repo.consumeValidAuthToken(tokenHash, 'PASSWORD_RESET', now);

    if (!consumed) {
      throw new DomainApiException(
        400,
        'VALIDATION_ERROR',
        'El enlace de recuperación es inválido, ya fue utilizado o expiró.',
      );
    }

    const user = await this.repo.findUserById(consumed.userId);
    if (!user || user.deletedAt !== null || user.status !== 'ACTIVE') {
      throw new DomainApiException(400, 'VALIDATION_ERROR', 'La cuenta asociada no está activa.');
    }

    const passwordHash = await this.passwordHasher.hashPassword(input.newPassword);
    await this.repo.updatePasswordHash(user.id, passwordHash, now);
    await this.repo.revokeAllUserSessions(user.id, 'PASSWORD_RESET', now);

    await this.audit.record({
      actorId: user.id,
      action: 'AUTH_PASSWORD_RESET_COMPLETED',
      entity: 'user',
      entityId: user.id,
      ip: meta.ip,
      now,
    });

    return {
      accepted: true,
      message: 'Tu contraseña se actualizó correctamente. Iniciá sesión nuevamente.',
    };
  }

  async verifyEmail(
    input: VerifyEmailRequest,
    meta: RequestClientMeta,
  ): Promise<NonEnumeratingAckResponse> {
    this.rateLimiter.enforce({ endpointGroup: 'auth:verify-email', ip: meta.ip });
    const now = new Date(this.config.nowFn());
    const tokenHash = hashOpaqueTokenSha256(input.token);
    const consumed = await this.repo.consumeValidAuthToken(tokenHash, 'EMAIL_VERIFY', now);

    if (!consumed) {
      throw new DomainApiException(
        400,
        'VALIDATION_ERROR',
        'El token de verificación es inválido, ya fue usado o expiró.',
      );
    }

    await this.repo.markEmailVerified(consumed.userId, now);
    await this.audit.record({
      actorId: consumed.userId,
      action: 'AUTH_EMAIL_VERIFIED',
      entity: 'user',
      entityId: consumed.userId,
      ip: meta.ip,
      now,
    });

    return { accepted: true, message: 'Correo electrónico verificado con éxito.' };
  }

  async resendVerificationEmail(
    input: ResendVerificationRequest,
    meta: RequestClientMeta,
  ): Promise<NonEnumeratingAckResponse> {
    const emailLower = input.email.trim().toLowerCase();
    this.rateLimiter.enforce({
      endpointGroup: 'auth:resend-verification',
      ip: meta.ip,
      accountKey: emailLower,
    });

    const now = new Date(this.config.nowFn());
    const user = await this.repo.findUserByEmail(emailLower);
    if (
      user &&
      !user.isGuest &&
      user.deletedAt === null &&
      user.status === 'ACTIVE' &&
      user.emailVerifiedAt === null
    ) {
      await this.issueVerificationEmailForUser(user, now);
    }

    return { accepted: true, message: ANTI_ENUMERATION_VERIFY_MESSAGE };
  }
}
