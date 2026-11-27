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
  CreateLeagueRequestSchema,
  LeagueDetailSchema,
  LeagueListQuerySchema,
  LeagueListResponseSchema,
  RescheduleLeagueMatchRequestSchema,
  RescheduleLeagueMatchResponseSchema,
} from '@truco/shared';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { parseWithZod } from '../../common/zod-validation.js';
import { CurrentPrincipal } from '../auth/guards/current-principal.decorator.js';
import {
  type AuthenticatedPrincipal,
  SessionAuthGuard,
  extractClientMeta,
} from '../auth/guards/session-auth.guard.js';
import { LeaguesService } from './leagues.service.js';

const IdParamSchema = z.object({ id: z.string().uuid() }).strict();

/**
 * Ligas (M10b, entrega 2) para jugadores.
 *
 * Todas las rutas exigen sesión. No hay ruta de inscripción con costo: no existe tal cosa
 * (regla 13). El listado muestra lo que cualquiera puede ver; el detalle esconde las partidas
 * ajenas salvo que quien mire organice la liga.
 */
@Controller('leagues')
@UseGuards(SessionAuthGuard)
export class LeaguesController {
  constructor(@Inject(LeaguesService) private readonly leagues: LeaguesService) {}

  @Get()
  async list(@CurrentPrincipal() principal: AuthenticatedPrincipal, @Query() rawQuery: unknown) {
    const query = parseWithZod(LeagueListQuerySchema, rawQuery);
    return LeagueListResponseSchema.parse(await this.leagues.list(principal, query));
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Body() rawBody: unknown,
    @Req() request: FastifyRequest,
  ) {
    const body = parseWithZod(CreateLeagueRequestSchema, rawBody);
    const meta = extractClientMeta(request);
    return await this.leagues.create(principal, body, { ip: meta.ip });
  }

  @Get(':id')
  async detail(@CurrentPrincipal() principal: AuthenticatedPrincipal, @Param() rawParams: unknown) {
    const { id } = parseWithZod(IdParamSchema, rawParams);
    return LeagueDetailSchema.parse(await this.leagues.detail(principal, id));
  }

  @Post(':id/join')
  @HttpCode(HttpStatus.CREATED)
  async join(@CurrentPrincipal() principal: AuthenticatedPrincipal, @Param() rawParams: unknown) {
    const { id } = parseWithZod(IdParamSchema, rawParams);
    return await this.leagues.join(principal, id);
  }

  // "Darse de baja" no usa el verbo `withdraw`: está reservado por `check-no-real-money` para
  // retiros de dinero, igual que en torneos.
  @Post(':id/leave')
  @HttpCode(HttpStatus.OK)
  async leave(@CurrentPrincipal() principal: AuthenticatedPrincipal, @Param() rawParams: unknown) {
    const { id } = parseWithZod(IdParamSchema, rawParams);
    return await this.leagues.leave(principal, id);
  }

  /** Arranca la liga: cierra la inscripción y arma calendario y partidas. */
  @Post(':id/start')
  @HttpCode(HttpStatus.OK)
  async start(@CurrentPrincipal() principal: AuthenticatedPrincipal, @Param() rawParams: unknown) {
    const { id } = parseWithZod(IdParamSchema, rawParams);
    return await this.leagues.start(principal, id);
  }

  /** Reprograma una partida propia dentro de los topes de la liga. */
  @Post('matches/:matchId/reschedule')
  @HttpCode(HttpStatus.OK)
  async reschedule(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param() rawParams: unknown,
    @Body() rawBody: unknown,
  ) {
    const { matchId } = parseWithZod(z.object({ matchId: z.string().uuid() }).strict(), rawParams);
    const body = parseWithZod(RescheduleLeagueMatchRequestSchema, rawBody);
    return RescheduleLeagueMatchResponseSchema.parse(
      await this.leagues.reschedule(principal, matchId, body),
    );
  }
}
