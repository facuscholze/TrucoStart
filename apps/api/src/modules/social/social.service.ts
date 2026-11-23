import { Inject, Injectable, type OnApplicationBootstrap } from '@nestjs/common';
import type {
  AcceptSocialInvitationResponse,
  BlockListResponse,
  BlockMutationResponse,
  CreateChallengeRequest,
  CreateFriendRequest,
  CreateSocialInvitationResponse,
  CreateTableInvitationRequest,
  FriendListQuery,
  FriendListResponse,
  FriendRequestListResponse,
  FriendRequestMutationResponse,
  MarkAllNotificationsReadResponse,
  PlayerSearchQuery,
  PlayerSearchResponse,
  ReadNotificationResponse,
  SocialInvitationActionResponse,
  SocialInvitationListQuery,
  SocialInvitationListResponse,
  SocialNotificationListQuery,
  SocialNotificationListResponse,
  UnreadNotificationCountResponse,
} from '@truco/shared';
import {
  AcceptSocialInvitationResponseSchema,
  BlockListResponseSchema,
  BlockMutationResponseSchema,
  CreateSocialInvitationResponseSchema,
  FriendListResponseSchema,
  FriendRequestListResponseSchema,
  FriendRequestMutationResponseSchema,
  MarkAllNotificationsReadResponseSchema,
  PlayerSearchResponseSchema,
  ReadNotificationResponseSchema,
  SocialInvitationActionResponseSchema,
  SocialInvitationListResponseSchema,
  SocialNotificationListResponseSchema,
  UnreadNotificationCountResponseSchema,
} from '@truco/shared';
import { DomainApiException } from '../../common/api-exception.js';
import {
  RATE_LIMIT_STORE,
  type RateLimitStore,
} from '../../common/rate-limit/rate-limit-store.interface.js';
import { AuditRepository } from '../audit/audit.repository.js';
import {
  AUTH_RUNTIME_CONFIG,
  type AuthRuntimeConfig,
  type RequestClientMeta,
} from '../auth/auth.config.js';
import type { AuthenticatedPrincipal } from '../auth/guards/session-auth.guard.js';
import { LobbyRepository } from '../lobby/lobby.repository.js';
import { LobbyRealtimeGateway } from '../lobby/lobby-realtime.gateway.js';
import { LobbyService } from '../lobby/lobby.service.js';
import { maxSeatsForMode } from '../lobby/lobby-row-mapper.js';
import { resolveRuleSetByCode } from '../lobby/lobby.config.js';
import { USER_PRESENCE_STORE, type UserPresenceStore } from './presence-store.interface.js';
import type { SocialNotificationDispatch } from './social.repository.js';
import { SocialRepository } from './social.repository.js';

const SEARCH_RATE_PER_USER = 30;
const SEARCH_RATE_PER_IP = 60;
const MUTATION_RATE_PER_USER = 30;
const RATE_WINDOW_MS = 60_000;
const FRIEND_LIST_MAX = 100;
const TABLE_INVITATION_TTL_MS = 20 * 60_000;
const CHALLENGE_TTL_MS = 24 * 60 * 60_000;

@Injectable()
export class SocialService implements OnApplicationBootstrap {
  constructor(
    @Inject(AUTH_RUNTIME_CONFIG) private readonly authConfig: AuthRuntimeConfig,
    @Inject(SocialRepository) private readonly repository: SocialRepository,
    @Inject(RATE_LIMIT_STORE) private readonly rateLimit: RateLimitStore,
    @Inject(USER_PRESENCE_STORE) private readonly presenceStore: UserPresenceStore,
    @Inject(LobbyRealtimeGateway) private readonly realtime: LobbyRealtimeGateway,
    @Inject(LobbyRepository) private readonly lobbyRepository: LobbyRepository,
    @Inject(LobbyService) private readonly lobbyService: LobbyService,
    @Inject(AuditRepository) private readonly audit: AuditRepository,
  ) {}

  onApplicationBootstrap(): void {
    this.realtime.registerPresenceObserver((userId) => this.refreshPresenceForUsers([userId]));
  }

  async refreshPresenceForUsers(userIds: readonly string[]): Promise<void> {
    await Promise.all(
      [...new Set(userIds)].map(async (userId) => {
        try {
          const online = await this.presenceStore.isOnline(userId, this.authConfig.nowFn());
          const status = !online
            ? 'OFFLINE'
            : (await this.repository.isUserInGame(userId))
              ? 'IN_GAME'
              : 'ONLINE';
          await this.publishPresence(userId, status);
        } catch {
          // La presencia es best-effort: no debe bloquear matchmaking ni persistencia de partidas.
        }
      }),
    );
  }

  private now(): Date {
    return new Date(this.authConfig.nowFn());
  }

  private async ensureEligible(userId: string): Promise<void> {
    if (!(await this.repository.isUserEligible(userId, this.now()))) {
      throw new DomainApiException(
        403,
        'FORBIDDEN',
        'Tu cuenta no puede usar las funciones sociales mientras tenga una sanción activa.',
      );
    }
  }

  private async consumeLimit(key: string, limit: number): Promise<void> {
    const result = await this.rateLimit.consumeWindow(key, limit, RATE_WINDOW_MS);
    if (!result.allowed) {
      throw new DomainApiException(
        429,
        'RATE_LIMITED',
        'Demasiadas acciones sociales. Intentá nuevamente en un minuto.',
        {
          retryAfterMs: result.retryAfterMs,
        },
      );
    }
  }

  private async consumeMutationLimit(userId: string): Promise<void> {
    await this.consumeLimit(`social:write:user:${userId}`, MUTATION_RATE_PER_USER);
  }

  private emitNotifications(notifications: readonly SocialNotificationDispatch[]): void {
    for (const notification of notifications) {
      this.realtime.emitSocialNotification(notification.userId, notification.event);
    }
  }

  async searchPlayers(
    principal: AuthenticatedPrincipal,
    query: PlayerSearchQuery,
    meta: RequestClientMeta,
  ): Promise<PlayerSearchResponse> {
    await this.ensureEligible(principal.userId);
    await this.consumeLimit(`social:search:user:${principal.userId}`, SEARCH_RATE_PER_USER);
    await this.consumeLimit(`social:search:ip:${meta.ip}`, SEARCH_RATE_PER_IP);
    const items = await this.repository.searchUsers({
      viewerUserId: principal.userId,
      nickname: query.nickname,
      limit: query.limit,
      now: this.now(),
    });
    return PlayerSearchResponseSchema.parse({ items });
  }

  async listFriends(
    principal: AuthenticatedPrincipal,
    query: FriendListQuery,
  ): Promise<FriendListResponse> {
    await this.ensureEligible(principal.userId);
    const friends = await this.repository.listFriends(principal.userId, query.limit);
    const items = await Promise.all(
      friends.map(async (friend) => {
        const visibility = await this.repository.getPresenceVisibility(friend.userId);
        if (visibility === 'NOBODY') return { ...friend, presence: null };
        const online = await this.presenceStore.isOnline(friend.userId, this.authConfig.nowFn());
        if (!online) return { ...friend, presence: null };
        const inGame = await this.repository.isUserInGame(friend.userId);
        return { ...friend, presence: inGame ? ('IN_GAME' as const) : ('ONLINE' as const) };
      }),
    );
    return FriendListResponseSchema.parse({ items });
  }

  async listFriendRequests(principal: AuthenticatedPrincipal): Promise<FriendRequestListResponse> {
    await this.ensureEligible(principal.userId);
    return FriendRequestListResponseSchema.parse({
      items: await this.repository.listFriendRequests(principal.userId),
    });
  }

  async createFriendRequest(
    principal: AuthenticatedPrincipal,
    input: CreateFriendRequest,
    meta: RequestClientMeta,
  ): Promise<FriendRequestMutationResponse> {
    await this.ensureEligible(principal.userId);
    await this.consumeMutationLimit(principal.userId);
    const result = await this.repository.createFriendRequest({
      senderId: principal.userId,
      senderNickname: principal.nickname,
      targetId: input.targetUserId,
      now: this.now(),
    });
    this.emitNotifications(result.notifications);
    await this.audit.record({
      actorId: principal.userId,
      action: 'social.friend_request.created',
      entity: 'friend_request',
      entityId: result.requestId,
      ip: meta.ip,
      afterState: {
        status: result.status,
        reciprocalRequestAccepted: result.reciprocalRequestAccepted,
      },
      now: this.now(),
    });
    return FriendRequestMutationResponseSchema.parse(result);
  }

  async actOnFriendRequest(
    principal: AuthenticatedPrincipal,
    requestId: string,
    action: 'ACCEPT' | 'DECLINE' | 'CANCEL',
    meta: RequestClientMeta,
  ): Promise<FriendRequestMutationResponse> {
    await this.ensureEligible(principal.userId);
    await this.consumeMutationLimit(principal.userId);
    const result = await this.repository.actOnFriendRequest({
      requestId,
      userId: principal.userId,
      nickname: principal.nickname,
      action,
      now: this.now(),
    });
    this.emitNotifications(result.notifications);
    await this.audit.record({
      actorId: principal.userId,
      action: `social.friend_request.${action.toLowerCase()}`,
      entity: 'friend_request',
      entityId: requestId,
      ip: meta.ip,
      afterState: { status: result.status },
      now: this.now(),
    });
    return FriendRequestMutationResponseSchema.parse(result);
  }

  async removeFriend(
    principal: AuthenticatedPrincipal,
    targetUserId: string,
    meta: RequestClientMeta,
  ): Promise<{ removed: true }> {
    await this.ensureEligible(principal.userId);
    await this.consumeMutationLimit(principal.userId);
    await this.repository.removeFriend(principal.userId, targetUserId, this.now());
    this.clearPresenceForPair(principal.userId, targetUserId);
    await this.audit.record({
      actorId: principal.userId,
      action: 'social.friend.removed',
      entity: 'friendship',
      entityId: targetUserId,
      ip: meta.ip,
      now: this.now(),
    });
    return { removed: true };
  }

  async listBlocks(principal: AuthenticatedPrincipal): Promise<BlockListResponse> {
    await this.ensureEligible(principal.userId);
    return BlockListResponseSchema.parse({
      items: await this.repository.listBlockedUsers(principal.userId),
    });
  }

  async blockUser(
    principal: AuthenticatedPrincipal,
    targetUserId: string,
    meta: RequestClientMeta,
  ): Promise<BlockMutationResponse> {
    await this.ensureEligible(principal.userId);
    await this.consumeMutationLimit(principal.userId);
    await this.repository.blockUser(principal.userId, targetUserId, this.now());
    this.clearPresenceForPair(principal.userId, targetUserId);
    await this.audit.record({
      actorId: principal.userId,
      action: 'social.user.blocked',
      entity: 'user',
      entityId: targetUserId,
      ip: meta.ip,
      now: this.now(),
    });
    return BlockMutationResponseSchema.parse({ userId: targetUserId, blocked: true });
  }

  async unblockUser(
    principal: AuthenticatedPrincipal,
    targetUserId: string,
    meta: RequestClientMeta,
  ): Promise<BlockMutationResponse> {
    await this.ensureEligible(principal.userId);
    await this.consumeMutationLimit(principal.userId);
    await this.repository.unblockUser(principal.userId, targetUserId);
    await this.audit.record({
      actorId: principal.userId,
      action: 'social.user.unblocked',
      entity: 'user',
      entityId: targetUserId,
      ip: meta.ip,
      now: this.now(),
    });
    return BlockMutationResponseSchema.parse({ userId: targetUserId, blocked: false });
  }

  async createTableInvitation(
    principal: AuthenticatedPrincipal,
    input: CreateTableInvitationRequest,
    meta: RequestClientMeta,
  ): Promise<CreateSocialInvitationResponse> {
    await this.ensureEligible(principal.userId);
    await this.consumeMutationLimit(principal.userId);
    const aggregate = await this.lobbyRepository.getTableWithSeats(input.tableId);
    if (!aggregate || aggregate.row.isPractice) {
      throw new DomainApiException(
        404,
        'NOT_FOUND',
        'La mesa no está disponible para invitaciones.',
      );
    }
    const isMember = aggregate.activeSeats.some((seat) => seat.userId === principal.userId);
    if (!isMember)
      throw new DomainApiException(
        403,
        'FORBIDDEN',
        'Solo un jugador sentado puede invitar a una mesa.',
      );
    if (aggregate.row.status !== 'WAITING')
      throw new DomainApiException(
        409,
        'INVALID_STATE',
        'Solo se puede invitar antes de iniciar la partida.',
      );
    if (aggregate.activeSeats.some((seat) => seat.userId === input.recipientUserId)) {
      throw new DomainApiException(409, 'CONFLICT', 'Ese jugador ya está sentado en la mesa.');
    }
    if (aggregate.activeSeats.length >= maxSeatsForMode(aggregate.row.mode)) {
      throw new DomainApiException(409, 'ROOM_FULL', 'La mesa no tiene asientos disponibles.');
    }
    const now = this.now();
    await this.repository.expirePendingInvitations(now);
    const expiresAt = new Date(
      Math.min(now.getTime() + TABLE_INVITATION_TTL_MS, aggregate.row.expiresAt.getTime()),
    );
    if (expiresAt.getTime() <= now.getTime())
      throw new DomainApiException(410, 'INVALID_STATE', 'La mesa está por expirar.');
    const result = await this.repository.createInvitation({
      kind: 'TABLE',
      senderId: principal.userId,
      senderNickname: principal.nickname,
      recipientId: input.recipientUserId,
      tableId: input.tableId,
      mode: null,
      rulesetCode: null,
      expiresAt,
      now,
    });
    this.emitNotifications(result.notifications);
    await this.audit.record({
      actorId: principal.userId,
      action: 'social.table_invitation.created',
      entity: 'social_invitation',
      entityId: result.invitationId,
      ip: meta.ip,
      afterState: { tableId: input.tableId, recipientId: input.recipientUserId },
      now,
    });
    return CreateSocialInvitationResponseSchema.parse({
      invitationId: result.invitationId,
      kind: 'TABLE',
      status: 'PENDING',
      expiresAt: result.expiresAt,
    });
  }

  async createChallenge(
    principal: AuthenticatedPrincipal,
    input: CreateChallengeRequest,
    meta: RequestClientMeta,
  ): Promise<CreateSocialInvitationResponse> {
    await this.ensureEligible(principal.userId);
    await this.consumeMutationLimit(principal.userId);
    const ruleset = resolveRuleSetByCode(input.rulesetCode);
    const now = this.now();
    await this.repository.expirePendingInvitations(now);
    const expiresAt = new Date(now.getTime() + CHALLENGE_TTL_MS);
    const result = await this.repository.createInvitation({
      kind: 'CHALLENGE',
      senderId: principal.userId,
      senderNickname: principal.nickname,
      recipientId: input.recipientUserId,
      tableId: null,
      mode: '1v1',
      rulesetCode: ruleset.code,
      expiresAt,
      now,
    });
    this.emitNotifications(result.notifications);
    await this.audit.record({
      actorId: principal.userId,
      action: 'social.challenge.created',
      entity: 'social_invitation',
      entityId: result.invitationId,
      ip: meta.ip,
      afterState: { recipientId: input.recipientUserId, mode: '1v1', rulesetCode: ruleset.code },
      now,
    });
    return CreateSocialInvitationResponseSchema.parse({
      invitationId: result.invitationId,
      kind: 'CHALLENGE',
      status: 'PENDING',
      expiresAt: result.expiresAt,
    });
  }

  async listInvitations(
    principal: AuthenticatedPrincipal,
    query: SocialInvitationListQuery,
  ): Promise<SocialInvitationListResponse> {
    await this.ensureEligible(principal.userId);
    const now = this.now();
    await this.repository.expirePendingInvitations(now);
    const items = await this.repository.listInvitations(principal.userId, query.direction, now);
    return SocialInvitationListResponseSchema.parse({ items });
  }

  async acceptInvitation(
    principal: AuthenticatedPrincipal,
    invitationId: string,
  ): Promise<AcceptSocialInvitationResponse> {
    await this.ensureEligible(principal.userId);
    await this.consumeMutationLimit(principal.userId);
    const invitation = await this.repository.getInvitationForRecipient(
      invitationId,
      principal.userId,
    );
    if (!invitation) throw new DomainApiException(404, 'NOT_FOUND', 'Invitación no encontrada.');
    if (invitation.status === 'PENDING') {
      const now = this.now();
      if (invitation.expiresAt.getTime() <= now.getTime()) {
        await this.repository.expirePendingInvitations(now);
        throw new DomainApiException(410, 'INVALID_STATE', 'La invitación expiró.');
      }
      if (!(await this.repository.isUserEligible(invitation.senderId, now))) {
        throw new DomainApiException(
          403,
          'FORBIDDEN',
          'La otra cuenta no puede participar en funciones sociales.',
        );
      }
      if (
        await this.repository.isBlockedEitherDirection(invitation.senderId, invitation.recipientId)
      ) {
        throw new DomainApiException(404, 'NOT_FOUND', 'Invitación no encontrada.');
      }
    } else if (invitation.status !== 'ACCEPTED') {
      throw new DomainApiException(409, 'CONFLICT', 'La invitación ya no está pendiente.');
    }

    let table;
    if (invitation.kind === 'TABLE') {
      table = await this.lobbyService.acceptSocialTableInvitation(principal, invitationId);
    } else {
      if (!invitation.rulesetCode || invitation.mode !== '1v1') {
        throw new DomainApiException(409, 'INVALID_STATE', 'El desafío no tiene reglas válidas.');
      }
      table = await this.lobbyService.acceptSocialChallenge({
        principal,
        invitationId,
        senderId: invitation.senderId,
        rulesetCode: invitation.rulesetCode as CreateChallengeRequest['rulesetCode'],
      });
    }
    const notification = await this.repository.recordInvitationAccepted({
      invitationId,
      senderId: invitation.senderId,
      recipientId: principal.userId,
      recipientNickname: principal.nickname,
      kind: invitation.kind,
      tableId: table.id,
      now: this.now(),
    });
    if (notification) this.emitNotifications([notification]);
    return AcceptSocialInvitationResponseSchema.parse({
      invitationId,
      kind: invitation.kind,
      table,
    });
  }

  async declineOrCancelInvitation(
    principal: AuthenticatedPrincipal,
    invitationId: string,
    action: 'DECLINE' | 'CANCEL',
    meta: RequestClientMeta,
  ): Promise<SocialInvitationActionResponse> {
    await this.ensureEligible(principal.userId);
    await this.consumeMutationLimit(principal.userId);
    const result = await this.repository.cancelOrDeclineInvitation({
      invitationId,
      userId: principal.userId,
      action,
      nickname: principal.nickname,
      now: this.now(),
    });
    if (result.notification) this.emitNotifications([result.notification]);
    await this.audit.record({
      actorId: principal.userId,
      action: `social.invitation.${action.toLowerCase()}`,
      entity: 'social_invitation',
      entityId: invitationId,
      ip: meta.ip,
      afterState: { status: result.status },
      now: this.now(),
    });
    return SocialInvitationActionResponseSchema.parse({ invitationId, status: result.status });
  }

  async listNotifications(
    principal: AuthenticatedPrincipal,
    query: SocialNotificationListQuery,
  ): Promise<SocialNotificationListResponse> {
    await this.ensureEligible(principal.userId);
    return SocialNotificationListResponseSchema.parse(
      await this.repository.listNotifications({
        userId: principal.userId,
        cursor: query.cursor,
        limit: query.limit,
        unreadOnly: query.unreadOnly,
      }),
    );
  }

  async unreadCount(principal: AuthenticatedPrincipal): Promise<UnreadNotificationCountResponse> {
    await this.ensureEligible(principal.userId);
    return UnreadNotificationCountResponseSchema.parse({
      unreadCount: await this.repository.unreadNotificationCount(principal.userId),
    });
  }

  async markNotificationRead(
    principal: AuthenticatedPrincipal,
    notificationId: string,
  ): Promise<ReadNotificationResponse> {
    await this.ensureEligible(principal.userId);
    const notification = await this.repository.markNotificationRead(
      principal.userId,
      notificationId,
      this.now(),
    );
    if (!notification)
      throw new DomainApiException(404, 'NOT_FOUND', 'Notificación no encontrada.');
    return ReadNotificationResponseSchema.parse({ notification });
  }

  async markAllNotificationsRead(
    principal: AuthenticatedPrincipal,
  ): Promise<MarkAllNotificationsReadResponse> {
    await this.ensureEligible(principal.userId);
    const updated = await this.repository.markAllNotificationsRead(principal.userId, this.now());
    return MarkAllNotificationsReadResponseSchema.parse({ updated, unreadCount: 0 });
  }

  private clearPresenceForPair(firstUserId: string, secondUserId: string): void {
    this.clearPresenceForObserver(firstUserId, secondUserId);
    this.clearPresenceForObserver(secondUserId, firstUserId);
  }

  private clearPresenceForObserver(observerId: string, targetId: string): void {
    this.realtime.emitSocialPresence(observerId, {
      userId: targetId,
      status: 'OFFLINE',
      visible: false,
      observedAt: this.now().toISOString(),
    });
  }

  async onPresenceVisibilityChanged(
    userId: string,
    previous: 'ALL' | 'FRIENDS' | 'NOBODY',
    next: 'ALL' | 'FRIENDS' | 'NOBODY',
  ): Promise<void> {
    if (previous === next) return;
    try {
      const online = await this.presenceStore.isOnline(userId, this.authConfig.nowFn());
      const observedAt = this.now().toISOString();
      if (previous === 'ALL' && next !== 'ALL') {
        const blockedUserIds = await this.repository.listBlockedCounterpartIds(userId);
        this.realtime.broadcastSocialPresence(
          { userId, status: 'OFFLINE', visible: false, observedAt },
          userId,
          blockedUserIds,
        );
      }
      if (next === 'NOBODY') {
        if (previous !== 'ALL') await this.publishPresence(userId, 'OFFLINE');
        return;
      }
      if (online) await this.refreshPresenceForUsers([userId]);
    } catch {
      // Una caída de Redis/WebSocket no debe impedir guardar preferencias de privacidad.
    }
  }

  private async publishPresence(
    userId: string,
    status: 'ONLINE' | 'IN_GAME' | 'OFFLINE',
  ): Promise<void> {
    const visibility = await this.repository.getPresenceVisibility(userId);
    const nowMs = this.authConfig.nowFn();
    const visible = visibility !== 'NOBODY';
    const event = {
      userId,
      status: visible ? status : 'OFFLINE',
      visible,
      observedAt: new Date(nowMs).toISOString(),
    };
    if (visibility === 'ALL') {
      const blockedUserIds = await this.repository.listBlockedCounterpartIds(userId);
      this.realtime.broadcastSocialPresence(event, userId, blockedUserIds);
      return;
    }
    const friends = await this.repository.listFriends(userId, FRIEND_LIST_MAX);
    for (const friend of friends) {
      this.realtime.emitSocialPresence(friend.userId, event);
    }
  }
}
