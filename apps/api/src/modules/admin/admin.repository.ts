import { Inject, Injectable } from '@nestjs/common';
import type { SanctionType } from '@truco/shared';
import { and, count, desc, eq, gt, ilike, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import { generateUuidV7 } from '../../common/uuidv7.js';
import { type AppDatabase, DRIZZLE_DB } from '../../db/database.provider.js';
import {
  adminSessionsTable,
  adminTwoFactorTable,
  auditLogsTable,
  matchEventsTable,
  matchPlayersTable,
  matchesTable,
  reportsTable,
  sanctionsTable,
  sessionsTable,
  usersTable,
} from '../../db/schema/index.js';

export interface AdminSessionRowRecord {
  readonly id: string;
  readonly userId: string;
  readonly expiresAt: Date;
  readonly revokedAt: Date | null;
}

@Injectable()
export class AdminRepository {
  constructor(@Inject(DRIZZLE_DB) private readonly db: AppDatabase) {}

  async findUserByEmail(emailLower: string) {
    const [row] = await this.db
      .select()
      .from(usersTable)
      .where(eq(usersTable.email, emailLower))
      .limit(1);
    return row ?? null;
  }

  async findUserById(userId: string) {
    const [row] = await this.db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
    return row ?? null;
  }

  /* ------------------------------- 2FA ---------------------------------- */

  async findTwoFactor(userId: string) {
    const [row] = await this.db
      .select()
      .from(adminTwoFactorTable)
      .where(eq(adminTwoFactorTable.userId, userId))
      .limit(1);
    return row ?? null;
  }

  async upsertTwoFactor(input: {
    userId: string;
    secretEncrypted: string;
    recoveryCodes: Array<{ hash: string; usedAt: string | null }>;
    confirmedAt: Date | null;
    now: Date;
  }): Promise<void> {
    await this.db
      .insert(adminTwoFactorTable)
      .values({
        userId: input.userId,
        secretEncrypted: input.secretEncrypted,
        recoveryCodes: input.recoveryCodes,
        confirmedAt: input.confirmedAt,
        createdAt: input.now,
        updatedAt: input.now,
      })
      .onConflictDoUpdate({
        target: adminTwoFactorTable.userId,
        set: {
          secretEncrypted: input.secretEncrypted,
          recoveryCodes: input.recoveryCodes,
          confirmedAt: input.confirmedAt,
          updatedAt: input.now,
        },
      });
  }

  async updateRecoveryCodes(
    userId: string,
    codes: Array<{ hash: string; usedAt: string | null }>,
    lastUsedStep: number | null,
    now: Date,
  ): Promise<void> {
    await this.db
      .update(adminTwoFactorTable)
      .set({ recoveryCodes: codes, lastUsedStep, updatedAt: now })
      .where(eq(adminTwoFactorTable.userId, userId));
  }

  /* --------------------------- Sesiones admin --------------------------- */

  async createAdminSession(input: {
    userId: string;
    tokenHash: string;
    ip: string | null;
    userAgent: string | null;
    expiresAt: Date;
    now: Date;
  }): Promise<string> {
    const id = generateUuidV7(input.now.getTime());
    await this.db.insert(adminSessionsTable).values({
      id,
      userId: input.userId,
      tokenHash: input.tokenHash,
      totpVerifiedAt: input.now,
      ipAddress: input.ip,
      userAgent: input.userAgent,
      createdAt: input.now,
      expiresAt: input.expiresAt,
    });
    return id;
  }

  async findAdminSessionByTokenHash(tokenHash: string) {
    const [row] = await this.db
      .select()
      .from(adminSessionsTable)
      .where(eq(adminSessionsTable.tokenHash, tokenHash))
      .limit(1);
    return row ?? null;
  }

  async revokeAdminSession(sessionId: string, now: Date): Promise<void> {
    await this.db
      .update(adminSessionsTable)
      .set({ revokedAt: now })
      .where(and(eq(adminSessionsTable.id, sessionId), isNull(adminSessionsTable.revokedAt)));
  }

  async revokeAllAdminSessionsForUser(userId: string, now: Date): Promise<number> {
    const rows = await this.db
      .update(adminSessionsTable)
      .set({ revokedAt: now })
      .where(and(eq(adminSessionsTable.userId, userId), isNull(adminSessionsTable.revokedAt)))
      .returning({ id: adminSessionsTable.id });
    return rows.length;
  }

  /** Revoca todas las sesiones de jugador (aplicación inmediata de una sanción). */
  async revokeAllPlayerSessions(userId: string, reason: string, now: Date): Promise<number> {
    const rows = await this.db
      .update(sessionsTable)
      .set({ revokedAt: now, revokedReason: reason as never })
      .where(and(eq(sessionsTable.userId, userId), isNull(sessionsTable.revokedAt)))
      .returning({ id: sessionsTable.id });
    return rows.length;
  }

  /* ----------------------------- Sanciones ------------------------------ */

  async applySanction(input: {
    userId: string;
    type: SanctionType;
    reason: string;
    reportId: string | null;
    issuedBy: string;
    expiresAt: Date | null;
    now: Date;
  }): Promise<string> {
    const id = generateUuidV7(input.now.getTime());
    await this.db.insert(sanctionsTable).values({
      id,
      userId: input.userId,
      type: input.type,
      reason: input.reason,
      reportId: input.reportId,
      issuedBy: input.issuedBy,
      expiresAt: input.expiresAt,
      createdAt: input.now,
    });
    return id;
  }

  async updateAccountStatus(input: {
    userId: string;
    status: 'ACTIVE' | 'SUSPENDED' | 'BANNED';
    statusReason: string | null;
    statusExpiresAt: Date | null;
    mutedUntil: Date | null;
    nicknameMustChange?: boolean;
    now: Date;
  }): Promise<void> {
    await this.db
      .update(usersTable)
      .set({
        status: input.status,
        statusReason: input.statusReason,
        statusExpiresAt: input.statusExpiresAt,
        mutedUntil: input.mutedUntil,
        ...(input.nicknameMustChange !== undefined
          ? { nicknameMustChange: input.nicknameMustChange }
          : {}),
        updatedAt: input.now,
      })
      .where(eq(usersTable.id, input.userId));
  }

  async listSanctionsForUser(userId: string, limit = 20) {
    return this.db
      .select({
        id: sanctionsTable.id,
        userId: sanctionsTable.userId,
        type: sanctionsTable.type,
        reason: sanctionsTable.reason,
        reportId: sanctionsTable.reportId,
        issuedBy: sanctionsTable.issuedBy,
        issuedByNickname: usersTable.nickname,
        expiresAt: sanctionsTable.expiresAt,
        createdAt: sanctionsTable.createdAt,
        revokedAt: sanctionsTable.revokedAt,
      })
      .from(sanctionsTable)
      .leftJoin(usersTable, eq(usersTable.id, sanctionsTable.issuedBy))
      .where(eq(sanctionsTable.userId, userId))
      .orderBy(desc(sanctionsTable.createdAt))
      .limit(limit);
  }

  /* ----------------------------- Dashboard ------------------------------ */

  async countUsersSince(since: Date): Promise<number> {
    const [row] = await this.db
      .select({ total: count() })
      .from(usersTable)
      .where(and(isNull(usersTable.deletedAt), gt(usersTable.updatedAt, since)));
    return Number(row?.total ?? 0);
  }

  async countUsersTotal(): Promise<number> {
    const [row] = await this.db
      .select({ total: count() })
      .from(usersTable)
      .where(isNull(usersTable.deletedAt));
    return Number(row?.total ?? 0);
  }

  async countMatchesInProgress(): Promise<number> {
    const [row] = await this.db
      .select({ total: count() })
      .from(matchesTable)
      .where(isNull(matchesTable.endedAt));
    return Number(row?.total ?? 0);
  }

  async countMatchesFinishedSince(since: Date): Promise<number> {
    const [row] = await this.db
      .select({ total: count() })
      .from(matchesTable)
      .where(and(sql`${matchesTable.endedAt} is not null`, gt(matchesTable.endedAt, since)));
    return Number(row?.total ?? 0);
  }

  async countReportsByStatus(): Promise<Record<string, number>> {
    const rows = await this.db
      .select({ status: reportsTable.status, total: count() })
      .from(reportsTable)
      .groupBy(reportsTable.status);
    const result: Record<string, number> = {};
    for (const row of rows) result[row.status] = Number(row.total);
    return result;
  }

  async countReportsResolvedSince(since: Date): Promise<number> {
    const [row] = await this.db
      .select({ total: count() })
      .from(reportsTable)
      .where(and(sql`${reportsTable.resolvedAt} is not null`, gt(reportsTable.resolvedAt, since)));
    return Number(row?.total ?? 0);
  }

  async countActiveSanctions(now: Date): Promise<number> {
    const [row] = await this.db
      .select({ total: count() })
      .from(sanctionsTable)
      .where(
        and(
          isNull(sanctionsTable.revokedAt),
          or(isNull(sanctionsTable.expiresAt), gt(sanctionsTable.expiresAt, now)),
          inArray(sanctionsTable.type, ['MUTE', 'SUSPEND', 'BAN']),
        ),
      );
    return Number(row?.total ?? 0);
  }

  /* ------------------------------- Usuarios ----------------------------- */

  async listUsers(input: { query: string | null; limit: number; cursor: Date | null }) {
    const filters = [isNull(usersTable.deletedAt)];
    if (input.query && input.query.trim().length > 0) {
      const like = `%${input.query.trim()}%`;
      filters.push(or(ilike(usersTable.nickname, like), ilike(usersTable.email, like))!);
    }
    if (input.cursor) filters.push(lt(usersTable.createdAt, input.cursor));

    return this.db
      .select({
        id: usersTable.id,
        nickname: usersTable.nickname,
        email: usersTable.email,
        role: usersTable.role,
        status: usersTable.status,
        statusReason: usersTable.statusReason,
        statusExpiresAt: usersTable.statusExpiresAt,
        mutedUntil: usersTable.mutedUntil,
        isGuest: usersTable.isGuest,
        createdAt: usersTable.createdAt,
        updatedAt: usersTable.updatedAt,
      })
      .from(usersTable)
      .where(and(...filters))
      .orderBy(desc(usersTable.createdAt))
      .limit(input.limit);
  }

  async openReportsAgainstCounts(userIds: string[]): Promise<Map<string, number>> {
    if (userIds.length === 0) return new Map();
    const rows = await this.db
      .select({ targetId: reportsTable.targetId, total: count() })
      .from(reportsTable)
      .where(
        and(
          inArray(reportsTable.targetId, userIds),
          inArray(reportsTable.status, ['OPEN', 'IN_REVIEW']),
        ),
      )
      .groupBy(reportsTable.targetId);
    return new Map(rows.map((row) => [row.targetId, Number(row.total)]));
  }

  async renameUser(
    userId: string,
    nickname: string,
    nicknameLower: string,
    now: Date,
  ): Promise<void> {
    await this.db
      .update(usersTable)
      .set({ nickname, nicknameLower, updatedAt: now })
      .where(eq(usersTable.id, userId));
  }

  async countSanctionsForUser(userId: string): Promise<number> {
    const [row] = await this.db
      .select({ total: count() })
      .from(sanctionsTable)
      .where(eq(sanctionsTable.userId, userId));
    return Number(row?.total ?? 0);
  }

  async listRecentMatchesForUser(userId: string, limit = 5) {
    return this.db
      .select({
        matchId: matchesTable.id,
        mode: matchesTable.mode,
        endedAt: matchesTable.endedAt,
        outcome: matchPlayersTable.outcome,
      })
      .from(matchPlayersTable)
      .innerJoin(matchesTable, eq(matchesTable.id, matchPlayersTable.matchId))
      .where(eq(matchPlayersTable.userId, userId))
      .orderBy(desc(matchesTable.startedAt))
      .limit(limit);
  }

  /* ------------------------------- Reportes ----------------------------- */

  async listReports(input: {
    status: string | null;
    reasonCode: string | null;
    limit: number;
    cursor: Date | null;
  }) {
    const reporter = { nickname: usersTable.nickname };
    const filters = [];
    if (input.status) filters.push(eq(reportsTable.status, input.status));
    if (input.reasonCode) filters.push(eq(reportsTable.reasonCode, input.reasonCode));
    if (input.cursor) filters.push(lt(reportsTable.createdAt, input.cursor));

    const rows = await this.db
      .select({
        report: reportsTable,
        reporterNickname: reporter.nickname,
      })
      .from(reportsTable)
      .innerJoin(usersTable, eq(usersTable.id, reportsTable.reporterId))
      .where(filters.length > 0 ? and(...filters) : undefined)
      .orderBy(desc(reportsTable.createdAt))
      .limit(input.limit);

    const targetIds = [...new Set(rows.map((row) => row.report.targetId))];
    const claimedByIds = [
      ...new Set(rows.map((row) => row.report.claimedBy).filter((id): id is string => !!id)),
    ];
    const targetNicknames = await this.nicknamesByIds(targetIds);
    const claimedByNicknames = await this.nicknamesByIds(claimedByIds);

    return rows.map((row) => ({
      row: row.report,
      reporterNickname: row.reporterNickname,
      targetNickname: targetNicknames.get(row.report.targetId) ?? 'Jugador',
      claimedByNickname: row.report.claimedBy
        ? (claimedByNicknames.get(row.report.claimedBy) ?? null)
        : null,
    }));
  }

  async nicknamesByIds(ids: string[]): Promise<Map<string, string>> {
    if (ids.length === 0) return new Map();
    const rows = await this.db
      .select({ id: usersTable.id, nickname: usersTable.nickname })
      .from(usersTable)
      .where(inArray(usersTable.id, ids));
    return new Map(rows.map((row) => [row.id, row.nickname]));
  }

  async findReportById(reportId: string) {
    const [row] = await this.db
      .select()
      .from(reportsTable)
      .where(eq(reportsTable.id, reportId))
      .limit(1);
    return row ?? null;
  }

  /** Claim atómico con control de versión: solo el primero gana. */
  async claimReport(input: {
    reportId: string;
    adminId: string;
    expectedVersion: number;
    now: Date;
  }): Promise<boolean> {
    const rows = await this.db
      .update(reportsTable)
      .set({
        status: 'IN_REVIEW',
        claimedBy: input.adminId,
        claimedAt: input.now,
        version: input.expectedVersion + 1,
        updatedAt: input.now,
      })
      .where(
        and(
          eq(reportsTable.id, input.reportId),
          eq(reportsTable.version, input.expectedVersion),
          inArray(reportsTable.status, ['OPEN', 'IN_REVIEW']),
        ),
      )
      .returning({ id: reportsTable.id });
    return rows.length === 1;
  }

  /** Resolución atómica por versión: dos moderadores no pueden resolver el mismo reporte. */
  async resolveReport(input: {
    reportId: string;
    adminId: string;
    expectedVersion: number;
    status: 'RESOLVED_ACTIONED' | 'RESOLVED_DISMISSED';
    note: string;
    now: Date;
  }): Promise<boolean> {
    const rows = await this.db
      .update(reportsTable)
      .set({
        status: input.status,
        resolvedBy: input.adminId,
        resolvedAt: input.now,
        resolutionNote: input.note,
        version: input.expectedVersion + 1,
        updatedAt: input.now,
      })
      .where(
        and(
          eq(reportsTable.id, input.reportId),
          eq(reportsTable.version, input.expectedVersion),
          inArray(reportsTable.status, ['OPEN', 'IN_REVIEW']),
        ),
      )
      .returning({ id: reportsTable.id });
    return rows.length === 1;
  }

  /* -------------------------------- Replay ------------------------------ */

  async findMatchReplay(matchId: string) {
    const [match] = await this.db
      .select()
      .from(matchesTable)
      .where(eq(matchesTable.id, matchId))
      .limit(1);
    if (!match) return null;
    const players = await this.db
      .select({
        userId: matchPlayersTable.userId,
        nickname: usersTable.nickname,
        seat: matchPlayersTable.seat,
        team: matchPlayersTable.team,
        outcome: matchPlayersTable.outcome,
      })
      .from(matchPlayersTable)
      .innerJoin(usersTable, eq(usersTable.id, matchPlayersTable.userId))
      .where(eq(matchPlayersTable.matchId, matchId))
      .orderBy(matchPlayersTable.seat);
    const events = await this.db
      .select()
      .from(matchEventsTable)
      .where(eq(matchEventsTable.matchId, matchId))
      .orderBy(matchEventsTable.seq);
    return { match, players, events };
  }

  /* ------------------------------- Auditoría ---------------------------- */

  async listAudit(input: {
    action: string | null;
    entityId: string | null;
    limit: number;
    cursor: Date | null;
  }) {
    const filters = [];
    if (input.action) filters.push(eq(auditLogsTable.action, input.action));
    if (input.entityId) filters.push(eq(auditLogsTable.entityId, input.entityId));
    if (input.cursor) filters.push(lt(auditLogsTable.createdAt, input.cursor));

    const rows = await this.db
      .select()
      .from(auditLogsTable)
      .where(filters.length > 0 ? and(...filters) : undefined)
      .orderBy(desc(auditLogsTable.createdAt))
      .limit(input.limit);

    const actorIds = [
      ...new Set(rows.map((row) => row.actorId).filter((id): id is string => !!id)),
    ];
    const nicknames = await this.nicknamesByIds(actorIds);
    return rows.map((row) => ({
      row,
      actorNickname: row.actorId ? (nicknames.get(row.actorId) ?? null) : null,
    }));
  }
}
