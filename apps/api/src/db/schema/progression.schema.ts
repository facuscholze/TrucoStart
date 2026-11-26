import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { usersTable } from './identity.schema.js';

/** Configuración ajustable por admin; la moneda queda fijada como simbólica por constraints. */
export const progressionConfigTable = pgTable(
  'progression_config',
  {
    id: integer('id').primaryKey(),
    humanMatchXp: integer('human_match_xp').notNull().default(25),
    botMatchXp: integer('bot_match_xp').notNull().default(8),
    dailyXpCap: integer('daily_xp_cap').notNull().default(200),
    botDailyXpCap: integer('bot_daily_xp_cap').notNull().default(40),
    dailyBonusXpCap: integer('daily_bonus_xp_cap').notNull().default(100),
    humanMatchCoins: integer('human_match_coins').notNull().default(3),
    botMatchCoins: integer('bot_match_coins').notNull().default(1),
    dailyCoinCap: integer('daily_coin_cap').notNull().default(40),
    botDailyCoinCap: integer('bot_daily_coin_cap').notNull().default(10),
    dailyCoinSpendCap: integer('daily_coin_spend_cap').notNull().default(100),
    baseXpPerLevel: integer('base_xp_per_level').notNull().default(100),
    xpGrowthPerLevel: integer('xp_growth_per_level').notNull().default(50),
    missionRewardMultiplierBp: integer('mission_reward_multiplier_bp').notNull().default(10_000),
    achievementRewardMultiplierBp: integer('achievement_reward_multiplier_bp')
      .notNull()
      .default(10_000),
    currencyType: varchar('currency_type', { length: 24 })
      .$type<'VIRTUAL_COIN'>()
      .notNull()
      .default('VIRTUAL_COIN'),
    hasEconomicValue: boolean('has_economic_value').notNull().default(false),
    playerTransfersEnabled: boolean('player_transfers_enabled').notNull().default(false),
    moneyPurchasesEnabled: boolean('money_purchases_enabled').notNull().default(false),
    version: integer('version').notNull().default(1),
    updatedBy: uuid('updated_by').references(() => usersTable.id, { onDelete: 'set null' }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('progression_config_singleton_chk', sql`${t.id} = 1`),
    check(
      'progression_config_virtual_currency_chk',
      sql`${t.currencyType} = 'VIRTUAL_COIN' AND ${t.hasEconomicValue} = false AND ${t.playerTransfersEnabled} = false AND ${t.moneyPurchasesEnabled} = false`,
    ),
    check(
      'progression_config_nonnegative_rewards_chk',
      sql`${t.humanMatchXp} >= 0 AND ${t.botMatchXp} >= 0 AND ${t.dailyXpCap} >= 0 AND ${t.botDailyXpCap} >= 0 AND ${t.dailyBonusXpCap} >= 0 AND ${t.humanMatchCoins} >= 0 AND ${t.botMatchCoins} >= 0 AND ${t.dailyCoinCap} >= 0 AND ${t.botDailyCoinCap} >= 0 AND ${t.dailyCoinSpendCap} >= 0 AND ${t.baseXpPerLevel} > 0 AND ${t.xpGrowthPerLevel} >= 0`,
    ),
  ],
);

/** Condiciones, textos e importes viven en datos; el código sólo interpreta sus tipos. */
export const achievementCatalogTable = pgTable(
  'achievement_catalog',
  {
    id: varchar('id', { length: 64 }).primaryKey(),
    titleKey: varchar('title_key', { length: 120 }).notNull(),
    descriptionKey: varchar('description_key', { length: 160 }).notNull(),
    icon: varchar('icon', { length: 48 }).notNull(),
    condition: jsonb('condition').$type<Record<string, unknown>>().notNull(),
    rewardXp: integer('reward_xp').notNull().default(0),
    rewardCoins: integer('reward_coins').notNull().default(0),
    enabled: boolean('enabled').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('achievement_catalog_enabled_idx').on(t.enabled, t.id),
    check('achievement_catalog_rewards_chk', sql`${t.rewardXp} >= 0 AND ${t.rewardCoins} >= 0`),
  ],
);

export const userAchievementsTable = pgTable(
  'user_achievements',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => usersTable.id, { onDelete: 'cascade' }),
    achievementId: varchar('achievement_id', { length: 64 })
      .notNull()
      .references(() => achievementCatalogTable.id, { onDelete: 'restrict' }),
    progress: integer('progress').notNull().default(0),
    unlockedAt: timestamp('unlocked_at', { withTimezone: true }),
    sourceMatchId: uuid('source_match_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.achievementId] }),
    index('user_achievements_user_unlocked_idx').on(t.userId, t.unlockedAt),
  ],
);

export type QuestPeriod = 'DAILY' | 'WEEKLY';

export const questTemplatesTable = pgTable(
  'quest_templates',
  {
    id: varchar('id', { length: 64 }).primaryKey(),
    period: varchar('period', { length: 8 }).$type<QuestPeriod>().notNull(),
    titleKey: varchar('title_key', { length: 120 }).notNull(),
    descriptionKey: varchar('description_key', { length: 160 }).notNull(),
    condition: jsonb('condition').$type<Record<string, unknown>>().notNull(),
    rewardXp: integer('reward_xp').notNull().default(0),
    rewardCoins: integer('reward_coins').notNull().default(0),
    alwaysAssign: boolean('always_assign').notNull().default(false),
    enabled: boolean('enabled').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('quest_templates_period_enabled_idx').on(t.period, t.enabled),
    check('quest_templates_period_chk', sql`${t.period} IN ('DAILY', 'WEEKLY')`),
    check('quest_templates_rewards_chk', sql`${t.rewardXp} >= 0 AND ${t.rewardCoins} >= 0`),
  ],
);

/** Snapshot de una misión asignada: cambios futuros del catálogo no alteran su recompensa. */
export const userQuestsTable = pgTable(
  'user_quests',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => usersTable.id, { onDelete: 'cascade' }),
    templateId: varchar('template_id', { length: 64 })
      .notNull()
      .references(() => questTemplatesTable.id, { onDelete: 'restrict' }),
    period: varchar('period', { length: 8 }).$type<QuestPeriod>().notNull(),
    periodStart: timestamp('period_start', { withTimezone: true }).notNull(),
    periodEnd: timestamp('period_end', { withTimezone: true }).notNull(),
    titleKey: varchar('title_key', { length: 120 }).notNull(),
    descriptionKey: varchar('description_key', { length: 160 }).notNull(),
    condition: jsonb('condition').$type<Record<string, unknown>>().notNull(),
    target: integer('target').notNull(),
    rewardXp: integer('reward_xp').notNull(),
    rewardCoins: integer('reward_coins').notNull(),
    progress: integer('progress').notNull().default(0),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    claimedAt: timestamp('claimed_at', { withTimezone: true }),
    version: integer('version').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('user_quests_assignment_uniq').on(t.userId, t.templateId, t.periodStart),
    index('user_quests_user_period_idx').on(t.userId, t.period, t.periodStart),
    check('user_quests_progress_chk', sql`${t.target} > 0 AND ${t.progress} >= 0`),
    check('user_quests_rewards_chk', sql`${t.rewardXp} >= 0 AND ${t.rewardCoins} >= 0`),
  ],
);

export type ProgressionXpCapClass = 'HUMAN_MATCH' | 'BOT_MATCH' | 'BONUS';

/** Recibos XP idempotentes; incluyen prácticas para las que no se guarda una partida histórica. */
export const progressionXpEntriesTable = pgTable(
  'progression_xp_entries',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => usersTable.id, { onDelete: 'cascade' }),
    sourceKind: varchar('source_kind', { length: 24 }).notNull(),
    sourceId: varchar('source_id', { length: 160 }).notNull(),
    idempotencyKey: varchar('idempotency_key', { length: 192 }).notNull(),
    capClass: varchar('cap_class', { length: 16 }).$type<ProgressionXpCapClass>().notNull(),
    xpAmount: integer('xp_amount').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('progression_xp_entries_idempotency_uniq').on(t.userId, t.idempotencyKey),
    index('progression_xp_entries_daily_cap_idx').on(t.userId, t.capClass, t.createdAt),
    check('progression_xp_entries_nonnegative_chk', sql`${t.xpAmount} >= 0`),
    check(
      'progression_xp_entries_cap_class_chk',
      sql`${t.capClass} IN ('HUMAN_MATCH', 'BOT_MATCH', 'BONUS')`,
    ),
  ],
);

/** Cuenta de moneda virtual sin columna de saldo: el total siempre se deriva del libro mayor. */
export const walletAccountsTable = pgTable(
  'wallet_accounts',
  {
    userId: uuid('user_id')
      .primaryKey()
      .references(() => usersTable.id, { onDelete: 'cascade' }),
    currencyType: varchar('currency_type', { length: 24 })
      .$type<'VIRTUAL_COIN'>()
      .notNull()
      .default('VIRTUAL_COIN'),
    hasEconomicValue: boolean('has_economic_value').notNull().default(false),
    playerTransfersEnabled: boolean('player_transfers_enabled').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      'wallet_accounts_virtual_only_chk',
      sql`${t.currencyType} = 'VIRTUAL_COIN' AND ${t.hasEconomicValue} = false AND ${t.playerTransfersEnabled} = false`,
    ),
  ],
);

export type WalletTransactionKind =
  'MATCH_REWARD' | 'MISSION_REWARD' | 'ACHIEVEMENT_REWARD' | 'COSMETIC_REDEEM' | 'ADMIN_REVERSAL';

/** Libro mayor append-only; los asientos negativos son gasto o compensación auditada. */
export const walletTransactionsTable = pgTable(
  'wallet_transactions',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => usersTable.id, { onDelete: 'restrict' }),
    amount: integer('amount').notNull(),
    kind: varchar('kind', { length: 24 }).$type<WalletTransactionKind>().notNull(),
    idempotencyKey: varchar('idempotency_key', { length: 192 }).notNull(),
    referenceType: varchar('reference_type', { length: 32 }).notNull(),
    referenceId: varchar('reference_id', { length: 160 }).notNull(),
    reversesTransactionId: uuid('reverses_transaction_id').references(
      (): AnyPgColumn => walletTransactionsTable.id,
      { onDelete: 'restrict' },
    ),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('wallet_transactions_idempotency_uniq').on(t.userId, t.idempotencyKey),
    uniqueIndex('wallet_transactions_single_reversal_uniq')
      .on(t.reversesTransactionId)
      .where(sql`${t.reversesTransactionId} IS NOT NULL`),
    index('wallet_transactions_user_created_idx').on(t.userId, t.createdAt),
    index('wallet_transactions_user_kind_created_idx').on(t.userId, t.kind, t.createdAt),
    check('wallet_transactions_nonzero_amount_chk', sql`${t.amount} <> 0`),
    check(
      'wallet_transactions_kind_amount_chk',
      sql`(${t.kind} IN ('MATCH_REWARD', 'MISSION_REWARD', 'ACHIEVEMENT_REWARD') AND ${t.amount} > 0) OR (${t.kind} IN ('COSMETIC_REDEEM', 'ADMIN_REVERSAL') AND ${t.amount} < 0)`,
    ),
    check(
      'wallet_transactions_reversal_kind_chk',
      sql`(${t.kind} = 'ADMIN_REVERSAL') = (${t.reversesTransactionId} IS NOT NULL)`,
    ),
  ],
);

export const cosmeticCatalogTable = pgTable(
  'cosmetic_catalog',
  {
    id: varchar('id', { length: 64 }).primaryKey(),
    nameKey: varchar('name_key', { length: 120 }).notNull(),
    descriptionKey: varchar('description_key', { length: 160 }).notNull(),
    category: varchar('category', { length: 32 }).notNull(),
    priceCoins: integer('price_coins').notNull(),
    icon: varchar('icon', { length: 48 }).notNull(),
    affectsRules: boolean('affects_rules').notNull().default(false),
    affectsMatchmaking: boolean('affects_matchmaking').notNull().default(false),
    enabled: boolean('enabled').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('cosmetic_catalog_enabled_price_idx').on(t.enabled, t.priceCoins),
    check(
      'cosmetic_catalog_cosmetic_only_chk',
      sql`${t.affectsRules} = false AND ${t.affectsMatchmaking} = false`,
    ),
    check('cosmetic_catalog_price_chk', sql`${t.priceCoins} > 0`),
  ],
);

export const userCosmeticsTable = pgTable(
  'user_cosmetics',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => usersTable.id, { onDelete: 'cascade' }),
    cosmeticId: varchar('cosmetic_id', { length: 64 })
      .notNull()
      .references(() => cosmeticCatalogTable.id, { onDelete: 'restrict' }),
    transactionId: uuid('transaction_id')
      .notNull()
      .references(() => walletTransactionsTable.id, { onDelete: 'restrict' }),
    acquiredAt: timestamp('acquired_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.cosmeticId] }),
    uniqueIndex('user_cosmetics_transaction_uniq').on(t.transactionId),
    index('user_cosmetics_user_acquired_idx').on(t.userId, t.acquiredAt),
  ],
);

export const progressionNotificationsTable = pgTable(
  'progression_notifications',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => usersTable.id, { onDelete: 'cascade' }),
    kind: varchar('kind', { length: 32 }).notNull(),
    idempotencyKey: varchar('idempotency_key', { length: 192 }).notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    readAt: timestamp('read_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('progression_notifications_idempotency_uniq').on(t.userId, t.idempotencyKey),
    index('progression_notifications_user_created_idx').on(t.userId, t.createdAt),
  ],
);
