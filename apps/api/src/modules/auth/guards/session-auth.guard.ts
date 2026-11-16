import '@fastify/cookie';
import { type CanActivate, type ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { ACCESS_COOKIE_NAME, type UserRole } from '@truco/shared';
import type { FastifyRequest } from 'fastify';
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

    const user = await this.authRepository.findUserById(claims.userId);
    if (!user || user.deletedAt !== null) {
      throw new DomainApiException(401, 'UNAUTHORIZED', 'La cuenta ya no se encuentra activa.');
    }
    if (user.status !== 'ACTIVE') {
      throw new DomainApiException(403, 'FORBIDDEN', 'Esta cuenta se encuentra suspendida.', {
        reason: 'ACCOUNT_SUSPENDED',
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
    };

    return true;
  }
}
