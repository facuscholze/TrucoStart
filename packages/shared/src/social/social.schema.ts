import { z } from 'zod';
import { RulesetCodeSchema } from '../ws/client-events.schema.js';
import { TableDetailResponseSchema } from '../lobby/lobby.schema.js';

export const SocialPresenceStatusSchema = z.enum(['ONLINE', 'IN_GAME', 'OFFLINE']);
export type SocialPresenceStatus = z.infer<typeof SocialPresenceStatusSchema>;

export const PlayerRelationshipStatusSchema = z.enum([
  'NONE',
  'FRIENDS',
  'PENDING_INCOMING',
  'PENDING_OUTGOING',
]);
export type PlayerRelationshipStatus = z.infer<typeof PlayerRelationshipStatusSchema>;

export const PlayerSearchQuerySchema = z
  .object({
    nickname: z.string().trim().min(2).max(32),
    limit: z.coerce.number().int().min(1).max(20).optional().default(10),
  })
  .strict();
export type PlayerSearchQuery = z.infer<typeof PlayerSearchQuerySchema>;

export const PlayerSearchResultSchema = z.object({
  userId: z.string().uuid(),
  nickname: z.string(),
  avatarId: z.string(),
  level: z.number().int().min(1),
  relationship: PlayerRelationshipStatusSchema,
});
export type PlayerSearchResult = z.infer<typeof PlayerSearchResultSchema>;

export const PlayerSearchResponseSchema = z.object({
  items: z.array(PlayerSearchResultSchema).max(20),
});
export type PlayerSearchResponse = z.infer<typeof PlayerSearchResponseSchema>;

export const FriendListItemSchema = z.object({
  friendshipId: z.string().uuid(),
  userId: z.string().uuid(),
  nickname: z.string(),
  avatarId: z.string(),
  level: z.number().int().min(1),
  presence: SocialPresenceStatusSchema.nullable(),
  friendsSince: z.string(),
});
export type FriendListItem = z.infer<typeof FriendListItemSchema>;

export const FriendListResponseSchema = z.object({
  items: z.array(FriendListItemSchema),
});
export type FriendListResponse = z.infer<typeof FriendListResponseSchema>;

export const FriendRequestDirectionSchema = z.enum(['INCOMING', 'OUTGOING']);
export type FriendRequestDirection = z.infer<typeof FriendRequestDirectionSchema>;

export const FriendRequestListItemSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  nickname: z.string(),
  avatarId: z.string(),
  direction: FriendRequestDirectionSchema,
  createdAt: z.string(),
});
export type FriendRequestListItem = z.infer<typeof FriendRequestListItemSchema>;

export const FriendRequestListResponseSchema = z.object({
  items: z.array(FriendRequestListItemSchema),
});
export type FriendRequestListResponse = z.infer<typeof FriendRequestListResponseSchema>;

export const CreateFriendRequestSchema = z.object({ targetUserId: z.string().uuid() }).strict();
export type CreateFriendRequest = z.infer<typeof CreateFriendRequestSchema>;

export const FriendRequestMutationResponseSchema = z.object({
  requestId: z.string().uuid(),
  status: z.enum(['PENDING', 'ACCEPTED', 'REJECTED', 'CANCELLED']),
  reciprocalRequestAccepted: z.boolean(),
});
export type FriendRequestMutationResponse = z.infer<typeof FriendRequestMutationResponseSchema>;

export const BlockedUserSchema = z.object({
  userId: z.string().uuid(),
  nickname: z.string(),
  blockedAt: z.string(),
});
export const BlockListResponseSchema = z.object({ items: z.array(BlockedUserSchema) });
export type BlockListResponse = z.infer<typeof BlockListResponseSchema>;

export const BlockMutationResponseSchema = z.object({
  userId: z.string().uuid(),
  blocked: z.boolean(),
});
export type BlockMutationResponse = z.infer<typeof BlockMutationResponseSchema>;

export const SocialNotificationTypeSchema = z.enum([
  'FRIEND_REQUEST',
  'FRIEND_REQUEST_ACCEPTED',
  'FRIEND_REQUEST_REJECTED',
  'TABLE_INVITATION',
  'TABLE_INVITATION_ACCEPTED',
  'TABLE_INVITATION_DECLINED',
  'CHALLENGE',
  'CHALLENGE_ACCEPTED',
  'CHALLENGE_DECLINED',
  /** M10a: el torneo arrancó y hay cuadro. */
  'TOURNAMENT_ROUND_STARTED',
  /** M10a: el cruce del jugador tiene a los dos rivales y su sala. */
  'TOURNAMENT_MATCH_READY',
  /** M10b: la jornada de la liga abrió y sus partidas se pueden jugar. */
  'LEAGUE_ROUND_OPEN',
  /** M10b: el jugador tiene una partida de liga pendiente por jugar. */
  'LEAGUE_MATCH_PENDING',
  /** M10b: la temporada de la liga cerró con su tabla final. */
  'LEAGUE_SEASON_FINISHED',
]);
export type SocialNotificationType = z.infer<typeof SocialNotificationTypeSchema>;

export const SocialNotificationItemSchema = z.object({
  id: z.string().uuid(),
  type: SocialNotificationTypeSchema,
  actorUserId: z.string().uuid().nullable(),
  actorNickname: z.string().nullable(),
  referenceId: z.string().uuid().nullable(),
  tableId: z.string().uuid().nullable(),
  createdAt: z.string(),
  readAt: z.string().nullable(),
});
export type SocialNotificationItem = z.infer<typeof SocialNotificationItemSchema>;

export const SocialNotificationEventSchema = SocialNotificationItemSchema;
export type SocialNotificationEvent = z.infer<typeof SocialNotificationEventSchema>;

export const SocialNotificationListResponseSchema = z.object({
  items: z.array(SocialNotificationItemSchema),
  nextCursor: z.string().uuid().nullable(),
  unreadCount: z.number().int().nonnegative(),
});
export type SocialNotificationListResponse = z.infer<typeof SocialNotificationListResponseSchema>;

export const UnreadNotificationCountResponseSchema = z.object({
  unreadCount: z.number().int().nonnegative(),
});
export type UnreadNotificationCountResponse = z.infer<typeof UnreadNotificationCountResponseSchema>;

export const ReadNotificationResponseSchema = z.object({
  notification: SocialNotificationItemSchema,
});
export type ReadNotificationResponse = z.infer<typeof ReadNotificationResponseSchema>;

export const MarkAllNotificationsReadResponseSchema = z.object({
  updated: z.number().int().nonnegative(),
  unreadCount: z.literal(0),
});
export type MarkAllNotificationsReadResponse = z.infer<
  typeof MarkAllNotificationsReadResponseSchema
>;

export const SocialPresenceEventSchema = z.object({
  userId: z.string().uuid(),
  status: SocialPresenceStatusSchema,
  /** false clears a previously cached online indicator when visibility is withdrawn. */
  visible: z.boolean().default(true),
  observedAt: z.string(),
});
export type SocialPresenceEvent = z.infer<typeof SocialPresenceEventSchema>;

export const SocialInvitationKindSchema = z.enum(['TABLE', 'CHALLENGE']);
export type SocialInvitationKind = z.infer<typeof SocialInvitationKindSchema>;

export const SocialInvitationStatusSchema = z.enum([
  'PENDING',
  'ACCEPTED',
  'DECLINED',
  'CANCELLED',
  'EXPIRED',
]);
export type SocialInvitationStatus = z.infer<typeof SocialInvitationStatusSchema>;

export const SocialInvitationItemSchema = z.object({
  id: z.string().uuid(),
  kind: SocialInvitationKindSchema,
  status: SocialInvitationStatusSchema,
  otherUserId: z.string().uuid(),
  otherNickname: z.string(),
  tableId: z.string().uuid().nullable(),
  mode: z.literal('1v1').nullable(),
  rulesetCode: RulesetCodeSchema.nullable(),
  expiresAt: z.string(),
  createdAt: z.string(),
});
export type SocialInvitationItem = z.infer<typeof SocialInvitationItemSchema>;

export const SocialInvitationListQuerySchema = z
  .object({
    direction: z.enum(['INCOMING', 'OUTGOING']).optional().default('INCOMING'),
  })
  .strict();
export type SocialInvitationListQuery = z.infer<typeof SocialInvitationListQuerySchema>;

export const SocialInvitationListResponseSchema = z.object({
  items: z.array(SocialInvitationItemSchema),
});
export type SocialInvitationListResponse = z.infer<typeof SocialInvitationListResponseSchema>;

export const CreateTableInvitationRequestSchema = z
  .object({
    recipientUserId: z.string().uuid(),
    tableId: z.string().uuid(),
  })
  .strict();
export type CreateTableInvitationRequest = z.infer<typeof CreateTableInvitationRequestSchema>;

export const CreateChallengeRequestSchema = z
  .object({
    recipientUserId: z.string().uuid(),
    mode: z.literal('1v1').optional().default('1v1'),
    rulesetCode: RulesetCodeSchema,
  })
  .strict();
export type CreateChallengeRequest = z.infer<typeof CreateChallengeRequestSchema>;

export const CreateSocialInvitationResponseSchema = z.object({
  invitationId: z.string().uuid(),
  kind: SocialInvitationKindSchema,
  status: z.literal('PENDING'),
  expiresAt: z.string(),
});
export type CreateSocialInvitationResponse = z.infer<typeof CreateSocialInvitationResponseSchema>;

export const AcceptSocialInvitationResponseSchema = z.object({
  invitationId: z.string().uuid(),
  kind: SocialInvitationKindSchema,
  table: TableDetailResponseSchema,
});
export type AcceptSocialInvitationResponse = z.infer<typeof AcceptSocialInvitationResponseSchema>;

export const SocialInvitationActionResponseSchema = z.object({
  invitationId: z.string().uuid(),
  status: z.enum(['DECLINED', 'CANCELLED']),
});
export type SocialInvitationActionResponse = z.infer<typeof SocialInvitationActionResponseSchema>;

export const FriendListQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).optional().default(100),
  })
  .strict();
export type FriendListQuery = z.infer<typeof FriendListQuerySchema>;

export const SocialNotificationListQuerySchema = z
  .object({
    cursor: z.string().uuid().optional(),
    limit: z.coerce.number().int().min(1).max(50).optional().default(20),
    unreadOnly: z
      .enum(['true', 'false'])
      .optional()
      .transform((value) => value === 'true'),
  })
  .strict();
export type SocialNotificationListQuery = z.infer<typeof SocialNotificationListQuerySchema>;

export const SocialFriendRequestActionParamsSchema = z
  .object({ requestId: z.string().uuid() })
  .strict();
export const SocialInvitationActionParamsSchema = z
  .object({ invitationId: z.string().uuid() })
  .strict();
export const SocialUserActionParamsSchema = z.object({ userId: z.string().uuid() }).strict();
export const SocialNotificationParamsSchema = z
  .object({ notificationId: z.string().uuid() })
  .strict();
export const SocialMatchParamsSchema = z
  .object({ userId: z.string().uuid(), matchId: z.string().uuid() })
  .strict();
