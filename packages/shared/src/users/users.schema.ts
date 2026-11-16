import { z } from 'zod';
import { AuthUserSummarySchema, RawNicknameInputSchema } from '../auth/auth.schema.js';

export const UserSettingsSchema = z
  .object({
    soundEnabled: z.boolean().default(true),
    animationsReduced: z.boolean().default(false),
    confirmCalls: z.boolean().default(false),
  })
  .strict();
export type UserSettings = z.infer<typeof UserSettingsSchema>;

export const ProfileDetailsSchema = z.object({
  avatarId: z.string().min(1).max(64),
  level: z.number().int().min(1),
  xp: z.number().int().nonnegative(),
  bio: z.string().max(280),
  settings: UserSettingsSchema,
});
export type ProfileDetails = z.infer<typeof ProfileDetailsSchema>;

export const MeResponseSchema = z.object({
  user: AuthUserSummarySchema,
  profile: ProfileDetailsSchema,
});
export type MeResponse = z.infer<typeof MeResponseSchema>;

export const PatchMeRequestSchema = z
  .object({
    nickname: RawNicknameInputSchema.optional(),
    avatarId: z.string().trim().min(1).max(64).optional(),
    bio: z.string().trim().max(280).optional(),
    settings: UserSettingsSchema.partial().optional(),
  })
  .strict();
export type PatchMeRequest = z.infer<typeof PatchMeRequestSchema>;

export const PublicUserProfileSchema = z.object({
  id: z.string().uuid(),
  nickname: z.string(),
  isGuest: z.boolean(),
  avatarId: z.string(),
  level: z.number().int().min(1),
  xp: z.number().int().nonnegative(),
  bio: z.string(),
  createdAt: z.string(),
});
export type PublicUserProfile = z.infer<typeof PublicUserProfileSchema>;

export const UserStatsResponseSchema = z.object({
  userId: z.string().uuid(),
  matchesPlayed: z.number().int().nonnegative(),
  wins: z.number().int().nonnegative(),
  losses: z.number().int().nonnegative(),
  abandons: z.number().int().nonnegative(),
  winRate: z.number().min(0).max(1),
});
export type UserStatsResponse = z.infer<typeof UserStatsResponseSchema>;

export const CursorPaginationQuerySchema = z
  .object({
    cursor: z.string().trim().min(1).max(256).optional(),
    limit: z.coerce.number().int().min(1).max(50).optional().default(20),
  })
  .strict();
export type CursorPaginationQuery = z.infer<typeof CursorPaginationQuerySchema>;

export const MatchOutcomeSchema = z.enum(['WIN', 'LOSS', 'ABANDON']);
export type MatchOutcome = z.infer<typeof MatchOutcomeSchema>;

export const UserMatchHistoryItemSchema = z.object({
  matchId: z.string().uuid(),
  mode: z.enum(['1v1', '2v2']),
  rulesetCode: z.string(),
  seat: z.number().int().nonnegative(),
  team: z.number().int().nonnegative(),
  score: z.number().int().nonnegative(),
  outcome: MatchOutcomeSchema,
  startedAt: z.string(),
  endedAt: z.string().nullable(),
});
export type UserMatchHistoryItem = z.infer<typeof UserMatchHistoryItemSchema>;

export const UserMatchesResponseSchema = z.object({
  items: z.array(UserMatchHistoryItemSchema),
  nextCursor: z.string().nullable(),
});
export type UserMatchesResponse = z.infer<typeof UserMatchesResponseSchema>;

export const AccountExportResponseSchema = z.object({
  exportedAt: z.string(),
  user: AuthUserSummarySchema,
  profile: ProfileDetailsSchema,
  activeSessionsCount: z.number().int().nonnegative(),
  stats: UserStatsResponseSchema,
  recentMatches: z.array(UserMatchHistoryItemSchema),
});
export type AccountExportResponse = z.infer<typeof AccountExportResponseSchema>;

export const DeleteAccountResponseSchema = z.object({
  deleted: z.literal(true),
  userId: z.string().uuid(),
});
export type DeleteAccountResponse = z.infer<typeof DeleteAccountResponseSchema>;
