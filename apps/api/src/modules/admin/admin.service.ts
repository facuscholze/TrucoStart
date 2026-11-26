import { Inject, Injectable } from '@nestjs/common';
import {
  ADMIN_ROLE_PERMISSIONS,
  type AdminAuditListResponse,
  type AdminDashboardMetrics,
  type AdminMatchReplay,
  type AdminPermission,
  type AdminReportDetail,
  type AdminReportListResponse,
  type AdminUserDetail,
  type AdminUserListResponse,
  type CreateSanctionRequest,
  type CreateSanctionResponse,
  type ResolveReportRequest,
  type SanctionItem,
  type SanctionType,
  maskEmail,
  SANCTION_TYPE_LABELS_ES_AR,
} from '@truco/shared';
import { DomainApiException } from '../../common/api-exception.js';
import { generateUuidV7 } from '../../common/uuidv7.js';
import { AuditRepository } from '../audit/audit.repository.js';
import type { AdminPrincipal } from './admin-auth.service.js';
import { ADMIN_RUNTIME_CONFIG, type AdminRuntimeConfig } from './admin.config.js';
import { AdminRepository } from './admin.repository.js';
import { summarizeReplay, toReplayEvents } from './replay.js';
import { USER_EVICTION, type UserEvictionPort } from './ports/user-eviction.js';

const NEUTRAL_NICKNAME_PREFIX = 'Jugador';

@Injectable()
export class AdminService {
  constructor(
    @Inject(ADMIN_RUNTIME_CONFIG) private readonly config: AdminRuntimeConfig,
    @Inject(AdminRepository) private readonly repo: AdminRepository,
    @Inject(AuditRepository) private readonly audit: AuditRepository,
    @Inject(USER_EVICTION) private readonly eviction: UserEvictionPort,
  ) {}

  private canSeePii(principal: AdminPrincipal): boolean {
    return principal.permissions.includes('users:read_pii');
  }

  async dashboard(): Promise<AdminDashboardMetrics> {
    const nowMs = this.config.nowFn();
    const now = new Date(nowMs);
    const since24h = new Date(nowMs - 24 * 3600 * 1000);
    const [
      activeUsers,
      usersTotal,
      inProgress,
      finished24h,
      byStatus,
      resolved24h,
      sanctionsActive,
    ] = await Promise.all([
      this.repo.countUsersSince(since24h),
      this.repo.countUsersTotal(),
      this.repo.countMatchesInProgress(),
      this.repo.countMatchesFinishedSince(since24h),
      this.repo.countReportsByStatus(),
      this.repo.countReportsResolvedSince(since24h),
      this.repo.countActiveSanctions(now),
    ]);
    return {
      activeUsers24h: activeUsers,
      usersTotal,
      matchesInProgress: inProgress,
      matchesFinished24h: finished24h,
      openReports: (byStatus['OPEN'] ?? 0) + (byStatus['IN_REVIEW'] ?? 0),
      reportsResolved24h: resolved24h,
      sanctionsActive,
      generatedAt: now.toISOString(),
    };
  }

  async listUsers(
    principal: AdminPrincipal,
    input: { query: string | null; cursor: string | null; limit: number },
  ): Promise<AdminUserListResponse> {
    const cursorDate = input.cursor ? new Date(input.cursor) : null;
    const rows = await this.repo.listUsers({
      query: input.query,
      limit: input.limit + 1,
      cursor: cursorDate && !Number.isNaN(cursorDate.getTime()) ? cursorDate : null,
    });
    const page = rows.slice(0, input.limit);
    const counts = await this.repo.openReportsAgainstCounts(page.map((row) => row.id));
    const showPii = this.canSeePii(principal);
    return {
      items: page.map((row) => ({
        id: row.id,
        nickname: row.nickname,
        emailMasked: showPii ? row.email : maskEmail(row.email),
        role: row.role,
        status: row.status,
        statusReason: row.statusReason,
        statusExpiresAt: row.statusExpiresAt?.toISOString() ?? null,
        mutedUntil: row.mutedUntil?.toISOString() ?? null,
        isGuest: row.isGuest,
        createdAt: row.createdAt.toISOString(),
        lastSeenAt: row.updatedAt.toISOString(),
        openReportsAgainst: counts.get(row.id) ?? 0,
      })),
      nextCursor:
        rows.length > input.limit ? (page[page.length - 1]?.createdAt.toISOString() ?? null) : null,
    };
  }

  async getUserDetail(
    principal: AdminPrincipal,
    userId: string,
    reason: string,
  ): Promise<AdminUserDetail> {
    const user = await this.repo.findUserById(userId);
    if (!user || user.deletedAt !== null) {
      throw new DomainApiException(404, 'NOT_FOUND', 'Usuario inexistente.');
    }
    const [sanctions, matches, openAgainst] = await Promise.all([
      this.repo.listSanctionsForUser(userId),
      this.repo.listRecentMatchesForUser(userId),
      this.repo.openReportsAgainstCounts([userId]),
    ]);

    await this.audit.record({
      actorId: principal.userId,
      action: 'ADMIN_USER_DETAIL_VIEWED',
      entity: 'user',
      entityId: userId,
      reason,
      afterState: { piiVisible: this.canSeePii(principal) },
      now: new Date(this.config.nowFn()),
    });

    const showPii = this.canSeePii(principal);
    return {
      id: user.id,
      nickname: user.nickname,
      emailMasked: showPii ? user.email : maskEmail(user.email),
      email: showPii ? user.email : null,
      role: user.role,
      status: user.status,
      statusReason: user.statusReason,
      statusExpiresAt: user.statusExpiresAt?.toISOString() ?? null,
      mutedUntil: user.mutedUntil?.toISOString() ?? null,
      isGuest: user.isGuest,
      createdAt: user.createdAt.toISOString(),
      lastSeenAt: user.updatedAt.toISOString(),
      openReportsAgainst: openAgainst.get(userId) ?? 0,
      bio: '',
      sanctions: sanctions.map((row) => this.toSanctionItem(row)),
      recentMatches: matches.map((row) => ({
        matchId: row.matchId,
        mode: row.mode as '1v1' | '2v2',
        outcome: row.outcome as 'WIN' | 'LOSS' | 'DRAW' | 'ABANDONED',
        endedAt: row.endedAt?.toISOString() ?? null,
      })),
    };
  }

  private toSanctionItem(row: {
    id: string;
    userId: string;
    type: string;
    reason: string;
    reportId: string | null;
    issuedBy: string | null;
    issuedByNickname?: string | null;
    expiresAt: Date | null;
    createdAt: Date;
    revokedAt: Date | null;
  }): SanctionItem {
    return {
      id: row.id,
      userId: row.userId,
      type: row.type as SanctionType,
      reason: row.reason,
      reportId: row.reportId,
      issuedBy: row.issuedBy,
      issuedByNickname: row.issuedByNickname ?? null,
      expiresAt: row.expiresAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      revokedAt: row.revokedAt?.toISOString() ?? null,
    };
  }

  async sanctionUser(
    principal: AdminPrincipal,
    userId: string,
    input: CreateSanctionRequest,
    ip: string | null,
  ): Promise<CreateSanctionResponse> {
    if (userId === principal.userId) {
      throw new DomainApiException(403, 'FORBIDDEN', 'No podés sancionarte a vos mismo.', {
        reason: 'SELF_SANCTION_FORBIDDEN',
      });
    }
    const target = await this.repo.findUserById(userId);
    if (!target || target.deletedAt !== null) {
      throw new DomainApiException(404, 'NOT_FOUND', 'Usuario inexistente.');
    }
    if (target.role === 'ADMIN' && principal.role !== 'ADMIN') {
      throw new DomainApiException(
        403,
        'FORBIDDEN',
        'Un moderador no puede sancionar a un administrador.',
        { reason: 'ADMIN_TARGET_FORBIDDEN' },
      );
    }
    if (input.type === 'BAN' && !principal.permissions.includes('sanctions:issue_ban')) {
      throw new DomainApiException(
        403,
        'FORBIDDEN',
        'Tu rol no puede aplicar bloqueos permanentes.',
        {
          reason: 'ADMIN_PERMISSION_DENIED',
          requiredPermission: 'sanctions:issue_ban',
        },
      );
    }

    const nowMs = this.config.nowFn();
    const now = new Date(nowMs);
    const expiresAt =
      input.durationHours !== undefined
        ? new Date(nowMs + input.durationHours * 3600 * 1000)
        : null;

    const before = {
      status: target.status as 'ACTIVE' | 'SUSPENDED' | 'BANNED' | 'DELETED',
      statusReason: target.statusReason,
      statusExpiresAt: target.statusExpiresAt?.toISOString() ?? null,
      mutedUntil: target.mutedUntil?.toISOString() ?? null,
    };

    const sanctionId = await this.repo.applySanction({
      userId,
      type: input.type,
      reason: input.reason,
      reportId: input.reportId ?? null,
      issuedBy: principal.userId,
      expiresAt,
      now,
    });

    let appliedStatus: 'ACTIVE' | 'SUSPENDED' | 'BANNED' = 'ACTIVE';
    let mutedUntil: Date | null = target.mutedUntil;
    let sessionsRevoked = 0;

    if (input.type === 'MUTE') {
      mutedUntil = expiresAt;
    } else if (input.type === 'SUSPEND') {
      appliedStatus = 'SUSPENDED';
      sessionsRevoked = await this.repo.revokeAllPlayerSessions(userId, 'SANCTION_APPLIED', now);
    } else if (input.type === 'BAN') {
      appliedStatus = 'BANNED';
      sessionsRevoked = await this.repo.revokeAllPlayerSessions(userId, 'SANCTION_APPLIED', now);
    }

    if (input.type !== 'WARNING') {
      await this.repo.updateAccountStatus({
        userId,
        status: appliedStatus,
        statusReason: input.type === 'MUTE' ? target.statusReason : input.reason,
        statusExpiresAt:
          input.type === 'SUSPEND'
            ? expiresAt
            : input.type === 'BAN'
              ? null
              : target.statusExpiresAt,
        mutedUntil,
        ...(input.forceNicknameChange ? { nicknameMustChange: true } : {}),
        now,
      });
    } else if (input.forceNicknameChange) {
      await this.repo.updateAccountStatus({
        userId,
        status: target.status === 'DELETED' ? 'BANNED' : target.status,
        statusReason: target.statusReason,
        statusExpiresAt: target.statusExpiresAt,
        mutedUntil: target.mutedUntil,
        nicknameMustChange: true,
        now,
      });
    }

    // Si la cuenta sancionada tiene rol de panel, también se le revocan las sesiones de admin.
    if (target.role !== 'PLAYER' && (input.type === 'SUSPEND' || input.type === 'BAN')) {
      sessionsRevoked += await this.repo.revokeAllAdminSessionsForUser(userId, now);
    }

    // Expulsión inmediata del game-server: no espera al caché de moderación (15 s).
    const eviction = await this.eviction
      .evict({
        userId,
        reason: `Sanción: ${SANCTION_TYPE_LABELS_ES_AR[input.type]} — ${input.reason}`,
        disconnect: input.type === 'SUSPEND' || input.type === 'BAN',
      })
      .catch(() => ({ evicted: false, rooms: [] }));

    await this.audit.record({
      actorId: principal.userId,
      action: 'ADMIN_SANCTION_ISSUED',
      entity: 'user',
      entityId: userId,
      reason: input.reason,
      beforeState: before,
      afterState: {
        sanctionId,
        type: input.type,
        expiresAt: expiresAt?.toISOString() ?? null,
        reportId: input.reportId ?? null,
        sessionsRevoked,
        roomsEvicted: eviction.rooms,
      },
      ip,
      now,
    });

    return {
      sanction: {
        id: sanctionId,
        userId,
        type: input.type,
        reason: input.reason,
        reportId: input.reportId ?? null,
        issuedBy: principal.userId,
        issuedByNickname: principal.nickname,
        expiresAt: expiresAt?.toISOString() ?? null,
        createdAt: now.toISOString(),
        revokedAt: null,
      },
      appliedStatus,
      mutedUntil: mutedUntil?.toISOString() ?? null,
      sessionsRevoked,
    };
  }

  /** Fuerza el cambio de apodo: reemplaza el ofensivo por uno neutro y marca la bandera. */
  async forceNicknameChange(
    principal: AdminPrincipal,
    userId: string,
    reason: string,
    ip: string | null,
  ): Promise<{ nickname: string; nicknameMustChange: boolean }> {
    const target = await this.repo.findUserById(userId);
    if (!target || target.deletedAt !== null) {
      throw new DomainApiException(404, 'NOT_FOUND', 'Usuario inexistente.');
    }
    if (target.role === 'ADMIN' && principal.role !== 'ADMIN') {
      throw new DomainApiException(403, 'FORBIDDEN', 'No podés moderar a un administrador.');
    }
    const neutral = `${NEUTRAL_NICKNAME_PREFIX}${generateUuidV7().replace(/-/g, '').slice(-6).toUpperCase()}`;
    const now = new Date(this.config.nowFn());
    await this.repo.updateAccountStatus({
      userId,
      status: target.status === 'DELETED' ? 'BANNED' : target.status,
      statusReason: target.statusReason,
      statusExpiresAt: target.statusExpiresAt,
      mutedUntil: target.mutedUntil,
      nicknameMustChange: true,
      now,
    });
    await this.repo.renameUser(userId, neutral, neutral.toLowerCase(), now);
    await this.audit.record({
      actorId: principal.userId,
      action: 'ADMIN_NICKNAME_FORCED',
      entity: 'user',
      entityId: userId,
      reason,
      beforeState: { nickname: target.nickname },
      afterState: { nickname: neutral, nicknameMustChange: true },
      ip,
      now,
    });
    return { nickname: neutral, nicknameMustChange: true };
  }

  async listReports(input: {
    status: string | null;
    reasonCode: string | null;
    cursor: string | null;
    limit: number;
  }): Promise<AdminReportListResponse> {
    const cursorDate = input.cursor ? new Date(input.cursor) : null;
    const rows = await this.repo.listReports({
      status: input.status,
      reasonCode: input.reasonCode,
      limit: input.limit + 1,
      cursor: cursorDate && !Number.isNaN(cursorDate.getTime()) ? cursorDate : null,
    });
    const page = rows.slice(0, input.limit);
    const byStatus = await this.repo.countReportsByStatus();
    return {
      items: page.map((entry) => ({
        id: entry.row.id,
        status: entry.row.status as never,
        reasonCode: entry.row.reasonCode as never,
        createdAt: entry.row.createdAt.toISOString(),
        reporterId: entry.row.reporterId,
        reporterNickname: entry.reporterNickname,
        targetId: entry.row.targetId,
        targetNickname: entry.targetNickname,
        matchId: entry.row.matchId,
        claimedBy: entry.row.claimedBy,
        claimedByNickname: entry.claimedByNickname,
        version: entry.row.version,
        duplicateCount: 0,
      })),
      nextCursor:
        rows.length > input.limit
          ? (page[page.length - 1]?.row.createdAt.toISOString() ?? null)
          : null,
      totals: {
        OPEN: byStatus['OPEN'] ?? 0,
        IN_REVIEW: byStatus['IN_REVIEW'] ?? 0,
        RESOLVED_ACTIONED: byStatus['RESOLVED_ACTIONED'] ?? 0,
        RESOLVED_DISMISSED: byStatus['RESOLVED_DISMISSED'] ?? 0,
      },
    };
  }

  async getReportDetail(reportId: string): Promise<AdminReportDetail> {
    const report = await this.repo.findReportById(reportId);
    if (!report) {
      throw new DomainApiException(404, 'NOT_FOUND', 'Reporte inexistente.');
    }
    const [target, nicknames, sanctionsCount, openAgainst] = await Promise.all([
      this.repo.findUserById(report.targetId),
      this.repo.nicknamesByIds(
        [report.reporterId, report.claimedBy, report.resolvedBy].filter((id): id is string => !!id),
      ),
      this.repo.countSanctionsForUser(report.targetId),
      this.repo.openReportsAgainstCounts([report.targetId]),
    ]);
    if (!target) {
      throw new DomainApiException(404, 'NOT_FOUND', 'El jugador reportado ya no existe.');
    }
    const matchReplay = report.matchId ? await this.repo.findMatchReplay(report.matchId) : null;
    const replayAvailable = Boolean(
      matchReplay && matchReplay.match.endedAt !== null && matchReplay.events.length > 0,
    );

    return {
      report: {
        id: report.id,
        status: report.status as never,
        reasonCode: report.reasonCode as never,
        createdAt: report.createdAt.toISOString(),
        reporterId: report.reporterId,
        reporterNickname: nicknames.get(report.reporterId) ?? 'Jugador',
        targetId: report.targetId,
        targetNickname: target.nickname,
        matchId: report.matchId,
        claimedBy: report.claimedBy,
        claimedByNickname: report.claimedBy ? (nicknames.get(report.claimedBy) ?? null) : null,
        version: report.version,
        duplicateCount: 0,
        details: report.details,
        resolutionNote: report.resolutionNote,
        resolvedByNickname: report.resolvedBy ? (nicknames.get(report.resolvedBy) ?? null) : null,
        resolvedAt: report.resolvedAt?.toISOString() ?? null,
        eventLogRef: (report.eventLogRef as never) ?? null,
      },
      target: {
        id: target.id,
        nickname: target.nickname,
        status: target.status,
        statusReason: target.statusReason,
        statusExpiresAt: target.statusExpiresAt?.toISOString() ?? null,
        mutedUntil: target.mutedUntil?.toISOString() ?? null,
        sanctionsCount,
        openReportsAgainst: openAgainst.get(target.id) ?? 0,
      },
      replayAvailable,
    };
  }

  async claimReport(
    principal: AdminPrincipal,
    reportId: string,
    expectedVersion: number,
    ip: string | null,
  ): Promise<{ version: number }> {
    const now = new Date(this.config.nowFn());
    const claimed = await this.repo.claimReport({
      reportId,
      adminId: principal.userId,
      expectedVersion,
      now,
    });
    if (!claimed) {
      throw new DomainApiException(
        409,
        'CONFLICT',
        'Otra persona tomó o resolvió este reporte mientras lo mirabas. Recargá la cola.',
        { reason: 'REPORT_VERSION_CONFLICT' },
      );
    }
    await this.audit.record({
      actorId: principal.userId,
      action: 'ADMIN_REPORT_CLAIMED',
      entity: 'report',
      entityId: reportId,
      ip,
      now,
    });
    return { version: expectedVersion + 1 };
  }

  async resolveReport(
    principal: AdminPrincipal,
    reportId: string,
    input: ResolveReportRequest,
    ip: string | null,
  ): Promise<{ status: string; version: number }> {
    const now = new Date(this.config.nowFn());
    const resolved = await this.repo.resolveReport({
      reportId,
      adminId: principal.userId,
      expectedVersion: input.expectedVersion,
      status: input.outcome,
      note: input.note,
      now,
    });
    if (!resolved) {
      throw new DomainApiException(
        409,
        'CONFLICT',
        'Otra persona resolvió este reporte al mismo tiempo. Recargá la cola.',
        { reason: 'REPORT_VERSION_CONFLICT' },
      );
    }
    await this.audit.record({
      actorId: principal.userId,
      action: 'ADMIN_REPORT_RESOLVED',
      entity: 'report',
      entityId: reportId,
      reason: input.note,
      afterState: { outcome: input.outcome },
      ip,
      now,
    });
    return { status: input.outcome, version: input.expectedVersion + 1 };
  }

  /** Replay solo de partidas terminadas y con registro en auditoría de cada acceso. */
  async getMatchReplay(
    principal: AdminPrincipal,
    matchId: string,
    reason: string,
    ip: string | null,
  ): Promise<AdminMatchReplay> {
    const replay = await this.repo.findMatchReplay(matchId);
    if (!replay) {
      throw new DomainApiException(404, 'NOT_FOUND', 'Partida inexistente.');
    }
    if (replay.match.endedAt === null) {
      throw new DomainApiException(
        409,
        'CONFLICT',
        'Solo se pueden ver replays de partidas terminadas.',
        { reason: 'MATCH_IN_PROGRESS' },
      );
    }

    const now = new Date(this.config.nowFn());
    await this.audit.record({
      actorId: principal.userId,
      action: 'ADMIN_REPLAY_ACCESSED',
      entity: 'match',
      entityId: matchId,
      reason,
      afterState: { events: replay.events.length },
      ip,
      now,
    });

    const rawEvents = replay.events.map((event) => ({
      seq: event.seq,
      type: event.type,
      payload: event.payload as Record<string, unknown>,
      createdAt: event.createdAt,
    }));

    return {
      matchId: replay.match.id,
      mode: replay.match.mode as '1v1' | '2v2',
      rulesetCode: replay.match.rulesetCode,
      startedAt: replay.match.startedAt.toISOString(),
      endedAt: replay.match.endedAt?.toISOString() ?? null,
      result: (replay.match.result as Record<string, unknown> | null) ?? null,
      players: replay.players.map((player) => ({
        userId: player.userId,
        nickname: player.nickname,
        seat: player.seat,
        team: player.team,
        outcome: player.outcome as 'WIN' | 'LOSS' | 'DRAW' | 'ABANDONED',
      })),
      events: toReplayEvents(rawEvents),
      reconstructed: summarizeReplay(rawEvents),
    };
  }

  async listAudit(input: {
    action: string | null;
    entityId: string | null;
    cursor: string | null;
    limit: number;
  }): Promise<AdminAuditListResponse> {
    const cursorDate = input.cursor ? new Date(input.cursor) : null;
    const rows = await this.repo.listAudit({
      action: input.action,
      entityId: input.entityId,
      limit: input.limit + 1,
      cursor: cursorDate && !Number.isNaN(cursorDate.getTime()) ? cursorDate : null,
    });
    const page = rows.slice(0, input.limit);
    return {
      items: page.map((entry) => ({
        id: entry.row.id,
        actorId: entry.row.actorId,
        actorNickname: entry.actorNickname,
        action: entry.row.action,
        entity: entry.row.entity,
        entityId: entry.row.entityId,
        reason: entry.row.reason,
        ip: entry.row.ip,
        createdAt: entry.row.createdAt.toISOString(),
        beforeState: entry.row.beforeState,
        afterState: entry.row.afterState,
      })),
      nextCursor:
        rows.length > input.limit
          ? (page[page.length - 1]?.row.createdAt.toISOString() ?? null)
          : null,
    };
  }

  permissionsFor(role: AdminPrincipal['role']): readonly AdminPermission[] {
    return ADMIN_ROLE_PERMISSIONS[role];
  }
}
