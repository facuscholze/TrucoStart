import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  CreateChallengeRequestSchema,
  CreateFriendRequestSchema,
  CreateTableInvitationRequestSchema,
  FriendListQuerySchema,
  PlayerSearchQuerySchema,
  SocialFriendRequestActionParamsSchema,
  SocialInvitationActionParamsSchema,
  SocialInvitationListQuerySchema,
  SocialNotificationListQuerySchema,
  SocialNotificationParamsSchema,
  SocialUserActionParamsSchema,
  type AcceptSocialInvitationResponse,
  type BlockListResponse,
  type BlockMutationResponse,
  type CreateSocialInvitationResponse,
  type FriendListResponse,
  type FriendRequestListResponse,
  type FriendRequestMutationResponse,
  type MarkAllNotificationsReadResponse,
  type PlayerSearchResponse,
  type ReadNotificationResponse,
  type SocialInvitationActionResponse,
  type SocialInvitationListResponse,
  type SocialNotificationListResponse,
  type UnreadNotificationCountResponse,
} from '@truco/shared';
import type { FastifyRequest } from 'fastify';
import { parseWithZod } from '../../common/zod-validation.js';
import { CurrentPrincipal } from '../auth/guards/current-principal.decorator.js';
import {
  type AuthenticatedPrincipal,
  extractClientMeta,
  SessionAuthGuard,
} from '../auth/guards/session-auth.guard.js';
import { SocialService } from './social.service.js';

@Controller('social')
@UseGuards(SessionAuthGuard)
export class SocialController {
  constructor(@Inject(SocialService) private readonly socialService: SocialService) {}

  @Get('search')
  async searchPlayers(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Query() rawQuery: unknown,
    @Req() req: FastifyRequest,
  ): Promise<PlayerSearchResponse> {
    const query = parseWithZod(PlayerSearchQuerySchema, rawQuery ?? {});
    return this.socialService.searchPlayers(principal, query, extractClientMeta(req));
  }

  @Get('friends')
  async listFriends(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Query() rawQuery: unknown,
  ): Promise<FriendListResponse> {
    const query = parseWithZod(FriendListQuerySchema, rawQuery ?? {});
    return this.socialService.listFriends(principal, query);
  }

  @Get('friend-requests')
  async listFriendRequests(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
  ): Promise<FriendRequestListResponse> {
    return this.socialService.listFriendRequests(principal);
  }

  @Post('friend-requests')
  @HttpCode(HttpStatus.CREATED)
  async createFriendRequest(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Body() rawBody: unknown,
    @Req() req: FastifyRequest,
  ): Promise<FriendRequestMutationResponse> {
    const input = parseWithZod(CreateFriendRequestSchema, rawBody);
    return this.socialService.createFriendRequest(principal, input, extractClientMeta(req));
  }

  @Post('friend-requests/:requestId/accept')
  @HttpCode(HttpStatus.OK)
  async acceptFriendRequest(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param() rawParams: unknown,
    @Req() req: FastifyRequest,
  ): Promise<FriendRequestMutationResponse> {
    const { requestId } = parseWithZod(SocialFriendRequestActionParamsSchema, rawParams);
    return this.socialService.actOnFriendRequest(
      principal,
      requestId,
      'ACCEPT',
      extractClientMeta(req),
    );
  }

  @Post('friend-requests/:requestId/decline')
  @HttpCode(HttpStatus.OK)
  async declineFriendRequest(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param() rawParams: unknown,
    @Req() req: FastifyRequest,
  ): Promise<FriendRequestMutationResponse> {
    const { requestId } = parseWithZod(SocialFriendRequestActionParamsSchema, rawParams);
    return this.socialService.actOnFriendRequest(
      principal,
      requestId,
      'DECLINE',
      extractClientMeta(req),
    );
  }

  @Post('friend-requests/:requestId/cancel')
  @HttpCode(HttpStatus.OK)
  async cancelFriendRequest(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param() rawParams: unknown,
    @Req() req: FastifyRequest,
  ): Promise<FriendRequestMutationResponse> {
    const { requestId } = parseWithZod(SocialFriendRequestActionParamsSchema, rawParams);
    return this.socialService.actOnFriendRequest(
      principal,
      requestId,
      'CANCEL',
      extractClientMeta(req),
    );
  }

  @Delete('friends/:userId')
  async removeFriend(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param() rawParams: unknown,
    @Req() req: FastifyRequest,
  ): Promise<{ removed: true }> {
    const { userId } = parseWithZod(SocialUserActionParamsSchema, rawParams);
    return this.socialService.removeFriend(principal, userId, extractClientMeta(req));
  }

  @Get('blocks')
  async listBlocks(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
  ): Promise<BlockListResponse> {
    return this.socialService.listBlocks(principal);
  }

  @Post('blocks/:userId')
  @HttpCode(HttpStatus.OK)
  async blockUser(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param() rawParams: unknown,
    @Req() req: FastifyRequest,
  ): Promise<BlockMutationResponse> {
    const { userId } = parseWithZod(SocialUserActionParamsSchema, rawParams);
    return this.socialService.blockUser(principal, userId, extractClientMeta(req));
  }

  @Delete('blocks/:userId')
  async unblockUser(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param() rawParams: unknown,
    @Req() req: FastifyRequest,
  ): Promise<BlockMutationResponse> {
    const { userId } = parseWithZod(SocialUserActionParamsSchema, rawParams);
    return this.socialService.unblockUser(principal, userId, extractClientMeta(req));
  }

  @Post('table-invitations')
  @HttpCode(HttpStatus.CREATED)
  async createTableInvitation(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Body() rawBody: unknown,
    @Req() req: FastifyRequest,
  ): Promise<CreateSocialInvitationResponse> {
    const input = parseWithZod(CreateTableInvitationRequestSchema, rawBody);
    return this.socialService.createTableInvitation(principal, input, extractClientMeta(req));
  }

  @Post('challenges')
  @HttpCode(HttpStatus.CREATED)
  async createChallenge(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Body() rawBody: unknown,
    @Req() req: FastifyRequest,
  ): Promise<CreateSocialInvitationResponse> {
    const input = parseWithZod(CreateChallengeRequestSchema, rawBody);
    return this.socialService.createChallenge(principal, input, extractClientMeta(req));
  }

  @Get('invitations')
  async listInvitations(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Query() rawQuery: unknown,
  ): Promise<SocialInvitationListResponse> {
    const query = parseWithZod(SocialInvitationListQuerySchema, rawQuery ?? {});
    return this.socialService.listInvitations(principal, query);
  }

  @Post('invitations/:invitationId/accept')
  @HttpCode(HttpStatus.OK)
  async acceptInvitation(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param() rawParams: unknown,
  ): Promise<AcceptSocialInvitationResponse> {
    const { invitationId } = parseWithZod(SocialInvitationActionParamsSchema, rawParams);
    return this.socialService.acceptInvitation(principal, invitationId);
  }

  @Post('invitations/:invitationId/decline')
  @HttpCode(HttpStatus.OK)
  async declineInvitation(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param() rawParams: unknown,
    @Req() req: FastifyRequest,
  ): Promise<SocialInvitationActionResponse> {
    const { invitationId } = parseWithZod(SocialInvitationActionParamsSchema, rawParams);
    return this.socialService.declineOrCancelInvitation(
      principal,
      invitationId,
      'DECLINE',
      extractClientMeta(req),
    );
  }

  @Post('invitations/:invitationId/cancel')
  @HttpCode(HttpStatus.OK)
  async cancelInvitation(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param() rawParams: unknown,
    @Req() req: FastifyRequest,
  ): Promise<SocialInvitationActionResponse> {
    const { invitationId } = parseWithZod(SocialInvitationActionParamsSchema, rawParams);
    return this.socialService.declineOrCancelInvitation(
      principal,
      invitationId,
      'CANCEL',
      extractClientMeta(req),
    );
  }

  @Get('notifications')
  async listNotifications(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Query() rawQuery: unknown,
  ): Promise<SocialNotificationListResponse> {
    const query = parseWithZod(SocialNotificationListQuerySchema, rawQuery ?? {});
    return this.socialService.listNotifications(principal, query);
  }

  @Get('notifications/unread-count')
  async unreadCount(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
  ): Promise<UnreadNotificationCountResponse> {
    return this.socialService.unreadCount(principal);
  }

  @Post('notifications/:notificationId/read')
  @HttpCode(HttpStatus.OK)
  async markNotificationRead(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('notificationId') rawNotificationId: string,
  ): Promise<ReadNotificationResponse> {
    const { notificationId } = parseWithZod(SocialNotificationParamsSchema, {
      notificationId: rawNotificationId,
    });
    return this.socialService.markNotificationRead(principal, notificationId);
  }

  @Post('notifications/read-all')
  @HttpCode(HttpStatus.OK)
  async markAllNotificationsRead(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
  ): Promise<MarkAllNotificationsReadResponse> {
    return this.socialService.markAllNotificationsRead(principal);
  }
}
