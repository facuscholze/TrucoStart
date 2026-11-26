import { z } from 'zod';
import { AuthUserSummarySchema, RawNicknameInputSchema } from '../auth/auth.schema.js';

export const PrivacyVisibilitySchema = z.enum(['ALL', 'FRIENDS', 'NOBODY']);
export type PrivacyVisibility = z.infer<typeof PrivacyVisibilitySchema>;

export const UserSettingsSchema = z
  .object({
    soundEnabled: z.boolean().default(true),
    animationsReduced: z.boolean().default(false),
    confirmCalls: z.boolean().default(false),
    historyVisibility: PrivacyVisibilitySchema.default('FRIENDS'),
    statsVisibility: PrivacyVisibilitySchema.default('FRIENDS'),
    presenceVisibility: PrivacyVisibilitySchema.default('FRIENDS'),
  })
  .strict();
export type UserSettings = z.infer<typeof UserSettingsSchema>;

/** PATCH must not apply response/default values to settings the caller omitted. */
export const UserSettingsPatchSchema = z
  .object({
    soundEnabled: z.boolean().optional(),
    animationsReduced: z.boolean().optional(),
    confirmCalls: z.boolean().optional(),
    historyVisibility: PrivacyVisibilitySchema.optional(),
    statsVisibility: PrivacyVisibilitySchema.optional(),
    presenceVisibility: PrivacyVisibilitySchema.optional(),
  })
  .strict();
export type UserSettingsPatch = z.infer<typeof UserSettingsPatchSchema>;

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
    settings: UserSettingsPatchSchema.optional(),
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

export const MatchOutcomeSchema = z.enum(['WIN', 'LOSS', 'ABANDON']);
export type MatchOutcome = z.infer<typeof MatchOutcomeSchema>;

export const UserModeStatsSchema = z.object({
  matchesPlayed: z.number().int().nonnegative(),
  wins: z.number().int().nonnegative(),
  losses: z.number().int().nonnegative(),
  abandons: z.number().int().nonnegative(),
  winRate: z.number().min(0).max(1),
  /** Racha vigente de victorias consecutivas, calculada desde el match más reciente. */
  currentStreak: z.number().int().nonnegative(),
  envido: z.object({
    resolved: z.number().int().nonnegative(),
    won: z.number().int().nonnegative(),
    winRate: z.number().min(0).max(1),
  }),
  truco: z.object({
    resolved: z.number().int().nonnegative(),
    won: z.number().int().nonnegative(),
    winRate: z.number().min(0).max(1),
  }),
});
export type UserModeStats = z.infer<typeof UserModeStatsSchema>;

export const UserStatsResponseSchema = z.object({
  userId: z.string().uuid(),
  matchesPlayed: z.number().int().nonnegative(),
  wins: z.number().int().nonnegative(),
  losses: z.number().int().nonnegative(),
  abandons: z.number().int().nonnegative(),
  winRate: z.number().min(0).max(1),
  byMode: z.object({
    '1v1': UserModeStatsSchema,
    '2v2': UserModeStatsSchema,
  }),
});
export type UserStatsResponse = z.infer<typeof UserStatsResponseSchema>;

export const CursorPaginationQuerySchema = z
  .object({
    cursor: z.string().trim().min(1).max(256).optional(),
    limit: z.coerce.number().int().min(1).max(50).optional().default(20),
  })
  .strict();
export type CursorPaginationQuery = z.infer<typeof CursorPaginationQuerySchema>;

export const UserMatchHistoryQuerySchema = z
  .object({
    cursor: z.string().uuid().optional(),
    limit: z.coerce.number().int().min(1).max(50).optional().default(20),
    mode: z.enum(['1v1', '2v2']).optional(),
    outcome: MatchOutcomeSchema.optional(),
    bots: z.enum(['ANY', 'BOTS', 'HUMANS']).optional().default('ANY'),
  })
  .strict();
export type UserMatchHistoryQuery = z.infer<typeof UserMatchHistoryQuerySchema>;

export const UserMatchHistoryItemSchema = z.object({
  matchId: z.string().uuid(),
  mode: z.enum(['1v1', '2v2']),
  rulesetCode: z.string(),
  seat: z.number().int().nonnegative(),
  team: z.number().int().nonnegative(),
  score: z.number().int().nonnegative(),
  outcome: MatchOutcomeSchema,
  hasBots: z.boolean(),
  startedAt: z.string(),
  endedAt: z.string().nullable(),
});
export type UserMatchHistoryItem = z.infer<typeof UserMatchHistoryItemSchema>;

export const UserMatchDetailResponseSchema = z.object({
  matchId: z.string().uuid(),
  mode: z.enum(['1v1', '2v2']),
  rulesetCode: z.string(),
  hasBots: z.boolean(),
  seedCommitment: z.string(),
  startedAt: z.string(),
  endedAt: z.string().nullable(),
  result: z.object({
    winnerTeam: z.number().int().nonnegative().nullable(),
    scoresByTeam: z.record(z.string(), z.number().int().nonnegative()),
    reason: z.string().nullable(),
  }),
  players: z.array(
    z.object({
      userId: z.string().uuid(),
      nickname: z.string(),
      seat: z.number().int().nonnegative(),
      team: z.number().int().nonnegative(),
      score: z.number().int().nonnegative(),
      outcome: MatchOutcomeSchema,
      isSelf: z.boolean(),
    }),
  ),
  /** Sólo eventos de timeline permitidos; nunca se incluye payload de cartas o señas. */
  events: z.array(
    z.object({
      seq: z.number().int().positive(),
      type: z.enum([
        'game.callMade',
        'game.callResolved',
        'game.handEnded',
        'game.scoreUpdated',
        'game.ended',
      ]),
      at: z.string(),
    }),
  ),
});
export type UserMatchDetailResponse = z.infer<typeof UserMatchDetailResponseSchema>;

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
