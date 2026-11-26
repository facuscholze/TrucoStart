import {
  Body,
  Controller,
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
  AdminAdvanceTournamentRequestSchema,
  AdminCancelTournamentRequestSchema,
  AdminCreateTournamentRequestSchema,
  AdminResolveTournamentIncidentRequestSchema,
  TournamentDetailResponseSchema,
  TournamentListQuerySchema,
  TournamentListResponseSchema,
} from '@truco/shared';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { parseWithZod } from '../../common/zod-validation.js';
import type { AdminPrincipal } from '../admin/admin-auth.service.js';
import { CurrentAdmin } from '../admin/guards/current-admin.decorator.js';
import { AdminAuthGuard, RequirePermission } from '../admin/guards/admin-auth.guard.js';
import { extractClientMeta } from '../auth/guards/session-auth.guard.js';
import { TournamentsService } from './tournaments.service.js';

const IdParamSchema = z.object({ id: z.string().uuid() }).strict();

/**
 * Acciones administrativas sobre torneos (M10a).
 *
 * Todas exigen `tournaments:manage`, motivo explícito y quedan en `audit_logs` con el
 * estado anterior y el posterior. Crear un oficial también pasa por acá para que el
 * torneo oficial nunca dependa de que el cliente diga "soy admin".
 */
@Controller('admin/tournaments')
@UseGuards(AdminAuthGuard)
export class AdminTournamentsController {
  constructor(@Inject(TournamentsService) private readonly tournaments: TournamentsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermission('tournaments:manage')
  async create(
    @CurrentAdmin() principal: AdminPrincipal,
    @Body() rawBody: unknown,
    @Req() request: FastifyRequest,
  ) {
    const { reason, ...body } = parseWithZod(AdminCreateTournamentRequestSchema, rawBody);
    const meta = extractClientMeta(request);
    const tournament = await this.tournaments.createAsStaff(principal, body, {
      ip: meta.ip,
      reason,
    });
    return { tournament };
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('tournaments:manage')
  async cancel(
    @CurrentAdmin() principal: AdminPrincipal,
    @Param() rawParams: unknown,
    @Body() rawBody: unknown,
    @Req() request: FastifyRequest,
  ) {
    const { id } = parseWithZod(IdParamSchema, rawParams);
    const body = parseWithZod(AdminCancelTournamentRequestSchema, rawBody);
    const meta = extractClientMeta(request);
    await this.tournaments.cancel(principal, id, body, { ip: meta.ip });
    return { cancelled: true };
  }

  @Post(':id/advance')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('tournaments:manage')
  async advance(
    @CurrentAdmin() principal: AdminPrincipal,
    @Param() rawParams: unknown,
    @Body() rawBody: unknown,
    @Req() request: FastifyRequest,
  ) {
    const { id } = parseWithZod(IdParamSchema, rawParams);
    const body = parseWithZod(AdminAdvanceTournamentRequestSchema, rawBody);
    const meta = extractClientMeta(request);
    await this.tournaments.forceAdvance(principal, id, body, { ip: meta.ip });
    return { advanced: true };
  }

  @Post(':id/resolve-incident')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('tournaments:manage')
  async resolveIncident(
    @CurrentAdmin() principal: AdminPrincipal,
    @Param() rawParams: unknown,
    @Body() rawBody: unknown,
    @Req() request: FastifyRequest,
  ) {
    const { id } = parseWithZod(IdParamSchema, rawParams);
    const body = parseWithZod(AdminResolveTournamentIncidentRequestSchema, rawBody);
    const meta = extractClientMeta(request);
    await this.tournaments.resolveIncident(principal, id, body, { ip: meta.ip });
    return { resolved: true };
  }

  /** Listado del panel: incluye torneos privados de terceros. */
  @Get()
  @RequirePermission('tournaments:manage')
  async list(@Query() rawQuery: unknown) {
    const query = parseWithZod(TournamentListQuerySchema, rawQuery);
    return TournamentListResponseSchema.parse(await this.tournaments.listForStaff(query));
  }

  /** Lectura del cuadro completo para el panel, incluido lo que el jugador no ve. */
  @Post(':id/detail')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('tournaments:manage')
  async detail(@CurrentAdmin() principal: AdminPrincipal, @Param() rawParams: unknown) {
    const { id } = parseWithZod(IdParamSchema, rawParams);
    void TournamentDetailResponseSchema;
    return TournamentDetailResponseSchema.parse(
      await this.tournaments.detail(principal.userId, id, { asStaff: true }),
    );
  }
}
