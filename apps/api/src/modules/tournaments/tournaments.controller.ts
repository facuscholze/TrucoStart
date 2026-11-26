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
  CreateTournamentRequestSchema,
  RegisterTeamRequestSchema,
  TournamentDetailResponseSchema,
  TournamentJoinByCodeRequestSchema,
  TournamentListResponseSchema,
  TournamentStatusSchema,
} from '@truco/shared';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { parseWithZod } from '../../common/zod-validation.js';
import { extractClientMeta } from '../auth/guards/session-auth.guard.js';
import { CurrentPrincipal } from '../auth/guards/current-principal.decorator.js';
import {
  type AuthenticatedPrincipal,
  SessionAuthGuard,
} from '../auth/guards/session-auth.guard.js';
import { TournamentsService } from './tournaments.service.js';

const IdParamSchema = z.object({ id: z.string().uuid() }).strict();

const ListQuerySchema = z
  .object({
    status: z
      .union([TournamentStatusSchema, z.array(TournamentStatusSchema)])
      .optional()
      .transform((value) => (value === undefined ? [] : Array.isArray(value) ? value : [value])),
    limit: z.coerce.number().int().min(1).max(50).optional().default(20),
    cursor: z.string().max(200).optional().nullable().default(null),
  })
  .strict();

/**
 * Torneos (M10a) para jugadores.
 *
 * Todas las rutas exigen sesión. `SessionAuthGuard` ya rechaza cuentas suspendidas o
 * bloqueadas (M9a), así que una sanción vigente impide crear, inscribirse y jugar.
 */
@Controller('tournaments')
@UseGuards(SessionAuthGuard)
export class TournamentsController {
  constructor(@Inject(TournamentsService) private readonly tournaments: TournamentsService) {}

  @Get()
  async list(@CurrentPrincipal() principal: AuthenticatedPrincipal, @Query() rawQuery: unknown) {
    const query = parseWithZod(ListQuerySchema, rawQuery);
    return TournamentListResponseSchema.parse(await this.tournaments.list(principal.userId, query));
  }

  @Get('mine')
  async listMine(@CurrentPrincipal() principal: AuthenticatedPrincipal) {
    // Los ítems ya salen tipados del servicio; se validan contra el contrato publicado.
    const result = await this.tournaments.listMine(principal.userId);
    return TournamentListResponseSchema.parse({ items: result.items, nextCursor: null });
  }

  /** Próxima partida del jugador en cualquier torneo, para el panel de inicio. */
  @Get('my-next-match')
  async myNextMatch(@CurrentPrincipal() principal: AuthenticatedPrincipal) {
    return this.tournaments.myNextMatch(principal.userId);
  }

  @Get(':id')
  async detail(@CurrentPrincipal() principal: AuthenticatedPrincipal, @Param() rawParams: unknown) {
    const { id } = parseWithZod(IdParamSchema, rawParams);
    return TournamentDetailResponseSchema.parse(
      await this.tournaments.detail(principal.userId, id),
    );
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Body() rawBody: unknown,
    @Req() request: FastifyRequest,
  ) {
    const body = parseWithZod(CreateTournamentRequestSchema, rawBody);
    const meta = extractClientMeta(request);
    const tournament = await this.tournaments.create(
      principal,
      {
        ...body,
        rules: { ...body.rules, rulesetCode: body.rules.rulesetCode },
        prizes: body.prizes.map((prize) => ({
          position: prize.position,
          coins: prize.coins,
          cosmeticId: prize.cosmeticId,
        })),
      },
      { ip: meta.ip },
    );
    return { tournament };
  }

  @Post('join-by-code')
  @HttpCode(HttpStatus.OK)
  async joinByCode(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Body() rawBody: unknown,
  ) {
    void principal;
    const body = parseWithZod(TournamentJoinByCodeRequestSchema, rawBody);
    return this.tournaments.resolveJoinCode(body.joinCode);
  }

  @Post(':id/register')
  @HttpCode(HttpStatus.CREATED)
  async register(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param() rawParams: unknown,
  ) {
    const { id } = parseWithZod(IdParamSchema, rawParams);
    return this.tournaments.register(principal, id);
  }

  // La ruta nombra la acción del torneo ("darse de baja"). No se usa `withdraw` porque
  // ese verbo está reservado por `check-no-real-money` para retiros de dinero, y el
  // guard no debe aflojarse para acomodar un nombre.
  /** Inscripción de un equipo en un torneo 2v2: el capitán anota a los dos juntos. */
  @Post(':id/teams')
  @HttpCode(HttpStatus.CREATED)
  async registerTeam(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param() rawParams: unknown,
    @Body() rawBody: unknown,
  ) {
    const { id } = parseWithZod(IdParamSchema, rawParams);
    const body = parseWithZod(RegisterTeamRequestSchema, rawBody);
    return this.tournaments.registerTeam(principal, id, body);
  }

  @Post(':id/unregister')
  @HttpCode(HttpStatus.OK)
  async unregister(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param() rawParams: unknown,
  ) {
    const { id } = parseWithZod(IdParamSchema, rawParams);
    await this.tournaments.unregister(principal, id);
    return { withdrawn: true };
  }

  @Post(':id/check-in')
  @HttpCode(HttpStatus.OK)
  async checkIn(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param() rawParams: unknown,
  ) {
    const { id } = parseWithZod(IdParamSchema, rawParams);
    await this.tournaments.checkIn(principal, id);
    return { checkedIn: true };
  }
}
