import type { GameMode, RulesetCode, TournamentFormat, TournamentStatus } from '@truco/shared';
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { matchesTable, rulesetsTable } from './gameplay-governance.schema.js';
import { usersTable } from './identity.schema.js';

/**
 * Torneos (M10a).
 *
 * Invariantes que se hacen cumplir en la base, no sólo en el servicio:
 * - Un torneo no tiene precio de inscripción: no existe columna de costo ni de pago.
 * - Los premios son filas con monedas virtuales o un cosmético; el `CHECK` impide
 *   premios vacíos y el servicio sólo acredita por `wallet_transactions`.
 * - Estados acotados por `CHECK`; las transiciones las valida el servicio.
 * - `join_code` es único entre torneos privados.
 */

export const tournamentsTable = pgTable(
  'tournaments',
  {
    id: uuid('id').primaryKey(),
    name: varchar('name', { length: 60 }).notNull(),
    format: varchar('format', { length: 24 }).$type<TournamentFormat>().notNull(),
    visibility: varchar('visibility', { length: 16 })
      .$type<'OFFICIAL' | 'PRIVATE'>()
      .notNull()
      .default('PRIVATE'),
    status: varchar('status', { length: 16 }).$type<TournamentStatus>().notNull().default('DRAFT'),
    mode: varchar('mode', { length: 8 }).$type<GameMode>().notNull(),
    rulesetId: uuid('ruleset_id')
      .notNull()
      .references(() => rulesetsTable.id),
    rulesetCode: varchar('ruleset_code', { length: 64 }).$type<RulesetCode>().notNull(),
    targetScore: integer('target_score').notNull(),
    florEnabled: boolean('flor_enabled').notNull().default(true),
    turnTimeoutMs: integer('turn_timeout_ms').notNull().default(25_000),
    /** 2..64. No hace falta potencia de 2: el cuadro se completa con byes. */
    capacity: integer('capacity').notNull(),
    /** Código de acceso de los torneos privados; `NULL` en los oficiales. */
    joinCode: varchar('join_code', { length: 12 }),
    /** Plazo para presentarse a una partida antes de la derrota por incomparecencia. */
    noShowMinutes: integer('no_show_minutes').notNull().default(10),
    registrationClosesAt: timestamp('registration_closes_at', { withTimezone: true }).notNull(),
    checkInClosesAt: timestamp('check_in_closes_at', { withTimezone: true }).notNull(),
    startsAt: timestamp('starts_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    cancelledReason: varchar('cancelled_reason', { length: 500 }),
    /** Límite de torneos privados activos por cuenta; se valida en el servicio. */
    createdBy: uuid('created_by')
      .notNull()
      .references(() => usersTable.id, { onDelete: 'restrict' }),
    /** Versión optimista para acciones administrativas concurrentes. */
    version: integer('version').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      'tournaments_status_chk',
      sql`${t.status} IN ('DRAFT','REGISTRATION','CHECK_IN','IN_PROGRESS','FINISHED','CANCELLED')`,
    ),
    check(
      'tournaments_format_chk',
      sql`${t.format} IN ('SINGLE_ELIMINATION','DOUBLE_ELIMINATION')`,
    ),
    check('tournaments_visibility_chk', sql`${t.visibility} IN ('OFFICIAL','PRIVATE')`),
    check('tournaments_capacity_chk', sql`${t.capacity} >= 2 AND ${t.capacity} <= 64`),
    check('tournaments_target_score_chk', sql`${t.targetScore} >= 15 AND ${t.targetScore} <= 30`),
    check('tournaments_no_show_chk', sql`${t.noShowMinutes} >= 1 AND ${t.noShowMinutes} <= 60`),
    // Un torneo privado debe tener código; uno oficial no lo necesita.
    check(
      'tournaments_join_code_chk',
      sql`(${t.visibility} = 'PRIVATE' AND ${t.joinCode} IS NOT NULL) OR (${t.visibility} = 'OFFICIAL')`,
    ),
    uniqueIndex('tournaments_join_code_uniq')
      .on(t.joinCode)
      .where(sql`${t.joinCode} IS NOT NULL`),
    index('tournaments_status_registration_idx').on(t.status, t.registrationClosesAt),
    index('tournaments_status_checkin_idx').on(t.status, t.checkInClosesAt),
    index('tournaments_visibility_status_idx').on(t.visibility, t.status, t.createdAt),
    index('tournaments_created_by_idx').on(t.createdBy, t.status),
  ],
);

export const tournamentParticipantsTable = pgTable(
  'tournament_participants',
  {
    id: uuid('id').primaryKey(),
    tournamentId: uuid('tournament_id')
      .notNull()
      .references(() => tournamentsTable.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => usersTable.id, { onDelete: 'cascade' }),
    status: varchar('status', { length: 16 })
      .$type<
        | 'REGISTERED'
        | 'CHECKED_IN'
        | 'NO_SHOW'
        | 'WITHDRAWN'
        | 'DISQUALIFIED'
        | 'ELIMINATED'
        | 'WINNER'
      >()
      .notNull()
      .default('REGISTERED'),
    /** Semilla 1..N asignada al armar la llave; `NULL` hasta que el torneo arranca. */
    seed: integer('seed'),
    /** Rating con el que se sembró, para poder reconstruir y auditar la llave. */
    seedRating: integer('seed_rating'),
    registeredAt: timestamp('registered_at', { withTimezone: true }).notNull().defaultNow(),
    checkedInAt: timestamp('checked_in_at', { withTimezone: true }),
    withdrawnAt: timestamp('withdrawn_at', { withTimezone: true }),
  },
  (t) => [
    check(
      'tournament_participants_status_chk',
      sql`${t.status} IN ('REGISTERED','CHECKED_IN','NO_SHOW','WITHDRAWN','DISQUALIFIED','ELIMINATED','WINNER')`,
    ),
    // Nadie se inscribe dos veces al mismo torneo: lo garantiza la base, no la app.
    uniqueIndex('tournament_participants_unique').on(t.tournamentId, t.userId),
    index('tournament_participants_tournament_status_idx').on(t.tournamentId, t.status),
    index('tournament_participants_user_idx').on(t.userId, t.registeredAt),
  ],
);

export const tournamentMatchesTable = pgTable(
  'tournament_matches',
  {
    id: uuid('id').primaryKey(),
    tournamentId: uuid('tournament_id')
      .notNull()
      .references(() => tournamentsTable.id, { onDelete: 'cascade' }),
    bracket: varchar('bracket', { length: 12 })
      .$type<'WINNERS' | 'LOSERS' | 'GRAND_FINAL'>()
      .notNull()
      .default('WINNERS'),
    round: integer('round').notNull(),
    slot: integer('slot').notNull(),
    homeUserId: uuid('home_user_id').references(() => usersTable.id, { onDelete: 'set null' }),
    awayUserId: uuid('away_user_id').references(() => usersTable.id, { onDelete: 'set null' }),
    /** Semillas de cada lado para reconstruir la llave y explicar los byes. */
    homeSeed: integer('home_seed'),
    awaySeed: integer('away_seed'),
    status: varchar('status', { length: 16 })
      .$type<'SCHEDULED' | 'READY' | 'IN_PROGRESS' | 'COMPLETED' | 'FORFEITED'>()
      .notNull()
      .default('SCHEDULED'),
    /** `NULL` en un cruce de bye o cuando no hubo ganador (doble incomparecencia). */
    winnerUserId: uuid('winner_user_id').references(() => usersTable.id, { onDelete: 'set null' }),
    loserUserId: uuid('loser_user_id').references(() => usersTable.id, { onDelete: 'set null' }),
    forfeitReason: varchar('forfeit_reason', { length: 16 }).$type<
      'NO_SHOW' | 'ABANDON' | 'DISQUALIFIED'
    >(),
    /** Partida real creada por el aprovisionamiento de salas existente. */
    matchId: uuid('match_id').references(() => matchesTable.id, { onDelete: 'set null' }),
    /** Sala de juego (`room_id`) usada para entrar a la partida. */
    roomId: uuid('room_id'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    /**
     * Reloj límite para presentarse. Es la base del manejo de incomparecencia:
     * pasado este instante sin partida iniciada, el servicio define el cruce.
     */
    deadlineAt: timestamp('deadline_at', { withTimezone: true }),
    /** Idempotencia del avance: la partida del torneo sólo se resuelve una vez. */
    resolvedFromMatchId: uuid('resolved_from_match_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      'tournament_matches_status_chk',
      sql`${t.status} IN ('SCHEDULED','READY','IN_PROGRESS','COMPLETED','FORFEITED')`,
    ),
    check(
      'tournament_matches_bracket_chk',
      sql`${t.bracket} IN ('WINNERS','LOSERS','GRAND_FINAL')`,
    ),
    uniqueIndex('tournament_matches_slot_uniq').on(t.tournamentId, t.bracket, t.round, t.slot),
    // Un mismo cruce no se resuelve dos veces por la misma partida.
    uniqueIndex('tournament_matches_resolved_uniq')
      .on(t.tournamentId, t.resolvedFromMatchId)
      .where(sql`${t.resolvedFromMatchId} IS NOT NULL`),
    index('tournament_matches_tournament_round_idx').on(t.tournamentId, t.bracket, t.round),
    index('tournament_matches_user_idx').on(t.homeUserId, t.awayUserId),
    index('tournament_matches_deadline_idx').on(t.status, t.deadlineAt),
  ],
);

export const tournamentPrizesTable = pgTable(
  'tournament_prizes',
  {
    id: uuid('id').primaryKey(),
    tournamentId: uuid('tournament_id')
      .notNull()
      .references(() => tournamentsTable.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    /** Sólo monedas virtuales simbólicas: nunca dinero ni valor económico. */
    coins: integer('coins').notNull().default(0),
    cosmeticId: varchar('cosmetic_id', { length: 64 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('tournament_prizes_position_chk', sql`${t.position} >= 1 AND ${t.position} <= 64`),
    check('tournament_prizes_amount_chk', sql`${t.coins} >= 0 AND ${t.coins} <= 100000`),
    // Un premio debe entregar algo; tampoco se permite un premio "en dinero".
    check('tournament_prizes_nonempty_chk', sql`${t.coins} > 0 OR ${t.cosmeticId} IS NOT NULL`),
    uniqueIndex('tournament_prizes_position_uniq').on(t.tournamentId, t.position),
  ],
);

/**
 * Premios efectivamente entregados. `wallet_transactions` guarda el asiento contable;
 * esta tabla evita volver a intentarlo y da trazabilidad al organizador.
 */
export const tournamentAwardsTable = pgTable(
  'tournament_awards',
  {
    id: uuid('id').primaryKey(),
    tournamentId: uuid('tournament_id')
      .notNull()
      .references(() => tournamentsTable.id, { onDelete: 'cascade' }),
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
    // Un premio por posición y torneo: reintentar no duplica monedas.
    uniqueIndex('tournament_awards_position_uniq').on(t.tournamentId, t.position),
    index('tournament_awards_user_idx').on(t.userId, t.awardedAt),
  ],
);

/**
 * La siembra usa el rating vigente (`rating_profiles`) de la temporada activa; el
 * servicio lo lee y guarda `seed_rating` en cada participante para poder reconstruir
 * la llave. Si no hay rating, el participante se siembra último.
 */
