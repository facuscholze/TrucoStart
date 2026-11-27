import type { LeagueDivision, LeagueMode, LeagueStatus, RulesetCode } from '@truco/shared';
import { Inject, Injectable } from '@nestjs/common';
import { and, asc, count, desc, eq, gt, inArray, isNull, lt, lte, ne, or, sql } from 'drizzle-orm';
import { type AppDatabase, type AppTransaction, DRIZZLE_DB } from '../../db/database.provider.js';
import {
  cosmeticCatalogTable,
  leagueClosuresTable,
  leagueMatchesTable,
  leagueMovementsTable,
  leagueParticipantsTable,
  leaguePrizeAwardsTable,
  leaguePrizesTable,
  leagueReschedulesTable,
  leagueRoundsTable,
  leaguesTable,
  usersTable,
} from '../../db/schema/index.js';

/**
 * Acceso a datos de ligas (M10b, entrega 2).
 *
 * El servicio concentra las reglas; acá sólo viven las consultas. Las escrituras que deben ser
 * atómicas reciben una transacción abierta por el servicio y usan `for('update')` sobre la liga
 * como cerrojo: con `SELECT … FOR UPDATE` de la fila de la liga, dos cierres simultáneos se
 * serializan y el segundo ve el resultado del primero en vez de duplicarlo.
 */

export interface LeagueRow {
  readonly id: string;
  readonly name: string;
  readonly mode: LeagueMode;
  readonly division: LeagueDivision;
  readonly status: LeagueStatus;
  readonly official: boolean;
  readonly seasonLabel: string;
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly ratingSeasonId: string | null;
  readonly rulesetId: string;
  readonly rulesetCode: RulesetCode;
  readonly targetScore: number;
  readonly florEnabled: boolean;
  readonly turnTimeoutMs: number;
  readonly scheduleFormat: 'ROUNDS' | 'WINDOW';
  readonly rounds: number;
  readonly daysBetweenRounds: number;
  readonly roundWindowHours: number;
  readonly maxReschedulesPerMatch: number;
  readonly rescheduleMinHoursBeforeDeadline: number;
  readonly rescheduleExtensionHours: number;
  readonly promotions: number;
  readonly relegations: number;
  readonly minMatchesToMove: number;
  readonly capacity: number;
  readonly registrationClosesAt: Date;
  readonly firstRoundStartsAt: Date;
  readonly closedAt: Date | null;
  readonly finishedAt: Date | null;
  readonly cancelledAt: Date | null;
  readonly cancelledReason: string | null;
  readonly createdBy: string;
  readonly version: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface LeagueRoundRow {
  readonly id: string;
  readonly leagueId: string;
  readonly number: number;
  readonly status: 'SCHEDULED' | 'OPEN' | 'CLOSED' | 'CANCELLED';
  readonly startsAt: Date;
  readonly deadlineAt: Date;
  readonly closedAt: Date | null;
}

export interface LeagueParticipantRow {
  readonly id: string;
  readonly leagueId: string;
  readonly userId: string;
  readonly seed: number;
  readonly status:
    'REGISTERED' | 'ACTIVE' | 'WITHDRAWN' | 'DISQUALIFIED' | 'PROMOTED' | 'RELEGATED';
  readonly joinedDivision: LeagueDivision;
  readonly joinedAt: Date;
  readonly withdrawnAt: Date | null;
}

export interface LeagueMatchRow {
  readonly id: string;
  readonly leagueId: string;
  readonly roundId: string | null;
  readonly roundNumber: number | null;
  readonly homeUserId: string;
  readonly awayUserId: string;
  readonly status: 'SCHEDULED' | 'READY' | 'IN_PROGRESS' | 'COMPLETED' | 'FORFEITED' | 'VOID';
  readonly winnerUserId: string | null;
  readonly homeScore: number | null;
  readonly awayScore: number | null;
  readonly forfeitReason:
    'NO_SHOW' | 'DOUBLE_NO_SHOW' | 'ABANDON' | 'RESCHEDULED_EXPIRED' | 'DISQUALIFIED' | null;
  readonly matchId: string | null;
  readonly roomId: string | null;
  readonly deadlineAt: Date | null;
  readonly reschedulesUsed: number;
  readonly noShowUserId: string | null;
  readonly startedAt: Date | null;
  readonly completedAt: Date | null;
  readonly resolvedFromMatchId: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface LeagueClosureRow {
  readonly id: string;
  readonly leagueId: string;
  readonly closedAt: Date;
  readonly standings: unknown;
  readonly championUserId: string | null;
  readonly promotedUserIds: unknown;
  readonly relegatedUserIds: unknown;
  readonly forfeitedMatches: number;
}

@Injectable()
export class LeaguesRepository {
  constructor(@Inject(DRIZZLE_DB) private readonly db: AppDatabase) {}

  get database(): AppDatabase {
    return this.db;
  }

  transaction<T>(work: (tx: AppTransaction) => Promise<T>): Promise<T> {
    return this.db.transaction(work);
  }

  /**
   * Ejecutor de una lectura: la transacción abierta si la hay, o la conexión normal.
   *
   * **No es un detalle de estilo.** Con PGlite y con un pool de tamaño 1, leer por `this.db`
   * mientras hay una transacción abierta espera a la única conexión y la consulta nunca vuelve:
   * un interbloqueo. Toda lectura que corre dentro de `transaction()` tiene que pasar `tx`.
   */
  private exec(tx?: AppTransaction) {
    return tx ?? this.db;
  }

  // ------------------------------------------------------------------ ligas

  async findById(id: string, tx?: AppTransaction): Promise<LeagueRow | null> {
    const [row] = await this.exec(tx)
      .select()
      .from(leaguesTable)
      .where(eq(leaguesTable.id, id))
      .limit(1);
    return (row as LeagueRow | undefined) ?? null;
  }

  /**
   * Lee la liga con cerrojo de fila dentro de una transacción.
   *
   * Es el cerrojo de todas las operaciones que no pueden intercalarse: inscribir (para asignar
   * un `seed` sin repetirlo), cerrar una jornada y cerrar la temporada. Con esto, dos cierres
   * simultáneos se serializan: el segundo espera, ve `CLOSING`/`FINISHED` y no repite nada.
   */
  async lockById(tx: AppTransaction, id: string): Promise<LeagueRow | null> {
    const [row] = await tx
      .select()
      .from(leaguesTable)
      .where(eq(leaguesTable.id, id))
      .for('update')
      .limit(1);
    return (row as LeagueRow | undefined) ?? null;
  }

  async insertLeague(
    tx: AppTransaction,
    values: typeof leaguesTable.$inferInsert,
  ): Promise<LeagueRow> {
    const [row] = await tx.insert(leaguesTable).values(values).returning();
    return row as LeagueRow;
  }

  async updateLeague(
    tx: AppTransaction,
    id: string,
    patch: Partial<typeof leaguesTable.$inferInsert>,
  ): Promise<LeagueRow | null> {
    const [row] = await tx
      .update(leaguesTable)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(leaguesTable.id, id))
      .returning();
    return (row as LeagueRow | undefined) ?? null;
  }

  async listLeagues(input: {
    readonly mode?: LeagueMode | undefined;
    readonly division?: LeagueDivision | undefined;
    readonly statuses: readonly LeagueStatus[];
    readonly limit: number;
    readonly cursor: string | null;
  }): Promise<LeagueRow[]> {
    const filters = [] as ReturnType<typeof eq>[];
    if (input.mode) filters.push(eq(leaguesTable.mode, input.mode));
    if (input.division) filters.push(eq(leaguesTable.division, input.division));
    if (input.statuses.length > 0) filters.push(inArray(leaguesTable.status, [...input.statuses]));
    // Cursor por `(firstRoundStartsAt, id)` descendente: el listado no se saltea filas aunque
    // se cree una liga entre dos páginas.
    if (input.cursor) {
      const [startsAtRaw, id] = input.cursor.split('~');
      const startsAt = new Date(Number(startsAtRaw));
      if (id && !Number.isNaN(startsAt.getTime())) {
        filters.push(
          or(
            lt(leaguesTable.firstRoundStartsAt, startsAt),
            and(eq(leaguesTable.firstRoundStartsAt, startsAt), lt(leaguesTable.id, id)),
          )!,
        );
      }
    }
    return (await this.db
      .select()
      .from(leaguesTable)
      .where(filters.length > 0 ? and(...filters) : undefined)
      .orderBy(desc(leaguesTable.firstRoundStartsAt), desc(leaguesTable.id))
      .limit(input.limit)) as LeagueRow[];
  }

  /** Ligas activas que una cuenta organiza; alimenta el tope anti-abuso. */
  async countActiveByCreator(createdBy: string, tx?: AppTransaction): Promise<number> {
    const [row] = await this.exec(tx)
      .select({ total: count() })
      .from(leaguesTable)
      .where(
        and(
          eq(leaguesTable.createdBy, createdBy),
          inArray(leaguesTable.status, ['REGISTRATION', 'ACTIVE', 'CLOSING', 'DRAFT']),
        ),
      );
    return Number(row?.total ?? 0);
  }

  /** Ligas que comparten división y temporada (para la escalera y la validación de unicidad). */
  async findSameDivisionSeason(
    input: {
      readonly mode: LeagueMode;
      readonly division: LeagueDivision;
      readonly seasonLabel: string;
    },
    tx?: AppTransaction,
  ): Promise<LeagueRow | null> {
    const [row] = await this.exec(tx)
      .select()
      .from(leaguesTable)
      .where(
        and(
          eq(leaguesTable.mode, input.mode),
          eq(leaguesTable.division, input.division),
          eq(leaguesTable.seasonLabel, input.seasonLabel),
          ne(leaguesTable.status, 'CANCELLED'),
        ),
      )
      .limit(1);
    return (row as LeagueRow | undefined) ?? null;
  }

  // ------------------------------------------------------------ participantes

  async listParticipants(leagueId: string, tx?: AppTransaction): Promise<LeagueParticipantRow[]> {
    return (await this.exec(tx)
      .select()
      .from(leagueParticipantsTable)
      .where(eq(leagueParticipantsTable.leagueId, leagueId))
      .orderBy(asc(leagueParticipantsTable.seed))) as LeagueParticipantRow[];
  }

  async findParticipant(
    leagueId: string,
    userId: string,
    tx?: AppTransaction,
  ): Promise<LeagueParticipantRow | null> {
    const [row] = await this.exec(tx)
      .select()
      .from(leagueParticipantsTable)
      .where(
        and(
          eq(leagueParticipantsTable.leagueId, leagueId),
          eq(leagueParticipantsTable.userId, userId),
        ),
      )
      .limit(1);
    return (row as LeagueParticipantRow | undefined) ?? null;
  }

  /** Siguiente número de inscripción. Se llama dentro del cerrojo de la liga. */
  async nextSeed(tx: AppTransaction, leagueId: string): Promise<number> {
    const [row] = await tx
      .select({ max: sql<number>`COALESCE(MAX(${leagueParticipantsTable.seed}), 0)` })
      .from(leagueParticipantsTable)
      .where(eq(leagueParticipantsTable.leagueId, leagueId));
    return Number(row?.max ?? 0) + 1;
  }

  async countActiveParticipants(leagueId: string, tx?: AppTransaction): Promise<number> {
    const [row] = await this.exec(tx)
      .select({ total: count() })
      .from(leagueParticipantsTable)
      .where(
        and(
          eq(leagueParticipantsTable.leagueId, leagueId),
          inArray(leagueParticipantsTable.status, ['REGISTERED', 'ACTIVE']),
        ),
      );
    return Number(row?.total ?? 0);
  }

  async upsertParticipant(
    tx: AppTransaction,
    values: typeof leagueParticipantsTable.$inferInsert,
  ): Promise<LeagueParticipantRow> {
    const [row] = await tx
      .insert(leagueParticipantsTable)
      .values(values)
      .onConflictDoUpdate({
        target: [leagueParticipantsTable.leagueId, leagueParticipantsTable.userId],
        // Reinscribirse reutiliza la fila y conserva el `seed`: el número de inscripción no
        // cambia porque alguien se fue y volvió.
        set: { status: 'ACTIVE', withdrawnAt: null, updatedAt: new Date() },
      })
      .returning();
    return row as LeagueParticipantRow;
  }

  async setParticipantStatus(
    tx: AppTransaction,
    leagueId: string,
    userId: string,
    status: LeagueParticipantRow['status'],
    now: Date,
  ): Promise<void> {
    await tx
      .update(leagueParticipantsTable)
      .set({
        status,
        updatedAt: now,
        withdrawnAt: status === 'WITHDRAWN' ? now : null,
      })
      .where(
        and(
          eq(leagueParticipantsTable.leagueId, leagueId),
          eq(leagueParticipantsTable.userId, userId),
        ),
      );
  }

  async nicknamesFor(
    userIds: readonly string[],
    tx?: AppTransaction,
  ): Promise<Map<string, string>> {
    if (userIds.length === 0) return new Map();
    const rows = await this.exec(tx)
      .select({ id: usersTable.id, nickname: usersTable.nickname })
      .from(usersTable)
      .where(inArray(usersTable.id, [...new Set(userIds)]));
    return new Map(rows.map((row) => [row.id, row.nickname]));
  }

  // ---------------------------------------------------------------- jornadas

  async listRounds(leagueId: string, tx?: AppTransaction): Promise<LeagueRoundRow[]> {
    return (await this.exec(tx)
      .select()
      .from(leagueRoundsTable)
      .where(eq(leagueRoundsTable.leagueId, leagueId))
      .orderBy(asc(leagueRoundsTable.number))) as LeagueRoundRow[];
  }

  async insertRound(
    tx: AppTransaction,
    values: typeof leagueRoundsTable.$inferInsert,
  ): Promise<LeagueRoundRow> {
    const [row] = await tx.insert(leagueRoundsTable).values(values).returning();
    return row as LeagueRoundRow;
  }

  async lockRound(tx: AppTransaction, roundId: string): Promise<LeagueRoundRow | null> {
    const [row] = await tx
      .select()
      .from(leagueRoundsTable)
      .where(eq(leagueRoundsTable.id, roundId))
      .for('update')
      .limit(1);
    return (row as LeagueRoundRow | undefined) ?? null;
  }

  async updateRound(
    tx: AppTransaction,
    roundId: string,
    patch: Partial<typeof leagueRoundsTable.$inferInsert>,
  ): Promise<void> {
    await tx.update(leagueRoundsTable).set(patch).where(eq(leagueRoundsTable.id, roundId));
  }

  /**
   * Marca como `READY` las partidas pendientes de una jornada que se acaba de abrir.
   *
   * `SCHEDULED` significa «todavía no se puede jugar» (la jornada no abrió); `READY` significa
   * «se puede jugar y falta la sala». Es la misma distinción que usan los cruces de torneo.
   */
  async markRoundMatchesReady(tx: AppTransaction, roundId: string): Promise<number> {
    const rows = await tx
      .update(leagueMatchesTable)
      .set({ status: 'READY', updatedAt: new Date() })
      .where(
        and(eq(leagueMatchesTable.roundId, roundId), eq(leagueMatchesTable.status, 'SCHEDULED')),
      )
      .returning({ id: leagueMatchesTable.id });
    return rows.length;
  }

  /** Jornadas que ya deberían estar abiertas y todavía no. */
  async roundsToOpen(now: Date): Promise<LeagueRoundRow[]> {
    return (await this.db
      .select()
      .from(leagueRoundsTable)
      .where(and(eq(leagueRoundsTable.status, 'SCHEDULED'), lte(leagueRoundsTable.startsAt, now)))
      .orderBy(asc(leagueRoundsTable.startsAt))) as LeagueRoundRow[];
  }

  /** Jornadas abiertas cuyo plazo venció: se cierran y se definen sus partidas. */
  async roundsToClose(now: Date): Promise<LeagueRoundRow[]> {
    return (await this.db
      .select()
      .from(leagueRoundsTable)
      .where(and(eq(leagueRoundsTable.status, 'OPEN'), lte(leagueRoundsTable.deadlineAt, now)))
      .orderBy(asc(leagueRoundsTable.deadlineAt))) as LeagueRoundRow[];
  }

  /** Ligas cuya temporada venció y todavía no se cerraron. */
  async leaguesToClose(now: Date): Promise<LeagueRow[]> {
    return (await this.db
      .select()
      .from(leaguesTable)
      .where(and(eq(leaguesTable.status, 'ACTIVE'), lte(leaguesTable.endsAt, now)))) as LeagueRow[];
  }

  // ---------------------------------------------------------------- partidas

  async listMatches(leagueId: string, tx?: AppTransaction): Promise<LeagueMatchRow[]> {
    return (await this.exec(tx)
      .select()
      .from(leagueMatchesTable)
      .where(eq(leagueMatchesTable.leagueId, leagueId))
      .orderBy(
        asc(leagueMatchesTable.roundNumber),
        asc(leagueMatchesTable.createdAt),
      )) as LeagueMatchRow[];
  }

  async listMatchesForUser(leagueId: string, userId: string): Promise<LeagueMatchRow[]> {
    return (await this.db
      .select()
      .from(leagueMatchesTable)
      .where(
        and(
          eq(leagueMatchesTable.leagueId, leagueId),
          or(eq(leagueMatchesTable.homeUserId, userId), eq(leagueMatchesTable.awayUserId, userId)),
        ),
      )
      .orderBy(
        asc(leagueMatchesTable.roundNumber),
        asc(leagueMatchesTable.createdAt),
      )) as LeagueMatchRow[];
  }

  async findMatchById(id: string, tx?: AppTransaction): Promise<LeagueMatchRow | null> {
    const [row] = await this.exec(tx)
      .select()
      .from(leagueMatchesTable)
      .where(eq(leagueMatchesTable.id, id))
      .limit(1);
    return (row as LeagueMatchRow | undefined) ?? null;
  }

  async lockMatch(tx: AppTransaction, id: string): Promise<LeagueMatchRow | null> {
    const [row] = await tx
      .select()
      .from(leagueMatchesTable)
      .where(eq(leagueMatchesTable.id, id))
      .for('update')
      .limit(1);
    return (row as LeagueMatchRow | undefined) ?? null;
  }

  async findMatchByRoomId(roomId: string): Promise<LeagueMatchRow | null> {
    const [row] = await this.db
      .select()
      .from(leagueMatchesTable)
      .where(eq(leagueMatchesTable.roomId, roomId))
      .limit(1);
    return (row as LeagueMatchRow | undefined) ?? null;
  }

  async insertMatch(
    tx: AppTransaction,
    values: typeof leagueMatchesTable.$inferInsert,
  ): Promise<LeagueMatchRow> {
    const [row] = await tx.insert(leagueMatchesTable).values(values).returning();
    return row as LeagueMatchRow;
  }

  async updateMatch(
    tx: AppTransaction,
    id: string,
    patch: Partial<typeof leagueMatchesTable.$inferInsert>,
  ): Promise<void> {
    await tx
      .update(leagueMatchesTable)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(leagueMatchesTable.id, id));
  }

  /** Partidas pendientes de una liga cuya fecha límite ya pasó (para el cierre de jornada). */
  async pendingMatchesPastDeadline(
    leagueId: string,
    now: Date,
    tx?: AppTransaction,
  ): Promise<LeagueMatchRow[]> {
    return (await this.exec(tx)
      .select()
      .from(leagueMatchesTable)
      .where(
        and(
          eq(leagueMatchesTable.leagueId, leagueId),
          inArray(leagueMatchesTable.status, ['SCHEDULED', 'READY']),
          or(isNull(leagueMatchesTable.deadlineAt), lte(leagueMatchesTable.deadlineAt, now)),
        ),
      )) as LeagueMatchRow[];
  }

  /**
   * Partidas listas (`READY`) todavía sin sala. Es lo que aprovisiona el barrido y, si algo
   * falla, se reintenta: la sala se crea después de confirmar la transacción, igual que en
   * torneos.
   */
  async matchesReadyWithoutRoom(leagueId: string, tx?: AppTransaction): Promise<LeagueMatchRow[]> {
    return (await this.exec(tx)
      .select()
      .from(leagueMatchesTable)
      .where(
        and(
          eq(leagueMatchesTable.leagueId, leagueId),
          eq(leagueMatchesTable.status, 'READY'),
          isNull(leagueMatchesTable.roomId),
        ),
      )
      .orderBy(asc(leagueMatchesTable.roundNumber))) as LeagueMatchRow[];
  }

  /** Partidas de una jornada, para saber si ya terminaron todas. */
  async countPendingInRound(roundId: string): Promise<number> {
    const [row] = await this.db
      .select({ total: count() })
      .from(leagueMatchesTable)
      .where(
        and(
          eq(leagueMatchesTable.roundId, roundId),
          inArray(leagueMatchesTable.status, ['SCHEDULED', 'READY', 'IN_PROGRESS']),
        ),
      );
    return Number(row?.total ?? 0);
  }

  async setMatchRoom(tx: AppTransaction, matchId: string, roomId: string): Promise<void> {
    await tx
      .update(leagueMatchesTable)
      .set({ roomId, updatedAt: new Date() })
      .where(eq(leagueMatchesTable.id, matchId));
  }

  // ----------------------------------------------------------- reprogramación

  async countReschedules(matchId: string, tx?: AppTransaction): Promise<number> {
    const [row] = await this.exec(tx)
      .select({ total: count() })
      .from(leagueReschedulesTable)
      .where(eq(leagueReschedulesTable.matchId, matchId));
    return Number(row?.total ?? 0);
  }

  async insertReschedule(
    tx: AppTransaction,
    values: typeof leagueReschedulesTable.$inferInsert,
  ): Promise<void> {
    await tx.insert(leagueReschedulesTable).values(values);
  }

  // ---------------------------------------------------------------- premios

  async listPrizes(
    leagueId: string,
    tx?: AppTransaction,
  ): Promise<Array<typeof leaguePrizesTable.$inferSelect>> {
    return await this.exec(tx)
      .select()
      .from(leaguePrizesTable)
      .where(eq(leaguePrizesTable.leagueId, leagueId))
      .orderBy(asc(leaguePrizesTable.position));
  }

  /** `nameKey` de los cosméticos de una lista de premios: es lo que la web muestra como nombre. */
  async cosmeticNamesFor(
    cosmeticIds: readonly string[],
    tx?: AppTransaction,
  ): Promise<Map<string, string>> {
    if (cosmeticIds.length === 0) return new Map();
    const rows = await this.exec(tx)
      .select({ id: cosmeticCatalogTable.id, nameKey: cosmeticCatalogTable.nameKey })
      .from(cosmeticCatalogTable)
      .where(inArray(cosmeticCatalogTable.id, [...cosmeticIds]));
    return new Map(rows.map((row) => [row.id, row.nameKey]));
  }

  async insertPrize(
    tx: AppTransaction,
    values: typeof leaguePrizesTable.$inferInsert,
  ): Promise<void> {
    await tx.insert(leaguePrizesTable).values(values);
  }

  // ---------------------------------------------------------------- cierres

  async findClosure(leagueId: string, tx?: AppTransaction): Promise<LeagueClosureRow | null> {
    const [row] = await this.exec(tx)
      .select()
      .from(leagueClosuresTable)
      .where(eq(leagueClosuresTable.leagueId, leagueId))
      .limit(1);
    return (row as LeagueClosureRow | undefined) ?? null;
  }

  async insertClosure(
    tx: AppTransaction,
    values: typeof leagueClosuresTable.$inferInsert,
  ): Promise<LeagueClosureRow | null> {
    const [row] = await tx
      .insert(leagueClosuresTable)
      .values(values)
      .onConflictDoNothing({ target: [leagueClosuresTable.leagueId] })
      .returning();
    return (row as LeagueClosureRow | undefined) ?? null;
  }

  async insertAward(
    tx: AppTransaction,
    values: typeof leaguePrizeAwardsTable.$inferInsert,
  ): Promise<typeof leaguePrizeAwardsTable.$inferSelect | null> {
    const [row] = await tx
      .insert(leaguePrizeAwardsTable)
      .values(values)
      .onConflictDoNothing({
        target: [
          leaguePrizeAwardsTable.leagueId,
          leaguePrizeAwardsTable.position,
          leaguePrizeAwardsTable.userId,
        ],
      })
      .returning();
    return row ?? null;
  }

  async insertMovement(
    tx: AppTransaction,
    values: typeof leagueMovementsTable.$inferInsert,
  ): Promise<void> {
    await tx
      .insert(leagueMovementsTable)
      .values(values)
      .onConflictDoNothing({
        target: [leagueMovementsTable.leagueId, leagueMovementsTable.userId],
      });
  }

  async listMovements(
    leagueId: string,
    tx?: AppTransaction,
  ): Promise<Array<typeof leagueMovementsTable.$inferSelect>> {
    return await this.exec(tx)
      .select()
      .from(leagueMovementsTable)
      .where(eq(leagueMovementsTable.leagueId, leagueId));
  }

  /** División vigente de una persona en un modo: el último movimiento aplicado la define. */
  async currentDivisionFor(userId: string, mode: LeagueMode): Promise<LeagueDivision | null> {
    const [row] = await this.db
      .select({ toDivision: leagueMovementsTable.toDivision })
      .from(leagueMovementsTable)
      .innerJoin(leaguesTable, eq(leaguesTable.id, leagueMovementsTable.leagueId))
      .where(and(eq(leagueMovementsTable.userId, userId), eq(leaguesTable.mode, mode)))
      .orderBy(desc(leagueMovementsTable.createdAt))
      .limit(1);
    return (row?.toDivision ?? null) as LeagueDivision | null;
  }

  /** Partidas de la liga cuyas dos personas están activas; alimenta la tabla. */
  async matchesForStandings(leagueId: string): Promise<LeagueMatchRow[]> {
    return (await this.db
      .select()
      .from(leagueMatchesTable)
      .where(
        and(
          eq(leagueMatchesTable.leagueId, leagueId),
          inArray(leagueMatchesTable.status, ['COMPLETED', 'FORFEITED']),
          gt(leagueMatchesTable.homeScore, -1),
        ),
      )
      .orderBy(asc(leagueMatchesTable.createdAt))) as LeagueMatchRow[];
  }
}
