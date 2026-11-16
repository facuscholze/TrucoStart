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
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  type AccountExportResponse,
  CursorPaginationQuerySchema,
  type DeleteAccountResponse,
  type MeResponse,
  PatchMeRequestSchema,
  type PublicUserProfile,
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
    return this.usersService.updateOwnProfile(
      principal,
      principal.userId,
      input,
      extractClientMeta(req),
    );
  }

  @Get('me/export')
  @UseGuards(SessionAuthGuard)
  async exportMe(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Req() req: FastifyRequest,
  ): Promise<AccountExportResponse> {
    return this.usersService.exportAccountData(principal, principal.userId, extractClientMeta(req));
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
      principal.userId,
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

  @Patch('users/:id')
  @UseGuards(SessionAuthGuard)
  async patchUserById(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param() rawParams: unknown,
    @Body() rawBody: unknown,
    @Req() req: FastifyRequest,
  ): Promise<MeResponse> {
    const { id } = parseWithZod(UserIdParamSchema, rawParams);
    const input = parseWithZod(PatchMeRequestSchema, rawBody);
    return this.usersService.updateOwnProfile(principal, id, input, extractClientMeta(req));
  }

  @Get('users/:id/stats')
  async getUserStats(@Param() rawParams: unknown): Promise<UserStatsResponse> {
    const { id } = parseWithZod(UserIdParamSchema, rawParams);
    return this.usersService.getPublicUserStats(id);
  }

  @Get('users/:id/matches')
  async getUserMatches(
    @Param() rawParams: unknown,
    @Query() rawQuery: unknown,
  ): Promise<UserMatchesResponse> {
    const { id } = parseWithZod(UserIdParamSchema, rawParams);
    const query = parseWithZod(CursorPaginationQuerySchema, rawQuery ?? {});
    return this.usersService.getUserMatches(id, query);
  }

  @Get('users/:id/export')
  @UseGuards(SessionAuthGuard)
  async exportUserById(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param() rawParams: unknown,
    @Req() req: FastifyRequest,
  ): Promise<AccountExportResponse> {
    const { id } = parseWithZod(UserIdParamSchema, rawParams);
    return this.usersService.exportAccountData(principal, id, extractClientMeta(req));
  }

  @Delete('users/:id')
  @UseGuards(SessionAuthGuard)
  @HttpCode(HttpStatus.OK)
  async deleteUserById(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param() rawParams: unknown,
    @Body() rawBody: unknown,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<DeleteAccountResponse> {
    const { id } = parseWithZod(UserIdParamSchema, rawParams);
    const input = parseWithZod(DeleteAccountBodySchema, rawBody ?? {});
    const result = await this.usersService.deleteAccount(
      principal,
      id,
      input.password,
      extractClientMeta(req),
    );
    clearAuthCookiesOnReply(reply, this.config.cookieConfig);
    return result;
  }
}
