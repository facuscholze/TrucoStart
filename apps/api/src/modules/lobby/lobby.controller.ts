import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  CreateTableRequestSchema,
  type DeleteTableResponse,
  JoinByCodeRequestSchema,
  JoinPublicTableRequestSchema,
  type LeaveTableResponse,
  ListTablesQuerySchema,
  type PublicTableListResponse,
  type TableDetailResponse,
  type TableInviteResponse,
} from '@truco/shared';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { parseWithZod } from '../../common/zod-validation.js';
import { CurrentPrincipal } from '../auth/guards/current-principal.decorator.js';
import {
  type AuthenticatedPrincipal,
  extractClientMeta,
  SessionAuthGuard,
} from '../auth/guards/session-auth.guard.js';
import { LobbyService } from './lobby.service.js';

const TableIdParamSchema = z.object({ id: z.string().uuid() });

@Controller('tables')
export class LobbyController {
  constructor(@Inject(LobbyService) private readonly lobbyService: LobbyService) {}

  @Get()
  async listPublicTables(@Query() rawQuery: unknown): Promise<PublicTableListResponse> {
    const query = parseWithZod(ListTablesQuerySchema, rawQuery ?? {});
    return this.lobbyService.listPublicTables(query);
  }

  @Post()
  @UseGuards(SessionAuthGuard)
  @HttpCode(201)
  async createTable(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Body() rawBody: unknown,
    @Req() req: FastifyRequest,
  ): Promise<TableDetailResponse> {
    const body = parseWithZod(CreateTableRequestSchema, rawBody ?? {});
    return this.lobbyService.createTable(principal, body, extractClientMeta(req));
  }

  @Post('join-by-code')
  @UseGuards(SessionAuthGuard)
  @HttpCode(200)
  async joinByCode(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Body() rawBody: unknown,
    @Req() req: FastifyRequest,
  ): Promise<TableDetailResponse> {
    const body = parseWithZod(JoinByCodeRequestSchema, rawBody ?? {});
    return this.lobbyService.joinTableByCodeOrInvite(principal, body, extractClientMeta(req));
  }

  @Get(':id')
  @UseGuards(SessionAuthGuard)
  async getTableById(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param() rawParams: unknown,
  ): Promise<TableDetailResponse> {
    const params = parseWithZod(TableIdParamSchema, rawParams);
    return this.lobbyService.getTableDetail(principal, params.id);
  }

  @Post(':id/join')
  @UseGuards(SessionAuthGuard)
  @HttpCode(200)
  async joinPublicTable(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param() rawParams: unknown,
    @Body() rawBody: unknown,
  ): Promise<TableDetailResponse> {
    const params = parseWithZod(TableIdParamSchema, rawParams);
    const body = parseWithZod(JoinPublicTableRequestSchema, rawBody ?? {});
    return this.lobbyService.joinPublicTableById(principal, params.id, body);
  }

  @Post(':id/invite')
  @UseGuards(SessionAuthGuard)
  @HttpCode(201)
  async createInviteLink(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param() rawParams: unknown,
  ): Promise<TableInviteResponse> {
    const params = parseWithZod(TableIdParamSchema, rawParams);
    return this.lobbyService.createInviteLink(principal, params.id);
  }

  @Post(':id/leave')
  @UseGuards(SessionAuthGuard)
  @HttpCode(200)
  async leaveTable(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param() rawParams: unknown,
  ): Promise<LeaveTableResponse> {
    const params = parseWithZod(TableIdParamSchema, rawParams);
    return this.lobbyService.leaveTable(principal, params.id);
  }

  @Delete(':id')
  @UseGuards(SessionAuthGuard)
  @HttpCode(200)
  async deleteTable(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param() rawParams: unknown,
    @Req() req: FastifyRequest,
  ): Promise<DeleteTableResponse> {
    const params = parseWithZod(TableIdParamSchema, rawParams);
    return this.lobbyService.deleteTableByOwner(principal, params.id, extractClientMeta(req));
  }
}
