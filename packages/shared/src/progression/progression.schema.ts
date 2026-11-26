import { z } from 'zod';

export const ProgressionConditionKindSchema = z.enum([
  'MATCHES_COMPLETED',
  'WINS',
  'CLEAN_MATCHES',
  'CARD_PLAYS',
  'TUTORIAL_LESSONS',
]);
export type ProgressionConditionKind = z.infer<typeof ProgressionConditionKindSchema>;

/**
 * Las condiciones son datos de catálogo, pero el servidor sólo interpreta estos
 * operadores verificables; nunca acepta progreso enviado por el cliente.
 */
export const ProgressionConditionSchema = z
  .object({
    kind: ProgressionConditionKindSchema,
    target: z.number().int().positive(),
    eventType: z.string().max(64).optional(),
  })
  .strict();
export type ProgressionCondition = z.infer<typeof ProgressionConditionSchema>;

export const ProgressionMissionPeriodSchema = z.enum(['DAILY', 'WEEKLY']);
export type ProgressionMissionPeriod = z.infer<typeof ProgressionMissionPeriodSchema>;

export const ProgressionAchievementSchema = z.object({
  id: z.string(),
  titleKey: z.string(),
  descriptionKey: z.string(),
  icon: z.string(),
  condition: ProgressionConditionSchema,
  progress: z.number().int().nonnegative(),
  target: z.number().int().positive(),
  rewardXp: z.number().int().nonnegative(),
  rewardCoins: z.number().int().nonnegative(),
  unlockedAt: z.string().nullable(),
});
export type ProgressionAchievement = z.infer<typeof ProgressionAchievementSchema>;

export const ProgressionMissionSchema = z.object({
  id: z.string().uuid(),
  templateId: z.string(),
  period: ProgressionMissionPeriodSchema,
  titleKey: z.string(),
  descriptionKey: z.string(),
  progress: z.number().int().nonnegative(),
  target: z.number().int().positive(),
  rewardXp: z.number().int().nonnegative(),
  rewardCoins: z.number().int().nonnegative(),
  periodEndsAt: z.string(),
  completedAt: z.string().nullable(),
  claimedAt: z.string().nullable(),
});
export type ProgressionMission = z.infer<typeof ProgressionMissionSchema>;

export const ProgressionCosmeticSchema = z.object({
  id: z.string(),
  nameKey: z.string(),
  descriptionKey: z.string(),
  category: z.string(),
  priceCoins: z.number().int().nonnegative(),
  icon: z.string(),
  owned: z.boolean(),
});
export type ProgressionCosmetic = z.infer<typeof ProgressionCosmeticSchema>;

export const ProgressionNotificationSchema = z.object({
  id: z.string().uuid(),
  kind: z.enum(['ACHIEVEMENT_UNLOCKED']),
  payload: z.record(z.string(), z.unknown()),
  createdAt: z.string(),
  readAt: z.string().nullable(),
});
export type ProgressionNotification = z.infer<typeof ProgressionNotificationSchema>;

export const ProgressionSummarySchema = z.object({
  level: z.number().int().min(1),
  xpTotal: z.number().int().nonnegative(),
  xpInLevel: z.number().int().nonnegative(),
  xpForNextLevel: z.number().int().positive(),
  levelProgress: z.number().min(0).max(1),
  wallet: z.object({
    balance: z.number().int().nonnegative(),
    currencyType: z.literal('VIRTUAL_COIN'),
    hasEconomicValue: z.literal(false),
    playerTransfersEnabled: z.literal(false),
    moneyPurchasesEnabled: z.literal(false),
  }),
  achievements: z.array(ProgressionAchievementSchema),
  missions: z.array(ProgressionMissionSchema),
  cosmetics: z.array(ProgressionCosmeticSchema),
  notifications: z.array(ProgressionNotificationSchema),
});
export type ProgressionSummary = z.infer<typeof ProgressionSummarySchema>;

export const ProgressionMissionClaimResponseSchema = z.object({
  claimed: z.boolean(),
  progression: ProgressionSummarySchema,
});
export type ProgressionMissionClaimResponse = z.infer<typeof ProgressionMissionClaimResponseSchema>;

export const ProgressionCosmeticRedeemResponseSchema = z.object({
  acquired: z.boolean(),
  progression: ProgressionSummarySchema,
});
export type ProgressionCosmeticRedeemResponse = z.infer<
  typeof ProgressionCosmeticRedeemResponseSchema
>;

export const ProgressionConfigSchema = z.object({
  humanMatchXp: z.number().int().min(0).max(10_000),
  botMatchXp: z.number().int().min(0).max(10_000),
  dailyXpCap: z.number().int().min(0).max(100_000),
  botDailyXpCap: z.number().int().min(0).max(100_000),
  dailyBonusXpCap: z.number().int().min(0).max(100_000),
  humanMatchCoins: z.number().int().min(0).max(1_000),
  botMatchCoins: z.number().int().min(0).max(1_000),
  dailyCoinCap: z.number().int().min(0).max(10_000),
  botDailyCoinCap: z.number().int().min(0).max(10_000),
  dailyCoinSpendCap: z.number().int().min(0).max(10_000),
  baseXpPerLevel: z.number().int().min(1).max(1_000_000),
  xpGrowthPerLevel: z.number().int().min(0).max(1_000_000),
  missionRewardMultiplierBp: z.number().int().min(0).max(50_000),
  achievementRewardMultiplierBp: z.number().int().min(0).max(50_000),
});
export type ProgressionConfig = z.infer<typeof ProgressionConfigSchema>;

export const ProgressionConfigUpdateRequestSchema = z
  .object({
    reason: z.string().trim().min(10).max(500),
    config: ProgressionConfigSchema,
  })
  .strict();
export type ProgressionConfigUpdateRequest = z.infer<typeof ProgressionConfigUpdateRequestSchema>;

export const ProgressionAdminReversalRequestSchema = z
  .object({ reason: z.string().trim().min(10).max(500) })
  .strict();
export type ProgressionAdminReversalRequest = z.infer<typeof ProgressionAdminReversalRequestSchema>;
