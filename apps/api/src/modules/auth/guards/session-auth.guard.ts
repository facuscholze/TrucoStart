import '@fastify/cookie';
import { type CanActivate, type ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { ACCESS_COOKIE_NAME, type UserRole } from '@truco/shared';
import type { FastifyRequest } from 'fastify';
import {
  describeBlockedAccount,
  resolveEffectiveAccountStatus,
} from '../../../common/account-status.js';
import { DomainApiException } from '../../../common/api-exception.js';
import {
  AUTH_RUNTIME_CONFIG,
  type AuthRuntimeConfig,
  type RequestClientMeta,
} from '../auth.config.js';
import { AuthRepository } from '../auth.repository.js';
import { verifyAccessSessionCookie } from '../security/token-crypto.js';

export interface AuthenticatedPrincipal {
  readonly userId: string;
  readonly sessionId: string;
  readonly familyId: string;
  readonly nickname: string;
  readonly email: string | null;
  readonly isGuest: boolean;
  readonly emailVerified: boolean;
  readonly role: UserRole;
  /** Fin del silencio vigente, si lo hay (bloquea chat rápido y señas). */
  readonly mutedUntil?: string | null;
}

export interface AuthenticatedFastifyRequest extends FastifyRequest {
  principal?: AuthenticatedPrincipal;
}

export function extractClientMeta(req: FastifyRequest): RequestClientMeta {
  const rawUa = req.headers['user-agent'];
  return {
    ip: req.ip || '127.0.0.1',
    userAgent: typeof rawUa === 'string' ? rawUa.slice(0, 512) : null,
  };
}

@Injectable()
export class SessionAuthGuard implements CanActivate {
  constructor(
    @Inject(AUTH_RUNTIME_CONFIG) private readonly config: AuthRuntimeConfig,
    @Inject(AuthRepository) private readonly authRepository: AuthRepository,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AuthenticatedFastifyRequest>();
    const rawCookie = req.cookies?.[ACCESS_COOKIE_NAME];
    const nowMs = this.config.nowFn();

    const claims = verifyAccessSessionCookie(rawCookie, this.config.sessionSecret, nowMs);
    if (!claims) {
      throw new DomainApiException(
        401,
        'UNAUTHORIZED',
        'Sesión ausente, inválida o vencida. Iniciá sesión nuevamente.',
      );
    }

    const session = await this.authRepository.findSessionById(claims.sessionId);
    if (!session || session.revokedAt !== null || session.expiresAt.getTime() <= nowMs) {
      throw new DomainApiException(
        401,
        'UNAUTHORIZED',
        'La sesión fue cerrada o expiró. Iniciá sesión nuevamente.',
        { reason: 'SESSION_EXPIRED' },
      );
    }

    const storedUser = await this.authRepository.findUserById(claims.userId);
    if (!storedUser || storedUser.deletedAt !== null) {
      throw new DomainApiException(401, 'UNAUTHORIZED', 'La cuenta ya no se encuentra activa.');
    }

    // Estado autoritativo: una suspensión vencida se levanta en el acto y se persiste.
    const effective = resolveEffectiveAccountStatus(storedUser, new Date(nowMs));
    const user = effective.expiredSuspensionLifted
      ? ((await this.authRepository.reactivateExpiredSuspension(storedUser.id, new Date(nowMs))) ??
        storedUser)
      : storedUser;

    if (effective.status !== 'ACTIVE') {
      throw new DomainApiException(403, 'FORBIDDEN', describeBlockedAccount(effective), {
        reason: effective.status === 'BANNED' ? 'ACCOUNT_BANNED' : 'ACCOUNT_SUSPENDED',
        accountStatus: effective.status,
        statusReason: effective.reason,
        statusExpiresAt: effective.expiresAt?.toISOString() ?? null,
      });
    }

    req.principal = {
      userId: user.id,
      sessionId: session.id,
      familyId: session.familyId,
      nickname: user.nickname,
      email: user.email,
      isGuest: user.isGuest,
      emailVerified: user.emailVerifiedAt !== null,
      role: user.role,
      mutedUntil: effective.mutedUntil?.toISOString() ?? null,
    };

    return true;
  }
}
