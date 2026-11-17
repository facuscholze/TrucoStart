import { timingSafeEqual } from 'node:crypto';
import { Controller, Get, Inject, Param, Req } from '@nestjs/common';
import { INTERNAL_SECRET_HEADER, type ModerationSnapshot } from '@truco/shared';
import type { FastifyRequest } from 'fastify';
import { toMyModerationState } from '../../common/account-status.js';
import { DomainApiException } from '../../common/api-exception.js';
import { ModerationRepository } from './moderation.repository.js';
import { MODERATION_RUNTIME_CONFIG, type ModerationRuntimeConfig } from './moderation.service.js';

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * Endpoint interno (sin cookie de jugador) consultado por `apps/game-server` para
 * aplicar sanciones de forma autoritativa: suspendidos no entran, silenciados no chatean.
 */
@Controller('internal/moderation')
export class InternalModerationController {
  constructor(
    @Inject(MODERATION_RUNTIME_CONFIG) private readonly config: ModerationRuntimeConfig,
    @Inject(ModerationRepository) private readonly repo: ModerationRepository,
  ) {}

  @Get(':userId')
  async snapshot(
    @Param('userId') userId: string,
    @Req() req: FastifyRequest,
  ): Promise<ModerationSnapshot> {
    const header = req.headers[INTERNAL_SECRET_HEADER];
    const provided = Array.isArray(header) ? header[0] : header;
    if (!provided || !safeEqual(provided, this.config.internalSecret)) {
      throw new DomainApiException(401, 'UNAUTHORIZED', 'Secreto interno inválido.');
    }

    const user = await this.repo.findUserById(userId);
    if (!user) {
      return {
        accountStatus: 'DELETED',
        statusReason: 'Cuenta inexistente',
        statusExpiresAt: null,
        mutedUntil: null,
      };
    }
    const openAgainst = await this.repo.countOpenReportsAgainst(user.id);
    const state = toMyModerationState(user, new Date(this.config.nowFn()), openAgainst);
    return {
      accountStatus: state.accountStatus,
      statusReason: state.statusReason,
      statusExpiresAt: state.statusExpiresAt,
      mutedUntil: state.mutedUntil,
    };
  }
}
