import '@fastify/cookie';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Patch,
  Put,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  type AccountExportResponse,
  type DeleteAccountResponse,
  type MeResponse,
  PatchMeRequestSchema,
  type PublicUserProfile,
  type TutorialProgressResponse,
  TutorialProgressUpdateRequestSchema,
  type UserMatchDetailResponse,
  UserMatchHistoryQuerySchema,
  type UserMatchesResponse,
  type UserStatsResponse,
} from '@truco/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { parseWithZod } from '../../common/zod-validation.js';
import { AUTH_RUNTIME_CONFIG, type AuthRuntimeConfig } from '../auth/auth.config.js';
import { CurrentPrincipal } from '../auth/guards/current-principal.decorator.js';
import {
  type AuthenticatedPrincipal,
  extractClientMeta,
  SessionAuthGuard,
} from '../auth/guards/session-auth.guard.js';
import { clearAuthCookiesOnReply } from '../auth/security/token-crypto.js';
import { UsersService } from './users.service.js';

const UserIdParamSchema = z.object({ id: z.string().uuid() });
const UserMatchParamsSchema = z.object({ id: z.string().uuid(), matchId: z.string().uuid() });
const DeleteAccountBodySchema = z
  .object({
    password: z.string().min(1).max(128).optional(),
  })
  .strict();

@Controller()
export class UsersController {
  constructor(
    @Inject(AUTH_RUNTIME_CONFIG) private readonly config: AuthRuntimeConfig,
    @Inject(UsersService) private readonly usersService: UsersService,
  ) {}

  @Get('me')
  @UseGuards(SessionAuthGuard)
  async getMe(@CurrentPrincipal() principal: AuthenticatedPrincipal): Promise<MeResponse> {
    return this.usersService.getMe(principal);
  }

  @Patch('me')
  @UseGuards(SessionAuthGuard)
  async patchMe(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Body() rawBody: unknown,
    @Req() req: FastifyRequest,
  ): Promise<MeResponse> {
    const input = parseWithZod(PatchMeRequestSchema, rawBody);
    return this.usersService.updateOwnProfile(principal, input, extractClientMeta(req));
  }

  @Get('me/tutorial')
  @UseGuards(SessionAuthGuard)
  async getTutorialProgress(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
  ): Promise<TutorialProgressResponse> {
    return this.usersService.getTutorialProgress(principal);
  }

  @Put('me/tutorial')
  @UseGuards(SessionAuthGuard)
  async putTutorialProgress(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Body() rawBody: unknown,
    @Req() req: FastifyRequest,
  ): Promise<TutorialProgressResponse> {
    const input = parseWithZod(TutorialProgressUpdateRequestSchema, rawBody);
    return this.usersService.saveTutorialProgress(principal, input, extractClientMeta(req));
  }

  @Get('me/export')
  @UseGuards(SessionAuthGuard)
  async exportMe(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Req() req: FastifyRequest,
  ): Promise<AccountExportResponse> {
    return this.usersService.exportAccountData(principal, extractClientMeta(req));
  }

  @Delete('me')
  @UseGuards(SessionAuthGuard)
  @HttpCode(HttpStatus.OK)
  async deleteMe(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Body() rawBody: unknown,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<DeleteAccountResponse> {
    const input = parseWithZod(DeleteAccountBodySchema, rawBody ?? {});
    const result = await this.usersService.deleteAccount(
      principal,
      input.password,
      extractClientMeta(req),
    );
    clearAuthCookiesOnReply(reply, this.config.cookieConfig);
    return result;
  }

  @Get('users/:id')
  async getUserById(@Param() rawParams: unknown): Promise<PublicUserProfile> {
    const { id } = parseWithZod(UserIdParamSchema, rawParams);
    return this.usersService.getPublicUserProfile(id);
  }

  @Get('users/:id/stats')
  @UseGuards(SessionAuthGuard)
  async getUserStats(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param() rawParams: unknown,
  ): Promise<UserStatsResponse> {
    const { id } = parseWithZod(UserIdParamSchema, rawParams);
    return this.usersService.getPublicUserStats(principal, id);
  }

  @Get('users/:id/matches')
  @UseGuards(SessionAuthGuard)
  async getUserMatches(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param() rawParams: unknown,
    @Query() rawQuery: unknown,
  ): Promise<UserMatchesResponse> {
    const { id } = parseWithZod(UserIdParamSchema, rawParams);
    const query = parseWithZod(UserMatchHistoryQuerySchema, rawQuery ?? {});
    return this.usersService.getUserMatches(principal, id, query);
  }

  @Get('users/:id/matches/:matchId')
  @UseGuards(SessionAuthGuard)
  async getUserMatchDetail(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param() rawParams: unknown,
  ): Promise<UserMatchDetailResponse> {
    const { id, matchId } = parseWithZod(UserMatchParamsSchema, rawParams);
    return this.usersService.getUserMatchDetail(principal, id, matchId);
  }
}
