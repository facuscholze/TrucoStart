import { z } from 'zod';
import { GameModeSchema } from '../ws/client-events.schema.js';

export const RankingPeriodSchema = z.enum(['GLOBAL', 'WEEKLY', 'MONTHLY']);
export type RankingPeriod = z.infer<typeof RankingPeriodSchema>;

export const RatingDivisionSchema = z.enum(['Bronce', 'Plata', 'Oro', 'Diamante']);
export type RatingDivision = z.infer<typeof RatingDivisionSchema>;

export const LeaderboardQuerySchema = z
  .object({
    period: RankingPeriodSchema.optional().default('GLOBAL'),
    mode: GameModeSchema.optional().default('1v1'),
    cursor: z
      .string()
      .regex(/^\d{1,7}$/)
      .optional(),
    limit: z.coerce.number().int().min(1).max(50).optional().default(20),
  })
  .strict();
export type LeaderboardQuery = z.infer<typeof LeaderboardQuerySchema>;

export const LeaderboardEntrySchema = z.object({
  position: z.number().int().positive(),
  userId: z.string().uuid(),
  nickname: z.string().min(1).max(32),
  /** Puntaje por período; para GLOBAL equivale al rating vigente. */
  score: z.number().finite(),
  rating: z.number().finite().nonnegative(),
  division: RatingDivisionSchema,
  matchesPlayed: z.number().int().nonnegative(),
  opponentsCount: z.number().int().nonnegative(),
  wins: z.number().int().nonnegative(),
});
export type LeaderboardEntry = z.infer<typeof LeaderboardEntrySchema>;

export const LeaderboardResponseSchema = z.object({
  period: RankingPeriodSchema,
  mode: GameModeSchema,
  season: z.object({
    id: z.string().uuid(),
    label: z.string(),
    startsAt: z.string().datetime(),
    endsAt: z.string().datetime(),
    secondsUntilReset: z.number().int().nonnegative(),
  }),
  minimumMatches: z.number().int().nonnegative(),
  minimumOpponents: z.number().int().nonnegative(),
  items: z.array(LeaderboardEntrySchema),
  nextCursor: z.string().nullable(),
  generatedAt: z.string().datetime(),
});
export type LeaderboardResponse = z.infer<typeof LeaderboardResponseSchema>;

export const PlayerRatingProfileSchema = z.object({
  seasonId: z.string().uuid(),
  seasonLabel: z.string(),
  seasonEndsAt: z.string().datetime(),
  mode: GameModeSchema,
  rating: z.number().finite().nonnegative(),
  deviation: z.number().finite().min(30).max(350),
  division: RatingDivisionSchema,
  position: z.number().int().positive().nullable(),
  matchesPlayed: z.number().int().nonnegative(),
  opponentsCount: z.number().int().nonnegative(),
  wins: z.number().int().nonnegative(),
  losses: z.number().int().nonnegative(),
  abandons: z.number().int().nonnegative(),
  qualifies: z.boolean(),
});
export type PlayerRatingProfile = z.infer<typeof PlayerRatingProfileSchema>;

export const PlayerRatingResponseSchema = z.object({
  ratings: z.array(PlayerRatingProfileSchema).length(2),
});
export type PlayerRatingResponse = z.infer<typeof PlayerRatingResponseSchema>;

export const CompetitiveReviewStatusSchema = z.enum(['OPEN', 'IN_REVIEW', 'RESOLVED']);
export type CompetitiveReviewStatus = z.infer<typeof CompetitiveReviewStatusSchema>;

export const CompetitiveReviewCaseSchema = z.object({
  id: z.string().uuid(),
  status: CompetitiveReviewStatusSchema,
  severity: z.enum(['LOW', 'MEDIUM', 'HIGH']),
  signals: z.array(z.string()),
  users: z.array(
    z.object({
      id: z.string().uuid(),
      nickname: z.string(),
      accountCreatedAt: z.string().datetime().nullable(),
    }),
  ),
  matchIds: z.array(z.string().uuid()),
  evidence: z.record(z.string(), z.unknown()),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  claimedByNickname: z.string().nullable(),
  resolvedByNickname: z.string().nullable(),
  resolutionNote: z.string().nullable(),
  version: z.number().int().nonnegative(),
});
export type CompetitiveReviewCase = z.infer<typeof CompetitiveReviewCaseSchema>;

export const CompetitiveReviewListResponseSchema = z.object({
  items: z.array(CompetitiveReviewCaseSchema),
  nextCursor: z.string().nullable(),
});
export type CompetitiveReviewListResponse = z.infer<typeof CompetitiveReviewListResponseSchema>;

export const CompetitiveReviewClaimRequestSchema = z
  .object({ expectedVersion: z.number().int().nonnegative() })
  .strict();
export type CompetitiveReviewClaimRequest = z.infer<typeof CompetitiveReviewClaimRequestSchema>;

export const CompetitiveReviewResolveRequestSchema = z
  .object({
    expectedVersion: z.number().int().nonnegative(),
    resolutionNote: z.string().trim().min(10).max(1000),
  })
  .strict();
export type CompetitiveReviewResolveRequest = z.infer<typeof CompetitiveReviewResolveRequestSchema>;
