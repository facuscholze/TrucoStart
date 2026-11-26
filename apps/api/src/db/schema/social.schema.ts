import type {
  SocialInvitationKind,
  SocialInvitationStatus,
  SocialNotificationType,
} from '@truco/shared';
import { desc, sql } from 'drizzle-orm';
import {
  index,
  jsonb,
  pgTable,
  primaryKey,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { tablesTable } from './gameplay-governance.schema.js';
import { usersTable } from './identity.schema.js';

export type FriendshipStatus = 'PENDING' | 'ACCEPTED' | 'REJECTED' | 'CANCELLED' | 'REMOVED';

/** Una fila por solicitud; pares activos se canonicalizan por UUID y tienen unicidad parcial. */
export const friendshipsTable = pgTable(
  'friendships',
  {
    id: uuid('id').primaryKey(),
    userLow: uuid('user_low')
      .notNull()
      .references(() => usersTable.id, { onDelete: 'cascade' }),
    userHigh: uuid('user_high')
      .notNull()
      .references(() => usersTable.id, { onDelete: 'cascade' }),
    requestedBy: uuid('requested_by')
      .notNull()
      .references(() => usersTable.id, { onDelete: 'cascade' }),
    status: varchar('status', { length: 16 }).$type<FriendshipStatus>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('friendships_active_pair_uniq')
      .on(t.userLow, t.userHigh)
      .where(sql`${t.status} IN ('PENDING', 'ACCEPTED')`),
    index('friendships_low_status_created_idx')
      .on(t.userLow, t.status, desc(t.createdAt))
      .where(sql`${t.status} IN ('PENDING', 'ACCEPTED')`),
    index('friendships_high_status_created_idx')
      .on(t.userHigh, t.status, desc(t.createdAt))
      .where(sql`${t.status} IN ('PENDING', 'ACCEPTED')`),
    index('friendships_requested_by_status_idx').on(t.requestedBy, t.status),
  ],
);

export const userBlocksTable = pgTable(
  'user_blocks',
  {
    blockerId: uuid('blocker_id')
      .notNull()
      .references(() => usersTable.id, { onDelete: 'cascade' }),
    blockedId: uuid('blocked_id')
      .notNull()
      .references(() => usersTable.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.blockerId, t.blockedId] }),
    index('user_blocks_blocked_idx').on(t.blockedId, t.blockerId),
  ],
);

export const socialInvitationsTable = pgTable(
  'social_invitations',
  {
    id: uuid('id').primaryKey(),
    kind: varchar('kind', { length: 16 }).$type<SocialInvitationKind>().notNull(),
    status: varchar('status', { length: 16 }).$type<SocialInvitationStatus>().notNull(),
    senderId: uuid('sender_id')
      .notNull()
      .references(() => usersTable.id, { onDelete: 'cascade' }),
    recipientId: uuid('recipient_id')
      .notNull()
      .references(() => usersTable.id, { onDelete: 'cascade' }),
    tableId: uuid('table_id').references(() => tablesTable.id, { onDelete: 'set null' }),
    mode: varchar('mode', { length: 8 }),
    rulesetCode: varchar('ruleset_code', { length: 64 }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('social_invitations_pending_pair_uniq')
      .on(
        t.kind,
        t.senderId,
        t.recipientId,
        sql`coalesce(${t.tableId}, '00000000-0000-0000-0000-000000000000'::uuid)`,
      )
      .where(sql`${t.status} = 'PENDING'`),
    index('social_invitations_recipient_pending_idx')
      .on(t.recipientId, t.expiresAt, desc(t.createdAt))
      .where(sql`${t.status} = 'PENDING'`),
    index('social_invitations_sender_pending_idx')
      .on(t.senderId, t.expiresAt, desc(t.createdAt))
      .where(sql`${t.status} = 'PENDING'`),
  ],
);

export const socialNotificationsTable = pgTable(
  'social_notifications',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => usersTable.id, { onDelete: 'cascade' }),
    actorUserId: uuid('actor_user_id').references(() => usersTable.id, { onDelete: 'set null' }),
    type: varchar('type', { length: 40 }).$type<SocialNotificationType>().notNull(),
    referenceId: uuid('reference_id'),
    tableId: uuid('table_id').references(() => tablesTable.id, { onDelete: 'set null' }),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    readAt: timestamp('read_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('social_notifications_reference_type_uniq')
      .on(t.userId, t.type, t.referenceId)
      .where(sql`${t.referenceId} IS NOT NULL`),
    index('social_notifications_user_created_idx').on(t.userId, desc(t.createdAt), desc(t.id)),
    index('social_notifications_user_unread_idx')
      .on(t.userId, desc(t.createdAt), desc(t.id))
      .where(sql`${t.readAt} IS NULL`),
  ],
);

export type FriendshipRow = typeof friendshipsTable.$inferSelect;
export type SocialInvitationRow = typeof socialInvitationsTable.$inferSelect;
export type SocialNotificationRow = typeof socialNotificationsTable.$inferSelect;
