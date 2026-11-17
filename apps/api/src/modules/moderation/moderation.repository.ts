import { Inject, Injectable } from '@nestjs/common';
import type { CreateReportResponse, ReportEventLogRef } from '@truco/shared';
import { and, count, desc, eq, inArray, sql } from 'drizzle-orm';
import { generateUuidV7 } from '../../common/uuidv7.js';
import { type AppDatabase, DRIZZLE_DB } from '../../db/database.provider.js';
import { matchEventsTable, matchesTable, reportsTable, usersTable } from '../../db/schema/index.js';

export interface InsertReportInput {
  readonly reporterId: string;
  readonly targetId: string;
  readonly matchId: string | null;
  readonly reasonCode: string;
  readonly reason: string;
  readonly details: string | null;
  readonly dedupeKey: string;
  readonly eventLogRef: ReportEventLogRef | null;
  readonly now: Date;
}

@Injectable()
export class ModerationRepository {
  constructor(@Inject(DRIZZLE_DB) private readonly db: AppDatabase) {}

  async findUserById(userId: string) {
    const [row] = await this.db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
    return row ?? null;
  }

  async matchExistsForUser(matchId: string, userId: string): Promise<boolean> {
    const rows = await this.db.execute(sql`
      SELECT 1 FROM match_players WHERE match_id = ${matchId} AND user_id = ${userId} LIMIT 1
    `);
    return ((rows as unknown as { rows?: unknown[] }).rows ?? []).length > 0;
  }

  /** Huella del tramo de `match_events` que se adjunta al reporte. */
  async buildEventLogRef(matchId: string): Promise<ReportEventLogRef | null> {
    const [meta] = await this.db
      .select({ id: matchesTable.id })
      .from(matchesTable)
      .where(eq(matchesTable.id, matchId))
      .limit(1);
    if (!meta) return null;

    const stats = await this.db
      .select({
        total: count(),
        lastSeq: sql<number>`coalesce(max(${matchEventsTable.seq}), 0)`,
        digest: sql<string>`coalesce(md5(string_agg(${matchEventsTable.seq} || ':' || ${matchEventsTable.type}, ',' order by ${matchEventsTable.seq})), md5(''))`,
      })
      .from(matchEventsTable)
      .where(eq(matchEventsTable.matchId, matchId));

    const total = Number(stats[0]?.total ?? 0);
    if (total === 0) return null;
    return {
      matchId,
      eventCount: total,
      lastSeq: Number(stats[0]?.lastSeq ?? 0),
      digest: String(stats[0]?.digest ?? ''),
    };
  }

  async countOpenReportsByReporter(reporterId: string): Promise<number> {
    const [row] = await this.db
      .select({ total: count() })
      .from(reportsTable)
      .where(
        and(
          eq(reportsTable.reporterId, reporterId),
          inArray(reportsTable.status, ['OPEN', 'IN_REVIEW']),
        ),
      );
    return Number(row?.total ?? 0);
  }

  async countOpenReportsAgainst(targetId: string): Promise<number> {
    const [row] = await this.db
      .select({ total: count() })
      .from(reportsTable)
      .where(
        and(
          eq(reportsTable.targetId, targetId),
          inArray(reportsTable.status, ['OPEN', 'IN_REVIEW']),
        ),
      );
    return Number(row?.total ?? 0);
  }

  async findOpenDuplicate(dedupeKey: string) {
    const [row] = await this.db
      .select()
      .from(reportsTable)
      .where(
        and(
          eq(reportsTable.dedupeKey, dedupeKey),
          inArray(reportsTable.status, ['OPEN', 'IN_REVIEW']),
        ),
      )
      .orderBy(desc(reportsTable.createdAt))
      .limit(1);
    return row ?? null;
  }

  async insertReport(input: InsertReportInput): Promise<void> {
    await this.db.insert(reportsTable).values({
      id: generateUuidV7(input.now.getTime()),
      reporterId: input.reporterId,
      targetId: input.targetId,
      matchId: input.matchId,
      reason: input.reason,
      reasonCode: input.reasonCode,
      details: input.details,
      status: 'OPEN',
      dedupeKey: input.dedupeKey,
      eventLogRef: input.eventLogRef as unknown as Record<string, unknown> | null,
      version: 0,
      createdAt: input.now,
      updatedAt: input.now,
    });
  }

  async listRecentReportsByReporter(reporterId: string): Promise<CreateReportResponse[]> {
    const rows = await this.db
      .select()
      .from(reportsTable)
      .where(eq(reportsTable.reporterId, reporterId))
      .orderBy(desc(reportsTable.createdAt))
      .limit(20);
    return rows.map((row) => ({
      id: row.id,
      status: row.status as CreateReportResponse['status'],
      createdAt: row.createdAt.toISOString(),
      mergedWithExisting: false,
      eventLogRef: (row.eventLogRef as unknown as ReportEventLogRef | null) ?? null,
    }));
  }
}
