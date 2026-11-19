import type { AccountStatus, UserRole, UserSettings } from '@truco/shared';
import { desc, sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

export const usersTable = pgTable(
  'users',
  {
    id: uuid('id').primaryKey(),
    email: varchar('email', { length: 254 }).unique(),
    emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
    passwordHash: text('password_hash'),
    googleSub: varchar('google_sub', { length: 128 }).unique(),
    nickname: varchar('nickname', { length: 32 }).notNull(),
    nicknameLower: varchar('nickname_lower', { length: 32 }).notNull().unique(),
    isGuest: boolean('is_guest').notNull().default(false),
    role: varchar('role', { length: 16 }).$type<UserRole>().notNull().default('PLAYER'),
    status: varchar('status', { length: 16 }).$type<AccountStatus>().notNull().default('ACTIVE'),
    /** Motivo visible para el jugador cuando `status != ACTIVE` (lo escribe la moderación). */
    statusReason: text('status_reason'),
    /** Vencimiento de la suspensión; `null` = sin vencimiento (solo bloqueo permanente). */
    statusExpiresAt: timestamp('status_expires_at', { withTimezone: true }),
    /** Fin del silencio (chat rápido y emotes bloqueados hasta entonces). */
    mutedUntil: timestamp('muted_until', { withTimezone: true }),
    /** La moderación forzó el cambio de apodo: la web lo exige en el próximo ingreso. */
    nicknameMustChange: boolean('nickname_must_change').notNull().default(false),
    failedLoginCount: integer('failed_login_count').notNull().default(0),
    lockedUntil: timestamp('locked_until', { withTimezone: true }),
    lastFailedLoginAt: timestamp('last_failed_login_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    /**
     * Constancia de aceptación legal (M8d). Se guarda la versión aceptada de cada
     * documento, el momento exacto y la edad mínima vigente en ese momento, para
     * poder acreditar el consentimiento (Ley 25.326, art. 5). NULL en cuentas
     * creadas antes de M8d y en invitados.
     */
    termsVersion: varchar('terms_version', { length: 64 }),
    privacyVersion: varchar('privacy_version', { length: 64 }),
    legalAcceptedAt: timestamp('legal_accepted_at', { withTimezone: true }),
    legalMinAge: integer('legal_min_age'),
  },
  (t) => [index('users_status_idx').on(t.status)],
);

export const profilesTable = pgTable('profiles', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => usersTable.id, { onDelete: 'cascade' }),
  avatarId: varchar('avatar_id', { length: 64 }).notNull().default('mate-classic'),
  level: integer('level').notNull().default(1),
  xp: integer('xp').notNull().default(0),
  bio: varchar('bio', { length: 280 }).notNull().default(''),
  settings: jsonb('settings')
    .$type<UserSettings>()
    .notNull()
    .default({ soundEnabled: true, animationsReduced: false, confirmCalls: false }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type SessionRevokedReason =
  | 'LOGOUT'
  | 'LOGOUT_ALL'
  | 'ROTATED'
  | 'REUSE_DETECTED'
  | 'DEVICE_REVOKED'
  | 'PASSWORD_RESET'
  | 'ACCOUNT_DELETED';

export const sessionsTable = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey(),
    familyId: uuid('family_id').notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => usersTable.id, { onDelete: 'cascade' }),
    refreshHash: varchar('refresh_hash', { length: 64 }).notNull().unique(),
    replacedBySessionId: uuid('replaced_by_session_id'),
    deviceName: varchar('device_name', { length: 120 }).notNull(),
    userAgent: varchar('user_agent', { length: 512 }),
    ipAddress: varchar('ip_address', { length: 64 }),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    revokedReason: varchar('revoked_reason', { length: 32 }).$type<SessionRevokedReason>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('sessions_user_id_idx').on(t.userId),
    index('sessions_family_id_idx').on(t.familyId),
    index('sessions_user_active_idx')
      .on(t.userId, desc(t.lastUsedAt))
      .where(sql`${t.revokedAt} IS NULL`),
  ],
);

export type AuthTokenPurpose = 'EMAIL_VERIFY' | 'PASSWORD_RESET';

export const authTokensTable = pgTable(
  'auth_tokens',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => usersTable.id, { onDelete: 'cascade' }),
    purpose: varchar('purpose', { length: 24 }).$type<AuthTokenPurpose>().notNull(),
    tokenHash: varchar('token_hash', { length: 64 }).notNull().unique(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('auth_tokens_user_purpose_idx').on(t.userId, t.purpose),
    index('auth_tokens_user_purpose_active_idx')
      .on(t.userId, t.purpose, t.expiresAt)
      .where(sql`${t.consumedAt} IS NULL`),
  ],
);

/** Sesión del panel administrativo: cookie separada de la de jugador y TTL corto. */
export const adminSessionsTable = pgTable(
  'admin_sessions',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => usersTable.id, { onDelete: 'cascade' }),
    tokenHash: varchar('token_hash', { length: 64 }).notNull().unique(),
    totpVerifiedAt: timestamp('totp_verified_at', { withTimezone: true }).notNull(),
    ipAddress: varchar('ip_address', { length: 64 }),
    userAgent: varchar('user_agent', { length: 512 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (t) => [index('admin_sessions_user_idx').on(t.userId)],
);

/** Secreto TOTP del panel (cifrado con AES-256-GCM) y códigos de recuperación (SHA-256). */
export const adminTwoFactorTable = pgTable('admin_two_factor', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => usersTable.id, { onDelete: 'cascade' }),
  secretEncrypted: text('secret_encrypted').notNull(),
  /** Códigos de recuperación de un solo uso (hash + uso). */
  recoveryCodes: jsonb('recovery_codes')
    .$type<Array<{ hash: string; usedAt: string | null }>>()
    .notNull()
    .default([]),
  confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
  lastUsedStep: integer('last_used_step'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type UserRow = typeof usersTable.$inferSelect;
export type AdminSessionRow = typeof adminSessionsTable.$inferSelect;
export type AdminTwoFactorRow = typeof adminTwoFactorTable.$inferSelect;
export type ProfileRow = typeof profilesTable.$inferSelect;
export type SessionRow = typeof sessionsTable.$inferSelect;
export type AuthTokenRow = typeof authTokensTable.$inferSelect;
