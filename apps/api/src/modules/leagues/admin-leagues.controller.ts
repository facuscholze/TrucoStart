import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { LeagueCloseResultSchema, LeagueListQuerySchema } from '@truco/shared';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { parseWithZod } from '../../common/zod-validation.js';
import type { AdminPrincipal } from '../admin/admin-auth.service.js';
import { CurrentAdmin } from '../admin/guards/current-admin.decorator.js';
import { AdminAuthGuard, RequirePermission } from '../admin/guards/admin-auth.guard.js';
import { LeaguesService } from './leagues.service.js';

const IdParamSchema = z.object({ id: z.string().uuid() }).strict();

const CloseRoundBody = z.object({ reason: z.string().trim().min(5).max(300) }).strict();

/**
 * Administración de ligas (M10b, entrega 2).
 *
 * Todas las acciones exigen `leagues:manage`, motivo explícito y quedan en `audit_logs` con el
 * estado anterior y el posterior. El cierre de temporada desde el panel es el mismo camino que
 * el cierre automático del barrido: idempotente y transaccional, sin una segunda implementación.
 */
@Controller('admin/leagues')
@UseGuards(AdminAuthGuard)
export class AdminLeaguesController {
  constructor(@Inject(LeaguesService) private readonly leagues: LeaguesService) {}

  @Get()
  async list(@Req() _request: FastifyRequest) {
    void _request;
    // El panel lista con el mismo contrato que la web: una sola forma de leer ligas.
    return await this.leagues.list(asViewer(), parseWithZod(LeagueListQuerySchema, {}));
  }

  @Get(':id/audit')
  @RequirePermission('leagues:manage')
  async audit(@CurrentAdmin() admin: AdminPrincipal, @Param() rawParams: unknown) {
    const { id } = parseWithZod(IdParamSchema, rawParams);
    return await this.leagues.audit({ userId: admin.userId, role: 'ADMIN' }, id);
  }

  @Post(':id/start')
  @RequirePermission('leagues:manage')
  @HttpCode(HttpStatus.OK)
  async start(@CurrentAdmin() admin: AdminPrincipal, @Param() rawParams: unknown) {
    const { id } = parseWithZod(IdParamSchema, rawParams);
    return await this.leagues.start({ userId: admin.userId, role: 'ADMIN' }, id);
  }

  @Post('rounds/:roundId/close')
  @RequirePermission('leagues:manage')
  @HttpCode(HttpStatus.OK)
  async closeRound(
    @CurrentAdmin() admin: AdminPrincipal,
    @Param() rawParams: unknown,
    @Body() rawBody: unknown,
  ) {
    const { roundId } = parseWithZod(z.object({ roundId: z.string().uuid() }).strict(), rawParams);
    parseWithZod(CloseRoundBody, rawBody);
    return await this.leagues.closeRound({ userId: admin.userId, role: 'ADMIN' }, roundId);
  }

  @Post(':id/close')
  @RequirePermission('leagues:manage')
  @HttpCode(HttpStatus.OK)
  async closeSeason(@CurrentAdmin() admin: AdminPrincipal, @Param() rawParams: unknown) {
    const { id } = parseWithZod(IdParamSchema, rawParams);
    return LeagueCloseResultSchema.parse(
      await this.leagues.closeSeason({ userId: admin.userId, role: 'ADMIN' }, id),
    );
  }
}

/**
 * El listado del panel reutiliza el contrato del jugador. Un administrador ve lo mismo que
 * cualquiera en el listado (la información pública de una liga no cambia por rol); lo que cambia
 * es lo que puede hacer, y eso lo decide `@RequirePermission`.
 */
function asViewer() {
  return {
    userId: '00000000-0000-0000-0000-000000000000',
    nickname: 'admin',
    role: 'ADMIN',
  } as never;
}
