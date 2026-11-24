import type { GameMode, MatchOutcome, RulesetCode } from '@truco/shared';
import { desc, sql } from 'drizzle-orm';
import {
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { usersTable } from './identity.schema.js';

export const rulesetsTable = pgTable('rulesets', {
  id: uuid('id').primaryKey(),
  code: varchar('code', { length: 64 }).notNull().unique(),
  version: integer('version').notNull().default(1),
  config: jsonb('config').$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const tablesTable = pgTable(
  'tables',
  {
    id: uuid('id').primaryKey(),
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => usersTable.id, { onDelete: 'cascade' }),
    mode: varchar('mode', { length: 8 }).$type<GameMode>().notNull(),
    rulesetId: uuid('ruleset_id')
      .notNull()
      .references(() => rulesetsTable.id),
    rulesetCode: varchar('ruleset_code', { length: 64 })
      .$type<RulesetCode>()
      .notNull()
      .default('ar-standard-v1'),
    targetScore: integer('target_score').notNull().default(30),
    florEnabled: boolean('flor_enabled').notNull().default(true),
    turnTimeoutMs: integer('turn_timeout_ms').notNull().default(25_000),
    visibility: varchar('visibility', { length: 16 })
      .$type<'PUBLIC' | 'PRIVATE'>()
      .notNull()
      .default('PUBLIC'),
    joinCode: varchar('join_code', { length: 12 }).unique(),
    status: varchar('status', { length: 16 }).notNull().default('WAITING'),
    closedReason: varchar('closed_reason', { length: 32 }),
    /** `true` en mesas de práctica contra la máquina (sin bots registrados, sin estadísticas). */
    isPractice: boolean('is_practice').notNull().default(false),
    /** Solo las salas creadas desde la cola competitiva pueden actualizar rating. */
    isCompetitive: boolean('is_competitive').notNull().default(false),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('tables_status_visibility_mode_idx').on(t.status, t.visibility, t.mode),
    index('tables_status_expires_idx').on(t.status, t.expiresAt),
    index('tables_status_updated_idx').on(t.status, t.updatedAt),
    index('tables_lobby_listing_idx').on(t.visibility, t.status, t.mode, desc(t.createdAt)),
  ],
);

export const tableSeatsTable = pgTable(
  'table_seats',
  {
    tableId: uuid('table_id')
      .notNull()
      .references(() => tablesTable.id, { onDelete: 'cascade' }),
    seat: integer('seat').notNull(),
    team: integer('team').notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => usersTable.id, { onDelete: 'cascade' }),
    nickname: varchar('nickname', { length: 32 }).notNull(),
    isActive: boolean('is_active').notNull().default(true),
    joinedAt: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.tableId, t.seat] }),
    uniqueIndex('table_seats_table_user_uniq').on(t.tableId, t.userId),
    uniqueIndex('table_seats_one_active_per_user_uniq')
      .on(t.userId)
      .where(sql`${t.isActive} = true`),
    index('table_seats_table_active_idx')
      .on(t.tableId)
      .where(sql`${t.isActive} = true`),
  ],
);

export const ratingSeasonsTable = pgTable(
  'rating_seasons',
  {
    id: uuid('id').primaryKey(),
    seasonNumber: integer('season_number').notNull().unique(),
    label: varchar('label', { length: 80 }).notNull(),
    status: varchar('status', { length: 16 })
      .$type<'ACTIVE' | 'CLOSED'>()
      .notNull()
      .default('ACTIVE'),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('rating_seasons_single_active_uniq')
      .on(t.status)
      .where(sql`${t.status} = 'ACTIVE'`),
    index('rating_seasons_status_ends_idx').on(t.status, t.endsAt),
  ],
);

export const matchesTable = pgTable('matches', {
  id: uuid('id').primaryKey(),
  tableId: uuid('table_id').references(() => tablesTable.id, { onDelete: 'set null' }),
  mode: varchar('mode', { length: 8 }).$type<GameMode>().notNull(),
  rulesetId: uuid('ruleset_id').references(() => rulesetsTable.id),
  rulesetCode: varchar('ruleset_code', { length: 64 }).notNull(),
  seedCommitment: varchar('seed_commitment', { length: 128 }).notNull(),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  endedAt: timestamp('ended_at', { withTimezone: true }),
  result: jsonb('result').$type<Record<string, unknown>>(),
  /** Si hubo uno o más bots como asiento durante esta partida competitiva. */
  hasBots: boolean('has_bots').notNull().default(false),
  /** Solo las partidas que nacen en la cola humana competitiva puntúan. */
  isCompetitive: boolean('is_competitive').notNull().default(false),
  seasonId: uuid('season_id').references(() => ratingSeasonsTable.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const matchPlayersTable = pgTable(
  'match_players',
  {
    matchId: uuid('match_id')
      .notNull()
      .references(() => matchesTable.id, { onDelete: 'cascade' }),
    seat: integer('seat').notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => usersTable.id, { onDelete: 'cascade' }),
    team: integer('team').notNull(),
    score: integer('score').notNull().default(0),
    outcome: varchar('outcome', { length: 16 }).$type<MatchOutcome>().notNull(),
    ratingDelta: doublePrecision('rating_delta').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.matchId, t.seat] }),
    index('match_players_user_match_idx').on(t.userId, t.matchId),
    index('match_players_user_started_idx').on(t.userId, desc(t.matchId)),
  ],
);

export const matchEventsTable = pgTable(
  'match_events',
  {
    matchId: uuid('match_id')
      .notNull()
      .references(() => matchesTable.id, { onDelete: 'cascade' }),
    seq: integer('seq').notNull(),
    type: varchar('type', { length: 64 }).notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.matchId, t.seq] }),
    index('match_events_match_seq_idx').on(t.matchId, t.seq),
  ],
);

export const reportsTable = pgTable(
  'reports',
  {
    id: uuid('id').primaryKey(),
    reporterId: uuid('reporter_id')
      .notNull()
      .references(() => usersTable.id, { onDelete: 'cascade' }),
    targetId: uuid('target_id')
      .notNull()
      .references(() => usersTable.id, { onDelete: 'cascade' }),
    matchId: uuid('match_id').references(() => matchesTable.id, { onDelete: 'set null' }),
    reason: text('reason').notNull(),
    reasonCode: varchar('reason_code', { length: 32 }).notNull().default('OTHER'),
    details: text('details'),
    status: varchar('status', { length: 24 }).notNull().default('OPEN'),
    /** Hash determinístico (denunciante, denunciado, motivo, partida) para detectar duplicados. */
    dedupeKey: varchar('dedupe_key', { length: 64 }),
    /** Referencia al tramo de `match_events` adjuntado automáticamente. */
    eventLogRef: jsonb('event_log_ref').$type<Record<string, unknown> | null>(),
    claimedBy: uuid('claimed_by').references(() => usersTable.id, { onDelete: 'set null' }),
    claimedAt: timestamp('claimed_at', { withTimezone: true }),
    resolvedBy: uuid('resolved_by').references(() => usersTable.id, { onDelete: 'set null' }),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    resolutionNote: text('resolution_note'),
    /** Control de concurrencia optimista: dos moderadores no resuelven el mismo reporte. */
    version: integer('version').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('reports_status_created_idx').on(t.status, t.createdAt),
    index('reports_target_status_idx').on(t.targetId, t.status),
    index('reports_claimed_status_idx').on(t.claimedBy, t.status),
    uniqueIndex('reports_dedupe_open_uniq')
      .on(t.dedupeKey)
      .where(sql`${t.status} IN ('OPEN', 'IN_REVIEW')`),
  ],
);

export const sanctionsTable = pgTable(
  'sanctions',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => usersTable.id, { onDelete: 'cascade' }),
    type: varchar('type', { length: 24 }).notNull(),
    reason: text('reason').notNull(),
    reportId: uuid('report_id').references(() => reportsTable.id, { onDelete: 'set null' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    issuedBy: uuid('issued_by').references(() => usersTable.id, { onDelete: 'set null' }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('sanctions_user_created_idx').on(t.userId, t.createdAt),
    index('sanctions_expires_idx').on(t.expiresAt),
    index('sanctions_user_active_idx')
      .on(t.userId, t.expiresAt)
      .where(sql`${t.revokedAt} IS NULL`),
  ],
);

export const auditLogsTable = pgTable(
  'audit_logs',
  {
    id: uuid('id').primaryKey(),
    actorId: uuid('actor_id').references(() => usersTable.id, { onDelete: 'set null' }),
    action: varchar('action', { length: 80 }).notNull(),
    entity: varchar('entity', { length: 64 }).notNull(),
    entityId: varchar('entity_id', { length: 128 }),
    /** Motivo declarado por el operador (obligatorio en accesos a datos personales y replay). */
    reason: text('reason'),
    /** Sesión administrativa que originó la acción (cookie separada de la de jugador). */
    adminSessionId: uuid('admin_session_id'),
    beforeState: jsonb('before_state').$type<Record<string, unknown> | null>(),
    afterState: jsonb('after_state').$type<Record<string, unknown> | null>(),
    ip: varchar('ip', { length: 64 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('audit_logs_actor_created_idx').on(t.actorId, t.createdAt),
    index('audit_logs_created_idx').on(t.createdAt),
    index('audit_logs_created_action_idx').on(desc(t.createdAt), t.action),
  ],
);

/**
 * Progreso del tutorial interactivo por cuenta (lecciones completadas).
 * Se guarda en la cuenta para que el avance sobreviva a cambios de dispositivo.
 */
export const tutorialProgressTable = pgTable('tutorial_progress', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => usersTable.id, { onDelete: 'cascade' }),
  completedLessons: jsonb('completed_lessons').$type<string[]>().notNull().default([]),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Rating Glicko-2 independiente por usuario, modalidad y temporada. */
export const ratingProfilesTable = pgTable(
  'rating_profiles',
  {
    seasonId: uuid('season_id')
      .notNull()
      .references(() => ratingSeasonsTable.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => usersTable.id, { onDelete: 'cascade' }),
    mode: varchar('mode', { length: 8 }).$type<GameMode>().notNull(),
    rating: doublePrecision('rating').notNull().default(1500),
    deviation: doublePrecision('deviation').notNull().default(350),
    volatility: doublePrecision('volatility').notNull().default(0.06),
    matchesPlayed: integer('matches_played').notNull().default(0),
    opponentsCount: integer('opponents_count').notNull().default(0),
    wins: integer('wins').notNull().default(0),
    losses: integer('losses').notNull().default(0),
    abandons: integer('abandons').notNull().default(0),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.seasonId, t.userId, t.mode] }),
    index('rating_profiles_mode_rank_idx').on(t.seasonId, t.mode, desc(t.rating)),
    index('rating_profiles_user_idx').on(t.userId, t.seasonId),
  ],
);

/** Duelo entre dos rivales opuestos; limita rematches y alimenta señales de revisión. */
export const ratingRivalriesTable = pgTable(
  'rating_rivalries',
  {
    seasonId: uuid('season_id')
      .notNull()
      .references(() => ratingSeasonsTable.id, { onDelete: 'cascade' }),
    mode: varchar('mode', { length: 8 }).$type<GameMode>().notNull(),
    playerLow: uuid('player_low')
      .notNull()
      .references(() => usersTable.id, { onDelete: 'cascade' }),
    playerHigh: uuid('player_high')
      .notNull()
      .references(() => usersTable.id, { onDelete: 'cascade' }),
    matchesPlayed: integer('matches_played').notNull().default(0),
    shortMatches: integer('short_matches').notNull().default(0),
    abandonMatches: integer('abandon_matches').notNull().default(0),
    playerLowWins: integer('player_low_wins').notNull().default(0),
    playerHighWins: integer('player_high_wins').notNull().default(0),
    firstPlayedAt: timestamp('first_played_at', { withTimezone: true }).notNull(),
    lastPlayedAt: timestamp('last_played_at', { withTimezone: true }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.seasonId, t.mode, t.playerLow, t.playerHigh] }),
    index('rating_rivalries_low_count_idx').on(t.seasonId, t.mode, t.playerLow, t.matchesPlayed),
    index('rating_rivalries_high_count_idx').on(t.seasonId, t.mode, t.playerHigh, t.matchesPlayed),
  ],
);

/** Agregados de puntos y rivales únicos para rankings semanales y mensuales. */
export const ratingPeriodStatsTable = pgTable(
  'rating_period_stats',
  {
    seasonId: uuid('season_id')
      .notNull()
      .references(() => ratingSeasonsTable.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => usersTable.id, { onDelete: 'cascade' }),
    mode: varchar('mode', { length: 8 }).$type<GameMode>().notNull(),
    periodType: varchar('period_type', { length: 8 }).$type<'WEEK' | 'MONTH'>().notNull(),
    periodStart: timestamp('period_start', { withTimezone: true }).notNull(),
    ratingPoints: doublePrecision('rating_points').notNull().default(0),
    matchesPlayed: integer('matches_played').notNull().default(0),
    opponentIds: jsonb('opponent_ids').$type<string[]>().notNull().default([]),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.seasonId, t.userId, t.mode, t.periodType, t.periodStart] }),
    index('rating_period_stats_rank_idx').on(
      t.seasonId,
      t.mode,
      t.periodType,
      t.periodStart,
      desc(t.ratingPoints),
    ),
  ],
);

/** Durable outbox: DB commit may succeed while Redis is unavailable; retries project absolute scores. */
export const ratingRedisOutboxTable = pgTable(
  'rating_redis_outbox',
  {
    matchId: uuid('match_id')
      .primaryKey()
      .references(() => matchesTable.id, { onDelete: 'cascade' }),
    seasonId: uuid('season_id')
      .notNull()
      .references(() => ratingSeasonsTable.id, { onDelete: 'cascade' }),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    projectedAt: timestamp('projected_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('rating_redis_outbox_pending_idx')
      .on(t.createdAt)
      .where(sql`${t.projectedAt} IS NULL`),
  ],
);

/** Explicit idempotency marker for the post-match rating job (same transaction as deltas). */
export const ratingJobsTable = pgTable('rating_jobs', {
  matchId: uuid('match_id')
    .primaryKey()
    .references(() => matchesTable.id, { onDelete: 'cascade' }),
  seasonId: uuid('season_id')
    .notNull()
    .references(() => ratingSeasonsTable.id, { onDelete: 'cascade' }),
  processedAt: timestamp('processed_at', { withTimezone: true }).notNull(),
});

/** Ranking congelado por temporada y modalidad; se conserva aunque los ratings activos se reinicien. */
export const ratingSeasonSnapshotsTable = pgTable(
  'rating_season_snapshots',
  {
    seasonId: uuid('season_id')
      .notNull()
      .references(() => ratingSeasonsTable.id, { onDelete: 'cascade' }),
    mode: varchar('mode', { length: 8 }).$type<GameMode>().notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => usersTable.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    rating: doublePrecision('rating').notNull(),
    deviation: doublePrecision('deviation').notNull(),
    matchesPlayed: integer('matches_played').notNull(),
    opponentsCount: integer('opponents_count').notNull(),
    wins: integer('wins').notNull(),
    division: varchar('division', { length: 16 }).notNull(),
    frozenAt: timestamp('frozen_at', { withTimezone: true }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.seasonId, t.mode, t.userId] }),
    uniqueIndex('rating_season_snapshots_position_uniq').on(t.seasonId, t.mode, t.position),
    index('rating_season_snapshots_user_idx').on(t.userId, t.seasonId),
  ],
);

/** Auditoría transaccional de cierre; una fila por temporada cerrada. */
export const ratingSeasonAuditsTable = pgTable('rating_season_audits', {
  seasonId: uuid('season_id')
    .primaryKey()
    .references(() => ratingSeasonsTable.id, { onDelete: 'cascade' }),
  nextSeasonId: uuid('next_season_id')
    .notNull()
    .references(() => ratingSeasonsTable.id, { onDelete: 'restrict' }),
  snapshotCount: integer('snapshot_count').notNull(),
  resetStrategy: varchar('reset_strategy', { length: 80 }).notNull(),
  closedAt: timestamp('closed_at', { withTimezone: true }).notNull(),
});

/** Casos antiabuso para revisión humana; el sistema no aplica sanciones automáticas. */
export const competitiveReviewCasesTable = pgTable(
  'competitive_review_cases',
  {
    id: uuid('id').primaryKey(),
    fingerprint: varchar('fingerprint', { length: 160 }).notNull().unique(),
    status: varchar('status', { length: 16 })
      .$type<'OPEN' | 'IN_REVIEW' | 'RESOLVED'>()
      .notNull()
      .default('OPEN'),
    severity: varchar('severity', { length: 8 }).$type<'LOW' | 'MEDIUM' | 'HIGH'>().notNull(),
    signals: jsonb('signals').$type<string[]>().notNull(),
    userIds: uuid('user_ids').array().notNull(),
    matchIds: uuid('match_ids').array().notNull(),
    evidence: jsonb('evidence').$type<Record<string, unknown>>().notNull(),
    claimedBy: uuid('claimed_by').references(() => usersTable.id, { onDelete: 'set null' }),
    claimedAt: timestamp('claimed_at', { withTimezone: true }),
    resolvedBy: uuid('resolved_by').references(() => usersTable.id, { onDelete: 'set null' }),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    resolutionNote: text('resolution_note'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('competitive_review_cases_status_created_idx').on(t.status, desc(t.createdAt)),
    index('competitive_review_cases_claimed_idx').on(t.claimedBy, t.status),
  ],
);
