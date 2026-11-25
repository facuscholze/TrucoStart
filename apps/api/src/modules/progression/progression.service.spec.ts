import { randomUUID } from 'node:crypto';
import { and, eq, isNotNull, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createAdaptiveTestDatabase,
  type AppDatabase,
  type DatabaseConnectionHandle,
} from '../../db/database.provider.js';
import {
  achievementCatalogTable,
  auditLogsTable,
  matchEventsTable,
  matchesTable,
  matchPlayersTable,
  profilesTable,
  progressionConfigTable,
  progressionNotificationsTable,
  progressionXpEntriesTable,
  userAchievementsTable,
  userCosmeticsTable,
  userQuestsTable,
  usersTable,
  walletAccountsTable,
  walletTransactionsTable,
} from '../../db/schema/index.js';
import { generateUuidV7 } from '../../common/uuidv7.js';
import {
  calculateLevelProgress,
  ProgressionService,
  xpThresholdForLevel,
} from './progression.service.js';

const MATCH_TIME = new Date('2026-11-19T12:00:00.000Z');
const HASH = 'a'.repeat(64);

interface SeedUser {
  readonly id: string;
  readonly nickname: string;
}

async function seedUser(db: AppDatabase): Promise<SeedUser> {
  const id = generateUuidV7();
  const nickname = `Progress-${randomUUID().slice(0, 8)}`;
  await db.insert(usersTable).values({ id, nickname, nicknameLower: nickname.toLowerCase() });
  await db.insert(profilesTable).values({ userId: id, level: 1, xp: 0 });
  await db.insert(walletAccountsTable).values({
    userId: id,
    currencyType: 'VIRTUAL_COIN',
    hasEconomicValue: false,
    playerTransfersEnabled: false,
  });
  return { id, nickname };
}

async function seedMatch(
  db: AppDatabase,
  options: {
    readonly players: readonly {
      userId: string;
      seat: number;
      team: number;
      outcome: 'WIN' | 'LOSS' | 'ABANDON';
    }[];
    readonly reason?: 'TARGET_SCORE' | 'ABANDON';
    readonly hasBots?: boolean;
    readonly isPractice?: boolean;
    readonly endedAt?: Date;
    readonly cardPlays?: number;
  },
): Promise<string> {
  const id = generateUuidV7();
  const endedAt = options.endedAt ?? MATCH_TIME;
  await db.insert(matchesTable).values({
    id,
    tableId: null,
    mode: '1v1',
    rulesetId: null,
    rulesetCode: 'ar-standard-v1',
    seedCommitment: HASH,
    startedAt: new Date(endedAt.getTime() - 60_000),
    endedAt,
    result: {
      reason: options.reason ?? 'TARGET_SCORE',
      winnerTeam: 0,
      scoresByTeam: { '0': 15, '1': 9 },
    },
    hasBots: options.hasBots ?? false,
    isPractice: options.isPractice ?? false,
    isCompetitive: false,
  });
  await db.insert(matchPlayersTable).values(
    options.players.map((player) => ({
      matchId: id,
      seat: player.seat,
      userId: player.userId,
      team: player.team,
      score: player.team === 0 ? 15 : 9,
      outcome: player.outcome,
    })),
  );
  const eventCount = options.cardPlays ?? 2;
  await db.insert(matchEventsTable).values(
    Array.from({ length: eventCount }, (_, index) => ({
      matchId: id,
      seq: index + 1,
      type: 'game.cardPlayed',
      payload: { seat: index % 2, team: index % 2, card: '7-espadas' },
      createdAt: new Date(endedAt.getTime() - (eventCount - index) * 1_000),
    })),
  );
  return id;
}

async function totalWallet(db: AppDatabase, userId: string): Promise<number> {
  const [row] = await db
    .select({ balance: sql<number>`COALESCE(SUM(${walletTransactionsTable.amount}), 0)` })
    .from(walletTransactionsTable)
    .where(eq(walletTransactionsTable.userId, userId));
  return Number(row?.balance ?? 0);
}

async function xpForClass(
  db: AppDatabase,
  userId: string,
  capClass: 'HUMAN_MATCH' | 'BOT_MATCH' | 'BONUS',
): Promise<number> {
  const [row] = await db
    .select({ total: sql<number>`COALESCE(SUM(${progressionXpEntriesTable.xpAmount}), 0)` })
    .from(progressionXpEntriesTable)
    .where(
      and(
        eq(progressionXpEntriesTable.userId, userId),
        eq(progressionXpEntriesTable.capClass, capClass),
      ),
    );
  return Number(row?.total ?? 0);
}

describe('M9c — progression persistence (PostgreSQL/PGlite integration)', () => {
  let connection: DatabaseConnectionHandle;
  let db: AppDatabase;
  let progression: ProgressionService;

  beforeAll(async () => {
    connection = await createAdaptiveTestDatabase();
    db = connection.db;
    progression = new ProgressionService(db);
    if (process.env['TRUCO_REQUIRE_REAL_SERVICES'] === '1') {
      expect(connection.kind).toBe('postgres');
      expect(process.env['REDIS_URL']).toBeTruthy();
    }
    console.info(`[M9c integration] database=${connection.kind}`);
  }, 120_000);

  afterAll(async () => {
    await connection?.close();
  });

  beforeEach(async () => {
    await db.update(progressionConfigTable).set({
      humanMatchXp: 25,
      botMatchXp: 8,
      dailyXpCap: 200,
      botDailyXpCap: 40,
      dailyBonusXpCap: 100,
      humanMatchCoins: 3,
      botMatchCoins: 1,
      dailyCoinCap: 40,
      botDailyCoinCap: 10,
      dailyCoinSpendCap: 100,
      baseXpPerLevel: 100,
      xpGrowthPerLevel: 50,
      missionRewardMultiplierBp: 10_000,
      achievementRewardMultiplierBp: 10_000,
    });
    for (const reward of [
      { id: 'first_match', rewardXp: 10, rewardCoins: 3 },
      { id: 'clean_table', rewardXp: 30, rewardCoins: 8 },
      { id: 'tutorial_graduate', rewardXp: 15, rewardCoins: 4 },
      { id: 'card_slinger', rewardXp: 20, rewardCoins: 5 },
    ]) {
      await db
        .update(achievementCatalogTable)
        .set({ rewardXp: reward.rewardXp, rewardCoins: reward.rewardCoins })
        .where(eq(achievementCatalogTable.id, reward.id));
    }
  });

  it('calcula niveles por curva configurable y conserva XP total como fuente de verdad', () => {
    // Los umbrales por defecto: nivel 2 = 100 XP; nivel 3 = 250 XP.
    expect(xpThresholdForLevel(2, 100, 50)).toBe(100);
    expect(xpThresholdForLevel(3, 100, 50)).toBe(250);
    expect(calculateLevelProgress(149, 100, 50)).toMatchObject({
      level: 2,
      xpInLevel: 49,
      xpForNextLevel: 150,
    });
  });

  it('otorga XP y logros por matchId una sola vez, y nunca por abandono', async () => {
    const player = await seedUser(db);
    const opponent = await seedUser(db);
    const matchId = await seedMatch(db, {
      players: [
        { userId: player.id, seat: 0, team: 0, outcome: 'WIN' },
        { userId: opponent.id, seat: 1, team: 1, outcome: 'LOSS' },
      ],
      cardPlays: 40,
    });

    await progression.processCompletedMatch(matchId);
    const [first] = await db
      .select({ xp: profilesTable.xp, level: profilesTable.level })
      .from(profilesTable)
      .where(eq(profilesTable.userId, player.id));
    await progression.processCompletedMatch(matchId);
    const [second] = await db
      .select({ xp: profilesTable.xp, level: profilesTable.level })
      .from(profilesTable)
      .where(eq(profilesTable.userId, player.id));
    expect(second).toEqual(first);
    expect(first!.xp).toBeGreaterThanOrEqual(25);
    expect(await xpForClass(db, player.id, 'HUMAN_MATCH')).toBe(25);
    expect(await totalWallet(db, player.id)).toBeGreaterThan(0);

    const unlocked = await db
      .select({ achievementId: userAchievementsTable.achievementId })
      .from(userAchievementsTable)
      .where(
        and(
          eq(userAchievementsTable.userId, player.id),
          isNotNull(userAchievementsTable.unlockedAt),
        ),
      );
    expect(unlocked.map((row) => row.achievementId)).toEqual(
      expect.arrayContaining(['first_match', 'card_slinger']),
    );
    const notifications = await db
      .select({ id: progressionNotificationsTable.id })
      .from(progressionNotificationsTable)
      .where(eq(progressionNotificationsTable.userId, player.id));
    expect(notifications.length).toBeGreaterThanOrEqual(2);

    const abandonedId = await seedMatch(db, {
      reason: 'ABANDON',
      players: [
        { userId: player.id, seat: 0, team: 0, outcome: 'ABANDON' },
        { userId: opponent.id, seat: 1, team: 1, outcome: 'WIN' },
      ],
    });
    const beforeAbandon = await xpForClass(db, player.id, 'HUMAN_MATCH');
    await progression.processCompletedMatch(abandonedId);
    expect(await xpForClass(db, player.id, 'HUMAN_MATCH')).toBe(beforeAbandon);
    const [abandonReceipt] = await db
      .select({ id: progressionXpEntriesTable.id })
      .from(progressionXpEntriesTable)
      .where(
        and(
          eq(progressionXpEntriesTable.userId, player.id),
          eq(progressionXpEntriesTable.sourceId, abandonedId),
        ),
      );
    expect(abandonReceipt).toBeUndefined();
  });

  it('rechaza valor económico, compras con dinero y transferencias en las restricciones de wallet', async () => {
    const player = await seedUser(db);

    await expect(
      db
        .update(walletAccountsTable)
        .set({ hasEconomicValue: true })
        .where(eq(walletAccountsTable.userId, player.id)),
    ).rejects.toThrow();
    await expect(
      db
        .update(walletAccountsTable)
        .set({ playerTransfersEnabled: true })
        .where(eq(walletAccountsTable.userId, player.id)),
    ).rejects.toThrow();
    await expect(
      db.update(progressionConfigTable).set({ hasEconomicValue: true }),
    ).rejects.toThrow();
    await expect(
      db.update(progressionConfigTable).set({ playerTransfersEnabled: true }),
    ).rejects.toThrow();
    await expect(
      db.update(progressionConfigTable).set({ moneyPurchasesEnabled: true }),
    ).rejects.toThrow();
    await expect(
      db.execute(sql`UPDATE progression_config SET currency_type = 'FIAT' WHERE id = 1`),
    ).rejects.toThrow();
  });

  it('aplica topes diarios separados para partidas humanas, bots y bonos; monedas con tope diario', async () => {
    const player = await seedUser(db);
    await db.update(progressionConfigTable).set({
      humanMatchXp: 25,
      botMatchXp: 8,
      dailyXpCap: 30,
      botDailyXpCap: 10,
      dailyBonusXpCap: 0,
      humanMatchCoins: 3,
      botMatchCoins: 2,
      dailyCoinCap: 4,
      botDailyCoinCap: 3,
      achievementRewardMultiplierBp: 0,
    });
    await db.update(achievementCatalogTable).set({ rewardCoins: 0 });

    for (let index = 0; index < 2; index++) {
      const matchId = await seedMatch(db, {
        endedAt: new Date(MATCH_TIME.getTime() + index * 1_000),
        players: [{ userId: player.id, seat: 0, team: 0, outcome: 'WIN' }],
      });
      await progression.processCompletedMatch(matchId);
    }
    expect(await xpForClass(db, player.id, 'HUMAN_MATCH')).toBe(30);
    expect(await totalWallet(db, player.id)).toBe(4);

    const botUser = await seedUser(db);
    for (let index = 0; index < 3; index++) {
      const matchId = await seedMatch(db, {
        hasBots: true,
        endedAt: new Date(MATCH_TIME.getTime() + index * 1_000),
        players: [{ userId: botUser.id, seat: 0, team: 0, outcome: 'WIN' }],
      });
      await progression.processCompletedMatch(matchId);
    }
    expect(await xpForClass(db, botUser.id, 'BOT_MATCH')).toBe(10);
    expect(await xpForClass(db, botUser.id, 'HUMAN_MATCH')).toBe(0);
    expect(await totalWallet(db, botUser.id)).toBe(3);

    const practiceUser = await seedUser(db);
    const practiceMatchId = await seedMatch(db, {
      hasBots: false,
      isPractice: true,
      endedAt: new Date(MATCH_TIME.getTime() + 5_000),
      players: [{ userId: practiceUser.id, seat: 0, team: 0, outcome: 'WIN' }],
    });
    await progression.processCompletedMatch(practiceMatchId);
    expect(await xpForClass(db, practiceUser.id, 'BOT_MATCH')).toBe(8);
    expect(await xpForClass(db, practiceUser.id, 'HUMAN_MATCH')).toBe(0);
    expect(await totalWallet(db, practiceUser.id)).toBe(2);
  });

  it('asigna misiones determinísticamente y reclama en concurrencia sin duplicar recompensas', async () => {
    const player = await seedUser(db);
    const opponent = await seedUser(db);
    const matchId = await seedMatch(db, {
      players: [
        { userId: player.id, seat: 0, team: 0, outcome: 'WIN' },
        { userId: opponent.id, seat: 1, team: 1, outcome: 'LOSS' },
      ],
    });
    await progression.processCompletedMatch(matchId);

    const firstSummary = await progression.getSummary(player.id, MATCH_TIME);
    const secondSummary = await progression.getSummary(player.id, MATCH_TIME);
    expect(firstSummary.missions.map((quest) => quest.templateId)).toEqual(
      secondSummary.missions.map((quest) => quest.templateId),
    );
    const mission = firstSummary.missions.find((quest) => quest.templateId === 'daily_play_match');
    expect(mission?.completedAt).not.toBeNull();
    const claims = await Promise.all([
      progression.claimMission(player.id, mission!.id, MATCH_TIME),
      progression.claimMission(player.id, mission!.id, MATCH_TIME),
    ]);
    expect(claims.filter(Boolean)).toHaveLength(1);
    const [coinRewards] = await db
      .select({ count: sql<number>`COUNT(*)` })
      .from(walletTransactionsTable)
      .where(
        and(
          eq(walletTransactionsTable.userId, player.id),
          eq(walletTransactionsTable.idempotencyKey, `mission:${mission!.id}:coins`),
        ),
      );
    expect(Number(coinRewards?.count ?? 0)).toBe(1);
    const [claimed] = await db
      .select({ claimedAt: userQuestsTable.claimedAt })
      .from(userQuestsTable)
      .where(eq(userQuestsTable.id, mission!.id));
    expect(claimed?.claimedAt).not.toBeNull();
  });

  it('serializa canjes concurrentes para no sobregirar; el saldo es derivado e inmutable', async () => {
    const player = await seedUser(db);
    await db.insert(walletTransactionsTable).values({
      id: generateUuidV7(),
      userId: player.id,
      amount: 50,
      kind: 'MATCH_REWARD',
      idempotencyKey: `seed:${randomUUID()}`,
      referenceType: 'test_seed',
      referenceId: player.id,
      createdAt: MATCH_TIME,
    });

    const purchases = await Promise.allSettled([
      progression.redeemCosmetic(player.id, 'frame_sunrise', MATCH_TIME),
      progression.redeemCosmetic(player.id, 'card_back_flor', MATCH_TIME),
    ]);
    expect(purchases.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(purchases.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect(await totalWallet(db, player.id)).toBeGreaterThanOrEqual(0);
    const owned = await db
      .select({ cosmeticId: userCosmeticsTable.cosmeticId })
      .from(userCosmeticsTable)
      .where(eq(userCosmeticsTable.userId, player.id));
    expect(owned).toHaveLength(1);

    await expect(
      db.insert(walletTransactionsTable).values({
        id: generateUuidV7(),
        userId: player.id,
        amount: -10_000,
        kind: 'COSMETIC_REDEEM',
        idempotencyKey: `overspend:${randomUUID()}`,
        referenceType: 'cosmetic',
        referenceId: 'not-owned',
        createdAt: MATCH_TIME,
      }),
    ).rejects.toThrow();
    await expect(
      db
        .update(walletTransactionsTable)
        .set({ amount: 1 })
        .where(eq(walletTransactionsTable.userId, player.id)),
    ).rejects.toThrow();
    await expect(
      db.delete(walletTransactionsTable).where(eq(walletTransactionsTable.userId, player.id)),
    ).rejects.toThrow();
  });

  it('aplica el tope diario de gasto y registra configuración/reversión en auditoría', async () => {
    const player = await seedUser(db);
    const admin = await seedUser(db);
    await db.update(progressionConfigTable).set({ dailyCoinSpendCap: 20 });
    await db.insert(walletTransactionsTable).values({
      id: generateUuidV7(),
      userId: player.id,
      amount: 100,
      kind: 'MATCH_REWARD',
      idempotencyKey: `seed:${randomUUID()}`,
      referenceType: 'test_seed',
      referenceId: player.id,
      createdAt: MATCH_TIME,
    });
    expect(await progression.redeemCosmetic(player.id, 'frame_sunrise', MATCH_TIME)).toBe(true);
    await expect(
      progression.redeemCosmetic(player.id, 'card_back_flor', MATCH_TIME),
    ).rejects.toThrow(/límite diario/i);

    const config = await progression.getAdminConfig();
    await progression.updateAdminConfig(
      { ...config, humanMatchXp: config.humanMatchXp + 1 },
      {
        actorId: admin.id,
        adminSessionId: generateUuidV7(),
        ip: '127.0.0.1',
        reason: 'Ajuste de balance de progresión documentado',
      },
    );
    const [configAudit] = await db
      .select({ action: auditLogsTable.action })
      .from(auditLogsTable)
      .where(eq(auditLogsTable.action, 'PROGRESSION_CONFIG_UPDATED'));
    expect(configAudit?.action).toBe('PROGRESSION_CONFIG_UPDATED');

    const creditId = generateUuidV7();
    await db.insert(walletTransactionsTable).values({
      id: creditId,
      userId: player.id,
      amount: 5,
      kind: 'MATCH_REWARD',
      idempotencyKey: `reversible:${randomUUID()}`,
      referenceType: 'test_credit',
      referenceId: player.id,
      createdAt: new Date(MATCH_TIME.getTime() + 10_000),
    });
    const auditContext = {
      actorId: admin.id,
      adminSessionId: generateUuidV7(),
      ip: '127.0.0.1',
      reason: 'Corrección por crédito de prueba otorgado por error',
    };
    const reversal = await progression.reverseWalletCredit(creditId, auditContext);
    const retry = await progression.reverseWalletCredit(creditId, auditContext);
    expect(reversal.reversed).toBe(true);
    expect(retry.reversed).toBe(false);
    expect(retry.transactionId).toBe(reversal.transactionId);
    const [reversalAudit] = await db
      .select({ action: auditLogsTable.action })
      .from(auditLogsTable)
      .where(eq(auditLogsTable.action, 'WALLET_TRANSACTION_REVERSED'));
    expect(reversalAudit?.action).toBe('WALLET_TRANSACTION_REVERSED');
  });

  it('e2e persistencia de partida → XP, logro con notificación y misión con progreso server-side', async () => {
    const player = await seedUser(db);
    const opponent = await seedUser(db);
    const matchId = await seedMatch(db, {
      cardPlays: 40,
      players: [
        { userId: player.id, seat: 0, team: 0, outcome: 'WIN' },
        { userId: opponent.id, seat: 1, team: 1, outcome: 'LOSS' },
      ],
    });
    await progression.processCompletedMatch(matchId);

    const summary = await progression.getSummary(player.id, MATCH_TIME);
    expect(summary.xpTotal).toBeGreaterThanOrEqual(25);
    expect(
      summary.achievements.find((achievement) => achievement.id === 'first_match')?.unlockedAt,
    ).not.toBeNull();
    expect(
      summary.achievements.find((achievement) => achievement.id === 'card_slinger')?.unlockedAt,
    ).not.toBeNull();
    expect(
      summary.notifications.filter((notification) => notification.kind === 'ACHIEVEMENT_UNLOCKED'),
    ).toHaveLength(2);
    expect(
      summary.missions.find((mission) => mission.templateId === 'daily_play_match')?.progress,
    ).toBe(1);
    expect(summary.wallet).toMatchObject({
      currencyType: 'VIRTUAL_COIN',
      hasEconomicValue: false,
      playerTransfersEnabled: false,
      moneyPurchasesEnabled: false,
    });
    expect(summary.wallet.balance).toBe(await totalWallet(db, player.id));
    expect(summary.wallet.balance).toBeGreaterThanOrEqual(0);
  });
});
