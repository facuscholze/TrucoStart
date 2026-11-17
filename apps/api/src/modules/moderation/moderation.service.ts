import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
  type CreateReportRequest,
  type CreateReportResponse,
  type MyModerationState,
  REPORT_LIMITS,
  REPORT_REASON_LABELS_ES_AR,
  type ReportEventLogRef,
} from '@truco/shared';
import { DomainApiException } from '../../common/api-exception.js';
import { toMyModerationState } from '../../common/account-status.js';
import {
  RATE_LIMIT_STORE,
  type RateLimitStore,
} from '../../common/rate-limit/rate-limit-store.interface.js';
import { AuditRepository } from '../audit/audit.repository.js';
import type { AuthenticatedPrincipal } from '../auth/guards/session-auth.guard.js';
import { ModerationRepository } from './moderation.repository.js';

export const MODERATION_RUNTIME_CONFIG = Symbol('MODERATION_RUNTIME_CONFIG');

export interface ModerationRuntimeConfig {
  readonly nowFn: () => number;
  /** Límites configurables (tests los bajan para forzar rate limit). */
  readonly maxOpenReportsPerReporter: number;
  readonly reportsPerWindow: number;
  readonly rateLimitWindowMs: number;
}

export const DEFAULT_MODERATION_CONFIG: Omit<ModerationRuntimeConfig, 'nowFn'> = Object.freeze({
  maxOpenReportsPerReporter: REPORT_LIMITS.maxOpenReportsPerReporter,
  reportsPerWindow: REPORT_LIMITS.reportsPerWindow,
  rateLimitWindowMs: REPORT_LIMITS.rateLimitWindowMs,
});

@Injectable()
export class ModerationService {
  constructor(
    @Inject(MODERATION_RUNTIME_CONFIG) private readonly config: ModerationRuntimeConfig,
    @Inject(ModerationRepository) private readonly repo: ModerationRepository,
    @Inject(RATE_LIMIT_STORE) private readonly rateLimit: RateLimitStore,
    @Inject(AuditRepository) private readonly audit: AuditRepository,
  ) {}

  private dedupeKey(
    reporterId: string,
    targetId: string,
    reasonCode: string,
    matchId: string | null,
  ): string {
    return createHash('sha256')
      .update([reporterId, targetId, reasonCode, matchId ?? 'sin-partida'].join('|'))
      .digest('hex');
  }

  async createReport(
    principal: AuthenticatedPrincipal,
    input: CreateReportRequest,
    ip: string | null,
  ): Promise<CreateReportResponse> {
    if (input.targetUserId === principal.userId) {
      throw new DomainApiException(400, 'VALIDATION_ERROR', 'No podés reportarte a vos mismo.', {
        field: 'targetUserId',
      });
    }

    // Rate limit por cuenta (ventana configurable) sobre el bucket del módulo.
    const limit = await this.rateLimit.consumeWindow(
      `moderation:report:user:${principal.userId}`,
      this.config.reportsPerWindow,
      this.config.rateLimitWindowMs,
    );
    if (!limit.allowed) {
      throw new DomainApiException(
        429,
        'RATE_LIMITED',
        'Enviaste demasiados reportes en las últimas horas. Probá más tarde.',
        { retryAfterMs: limit.retryAfterMs },
      );
    }

    const target = await this.repo.findUserById(input.targetUserId);
    if (!target || target.deletedAt !== null) {
      throw new DomainApiException(404, 'NOT_FOUND', 'El jugador reportado no existe.');
    }

    const matchId = input.matchId ?? null;
    if (matchId) {
      const belongs = await this.repo.matchExistsForUser(matchId, principal.userId);
      if (!belongs) {
        throw new DomainApiException(
          403,
          'FORBIDDEN',
          'Solo podés adjuntar partidas en las que hayas jugado.',
          { reason: 'MATCH_NOT_OWNED' },
        );
      }
    }

    const openByReporter = await this.repo.countOpenReportsByReporter(principal.userId);
    if (openByReporter >= this.config.maxOpenReportsPerReporter) {
      throw new DomainApiException(
        409,
        'CONFLICT',
        `Tenés ${openByReporter} reportes abiertos (máximo ${this.config.maxOpenReportsPerReporter}). Esperá a que se resuelvan.`,
        { reason: 'TOO_MANY_OPEN_REPORTS', openReports: openByReporter },
      );
    }

    const nowMs = this.config.nowFn();
    const now = new Date(nowMs);
    const dedupeKey = this.dedupeKey(
      principal.userId,
      input.targetUserId,
      input.reasonCode,
      matchId,
    );

    // Detección de duplicados: mismo denunciante/denunciado/motivo/partida con reporte abierto.
    const duplicate = await this.repo.findOpenDuplicate(dedupeKey);
    if (duplicate) {
      return {
        id: duplicate.id,
        status: duplicate.status as CreateReportResponse['status'],
        createdAt: duplicate.createdAt.toISOString(),
        mergedWithExisting: true,
        eventLogRef: (duplicate.eventLogRef as unknown as ReportEventLogRef | null) ?? null,
      };
    }

    const eventLogRef = matchId ? await this.repo.buildEventLogRef(matchId) : null;

    await this.repo.insertReport({
      reporterId: principal.userId,
      targetId: input.targetUserId,
      matchId,
      reasonCode: input.reasonCode,
      reason: REPORT_REASON_LABELS_ES_AR[input.reasonCode],
      details: input.details ?? null,
      dedupeKey,
      eventLogRef,
      now,
    });

    await this.audit.record({
      actorId: principal.userId,
      action: 'MODERATION_REPORT_CREATED',
      entity: 'report',
      entityId: target.id,
      afterState: {
        targetUserId: target.id,
        reasonCode: input.reasonCode,
        matchId,
        eventLogSeq: eventLogRef?.lastSeq ?? null,
      },
      ip,
      now,
    });

    const recent = await this.repo.listRecentReportsByReporter(principal.userId);
    const created = recent[0];
    return {
      id: created?.id ?? '',
      status: 'OPEN',
      createdAt: created?.createdAt ?? now.toISOString(),
      mergedWithExisting: false,
      eventLogRef,
    };
  }

  async getMyModerationState(principal: AuthenticatedPrincipal): Promise<MyModerationState> {
    const user = await this.repo.findUserById(principal.userId);
    if (!user) {
      throw new DomainApiException(404, 'NOT_FOUND', 'Usuario inexistente.');
    }
    const openAgainst = await this.repo.countOpenReportsAgainst(user.id);
    return toMyModerationState(user, new Date(this.config.nowFn()), openAgainst);
  }
}
