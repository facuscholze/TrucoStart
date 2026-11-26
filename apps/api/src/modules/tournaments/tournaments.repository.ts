import type { RulesetCode } from '@truco/shared';
import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, inArray, isNotNull, lt, or, sql } from 'drizzle-orm';
import { type AppDatabase, type AppTransaction, DRIZZLE_DB } from '../../db/database.provider.js';
import {
  matchesTable,
  matchPlayersTable,
  ratingProfilesTable,
  ratingSeasonsTable,
  tournamentAwardsTable,
  tournamentMatchesTable,
  tournamentParticipantsTable,
  tournamentPrizesTable,
  tournamentsTable,
  usersTable,
} from '../../db/schema/index.js';

/**
 * Acceso a datos de torneos (M10a).
 *
 * El servicio concentra las reglas; acá sólo viven las consultas. Las escrituras que
 * deben ser atómicas reciben una transacción abierta por el servicio.
 */

export interface TournamentRow {
  readonly id: string;
  readonly name: string;
  readonly format: 'SINGLE_ELIMINATION' | 'DOUBLE_ELIMINATION';
  readonly visibility: 'OFFICIAL' | 'PRIVATE';
  readonly status: 'DRAFT' | 'REGISTRATION' | 'CHECK_IN' | 'IN_PROGRESS' | 'FINISHED' | 'CANCELLED';
  readonly mode: '1v1' | '2v2';
  readonly rulesetId: string;
  readonly rulesetCode: RulesetCode;
  readonly targetScore: number;
  readonly florEnabled: boolean;
  readonly turnTimeoutMs: number;
  readonly capacity: number;
  readonly joinCode: string | null;
  readonly noShowMinutes: number;
  readonly registrationClosesAt: Date;
  readonly checkInClosesAt: Date;
  readonly startsAt: Date | null;
  readonly finishedAt: Date | null;
  readonly cancelledAt: Date | null;
  readonly cancelledReason: string | null;
  readonly createdBy: string;
  readonly version: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface ParticipantRow {
  readonly id: string;
  readonly tournamentId: string;
  readonly userId: string;
  readonly status:
    | 'REGISTERED'
    | 'CHECKED_IN'
    | 'NO_SHOW'
    | 'WITHDRAWN'
    | 'DISQUALIFIED'
    | 'ELIMINATED'
    | 'WINNER';
  readonly seed: number | null;
  readonly seedRating: number | null;
  readonly registeredAt: Date;
  readonly checkedInAt: Date | null;
  readonly withdrawnAt: Date | null;
}

export interface TournamentMatchRow {
  readonly id: string;
  readonly tournamentId: string;
  readonly bracket: 'WINNERS' | 'LOSERS' | 'GRAND_FINAL';
  readonly round: number;
  readonly slot: number;
  readonly homeUserId: string | null;
  readonly awayUserId: string | null;
  readonly homeSeed: number | null;
  readonly awaySeed: number | null;
  readonly status: 'SCHEDULED' | 'READY' | 'IN_PROGRESS' | 'COMPLETED' | 'FORFEITED';
  readonly winnerUserId: string | null;
  readonly loserUserId: string | null;
  readonly forfeitReason: 'NO_SHOW' | 'ABANDON' | 'DISQUALIFIED' | null;
  readonly matchId: string | null;
  readonly roomId: string | null;
  readonly startedAt: Date | null;
  readonly completedAt: Date | null;
  readonly deadlineAt: Date | null;
  readonly resolvedFromMatchId: string | null;
}

@Injectable()
export class TournamentsRepository {
  constructor(@Inject(DRIZZLE_DB) private readonly db: AppDatabase) {}

  get database(): AppDatabase {
    return this.db;
  }

  transaction<T>(work: (tx: AppTransaction) => Promise<T>): Promise<T> {
    return this.db.transaction(work);
  }

  async findById(id: string): Promise<TournamentRow | null> {
    const [row] = await this.db
      .select()
      .from(tournamentsTable)
      .where(eq(tournamentsTable.id, id))
      .limit(1);
    return row ?? null;
  }

  async lockById(tx: AppTransaction, id: string): Promise<TournamentRow | null> {
    const [row] = await tx
      .select()
      .from(tournamentsTable)
      .where(eq(tournamentsTable.id, id))
      .for('update')
      .limit(1);
    return row ?? null;
  }

  async findByJoinCode(joinCode: string): Promise<TournamentRow | null> {
    const [row] = await this.db
      .select()
      .from(tournamentsTable)
      .where(eq(tournamentsTable.joinCode, joinCode))
      .limit(1);
    return row ?? null;
  }

  async insertTournament(
    tx: AppTransaction,
    values: typeof tournamentsTable.$inferInsert,
  ): Promise<TournamentRow> {
    const [row] = await tx.insert(tournamentsTable).values(values).returning();
    return row!;
  }

  async updateTournament(
    tx: AppTransaction,
    id: string,
    patch: Partial<typeof tournamentsTable.$inferInsert>,
  ): Promise<TournamentRow> {
    const [row] = await tx
      .update(tournamentsTable)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(tournamentsTable.id, id))
      .returning();
    return row!;
  }

  /**
   * Listado público. Los privados sólo aparecen para quien ya participa o los creó,
   * así que el filtro de visibilidad se resuelve en SQL y no en memoria.
   */
  async listVisible(input: {
    readonly viewerUserId: string;
    readonly statuses: readonly string[];
    readonly limit: number;
    readonly cursor?: { readonly createdAt: Date; readonly id: string } | null;
    readonly includePrivateForViewer: boolean;
  }): Promise<TournamentRow[]> {
    const statusFilter =
      input.statuses.length > 0
        ? inArray(tournamentsTable.status, input.statuses as never[])
        : undefined;
    const visibilityFilter = input.includePrivateForViewer
      ? or(
          eq(tournamentsTable.visibility, 'OFFICIAL'),
          eq(tournamentsTable.createdBy, input.viewerUserId),
          sql`EXISTS (
            SELECT 1 FROM ${tournamentParticipantsTable}
            WHERE ${tournamentParticipantsTable.tournamentId} = ${tournamentsTable.id}
              AND ${tournamentParticipantsTable.userId} = ${input.viewerUserId}
          )`,
        )
      : eq(tournamentsTable.visibility, 'OFFICIAL');

    const cursorFilter = input.cursor
      ? or(
          lt(tournamentsTable.createdAt, input.cursor.createdAt),
          and(
            eq(tournamentsTable.createdAt, input.cursor.createdAt),
            lt(tournamentsTable.id, input.cursor.id),
          ),
        )
      : undefined;

    return this.db
      .select()
      .from(tournamentsTable)
      .where(and(visibilityFilter, statusFilter, cursorFilter))
      .orderBy(desc(tournamentsTable.createdAt), desc(tournamentsTable.id))
      .limit(input.limit);
  }

  /**
   * Listado para el panel: ve todos los torneos, incluidos los privados de otros
   * jugadores. Sólo lo usa el controlador de staff, detrás de `tournaments:manage`.
   */
  async listForStaff(input: {
    readonly statuses: readonly string[];
    readonly limit: number;
    readonly cursor?: { readonly createdAt: Date; readonly id: string } | null;
  }): Promise<TournamentRow[]> {
    const statusFilter =
      input.statuses.length > 0
        ? inArray(tournamentsTable.status, input.statuses as never[])
        : undefined;
    const cursorFilter = input.cursor
      ? or(
          lt(tournamentsTable.createdAt, input.cursor.createdAt),
          and(
            eq(tournamentsTable.createdAt, input.cursor.createdAt),
            lt(tournamentsTable.id, input.cursor.id),
          ),
        )
      : undefined;
    return this.db
      .select()
      .from(tournamentsTable)
      .where(and(statusFilter, cursorFilter))
      .orderBy(desc(tournamentsTable.createdAt), desc(tournamentsTable.id))
      .limit(input.limit);
  }

  async countActivePrivateByCreator(tx: AppTransaction, creatorId: string): Promise<number> {
    const [row] = await tx
      .select({ count: sql<number>`COUNT(*)::int` })
      .from(tournamentsTable)
      .where(
        and(
          eq(tournamentsTable.createdBy, creatorId),
          eq(tournamentsTable.visibility, 'PRIVATE'),
          inArray(tournamentsTable.status, ['REGISTRATION', 'CHECK_IN', 'IN_PROGRESS']),
        ),
      );
    return Number(row?.count ?? 0);
  }

  async insertPrizes(
    tx: AppTransaction,
    values: readonly (typeof tournamentPrizesTable.$inferInsert)[],
  ): Promise<void> {
    if (values.length === 0) return;
    await tx.insert(tournamentPrizesTable).values([...values]);
  }

  async listPrizes(tournamentIds: readonly string[]) {
    if (tournamentIds.length === 0) return [];
    return this.db
      .select()
      .from(tournamentPrizesTable)
      .where(inArray(tournamentPrizesTable.tournamentId, [...tournamentIds]))
      .orderBy(asc(tournamentPrizesTable.position));
  }

  async listParticipants(tournamentId: string): Promise<ParticipantRow[]> {
    return this.db
      .select()
      .from(tournamentParticipantsTable)
      .where(eq(tournamentParticipantsTable.tournamentId, tournamentId))
      .orderBy(asc(tournamentParticipantsTable.registeredAt), asc(tournamentParticipantsTable.id));
  }

  async lockParticipants(tx: AppTransaction, tournamentId: string): Promise<ParticipantRow[]> {
    return tx
      .select()
      .from(tournamentParticipantsTable)
      .where(
        and(
          eq(tournamentParticipantsTable.tournamentId, tournamentId),
          inArray(tournamentParticipantsTable.status, [
            'REGISTERED',
            'CHECKED_IN',
            'ELIMINATED',
            'WINNER',
          ]),
        ),
      )
      .orderBy(asc(tournamentParticipantsTable.registeredAt), asc(tournamentParticipantsTable.id))
      .for('update');
  }

  async findParticipant(
    tournamentId: string,
    userId: string,
    tx?: AppTransaction,
  ): Promise<ParticipantRow | null> {
    // Dentro de una transacción hay que leer por la MISMA conexión: usar el pool
    // mientras la transacción tiene el torneo bloqueado se traba (y en PostgreSQL real
    // leería fuera de la transacción).
    const [row] = await (tx ?? this.db)
      .select()
      .from(tournamentParticipantsTable)
      .where(
        and(
          eq(tournamentParticipantsTable.tournamentId, tournamentId),
          eq(tournamentParticipantsTable.userId, userId),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  async countActiveParticipants(tx: AppTransaction, tournamentId: string): Promise<number> {
    const [row] = await tx
      .select({ count: sql<number>`COUNT(*)::int` })
      .from(tournamentParticipantsTable)
      .where(
        and(
          eq(tournamentParticipantsTable.tournamentId, tournamentId),
          inArray(tournamentParticipantsTable.status, ['REGISTERED', 'CHECKED_IN']),
        ),
      );
    return Number(row?.count ?? 0);
  }

  async insertParticipant(
    tx: AppTransaction,
    values: typeof tournamentParticipantsTable.$inferInsert,
  ): Promise<ParticipantRow> {
    const [row] = await tx.insert(tournamentParticipantsTable).values(values).returning();
    return row!;
  }

  async updateParticipant(
    tx: AppTransaction,
    id: string,
    patch: Partial<typeof tournamentParticipantsTable.$inferInsert>,
  ): Promise<void> {
    await tx
      .update(tournamentParticipantsTable)
      .set(patch)
      .where(eq(tournamentParticipantsTable.id, id));
  }

  /** Ratings vigentes de la temporada activa para sembrar el cuadro. */
  async ratingsFor(
    userIds: readonly string[],
    mode: '1v1' | '2v2',
    tx?: AppTransaction,
  ): Promise<Map<string, number>> {
    if (userIds.length === 0) return new Map();
    const [season] = await (tx ?? this.db)
      .select({ id: ratingSeasonsTable.id })
      .from(ratingSeasonsTable)
      .where(eq(ratingSeasonsTable.status, 'ACTIVE'))
      .limit(1);
    if (!season) return new Map();
    const rows = await (tx ?? this.db)
      .select({ userId: ratingProfilesTable.userId, rating: ratingProfilesTable.rating })
      .from(ratingProfilesTable)
      .where(
        and(
          eq(ratingProfilesTable.seasonId, season.id),
          eq(ratingProfilesTable.mode, mode),
          inArray(ratingProfilesTable.userId, [...userIds]),
        ),
      );
    return new Map(rows.map((row) => [row.userId, Math.round(row.rating)]));
  }

  async nicknamesFor(userIds: readonly string[]): Promise<Map<string, string>> {
    if (userIds.length === 0) return new Map();
    const rows = await this.db
      .select({ id: usersTable.id, nickname: usersTable.nickname })
      .from(usersTable)
      .where(inArray(usersTable.id, [...userIds]));
    return new Map(rows.map((row) => [row.id, row.nickname]));
  }

  async insertMatches(
    tx: AppTransaction,
    values: readonly (typeof tournamentMatchesTable.$inferInsert)[],
  ): Promise<void> {
    if (values.length === 0) return;
    await tx.insert(tournamentMatchesTable).values([...values]);
  }

  async listMatches(tournamentId: string): Promise<TournamentMatchRow[]> {
    return this.db
      .select()
      .from(tournamentMatchesTable)
      .where(eq(tournamentMatchesTable.tournamentId, tournamentId))
      .orderBy(
        asc(tournamentMatchesTable.round),
        asc(tournamentMatchesTable.bracket),
        asc(tournamentMatchesTable.slot),
      );
  }

  async lockMatches(tx: AppTransaction, tournamentId: string): Promise<TournamentMatchRow[]> {
    return tx
      .select()
      .from(tournamentMatchesTable)
      .where(eq(tournamentMatchesTable.tournamentId, tournamentId))
      .orderBy(
        asc(tournamentMatchesTable.round),
        asc(tournamentMatchesTable.bracket),
        asc(tournamentMatchesTable.slot),
      )
      .for('update');
  }

  async updateMatch(
    tx: AppTransaction,
    id: string,
    patch: Partial<typeof tournamentMatchesTable.$inferInsert>,
  ): Promise<void> {
    await tx
      .update(tournamentMatchesTable)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(tournamentMatchesTable.id, id));
  }

  /** Asocia la sala aprovisionada a un cruce ya escrito, sin abrir transacción propia. */
  async setMatchRoom(matchId: string, roomId: string): Promise<void> {
    await this.db
      .update(tournamentMatchesTable)
      .set({ roomId, updatedAt: new Date() })
      .where(eq(tournamentMatchesTable.id, matchId));
  }

  async findMatchById(id: string): Promise<TournamentMatchRow | null> {
    const [row] = await this.db
      .select()
      .from(tournamentMatchesTable)
      .where(eq(tournamentMatchesTable.id, id))
      .limit(1);
    return row ?? null;
  }

  async lockMatch(tx: AppTransaction, id: string): Promise<TournamentMatchRow | null> {
    const [row] = await tx
      .select()
      .from(tournamentMatchesTable)
      .where(eq(tournamentMatchesTable.id, id))
      .for('update')
      .limit(1);
    return row ?? null;
  }

  /** Cruces que todavía no tienen definición: si son cero, el torneo terminó. */
  async countPendingMatches(tournamentId: string): Promise<number> {
    const [row] = await this.db
      .select({ count: sql<number>`COUNT(*)::int` })
      .from(tournamentMatchesTable)
      .where(
        and(
          eq(tournamentMatchesTable.tournamentId, tournamentId),
          inArray(tournamentMatchesTable.status, ['SCHEDULED', 'READY', 'IN_PROGRESS']),
        ),
      );
    return Number(row?.count ?? 0);
  }

  async findMatchByGameMatchId(matchId: string): Promise<TournamentMatchRow | null> {
    const [row] = await this.db
      .select()
      .from(tournamentMatchesTable)
      .where(eq(tournamentMatchesTable.matchId, matchId))
      .limit(1);
    return row ?? null;
  }

  /** Cruces cuyo plazo de presentación venció y todavía no se resolvieron. */
  async listOverdueMatches(now: Date, limit = 100): Promise<TournamentMatchRow[]> {
    return this.db
      .select()
      .from(tournamentMatchesTable)
      .where(
        and(
          inArray(tournamentMatchesTable.status, ['SCHEDULED', 'READY']),
          isNotNull(tournamentMatchesTable.deadlineAt),
          lt(tournamentMatchesTable.deadlineAt, now),
        ),
      )
      .orderBy(asc(tournamentMatchesTable.deadlineAt))
      .limit(limit);
  }

  async listTournamentsAwaitingStart(now: Date, limit = 50): Promise<TournamentRow[]> {
    return this.db
      .select()
      .from(tournamentsTable)
      .where(
        and(
          inArray(tournamentsTable.status, ['REGISTRATION', 'CHECK_IN']),
          lt(tournamentsTable.checkInClosesAt, now),
        ),
      )
      .orderBy(asc(tournamentsTable.checkInClosesAt))
      .limit(limit);
  }

  async listTournamentsWithOverdueDeadline(limit = 50): Promise<TournamentRow[]> {
    return this.db
      .select()
      .from(tournamentsTable)
      .where(eq(tournamentsTable.status, 'IN_PROGRESS'))
      .orderBy(asc(tournamentsTable.updatedAt))
      .limit(limit);
  }

  /** Partida real ya persistida, con su resultado y sus jugadores. */
  async findGameMatch(matchId: string): Promise<{
    readonly id: string;
    readonly result: Record<string, unknown> | null;
    readonly players: readonly { readonly userId: string; readonly team: number }[];
  } | null> {
    const [match] = await this.db
      .select({ id: matchesTable.id, result: matchesTable.result })
      .from(matchesTable)
      .where(eq(matchesTable.id, matchId))
      .limit(1);
    if (!match) return null;
    const players = await this.db
      .select({ userId: matchPlayersTable.userId, team: matchPlayersTable.team })
      .from(matchPlayersTable)
      .where(eq(matchPlayersTable.matchId, matchId));
    return { id: match.id, result: match.result ?? null, players };
  }

  async insertAward(
    tx: AppTransaction,
    values: typeof tournamentAwardsTable.$inferInsert,
  ): Promise<{ readonly id: string } | null> {
    const [row] = await tx
      .insert(tournamentAwardsTable)
      .values(values)
      .onConflictDoNothing({
        target: [tournamentAwardsTable.tournamentId, tournamentAwardsTable.position],
      })
      .returning({ id: tournamentAwardsTable.id });
    return row ?? null;
  }

  async listAwards(tournamentId: string) {
    return this.db
      .select()
      .from(tournamentAwardsTable)
      .where(eq(tournamentAwardsTable.tournamentId, tournamentId))
      .orderBy(asc(tournamentAwardsTable.position));
  }

  async setAwardTransaction(
    tx: AppTransaction,
    awardId: string,
    walletTransactionId: string,
  ): Promise<void> {
    await tx
      .update(tournamentAwardsTable)
      .set({ walletTransactionId })
      .where(eq(tournamentAwardsTable.id, awardId));
  }

  async tournamentIdsForUser(userId: string): Promise<string[]> {
    const rows = await this.db
      .select({ tournamentId: tournamentParticipantsTable.tournamentId })
      .from(tournamentParticipantsTable)
      .where(eq(tournamentParticipantsTable.userId, userId));
    return rows.map((row) => row.tournamentId);
  }

  async listMatchesForUser(userId: string): Promise<TournamentMatchRow[]> {
    return this.db
      .select()
      .from(tournamentMatchesTable)
      .where(
        and(
          inArray(tournamentMatchesTable.status, ['SCHEDULED', 'READY', 'IN_PROGRESS']),
          or(
            eq(tournamentMatchesTable.homeUserId, userId),
            eq(tournamentMatchesTable.awayUserId, userId),
          ),
        ),
      )
      .orderBy(asc(tournamentMatchesTable.deadlineAt));
  }

  async tournamentsByIds(ids: readonly string[]): Promise<TournamentRow[]> {
    if (ids.length === 0) return [];
    return this.db
      .select()
      .from(tournamentsTable)
      .where(inArray(tournamentsTable.id, [...ids]));
  }
}
