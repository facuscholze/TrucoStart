import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type {
  ProgressionAchievement,
  ProgressionConfig,
  ProgressionCosmetic,
  ProgressionCondition,
  ProgressionMission,
  ProgressionMissionPeriod,
  ProgressionNotification,
  ProgressionSummary,
} from '@truco/shared';
import { ProgressionConditionSchema, ProgressionMissionPeriodSchema } from '@truco/shared';
import { and, asc, desc, eq, gt, gte, isNull, lt, lte, sql } from 'drizzle-orm';
import { DomainApiException } from '../../common/api-exception.js';
import { generateUuidV7 } from '../../common/uuidv7.js';
import { type AppDatabase, type AppTransaction, DRIZZLE_DB } from '../../db/database.provider.js';
import type { WalletTransactionKind } from '../../db/schema/progression.schema.js';
import {
  achievementCatalogTable,
  auditLogsTable,
  cosmeticCatalogTable,
  matchEventsTable,
  matchesTable,
  matchPlayersTable,
  progressionConfigTable,
  progressionNotificationsTable,
  progressionXpEntriesTable,
  questTemplatesTable,
  tutorialProgressTable,
  userAchievementsTable,
  userCosmeticsTable,
  userQuestsTable,
  usersTable,
  walletAccountsTable,
  walletTransactionsTable,
  profilesTable,
} from '../../db/schema/index.js';

const ASSIGNMENTS_PER_PERIOD = 3;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

interface ProgressionConfigRow extends ProgressionConfig {
  readonly id: number;
  readonly currencyType: 'VIRTUAL_COIN';
  readonly hasEconomicValue: boolean;
  readonly playerTransfersEnabled: boolean;
  readonly moneyPurchasesEnabled: boolean;
  readonly version: number;
  readonly updatedBy: string | null;
  readonly updatedAt: Date;
}

interface AdminAuditContext {
  readonly actorId: string;
  readonly adminSessionId: string;
  readonly ip: string | null;
  readonly reason: string;
}

interface WalletCreditInput {
  readonly userId: string;
  readonly amount: number;
  readonly kind: Extract<
    WalletTransactionKind,
    'MATCH_REWARD' | 'MISSION_REWARD' | 'ACHIEVEMENT_REWARD'
  >;
  readonly idempotencyKey: string;
  readonly referenceType: string;
  readonly referenceId: string;
  readonly now: Date;
  readonly isBotMatch?: boolean;
}

function utcDayStart(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function periodBounds(
  period: ProgressionMissionPeriod,
  reference: Date,
): { start: Date; end: Date } {
  const start = utcDayStart(reference);
  if (period === 'WEEKLY') {
    const daysSinceMonday = (start.getUTCDay() + 6) % 7;
    start.setUTCDate(start.getUTCDate() - daysSinceMonday);
  }
  return {
    start,
    end: new Date(start.getTime() + (period === 'DAILY' ? 1 : 7) * MS_PER_DAY),
  };
}

function stableRank(seed: string, id: string): string {
  return createHash('sha256').update(`${seed}:${id}`).digest('hex');
}

/** Total XP required to enter a level; the per-level increment is linear. */
export function xpThresholdForLevel(level: number, base: number, growth: number): number {
  const completedLevels = Math.max(0, Math.trunc(level) - 1);
  return completedLevels * base + (growth * completedLevels * (completedLevels - 1)) / 2;
}

export function calculateLevelProgress(
  xpTotal: number,
  base: number,
  growth: number,
): { level: number; xpInLevel: number; xpForNextLevel: number; levelProgress: number } {
  const total = Math.max(0, Math.trunc(xpTotal));
  let low = 1;
  let high = Math.max(2, Math.ceil(total / Math.max(1, base)) + 2);
  while (xpThresholdForLevel(high, base, growth) <= total && high < 2_000_000_000) {
    low = high;
    high *= 2;
  }
  while (low + 1 < high) {
    const middle = Math.floor((low + high) / 2);
    if (xpThresholdForLevel(middle, base, growth) <= total) low = middle;
    else high = middle;
  }
  const level = low;
  const currentThreshold = xpThresholdForLevel(level, base, growth);
  const nextThreshold = xpThresholdForLevel(level + 1, base, growth);
  const xpForNextLevel = Math.max(1, nextThreshold - currentThreshold);
  const xpInLevel = Math.max(0, total - currentThreshold);
  return {
    level,
    xpInLevel,
    xpForNextLevel,
    levelProgress: Math.min(1, xpInLevel / xpForNextLevel),
  };
}

function reasonNotAbandonSql() {
  return sql`COALESCE(${matchesTable.result}->>'reason', '') <> 'ABANDON'`;
}

function configValues(row: ProgressionConfigRow): ProgressionConfig {
  return {
    humanMatchXp: row.humanMatchXp,
    botMatchXp: row.botMatchXp,
    dailyXpCap: row.dailyXpCap,
    botDailyXpCap: row.botDailyXpCap,
    dailyBonusXpCap: row.dailyBonusXpCap,
    humanMatchCoins: row.humanMatchCoins,
    botMatchCoins: row.botMatchCoins,
    dailyCoinCap: row.dailyCoinCap,
    botDailyCoinCap: row.botDailyCoinCap,
    dailyCoinSpendCap: row.dailyCoinSpendCap,
    baseXpPerLevel: row.baseXpPerLevel,
    xpGrowthPerLevel: row.xpGrowthPerLevel,
    missionRewardMultiplierBp: row.missionRewardMultiplierBp,
    achievementRewardMultiplierBp: row.achievementRewardMultiplierBp,
  };
}

@Injectable()
export class ProgressionService {
  constructor(@Inject(DRIZZLE_DB) private readonly db: AppDatabase) {}

  /**
   * Se ejecuta después de persistir match_players y match_events. El recibo XP,
   * créditos, logros y progreso de misiones se confirman en una sola transacción.
   */
  async processCompletedMatch(matchId: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const [match] = await tx
        .select()
        .from(matchesTable)
        .where(eq(matchesTable.id, matchId))
        .for('update')
        .limit(1);
      if (!match?.endedAt || match.result?.['reason'] === 'ABANDON') return;

      const players = await tx
        .select({ userId: matchPlayersTable.userId })
        .from(matchPlayersTable)
        .where(eq(matchPlayersTable.matchId, matchId))
        .orderBy(asc(matchPlayersTable.userId));
      if (players.length === 0) return;

      const config = await this.readConfig(tx);
      const completedAt = match.endedAt;
      const isBotMatch = match.hasBots || match.isPractice;
      const capClass = isBotMatch ? 'BOT_MATCH' : 'HUMAN_MATCH';
      const requestedXp = isBotMatch ? config.botMatchXp : config.humanMatchXp;
      const requestedCoins = isBotMatch ? config.botMatchCoins : config.humanMatchCoins;

      for (const { userId } of players) {
        await this.lockOrCreateProfile(tx, userId, completedAt);
        const matchKey = `match:${matchId}`;
        const [receipt] = await tx
          .select({ id: progressionXpEntriesTable.id })
          .from(progressionXpEntriesTable)
          .where(
            and(
              eq(progressionXpEntriesTable.userId, userId),
              eq(progressionXpEntriesTable.idempotencyKey, matchKey),
            ),
          )
          .limit(1);
        if (receipt) continue;

        const xpAward = await this.recordXp(tx, {
          userId,
          idempotencyKey: matchKey,
          sourceKind: 'MATCH',
          sourceId: matchId,
          capClass,
          requested: requestedXp,
          config,
          now: completedAt,
        });
        await this.applyXpToProfile(tx, userId, xpAward, config, completedAt);

        await this.creditCoins(
          tx,
          {
            userId,
            amount: requestedCoins,
            kind: 'MATCH_REWARD',
            idempotencyKey: `match:${matchId}:coins`,
            referenceType: isBotMatch ? 'bot_match' : 'match',
            referenceId: matchId,
            now: completedAt,
            isBotMatch,
          },
          config,
        );

        await this.ensureAssignments(tx, userId, completedAt);
        await this.refreshMissionProgress(tx, userId, completedAt);
        await this.refreshAchievements(tx, userId, config, completedAt, matchId);
      }
    });
  }

  /** Se invoca al guardar tutorial; el cliente sólo puede enviar IDs del catálogo validado. */
  async syncTutorialAchievements(userId: string, now = new Date()): Promise<void> {
    await this.db.transaction(async (tx) => {
      await this.lockOrCreateProfile(tx, userId, now);
      const config = await this.readConfig(tx);
      await this.refreshAchievements(tx, userId, config, now, null);
    });
  }

  async getSummary(userId: string, now = new Date()): Promise<ProgressionSummary> {
    return this.db.transaction(async (tx) => {
      const config = await this.readConfig(tx);
      const profile = await this.lockOrCreateProfile(tx, userId, now);
      await this.ensureWalletAccount(tx, userId);
      await this.ensureAssignments(tx, userId, now);
      await this.refreshMissionProgress(tx, userId, now);

      const progression = calculateLevelProgress(
        profile.xp,
        config.baseXpPerLevel,
        config.xpGrowthPerLevel,
      );
      const achievements = await this.readAchievements(tx, userId);
      const missions = await this.readMissions(tx, userId, now);
      const cosmetics = await this.readCosmetics(tx, userId);
      const [balance] = await tx
        .select({ amount: sql<number>`COALESCE(SUM(${walletTransactionsTable.amount}), 0)` })
        .from(walletTransactionsTable)
        .where(eq(walletTransactionsTable.userId, userId));
      const notifications = await this.readNotifications(tx, userId);

      return {
        level: progression.level,
        xpTotal: profile.xp,
        xpInLevel: progression.xpInLevel,
        xpForNextLevel: progression.xpForNextLevel,
        levelProgress: progression.levelProgress,
        wallet: {
          balance: Math.max(0, Number(balance?.amount ?? 0)),
          currencyType: 'VIRTUAL_COIN',
          hasEconomicValue: false,
          playerTransfersEnabled: false,
          moneyPurchasesEnabled: false,
        },
        achievements,
        missions,
        cosmetics,
        notifications,
      };
    });
  }

  async claimMission(userId: string, questId: string, now = new Date()): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      // El orden de locks (perfil → misión → billetera) es común al worker y al reclamo concurrente.
      await this.lockOrCreateProfile(tx, userId, now);
      const config = await this.readConfig(tx);
      const [quest] = await tx
        .select()
        .from(userQuestsTable)
        .where(and(eq(userQuestsTable.id, questId), eq(userQuestsTable.userId, userId)))
        .for('update')
        .limit(1);
      if (!quest) {
        throw new DomainApiException(404, 'NOT_FOUND', 'No se encontró la misión asignada.');
      }

      await this.refreshOneMissionProgress(tx, quest, now);
      const [current] = await tx
        .select()
        .from(userQuestsTable)
        .where(eq(userQuestsTable.id, questId))
        .limit(1);
      if (!current) throw new DomainApiException(404, 'NOT_FOUND', 'No se encontró la misión.');
      if (current.claimedAt) return false;
      if (!current.completedAt) {
        throw new DomainApiException(
          409,
          'CONFLICT',
          'La misión todavía no está completa según las partidas registradas.',
          { reason: 'MISSION_NOT_COMPLETED' },
        );
      }

      const claimedAt = new Date(Math.max(now.getTime(), current.completedAt.getTime()));
      await tx
        .update(userQuestsTable)
        .set({ claimedAt, updatedAt: claimedAt })
        .where(and(eq(userQuestsTable.id, current.id), isNull(userQuestsTable.claimedAt)));

      const xp = Math.floor((current.rewardXp * config.missionRewardMultiplierBp) / 10_000);
      const coinReward = current.rewardCoins;
      const xpAward = await this.recordXp(tx, {
        userId,
        idempotencyKey: `mission:${current.id}`,
        sourceKind: 'MISSION',
        sourceId: current.id,
        capClass: 'BONUS',
        requested: xp,
        config,
        now: claimedAt,
      });
      await this.applyXpToProfile(tx, userId, xpAward, config, claimedAt);
      await this.creditCoins(
        tx,
        {
          userId,
          amount: coinReward,
          kind: 'MISSION_REWARD',
          idempotencyKey: `mission:${current.id}:coins`,
          referenceType: 'mission',
          referenceId: current.id,
          now: claimedAt,
        },
        config,
      );
      return true;
    });
  }

  async redeemCosmetic(userId: string, cosmeticId: string, now = new Date()): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      const config = await this.readConfig(tx);
      const [cosmetic] = await tx
        .select()
        .from(cosmeticCatalogTable)
        .where(and(eq(cosmeticCatalogTable.id, cosmeticId), eq(cosmeticCatalogTable.enabled, true)))
        .limit(1);
      if (!cosmetic)
        throw new DomainApiException(404, 'NOT_FOUND', 'El cosmético no está disponible.');

      await this.ensureWalletAccount(tx, userId);
      const [wallet] = await tx
        .select({ userId: walletAccountsTable.userId })
        .from(walletAccountsTable)
        .where(eq(walletAccountsTable.userId, userId))
        .for('update')
        .limit(1);
      if (!wallet) throw new Error('No se pudo bloquear la cuenta de moneda virtual.');

      const [owned] = await tx
        .select({ cosmeticId: userCosmeticsTable.cosmeticId })
        .from(userCosmeticsTable)
        .where(
          and(eq(userCosmeticsTable.userId, userId), eq(userCosmeticsTable.cosmeticId, cosmeticId)),
        )
        .limit(1);
      if (owned) return false;

      const dayStart = utcDayStart(now);
      const [dailySpent] = await tx
        .select({ amount: sql<number>`COALESCE(SUM(ABS(${walletTransactionsTable.amount})), 0)` })
        .from(walletTransactionsTable)
        .where(
          and(
            eq(walletTransactionsTable.userId, userId),
            eq(walletTransactionsTable.kind, 'COSMETIC_REDEEM'),
            gte(walletTransactionsTable.createdAt, dayStart),
          ),
        );
      if (Number(dailySpent?.amount ?? 0) + cosmetic.priceCoins > config.dailyCoinSpendCap) {
        throw new DomainApiException(409, 'CONFLICT', 'Se alcanzó el límite diario de canjes.', {
          reason: 'DAILY_SPEND_CAP',
        });
      }

      const [balance] = await tx
        .select({ amount: sql<number>`COALESCE(SUM(${walletTransactionsTable.amount}), 0)` })
        .from(walletTransactionsTable)
        .where(eq(walletTransactionsTable.userId, userId));
      if (Number(balance?.amount ?? 0) < cosmetic.priceCoins) {
        throw new DomainApiException(
          409,
          'CONFLICT',
          'No hay monedas suficientes para ese canje.',
          {
            reason: 'INSUFFICIENT_VIRTUAL_COINS',
          },
        );
      }

      const transactionId = generateUuidV7(now.getTime());
      const [transaction] = await tx
        .insert(walletTransactionsTable)
        .values({
          id: transactionId,
          userId,
          amount: -cosmetic.priceCoins,
          kind: 'COSMETIC_REDEEM',
          idempotencyKey: `cosmetic:${cosmeticId}`,
          referenceType: 'cosmetic',
          referenceId: cosmeticId,
          metadata: { category: cosmetic.category, symbolicOnly: true },
          createdAt: now,
        })
        .onConflictDoNothing()
        .returning({ id: walletTransactionsTable.id });
      if (!transaction) return false;

      await tx.insert(userCosmeticsTable).values({
        userId,
        cosmeticId,
        transactionId: transaction.id,
        acquiredAt: now,
      });
      return true;
    });
  }

  async readNotification(userId: string, notificationId: string, now = new Date()): Promise<void> {
    const rows = await this.db
      .update(progressionNotificationsTable)
      .set({ readAt: now })
      .where(
        and(
          eq(progressionNotificationsTable.id, notificationId),
          eq(progressionNotificationsTable.userId, userId),
          isNull(progressionNotificationsTable.readAt),
        ),
      )
      .returning({ id: progressionNotificationsTable.id });
    if (rows.length === 0) {
      const [exists] = await this.db
        .select({ id: progressionNotificationsTable.id })
        .from(progressionNotificationsTable)
        .where(
          and(
            eq(progressionNotificationsTable.id, notificationId),
            eq(progressionNotificationsTable.userId, userId),
          ),
        )
        .limit(1);
      if (!exists)
        throw new DomainApiException(404, 'NOT_FOUND', 'No se encontró la notificación.');
    }
  }

  async getAdminConfig(): Promise<ProgressionConfig> {
    return this.db.transaction(async (tx) => configValues(await this.readConfig(tx)));
  }

  async updateAdminConfig(
    config: ProgressionConfig,
    audit: AdminAuditContext,
  ): Promise<ProgressionConfig> {
    return this.db.transaction(async (tx) => {
      const before = await this.readConfig(tx, true);
      const now = new Date();
      const [updated] = await tx
        .update(progressionConfigTable)
        .set({ ...config, version: before.version + 1, updatedBy: audit.actorId, updatedAt: now })
        .where(eq(progressionConfigTable.id, 1))
        .returning();
      if (!updated) throw new Error('No se pudo actualizar la configuración de progresión.');
      await tx.insert(auditLogsTable).values({
        id: generateUuidV7(now.getTime()),
        actorId: audit.actorId,
        action: 'PROGRESSION_CONFIG_UPDATED',
        entity: 'progression_config',
        entityId: '1',
        reason: audit.reason,
        adminSessionId: audit.adminSessionId,
        beforeState: configValues(before),
        afterState: configValues(updated),
        ip: audit.ip,
        createdAt: now,
      });
      return configValues(updated);
    });
  }

  async reverseWalletCredit(
    transactionId: string,
    audit: AdminAuditContext,
  ): Promise<{ transactionId: string; reversed: boolean }> {
    return this.db.transaction(async (tx) => {
      const [original] = await tx
        .select()
        .from(walletTransactionsTable)
        .where(eq(walletTransactionsTable.id, transactionId))
        .limit(1);
      if (!original) throw new DomainApiException(404, 'NOT_FOUND', 'No se encontró el asiento.');
      if (original.amount <= 0 || original.kind === 'ADMIN_REVERSAL') {
        throw new DomainApiException(
          409,
          'CONFLICT',
          'Sólo se pueden revertir créditos positivos.',
          {
            reason: 'REVERSAL_NOT_ALLOWED',
          },
        );
      }

      await this.ensureWalletAccount(tx, original.userId);
      await tx
        .select({ userId: walletAccountsTable.userId })
        .from(walletAccountsTable)
        .where(eq(walletAccountsTable.userId, original.userId))
        .for('update')
        .limit(1);

      const [existing] = await tx
        .select({ id: walletTransactionsTable.id })
        .from(walletTransactionsTable)
        .where(eq(walletTransactionsTable.reversesTransactionId, original.id))
        .limit(1);
      if (existing) return { transactionId: existing.id, reversed: false };

      const now = new Date();
      const reversalId = generateUuidV7(now.getTime());
      const [inserted] = await tx
        .insert(walletTransactionsTable)
        .values({
          id: reversalId,
          userId: original.userId,
          amount: -original.amount,
          kind: 'ADMIN_REVERSAL',
          idempotencyKey: `admin-reversal:${original.id}`,
          referenceType: 'wallet_transaction',
          referenceId: original.id,
          reversesTransactionId: original.id,
          metadata: { reason: audit.reason, actorId: audit.actorId },
          createdAt: now,
        })
        .onConflictDoNothing()
        .returning({ id: walletTransactionsTable.id });
      if (!inserted) {
        const [reversal] = await tx
          .select({ id: walletTransactionsTable.id })
          .from(walletTransactionsTable)
          .where(eq(walletTransactionsTable.reversesTransactionId, original.id))
          .limit(1);
        if (reversal) return { transactionId: reversal.id, reversed: false };
        throw new DomainApiException(409, 'CONFLICT', 'El asiento no pudo revertirse.');
      }

      await tx.insert(auditLogsTable).values({
        id: generateUuidV7(now.getTime() + 1),
        actorId: audit.actorId,
        action: 'WALLET_TRANSACTION_REVERSED',
        entity: 'wallet_transaction',
        entityId: original.id,
        reason: audit.reason,
        adminSessionId: audit.adminSessionId,
        beforeState: { transactionId: original.id, amount: original.amount, kind: original.kind },
        afterState: {
          transactionId: inserted.id,
          amount: -original.amount,
          kind: 'ADMIN_REVERSAL',
        },
        ip: audit.ip,
        createdAt: now,
      });
      return { transactionId: inserted.id, reversed: true };
    });
  }

  private async readConfig(tx: AppTransaction, forUpdate = false): Promise<ProgressionConfigRow> {
    let query = tx
      .select()
      .from(progressionConfigTable)
      .where(eq(progressionConfigTable.id, 1))
      .limit(1);
    if (forUpdate) query = query.for('update') as typeof query;
    const [config] = await query;
    if (!config) throw new Error('Falta la configuración inicial de progresión (id=1).');
    return config as ProgressionConfigRow;
  }

  private async lockOrCreateProfile(
    tx: AppTransaction,
    userId: string,
    now: Date,
  ): Promise<{ xp: number }> {
    const [profile] = await tx
      .select({ xp: profilesTable.xp })
      .from(profilesTable)
      .where(eq(profilesTable.userId, userId))
      .for('update')
      .limit(1);
    if (profile) return profile;
    const [user] = await tx
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.id, userId))
      .limit(1);
    if (!user)
      throw new DomainApiException(404, 'NOT_FOUND', 'No se encontró el perfil del jugador.');
    const [created] = await tx
      .insert(profilesTable)
      .values({ userId, level: 1, xp: 0, createdAt: now, updatedAt: now })
      .onConflictDoNothing({ target: profilesTable.userId })
      .returning({ xp: profilesTable.xp });
    if (created) return created;
    const [reread] = await tx
      .select({ xp: profilesTable.xp })
      .from(profilesTable)
      .where(eq(profilesTable.userId, userId))
      .for('update')
      .limit(1);
    return reread ?? { xp: 0 };
  }

  private async applyXpToProfile(
    tx: AppTransaction,
    userId: string,
    xpAward: number,
    config: ProgressionConfigRow,
    now: Date,
  ): Promise<void> {
    if (xpAward <= 0) return;
    const [profile] = await tx
      .select({ xp: profilesTable.xp })
      .from(profilesTable)
      .where(eq(profilesTable.userId, userId))
      .for('update')
      .limit(1);
    if (!profile) throw new Error('No se encontró el perfil bloqueado para aplicar XP.');
    const xp = profile.xp + xpAward;
    const level = calculateLevelProgress(xp, config.baseXpPerLevel, config.xpGrowthPerLevel).level;
    await tx
      .update(profilesTable)
      .set({ xp, level, updatedAt: now })
      .where(eq(profilesTable.userId, userId));
  }

  private async recordXp(
    tx: AppTransaction,
    input: {
      readonly userId: string;
      readonly idempotencyKey: string;
      readonly sourceKind: string;
      readonly sourceId: string;
      readonly capClass: 'HUMAN_MATCH' | 'BOT_MATCH' | 'BONUS';
      readonly requested: number;
      readonly config: ProgressionConfigRow;
      readonly now: Date;
    },
  ): Promise<number> {
    const dayStart = utcDayStart(input.now);
    const [usedRow] = await tx
      .select({ amount: sql<number>`COALESCE(SUM(${progressionXpEntriesTable.xpAmount}), 0)` })
      .from(progressionXpEntriesTable)
      .where(
        and(
          eq(progressionXpEntriesTable.userId, input.userId),
          eq(progressionXpEntriesTable.capClass, input.capClass),
          gte(progressionXpEntriesTable.createdAt, dayStart),
        ),
      );
    const cap =
      input.capClass === 'HUMAN_MATCH'
        ? input.config.dailyXpCap
        : input.capClass === 'BOT_MATCH'
          ? input.config.botDailyXpCap
          : input.config.dailyBonusXpCap;
    const amount = Math.min(
      Math.max(0, input.requested),
      Math.max(0, cap - Number(usedRow?.amount ?? 0)),
    );
    const [entry] = await tx
      .insert(progressionXpEntriesTable)
      .values({
        id: generateUuidV7(input.now.getTime()),
        userId: input.userId,
        sourceKind: input.sourceKind,
        sourceId: input.sourceId,
        idempotencyKey: input.idempotencyKey,
        capClass: input.capClass,
        xpAmount: amount,
        createdAt: input.now,
      })
      .onConflictDoNothing({
        target: [progressionXpEntriesTable.userId, progressionXpEntriesTable.idempotencyKey],
      })
      .returning({ xpAmount: progressionXpEntriesTable.xpAmount });
    return entry?.xpAmount ?? 0;
  }

  private async ensureWalletAccount(tx: AppTransaction, userId: string): Promise<void> {
    await tx
      .insert(walletAccountsTable)
      .values({
        userId,
        currencyType: 'VIRTUAL_COIN',
        hasEconomicValue: false,
        playerTransfersEnabled: false,
      })
      .onConflictDoNothing({ target: walletAccountsTable.userId });
  }

  private async creditCoins(
    tx: AppTransaction,
    input: WalletCreditInput,
    config: ProgressionConfigRow,
  ): Promise<number> {
    if (input.amount <= 0) return 0;
    await this.ensureWalletAccount(tx, input.userId);
    await tx
      .select({ userId: walletAccountsTable.userId })
      .from(walletAccountsTable)
      .where(eq(walletAccountsTable.userId, input.userId))
      .for('update')
      .limit(1);

    const [alreadyRecorded] = await tx
      .select({ id: walletTransactionsTable.id, amount: walletTransactionsTable.amount })
      .from(walletTransactionsTable)
      .where(
        and(
          eq(walletTransactionsTable.userId, input.userId),
          eq(walletTransactionsTable.idempotencyKey, input.idempotencyKey),
        ),
      )
      .limit(1);
    if (alreadyRecorded) return alreadyRecorded.amount;

    const dayStart = utcDayStart(input.now);
    const [earned] = await tx
      .select({ amount: sql<number>`COALESCE(SUM(${walletTransactionsTable.amount}), 0)` })
      .from(walletTransactionsTable)
      .where(
        and(
          eq(walletTransactionsTable.userId, input.userId),
          gte(walletTransactionsTable.createdAt, dayStart),
          gt(walletTransactionsTable.amount, 0),
        ),
      );
    let remaining = Math.max(0, config.dailyCoinCap - Number(earned?.amount ?? 0));
    if (input.isBotMatch) {
      const [botEarned] = await tx
        .select({ amount: sql<number>`COALESCE(SUM(${walletTransactionsTable.amount}), 0)` })
        .from(walletTransactionsTable)
        .where(
          and(
            eq(walletTransactionsTable.userId, input.userId),
            eq(walletTransactionsTable.referenceType, 'bot_match'),
            gte(walletTransactionsTable.createdAt, dayStart),
            gt(walletTransactionsTable.amount, 0),
          ),
        );
      remaining = Math.min(
        remaining,
        Math.max(0, config.botDailyCoinCap - Number(botEarned?.amount ?? 0)),
      );
    }
    const amount = Math.min(input.amount, remaining);
    if (amount <= 0) return 0;

    const [entry] = await tx
      .insert(walletTransactionsTable)
      .values({
        id: generateUuidV7(input.now.getTime()),
        userId: input.userId,
        amount,
        kind: input.kind,
        idempotencyKey: input.idempotencyKey,
        referenceType: input.referenceType,
        referenceId: input.referenceId,
        metadata: { source: input.referenceType, isBotMatch: input.isBotMatch ?? false },
        createdAt: input.now,
      })
      .onConflictDoNothing()
      .returning({ amount: walletTransactionsTable.amount });
    return entry?.amount ?? 0;
  }

  private async ensureAssignments(tx: AppTransaction, userId: string, at: Date): Promise<void> {
    for (const period of ['DAILY', 'WEEKLY'] as const) {
      const { start, end } = periodBounds(period, at);
      const templates = await tx
        .select()
        .from(questTemplatesTable)
        .where(and(eq(questTemplatesTable.period, period), eq(questTemplatesTable.enabled, true)))
        .orderBy(asc(questTemplatesTable.id));
      if (templates.length === 0) continue;

      const seed = `${period}:${start.toISOString()}:${userId}`;
      const always = templates.filter((template) => template.alwaysAssign).slice(0, 1);
      const selectedIds = new Set(always.map((template) => template.id));
      const remaining = templates
        .filter((template) => !selectedIds.has(template.id))
        .sort((left, right) => stableRank(seed, left.id).localeCompare(stableRank(seed, right.id)))
        .slice(0, Math.max(0, ASSIGNMENTS_PER_PERIOD - always.length));
      const selected = [...always, ...remaining];

      const existing = await tx
        .select({ templateId: userQuestsTable.templateId })
        .from(userQuestsTable)
        .where(
          and(
            eq(userQuestsTable.userId, userId),
            eq(userQuestsTable.period, period),
            eq(userQuestsTable.periodStart, start),
          ),
        );
      const existingIds = new Set(existing.map((row) => row.templateId));
      const newRows = selected
        .filter((template) => !existingIds.has(template.id))
        .map((template) => {
          const condition = this.parseCondition(template.condition);
          return {
            id: generateUuidV7(at.getTime()),
            userId,
            templateId: template.id,
            period,
            periodStart: start,
            periodEnd: end,
            titleKey: template.titleKey,
            descriptionKey: template.descriptionKey,
            condition: template.condition,
            target: condition.target,
            rewardXp: template.rewardXp,
            rewardCoins: template.rewardCoins,
            progress: 0,
            version: 0,
            createdAt: at,
            updatedAt: at,
          };
        });
      if (newRows.length > 0) {
        await tx.insert(userQuestsTable).values(newRows).onConflictDoNothing();
      }
    }
  }

  private async refreshMissionProgress(
    tx: AppTransaction,
    userId: string,
    at: Date,
  ): Promise<void> {
    const active = await tx
      .select()
      .from(userQuestsTable)
      .where(
        and(
          eq(userQuestsTable.userId, userId),
          lte(userQuestsTable.periodStart, at),
          gt(userQuestsTable.periodEnd, at),
        ),
      );
    for (const quest of active) await this.refreshOneMissionProgress(tx, quest, at);
  }

  private async refreshOneMissionProgress(
    tx: AppTransaction,
    quest: typeof userQuestsTable.$inferSelect,
    now: Date,
  ): Promise<void> {
    const condition = this.parseCondition(quest.condition);
    const value = await this.conditionValue(tx, quest.userId, condition, {
      start: quest.periodStart,
      end: quest.periodEnd,
    });
    const progress = Math.min(quest.target, value);
    const completedAt =
      progress >= quest.target ? sql`COALESCE(${userQuestsTable.completedAt}, ${now})` : undefined;
    await tx
      .update(userQuestsTable)
      .set({
        progress,
        version: quest.version + 1,
        updatedAt: now,
        ...(completedAt !== undefined ? { completedAt } : {}),
      })
      .where(eq(userQuestsTable.id, quest.id));
  }

  private async refreshAchievements(
    tx: AppTransaction,
    userId: string,
    config: ProgressionConfigRow,
    now: Date,
    sourceMatchId: string | null,
  ): Promise<void> {
    const catalog = await tx
      .select()
      .from(achievementCatalogTable)
      .where(eq(achievementCatalogTable.enabled, true))
      .orderBy(asc(achievementCatalogTable.id));
    for (const item of catalog) {
      const condition = this.parseCondition(item.condition);
      const progress = await this.conditionValue(tx, userId, condition);
      const [prior] = await tx
        .select()
        .from(userAchievementsTable)
        .where(
          and(
            eq(userAchievementsTable.userId, userId),
            eq(userAchievementsTable.achievementId, item.id),
          ),
        )
        .for('update')
        .limit(1);

      if (!prior) {
        await tx
          .insert(userAchievementsTable)
          .values({
            userId,
            achievementId: item.id,
            progress: Math.min(condition.target, progress),
            unlockedAt: null,
            sourceMatchId: null,
            createdAt: now,
            updatedAt: now,
          })
          .onConflictDoNothing();
      }
      const [locked] = await tx
        .select()
        .from(userAchievementsTable)
        .where(
          and(
            eq(userAchievementsTable.userId, userId),
            eq(userAchievementsTable.achievementId, item.id),
          ),
        )
        .for('update')
        .limit(1);
      if (!locked) continue;

      const reached = progress >= condition.target;
      const isNewUnlock = !locked.unlockedAt && reached;
      await tx
        .update(userAchievementsTable)
        .set({
          progress: Math.max(locked.progress, Math.min(condition.target, progress)),
          updatedAt: now,
          ...(isNewUnlock ? { unlockedAt: now, sourceMatchId } : {}),
        })
        .where(
          and(
            eq(userAchievementsTable.userId, userId),
            eq(userAchievementsTable.achievementId, item.id),
            ...(locked.unlockedAt ? [] : [isNull(userAchievementsTable.unlockedAt)]),
          ),
        );

      if (!isNewUnlock) continue;
      const notificationKey = `achievement:${item.id}`;
      await tx
        .insert(progressionNotificationsTable)
        .values({
          id: generateUuidV7(now.getTime()),
          userId,
          kind: 'ACHIEVEMENT_UNLOCKED',
          idempotencyKey: notificationKey,
          payload: { achievementId: item.id, titleKey: item.titleKey },
          createdAt: now,
        })
        .onConflictDoNothing();

      const xp = Math.floor((item.rewardXp * config.achievementRewardMultiplierBp) / 10_000);
      const xpAward = await this.recordXp(tx, {
        userId,
        idempotencyKey: notificationKey,
        sourceKind: 'ACHIEVEMENT',
        sourceId: item.id,
        capClass: 'BONUS',
        requested: xp,
        config,
        now,
      });
      await this.applyXpToProfile(tx, userId, xpAward, config, now);
      await this.creditCoins(
        tx,
        {
          userId,
          amount: item.rewardCoins,
          kind: 'ACHIEVEMENT_REWARD',
          idempotencyKey: `${notificationKey}:coins`,
          referenceType: 'achievement',
          referenceId: item.id,
          now,
        },
        config,
      );
    }
  }

  private async conditionValue(
    tx: AppTransaction,
    userId: string,
    condition: ProgressionCondition,
    period?: { start: Date; end: Date },
  ): Promise<number> {
    if (condition.kind === 'TUTORIAL_LESSONS') {
      const [tutorial] = await tx
        .select({ completedLessons: tutorialProgressTable.completedLessons })
        .from(tutorialProgressTable)
        .where(eq(tutorialProgressTable.userId, userId))
        .limit(1);
      return tutorial?.completedLessons.length ?? 0;
    }

    if (condition.kind === 'CARD_PLAYS') {
      const clauses = [
        eq(matchPlayersTable.userId, userId),
        eq(matchEventsTable.type, condition.eventType ?? 'game.cardPlayed'),
        sql`${matchesTable.endedAt} IS NOT NULL`,
        reasonNotAbandonSql(),
      ];
      if (period) {
        clauses.push(gte(matchesTable.endedAt, period.start), lt(matchesTable.endedAt, period.end));
      }
      const [count] = await tx
        .select({ value: sql<number>`COUNT(*)` })
        .from(matchEventsTable)
        .innerJoin(matchesTable, eq(matchesTable.id, matchEventsTable.matchId))
        .innerJoin(
          matchPlayersTable,
          and(eq(matchPlayersTable.matchId, matchesTable.id), eq(matchPlayersTable.userId, userId)),
        )
        .where(and(...clauses));
      return Number(count?.value ?? 0);
    }

    const clauses = [
      eq(matchPlayersTable.userId, userId),
      sql`${matchesTable.endedAt} IS NOT NULL`,
      reasonNotAbandonSql(),
    ];
    if (period) {
      clauses.push(gte(matchesTable.endedAt, period.start), lt(matchesTable.endedAt, period.end));
    }
    const [stats] = await tx
      .select({
        matches: sql<number>`COUNT(*)`,
        wins: sql<number>`COUNT(*) FILTER (WHERE ${matchPlayersTable.outcome} = 'WIN')`,
        clean: sql<number>`COUNT(*) FILTER (WHERE ${matchesTable.result}->>'reason' = 'TARGET_SCORE' AND ${matchPlayersTable.outcome} IN ('WIN', 'LOSS'))`,
      })
      .from(matchPlayersTable)
      .innerJoin(matchesTable, eq(matchesTable.id, matchPlayersTable.matchId))
      .where(and(...clauses));

    switch (condition.kind) {
      case 'MATCHES_COMPLETED':
        return Number(stats?.matches ?? 0);
      case 'WINS':
        return Number(stats?.wins ?? 0);
      case 'CLEAN_MATCHES':
        return Number(stats?.clean ?? 0);
    }
  }

  private parseCondition(value: unknown): ProgressionCondition {
    const parsed = ProgressionConditionSchema.safeParse(value);
    if (!parsed.success)
      throw new Error('Hay una condición de progresión inválida en el catálogo.');
    if (
      parsed.data.kind === 'CARD_PLAYS' &&
      parsed.data.eventType !== undefined &&
      parsed.data.eventType !== 'game.cardPlayed'
    ) {
      throw new Error('El catálogo sólo puede contar eventos game.cardPlayed para CARD_PLAYS.');
    }
    return parsed.data;
  }

  private async readAchievements(
    tx: AppTransaction,
    userId: string,
  ): Promise<ProgressionAchievement[]> {
    const rows = await tx
      .select({
        catalog: achievementCatalogTable,
        progress: userAchievementsTable.progress,
        unlockedAt: userAchievementsTable.unlockedAt,
      })
      .from(achievementCatalogTable)
      .leftJoin(
        userAchievementsTable,
        and(
          eq(userAchievementsTable.achievementId, achievementCatalogTable.id),
          eq(userAchievementsTable.userId, userId),
        ),
      )
      .where(eq(achievementCatalogTable.enabled, true))
      .orderBy(asc(achievementCatalogTable.id));
    return rows.map(({ catalog, progress, unlockedAt }) => {
      const condition = this.parseCondition(catalog.condition);
      return {
        id: catalog.id,
        titleKey: catalog.titleKey,
        descriptionKey: catalog.descriptionKey,
        icon: catalog.icon,
        condition,
        progress: progress ?? 0,
        target: condition.target,
        rewardXp: catalog.rewardXp,
        rewardCoins: catalog.rewardCoins,
        unlockedAt: unlockedAt?.toISOString() ?? null,
      };
    });
  }

  private async readMissions(
    tx: AppTransaction,
    userId: string,
    now: Date,
  ): Promise<ProgressionMission[]> {
    const rows = await tx
      .select()
      .from(userQuestsTable)
      .where(and(eq(userQuestsTable.userId, userId), gt(userQuestsTable.periodEnd, now)))
      .orderBy(
        asc(userQuestsTable.period),
        asc(userQuestsTable.periodStart),
        asc(userQuestsTable.templateId),
      );
    return rows.map((row) => {
      const period = ProgressionMissionPeriodSchema.parse(row.period);
      return {
        id: row.id,
        templateId: row.templateId,
        period,
        titleKey: row.titleKey,
        descriptionKey: row.descriptionKey,
        progress: row.progress,
        target: row.target,
        rewardXp: row.rewardXp,
        rewardCoins: row.rewardCoins,
        periodEndsAt: row.periodEnd.toISOString(),
        completedAt: row.completedAt?.toISOString() ?? null,
        claimedAt: row.claimedAt?.toISOString() ?? null,
      };
    });
  }

  private async readCosmetics(tx: AppTransaction, userId: string): Promise<ProgressionCosmetic[]> {
    const [catalog, ownedRows] = await Promise.all([
      tx
        .select()
        .from(cosmeticCatalogTable)
        .where(eq(cosmeticCatalogTable.enabled, true))
        .orderBy(asc(cosmeticCatalogTable.category), asc(cosmeticCatalogTable.priceCoins)),
      tx
        .select({ cosmeticId: userCosmeticsTable.cosmeticId })
        .from(userCosmeticsTable)
        .where(eq(userCosmeticsTable.userId, userId)),
    ]);
    const owned = new Set(ownedRows.map((row) => row.cosmeticId));
    return catalog.map((row) => ({
      id: row.id,
      nameKey: row.nameKey,
      descriptionKey: row.descriptionKey,
      category: row.category,
      priceCoins: row.priceCoins,
      icon: row.icon,
      owned: owned.has(row.id),
    }));
  }

  private async readNotifications(
    tx: AppTransaction,
    userId: string,
  ): Promise<ProgressionNotification[]> {
    const rows = await tx
      .select()
      .from(progressionNotificationsTable)
      .where(eq(progressionNotificationsTable.userId, userId))
      .orderBy(desc(progressionNotificationsTable.createdAt))
      .limit(8);
    return rows.map((row) => ({
      id: row.id,
      kind: 'ACHIEVEMENT_UNLOCKED',
      payload: row.payload,
      createdAt: row.createdAt.toISOString(),
      readAt: row.readAt?.toISOString() ?? null,
    }));
  }
}
