import type { LeagueDivision, LeagueMode, LeagueStatus, RulesetCode } from '@truco/shared';
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { matchesTable, rulesetsTable } from './gameplay-governance.schema.js';
import { usersTable } from './identity.schema.js';
import { ratingSeasonsTable } from './gameplay-governance.schema.js';

/**
 * Ligas por temporada (M10b, entrega 2).
 *
 * Invariantes que se hacen cumplir en la base, no sólo en el servicio:
 * - **Una liga no se paga.** No existe columna de precio, entrada ni inscripción con costo.
 * - Los premios son filas con monedas virtuales o un cosmético; nunca dinero.
 * - Un jugador está en **una sola** división por modo y temporada: el único
 *   `(mode, season_label, division_key, user_id)` de `league_participants` lo garantiza.
 * - Estados acotados por `CHECK`; las transiciones las valida el servicio.
 * - Cierres idempotentes: `league_closures` tiene único `(league_id)` y
 *   `league_prize_awards` único `(league_id, position, user_id)`, así un reintento no duplica.
 *
 * `3v3` no aparece en `mode`: el truco de 6 es social por el ADR-033 y una liga es una
 * competencia por puntaje. El `CHECK` lo impone aunque alguien saltee el contrato Zod.
 */

export const leaguesTable = pgTable(
  'leagues',
  {
    id: uuid('id').primaryKey(),
    name: varchar('name', { length: 60 }).notNull(),
    mode: varchar('mode', { length: 8 }).$type<LeagueMode>().notNull(),
    division: varchar('division', { length: 16 }).$type<LeagueDivision>().notNull(),
    status: varchar('status', { length: 16 }).$type<LeagueStatus>().notNull().default('DRAFT'),
    official: boolean('official').notNull().default(false),
    /** Etiqueta de la temporada; agrupa ligas de la misma temporada en distintas divisiones. */
    seasonLabel: varchar('season_label', { length: 60 }).notNull(),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
    /**
     * Temporada de rating con la que se siembran los desempates de ingreso, si existe. Las
     * ligas no tocan Glicko-2 (ADR-035): la referencia es sólo para ordenar inscripciones.
     */
    ratingSeasonId: uuid('rating_season_id').references(() => ratingSeasonsTable.id, {
      onDelete: 'set null',
    }),
    rulesetId: uuid('ruleset_id')
      .notNull()
      .references(() => rulesetsTable.id),
    rulesetCode: varchar('ruleset_code', { length: 64 }).$type<RulesetCode>().notNull(),
    targetScore: integer('target_score').notNull(),
    florEnabled: boolean('flor_enabled').notNull().default(true),
    turnTimeoutMs: integer('turn_timeout_ms').notNull().default(25_000),
    /** Formato del calendario: `ROUNDS` (jornadas) o `WINDOW` (ventana única). */
    scheduleFormat: varchar('schedule_format', { length: 16 })
      .$type<'ROUNDS' | 'WINDOW'>()
      .notNull()
      .default('ROUNDS'),
    /** Jornadas planificadas. En `WINDOW` es 1. */
    rounds: integer('rounds').notNull().default(1),
    daysBetweenRounds: integer('days_between_rounds').notNull().default(7),
    roundWindowHours: integer('round_window_hours').notNull().default(72),
    maxReschedulesPerMatch: integer('max_reschedules_per_match').notNull().default(2),
    rescheduleMinHoursBeforeDeadline: integer('reschedule_min_hours_before_deadline')
      .notNull()
      .default(12),
    rescheduleExtensionHours: integer('reschedule_extension_hours').notNull().default(48),
    /** Ascensos y descensos de esta división en esta temporada (ADR-035). */
    promotions: integer('promotions').notNull().default(0),
    relegations: integer('relegations').notNull().default(0),
    minMatchesToMove: integer('min_matches_to_move').notNull().default(1),
    capacity: integer('capacity').notNull(),
    registrationClosesAt: timestamp('registration_closes_at', { withTimezone: true }).notNull(),
    /** Primer día de juego; el calendario se arma sobre este instante. */
    firstRoundStartsAt: timestamp('first_round_starts_at', { withTimezone: true }).notNull(),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    cancelledReason: varchar('cancelled_reason', { length: 500 }),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => usersTable.id, { onDelete: 'restrict' }),
    version: integer('version').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      'leagues_status_chk',
      sql`${t.status} IN ('DRAFT','REGISTRATION','ACTIVE','CLOSING','FINISHED','CANCELLED')`,
    ),
    // Un torneo de 6 no tiene ligas (ADR-033). El CHECK lo impone, no sólo el contrato Zod.
    check('leagues_mode_chk', sql`${t.mode} IN ('1v1','2v2')`),
    check('leagues_division_chk', sql`${t.division} IN ('BRONCE','PLATA','ORO','PLATINO')`),
    check('leagues_schedule_format_chk', sql`${t.scheduleFormat} IN ('ROUNDS','WINDOW')`),
    check('leagues_capacity_chk', sql`${t.capacity} >= 2 AND ${t.capacity} <= 200`),
    check('leagues_target_score_chk', sql`${t.targetScore} >= 15 AND ${t.targetScore} <= 30`),
    check('leagues_rounds_chk', sql`${t.rounds} >= 1 AND ${t.rounds} <= 30`),
    check(
      'leagues_movement_chk',
      sql`${t.promotions} >= 0 AND ${t.promotions} <= 10 AND ${t.relegations} >= 0 AND ${t.relegations} <= 10`,
    ),
    check(
      'leagues_season_chk',
      sql`${t.endsAt} > ${t.startsAt} AND ${t.registrationClosesAt} >= ${t.createdAt}`,
    ),
    // Una liquidación no puede preceder al arranque: la tabla no tendría partidas.
    check('leagues_first_round_chk', sql`${t.firstRoundStartsAt} >= ${t.registrationClosesAt}`),
    // La liga de una división y temporada es única por modo: la tabla de la división no se
    // parte en dos ligas paralelas (ADR-035).
    uniqueIndex('leagues_division_season_uniq').on(t.mode, t.seasonLabel, t.division),
    index('leagues_status_start_idx').on(t.status, t.firstRoundStartsAt),
    index('leagues_mode_division_idx').on(t.mode, t.division, t.status),
    index('leagues_created_by_idx').on(t.createdBy, t.status),
  ],
);

/**
 * Inscripción a una liga. El número de inscripción (`seed`) es el último desempate de la
 * tabla, así que se asigna en orden de llegada con bloqueo de la liga.
 *
 * El único `(league_id, user_id)` impide reinscribirse creando una fila nueva: la baja pone
 * `status = 'WITHDRAWN'` y la vuelta reutiliza la misma fila conservando el `seed`.
 */
export const leagueParticipantsTable = pgTable(
  'league_participants',
  {
    id: uuid('id').primaryKey(),
    leagueId: uuid('league_id')
      .notNull()
      .references(() => leaguesTable.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => usersTable.id, { onDelete: 'cascade' }),
    seed: integer('seed').notNull(),
    status: varchar('status', { length: 16 })
      .$type<'REGISTERED' | 'ACTIVE' | 'WITHDRAWN' | 'DISQUALIFIED' | 'PROMOTED' | 'RELEGATED'>()
      .notNull()
      .default('REGISTERED'),
    /** División de origen al inscribirse, para reconstruir ascensos de temporadas pasadas. */
    joinedDivision: varchar('joined_division', { length: 16 }).$type<LeagueDivision>().notNull(),
    joinedAt: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow(),
    withdrawnAt: timestamp('withdrawn_at', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      'league_participants_status_chk',
      sql`${t.status} IN ('REGISTERED','ACTIVE','WITHDRAWN','DISQUALIFIED','PROMOTED','RELEGATED')`,
    ),
    uniqueIndex('league_participants_user_uniq').on(t.leagueId, t.userId),
    // Un número de inscripción no se repite dentro de la liga: es el último desempate.
    uniqueIndex('league_participants_seed_uniq').on(t.leagueId, t.seed),
    index('league_participants_user_idx').on(t.userId, t.status),
  ],
);

/** Jornada de una liga con su ventana. */
export const leagueRoundsTable = pgTable(
  'league_rounds',
  {
    id: uuid('id').primaryKey(),
    leagueId: uuid('league_id')
      .notNull()
      .references(() => leaguesTable.id, { onDelete: 'cascade' }),
    number: integer('number').notNull(),
    status: varchar('status', { length: 16 })
      .$type<'SCHEDULED' | 'OPEN' | 'CLOSED' | 'CANCELLED'>()
      .notNull()
      .default('SCHEDULED'),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    deadlineAt: timestamp('deadline_at', { withTimezone: true }).notNull(),
    /** Cierre de la jornada: idempotente, se marca una sola vez. */
    closedAt: timestamp('closed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      'league_rounds_status_chk',
      sql`${t.status} IN ('SCHEDULED','OPEN','CLOSED','CANCELLED')`,
    ),
    check('league_rounds_number_chk', sql`${t.number} >= 1 AND ${t.number} <= 30`),
    check('league_rounds_window_chk', sql`${t.deadlineAt} > ${t.startsAt}`),
    // Una jornada por número: el cierre no puede correr dos veces la misma.
    uniqueIndex('league_rounds_number_uniq').on(t.leagueId, t.number),
    index('league_rounds_status_starts_idx').on(t.status, t.startsAt),
    index('league_rounds_deadline_idx').on(t.status, t.deadlineAt),
  ],
);

/**
 * Partida de liga.
 *
 * `roundId` es `NULL` en el formato `WINDOW` (no hay jornadas numeradas: la ventana es la
 * liga misma). La sala se aprovisiona con el `provisioner` del lobby, nunca contra bots.
 */
export const leagueMatchesTable = pgTable(
  'league_matches',
  {
    id: uuid('id').primaryKey(),
    leagueId: uuid('league_id')
      .notNull()
      .references(() => leaguesTable.id, { onDelete: 'cascade' }),
    roundId: uuid('round_id').references(() => leagueRoundsTable.id, { onDelete: 'cascade' }),
    /** Número de jornada desnormalizado para leer la tabla sin un join más. */
    roundNumber: integer('round_number'),
    homeUserId: uuid('home_user_id')
      .notNull()
      .references(() => usersTable.id, { onDelete: 'cascade' }),
    awayUserId: uuid('away_user_id')
      .notNull()
      .references(() => usersTable.id, { onDelete: 'cascade' }),
    status: varchar('status', { length: 16 })
      .$type<'SCHEDULED' | 'READY' | 'IN_PROGRESS' | 'COMPLETED' | 'FORFEITED' | 'VOID'>()
      .notNull()
      .default('SCHEDULED'),
    winnerUserId: uuid('winner_user_id').references(() => usersTable.id, { onDelete: 'set null' }),
    homeScore: integer('home_score'),
    awayScore: integer('away_score'),
    forfeitReason: varchar('forfeit_reason', { length: 24 }).$type<
      'NO_SHOW' | 'DOUBLE_NO_SHOW' | 'ABANDON' | 'RESCHEDULED_EXPIRED' | 'DISQUALIFIED'
    >(),
    /** Sala real del aprovisionamiento de M4/M5a. */
    matchId: uuid('match_id').references(() => matchesTable.id, { onDelete: 'set null' }),
    roomId: uuid('room_id'),
    deadlineAt: timestamp('deadline_at', { withTimezone: true }),
    reschedulesUsed: integer('reschedules_used').notNull().default(0),
    /**
     * Quién no se presentó. En un doble ausente quedan los dos sin marcar (`NULL`) y el motivo
     * `DOUBLE_NO_SHOW` es el que dice que faltaron los dos.
     */
    noShowUserId: uuid('no_show_user_id').references(() => usersTable.id, { onDelete: 'set null' }),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    /** Idempotencia: una partida real resuelve este cruce una sola vez. */
    resolvedFromMatchId: uuid('resolved_from_match_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      'league_matches_status_chk',
      sql`${t.status} IN ('SCHEDULED','READY','IN_PROGRESS','COMPLETED','FORFEITED','VOID')`,
    ),
    check(
      'league_matches_forfeit_chk',
      sql`${t.forfeitReason} IS NULL OR ${t.forfeitReason} IN ('NO_SHOW','DOUBLE_NO_SHOW','ABANDON','RESCHEDULED_EXPIRED','DISQUALIFIED')`,
    ),
    // Nadie juega contra sí mismo: la base lo impide.
    check('league_matches_distinct_players_chk', sql`${t.homeUserId} <> ${t.awayUserId}`),
    /**
     * Coherencia del resultado.
     *
     * Una partida jugada (`COMPLETED`) tiene ganador y marcador. Una definida sin jugar
     * (`FORFEITED`) tiene motivo y **puede** no tener ganador: el doble ausente no tiene a nadie
     * que gane (ADR-035), y ése es justamente el caso que no se puede inventar. Una pendiente no
     * tiene ganador ni motivo todavía.
     */
    check(
      'league_matches_result_chk',
      sql`(${t.status} IN ('SCHEDULED','READY','IN_PROGRESS','VOID')
             AND ${t.winnerUserId} IS NULL AND ${t.forfeitReason} IS NULL)
          OR (${t.status} = 'COMPLETED'
             AND ${t.winnerUserId} IS NOT NULL AND ${t.homeScore} IS NOT NULL AND ${t.awayScore} IS NOT NULL
             AND ${t.forfeitReason} IS NULL)
          OR (${t.status} = 'FORFEITED' AND ${t.forfeitReason} IS NOT NULL)`,
    ),
    // Un mismo par no juega dos veces la misma jornada (una liga no repite el cruce).
    uniqueIndex('league_matches_round_pair_uniq')
      .on(t.leagueId, t.roundNumber, t.homeUserId, t.awayUserId)
      .where(sql`${t.roundNumber} IS NOT NULL`),
    // La misma partida real no resuelve dos cruces.
    uniqueIndex('league_matches_resolved_uniq')
      .on(t.leagueId, t.resolvedFromMatchId)
      .where(sql`${t.resolvedFromMatchId} IS NOT NULL`),
    index('league_matches_league_round_idx').on(t.leagueId, t.roundNumber),
    index('league_matches_home_idx').on(t.homeUserId, t.status),
    index('league_matches_away_idx').on(t.awayUserId, t.status),
    index('league_matches_deadline_idx').on(t.status, t.deadlineAt),
  ],
);

/** Reprogramación pedida por un jugador, con su motivo (auditable). */
export const leagueReschedulesTable = pgTable(
  'league_reschedules',
  {
    id: uuid('id').primaryKey(),
    matchId: uuid('match_id')
      .notNull()
      .references(() => leagueMatchesTable.id, { onDelete: 'cascade' }),
    requestedBy: uuid('requested_by')
      .notNull()
      .references(() => usersTable.id, { onDelete: 'cascade' }),
    reason: varchar('reason', { length: 300 }).notNull(),
    previousDeadlineAt: timestamp('previous_deadline_at', { withTimezone: true }).notNull(),
    newDeadlineAt: timestamp('new_deadline_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('league_reschedules_reason_chk', sql`length(${t.reason}) >= 5`),
    check('league_reschedules_extends_chk', sql`${t.newDeadlineAt} > ${t.previousDeadlineAt}`),
    index('league_reschedules_match_idx').on(t.matchId, t.createdAt),
  ],
);

/**
 * Cierre de temporada ya aplicado.
 *
 * Es la marca de idempotencia del cierre completo: el servicio inserta esta fila **dentro** de
 * la transacción del cierre, con único `(league_id)`. Un reintento encuentra la fila y devuelve
 * el mismo resultado; un cierre que falló a mitad no deja la fila y por eso se puede reintentar
 * desde cero. `standings` guarda la tabla congelada: la de la temporada cerrada no cambia
 * aunque después se corrija una partida.
 */
export const leagueClosuresTable = pgTable(
  'league_closures',
  {
    id: uuid('id').primaryKey(),
    leagueId: uuid('league_id')
      .notNull()
      .references(() => leaguesTable.id, { onDelete: 'cascade' }),
    closedAt: timestamp('closed_at', { withTimezone: true }).notNull(),
    /** Tabla congelada al cierre, con el desempate que decidió cada posición. */
    standings: jsonb('standings').notNull(),
    championUserId: uuid('champion_user_id').references(() => usersTable.id, {
      onDelete: 'set null',
    }),
    promotedUserIds: jsonb('promoted_user_ids').notNull().default([]),
    relegatedUserIds: jsonb('relegated_user_ids').notNull().default([]),
    /** Cuántas partidas se definieron por ausencia en el cierre. */
    forfeitedMatches: integer('forfeited_matches').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('league_closures_league_uniq').on(t.leagueId),
    index('league_closures_closed_idx').on(t.closedAt),
  ],
);

/**
 * Premios entregados. `wallet_transactions` guarda el asiento contable; esta tabla evita
 * volver a intentarlo y da trazabilidad al organizador. Único `(liga, posición, persona)`:
 * un reintento del cierre no acredita dos veces.
 */
export const leaguePrizeAwardsTable = pgTable(
  'league_prize_awards',
  {
    id: uuid('id').primaryKey(),
    leagueId: uuid('league_id')
      .notNull()
      .references(() => leaguesTable.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => usersTable.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    coins: integer('coins').notNull().default(0),
    cosmeticId: varchar('cosmetic_id', { length: 64 }),
    walletTransactionId: uuid('wallet_transaction_id'),
    awardedAt: timestamp('awarded_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('league_prize_awards_position_uniq').on(t.leagueId, t.position, t.userId),
    check('league_prize_awards_position_chk', sql`${t.position} >= 1 AND ${t.position} <= 200`),
    check('league_prize_awards_nonempty_chk', sql`${t.coins} > 0 OR ${t.cosmeticId} IS NOT NULL`),
    index('league_prize_awards_user_idx').on(t.userId, t.awardedAt),
  ],
);

/** Premios configurados al crear la liga: sólo monedas virtuales o cosméticos. */
export const leaguePrizesTable = pgTable(
  'league_prizes',
  {
    id: uuid('id').primaryKey(),
    leagueId: uuid('league_id')
      .notNull()
      .references(() => leaguesTable.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    coins: integer('coins').notNull().default(0),
    cosmeticId: varchar('cosmetic_id', { length: 64 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('league_prizes_position_chk', sql`${t.position} >= 1 AND ${t.position} <= 200`),
    check('league_prizes_amount_chk', sql`${t.coins} >= 0 AND ${t.coins} <= 100000`),
    check('league_prizes_nonempty_chk', sql`${t.coins} > 0 OR ${t.cosmeticId} IS NOT NULL`),
    uniqueIndex('league_prizes_position_uniq').on(t.leagueId, t.position),
  ],
);

/**
 * Ascenso o descenso aplicado. Es la constancia histórica de la escalera: permite responder
 * «en qué división estaba esta persona en esta temporada» sin recalcular tablas viejas.
 */
export const leagueMovementsTable = pgTable(
  'league_movements',
  {
    id: uuid('id').primaryKey(),
    leagueId: uuid('league_id')
      .notNull()
      .references(() => leaguesTable.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => usersTable.id, { onDelete: 'cascade' }),
    kind: varchar('kind', { length: 16 })
      .$type<'PROMOTION' | 'RELEGATION' | 'TIE_AT_CUT'>()
      .notNull(),
    fromDivision: varchar('from_division', { length: 16 }).$type<LeagueDivision>().notNull(),
    toDivision: varchar('to_division', { length: 16 }).$type<LeagueDivision>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('league_movements_kind_chk', sql`${t.kind} IN ('PROMOTION','RELEGATION','TIE_AT_CUT')`),
    uniqueIndex('league_movements_user_uniq').on(t.leagueId, t.userId),
    index('league_movements_user_idx').on(t.userId, t.createdAt),
  ],
);
