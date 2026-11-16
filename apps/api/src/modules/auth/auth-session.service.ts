import { Inject, Injectable } from '@nestjs/common';
import {
  type AuthSessionResponse,
  type LogoutRequest,
  type SessionDeviceItem,
  signWsAuthTicket,
  type WsTicketResponse,
} from '@truco/shared';
import { DomainApiException } from '../../common/api-exception.js';
import type { UserRow } from '../../db/schema/index.js';
import { AuditRepository } from '../audit/audit.repository.js';
import {
  AUTH_RUNTIME_CONFIG,
  type AuthRuntimeConfig,
  deriveDeviceName,
  type RequestClientMeta,
} from './auth.config.js';
import { AuthRepository, mapUserRowToSummary } from './auth.repository.js';
import type { AuthenticatedPrincipal } from './guards/session-auth.guard.js';
import { HttpAuthRateLimiter } from './security/http-rate-limiter.js';
import {
  createAccessCookieValue,
  generateOpaqueToken,
  hashOpaqueTokenSha256,
} from './security/token-crypto.js';

export interface SessionIssueBundle {
  readonly response: AuthSessionResponse;
  readonly accessCookie: string;
  readonly refreshCookie: string;
}

@Injectable()
export class AuthSessionService {
  constructor(
    @Inject(AUTH_RUNTIME_CONFIG) private readonly config: AuthRuntimeConfig,
    @Inject(AuthRepository) private readonly repo: AuthRepository,
    @Inject(AuditRepository) private readonly audit: AuditRepository,
    @Inject(HttpAuthRateLimiter) private readonly rateLimiter: HttpAuthRateLimiter,
  ) {}

  async issueCookiesForUser(
    user: UserRow,
    meta: RequestClientMeta,
    now: Date,
    deviceName?: string,
  ): Promise<SessionIssueBundle> {
    const rawRefresh = generateOpaqueToken(32);
    const refreshHash = hashOpaqueTokenSha256(rawRefresh);
    const expiresAt = new Date(now.getTime() + this.config.refreshTtlSeconds * 1000);

    const session = await this.repo.createSession({
      userId: user.id,
      refreshHash,
      deviceName: deriveDeviceName(deviceName, meta.userAgent),
      userAgent: meta.userAgent,
      ipAddress: meta.ip,
      expiresAt,
      now,
    });

    const accessCookie = createAccessCookieValue({
      userId: user.id,
      sessionId: session.id,
      role: user.role,
      isGuest: user.isGuest,
      secret: this.config.sessionSecret,
      nowMs: now.getTime(),
      ttlSeconds: this.config.accessTtlSeconds,
    });

    return {
      response: {
        user: mapUserRowToSummary(user),
        sessionId: session.id,
        expiresAt: expiresAt.toISOString(),
      },
      accessCookie,
      refreshCookie: rawRefresh,
    };
  }

  async refreshSession(
    rawRefreshCookie: string | undefined,
    meta: RequestClientMeta,
  ): Promise<SessionIssueBundle> {
    this.rateLimiter.enforce({ endpointGroup: 'auth:refresh', ip: meta.ip });
    if (!rawRefreshCookie || rawRefreshCookie.trim().length < 16) {
      throw new DomainApiException(401, 'UNAUTHORIZED', 'Token de refresco ausente o inválido.', {
        reason: 'MISSING_REFRESH_TOKEN',
      });
    }

    const nowMs = this.config.nowFn();
    const now = new Date(nowMs);
    const refreshHash = hashOpaqueTokenSha256(rawRefreshCookie);
    const session = await this.repo.findSessionByRefreshHash(refreshHash);

    if (!session) {
      throw new DomainApiException(401, 'UNAUTHORIZED', 'Sesión expirada o inexistente.');
    }

    if (session.revokedReason === 'ROTATED') {
      const revokedCount = await this.repo.revokeSessionFamily(
        session.familyId,
        'REUSE_DETECTED',
        now,
      );
      await this.audit.record({
        actorId: session.userId,
        action: 'AUTH_REFRESH_REUSE_DETECTED',
        entity: 'session_family',
        entityId: session.familyId,
        afterState: {
          reusedSessionId: session.id,
          revokedFamilyMembers: revokedCount,
        },
        ip: meta.ip,
        now,
      });
      throw new DomainApiException(
        401,
        'UNAUTHORIZED',
        'Se detectó reutilización de un token de refresco ya consumido; toda la familia de sesiones fue revocada.',
        { reason: 'REFRESH_TOKEN_REUSED', familyId: session.familyId },
      );
    }

    if (session.revokedAt !== null || session.expiresAt.getTime() <= nowMs) {
      throw new DomainApiException(401, 'UNAUTHORIZED', 'La sesión expiró o fue revocada.');
    }

    const user = await this.repo.findUserById(session.userId);
    if (!user || user.deletedAt !== null || user.status !== 'ACTIVE') {
      await this.repo.revokeSessionFamily(session.familyId, 'ACCOUNT_DELETED', now);
      throw new DomainApiException(401, 'UNAUTHORIZED', 'Cuenta inactiva o eliminada.');
    }

    const nextRawRefresh = generateOpaqueToken(32);
    const nextRefreshHash = hashOpaqueTokenSha256(nextRawRefresh);
    const nextExpiresAt = new Date(nowMs + this.config.refreshTtlSeconds * 1000);
    const rotated = await this.repo.rotateSessionRefreshToken({
      previousSession: session,
      newRefreshHash: nextRefreshHash,
      userAgent: meta.userAgent,
      ipAddress: meta.ip,
      expiresAt: nextExpiresAt,
      now,
    });

    const accessCookie = createAccessCookieValue({
      userId: user.id,
      sessionId: rotated.id,
      role: user.role,
      isGuest: user.isGuest,
      secret: this.config.sessionSecret,
      nowMs,
      ttlSeconds: this.config.accessTtlSeconds,
    });

    return {
      response: {
        user: mapUserRowToSummary(user),
        sessionId: rotated.id,
        expiresAt: nextExpiresAt.toISOString(),
      },
      accessCookie,
      refreshCookie: nextRawRefresh,
    };
  }

  async logout(
    principal: AuthenticatedPrincipal | null,
    rawRefreshCookie: string | undefined,
    input: LogoutRequest,
    meta: RequestClientMeta,
  ): Promise<void> {
    this.rateLimiter.enforce({
      endpointGroup: 'auth:logout',
      ip: meta.ip,
      accountKey: principal?.userId ?? null,
    });
    const now = new Date(this.config.nowFn());
    if (principal) {
      if (input.allDevices) {
        await this.repo.revokeAllUserSessions(principal.userId, 'LOGOUT_ALL', now);
      } else {
        await this.repo.revokeSingleSession(principal.sessionId, 'LOGOUT', now);
      }
      await this.audit.record({
        actorId: principal.userId,
        action: input.allDevices ? 'AUTH_LOGOUT_ALL' : 'AUTH_LOGOUT',
        entity: 'session',
        entityId: principal.sessionId,
        ip: meta.ip,
        now,
      });
      return;
    }

    if (rawRefreshCookie) {
      const hash = hashOpaqueTokenSha256(rawRefreshCookie);
      const session = await this.repo.findSessionByRefreshHash(hash);
      if (session && session.revokedAt === null) {
        await this.repo.revokeSingleSession(session.id, 'LOGOUT', now);
      }
    }
  }

  async listSessions(principal: AuthenticatedPrincipal): Promise<SessionDeviceItem[]> {
    const now = new Date(this.config.nowFn());
    const rows = await this.repo.listActiveUserSessions(principal.userId, now);
    return rows.map((row) => ({
      id: row.id,
      deviceName: row.deviceName,
      ipAddress: row.ipAddress,
      userAgent: row.userAgent,
      createdAt: row.createdAt.toISOString(),
      lastUsedAt: row.lastUsedAt.toISOString(),
      expiresAt: row.expiresAt.toISOString(),
      isCurrent: row.id === principal.sessionId,
    }));
  }

  async revokeSessionById(
    principal: AuthenticatedPrincipal,
    targetSessionId: string,
    meta: RequestClientMeta,
  ): Promise<void> {
    const target = await this.repo.findSessionById(targetSessionId);
    if (!target) {
      throw new DomainApiException(404, 'NOT_FOUND', 'Sesión no encontrada.');
    }
    if (target.userId !== principal.userId) {
      throw new DomainApiException(
        403,
        'FORBIDDEN',
        'No tenés permisos para revocar la sesión de otro usuario.',
      );
    }

    const now = new Date(this.config.nowFn());
    await this.repo.revokeSingleSession(target.id, 'DEVICE_REVOKED', now);
    await this.audit.record({
      actorId: principal.userId,
      action: 'AUTH_SESSION_REVOKED',
      entity: 'session',
      entityId: target.id,
      ip: meta.ip,
      now,
    });
  }

  issueWsTicket(principal: AuthenticatedPrincipal, meta: RequestClientMeta): WsTicketResponse {
    this.rateLimiter.enforce({
      endpointGroup: 'auth:ws-ticket',
      ip: meta.ip,
      accountKey: principal.userId,
    });
    const nowMs = this.config.nowFn();
    const expiresAt = nowMs + this.config.wsTicketTtlMs;
    const ticket = signWsAuthTicket(
      {
        userId: principal.userId,
        sessionId: principal.sessionId,
        nickname: principal.nickname,
        isGuest: principal.isGuest,
        exp: expiresAt,
      },
      this.config.sessionSecret,
    );

    return { ticket, expiresAt };
  }
}
