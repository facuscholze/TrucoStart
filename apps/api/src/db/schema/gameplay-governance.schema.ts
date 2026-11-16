import type { GameMode, MatchOutcome, RulesetCode } from '@truco/shared';
import { sql } from 'drizzle-orm';
import {
  boolean,
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
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('tables_status_visibility_mode_idx').on(t.status, t.visibility, t.mode),
    index('tables_status_expires_idx').on(t.status, t.expiresAt),
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
    ratingDelta: integer('rating_delta').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.matchId, t.seat] }),
    index('match_players_user_match_idx').on(t.userId, t.matchId),
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
  (t) => [primaryKey({ columns: [t.matchId, t.seq] })],
);

export const reportsTable = pgTable('reports', {
  id: uuid('id').primaryKey(),
  reporterId: uuid('reporter_id')
    .notNull()
    .references(() => usersTable.id, { onDelete: 'cascade' }),
  targetId: uuid('target_id')
    .notNull()
    .references(() => usersTable.id, { onDelete: 'cascade' }),
  matchId: uuid('match_id').references(() => matchesTable.id, { onDelete: 'set null' }),
  reason: text('reason').notNull(),
  status: varchar('status', { length: 24 }).notNull().default('OPEN'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const sanctionsTable = pgTable('sanctions', {
  id: uuid('id').primaryKey(),
  userId: uuid('user_id')
    .notNull()
    .references(() => usersTable.id, { onDelete: 'cascade' }),
  type: varchar('type', { length: 24 }).notNull(),
  reason: text('reason').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  issuedBy: uuid('issued_by').references(() => usersTable.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const auditLogsTable = pgTable(
  'audit_logs',
  {
    id: uuid('id').primaryKey(),
    actorId: uuid('actor_id').references(() => usersTable.id, { onDelete: 'set null' }),
    action: varchar('action', { length: 80 }).notNull(),
    entity: varchar('entity', { length: 64 }).notNull(),
    entityId: varchar('entity_id', { length: 128 }),
    beforeState: jsonb('before_state').$type<Record<string, unknown> | null>(),
    afterState: jsonb('after_state').$type<Record<string, unknown> | null>(),
    ip: varchar('ip', { length: 64 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('audit_logs_actor_created_idx').on(t.actorId, t.createdAt)],
);
