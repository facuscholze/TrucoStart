import { Controller, Get, Inject, Param, Req } from '@nestjs/common';
import type { ModerationSnapshot } from '@truco/shared';
import type { FastifyRequest } from 'fastify';
import { toMyModerationState } from '../../common/account-status.js';
import { DomainApiException } from '../../common/api-exception.js';
import { verifySignedInternalRequest } from '../../common/internal-rpc/verify-signed-request.js';
import { InternalNonceStoreService } from '../../common/internal-rpc/nonce-store.js';
import { ModerationRepository } from './moderation.repository.js';
import { MODERATION_RUNTIME_CONFIG, type ModerationRuntimeConfig } from './moderation.service.js';

/**
 * Endpoint interno (sin cookie de jugador) consultado por `apps/game-server` para
 * aplicar sanciones de forma autoritativa: suspendidos no entran, silenciados no chatean.
 *
 * Usa el mismo esquema que el resto de RPC internas: HMAC-SHA256 sobre
 * `método\npath\ntimestamp\nnonce\nbody`, ventana de reloj acotada y nonce de un solo uso.
 */
@Controller('internal/moderation')
export class InternalModerationController {
  constructor(
    @Inject(MODERATION_RUNTIME_CONFIG) private readonly config: ModerationRuntimeConfig,
    @Inject(ModerationRepository) private readonly repo: ModerationRepository,
    @Inject(InternalNonceStoreService) private readonly nonceStore: InternalNonceStoreService,
  ) {}

  @Get(':userId')
  async snapshot(
    @Param('userId') userId: string,
    @Req() req: FastifyRequest,
  ): Promise<ModerationSnapshot> {
    const path = (req.url ?? '').split('?')[0] ?? req.url ?? '';
    const verified = await verifySignedInternalRequest({
      method: req.method,
      path,
      headers: req.headers,
      rawBody: '',
      secret: this.config.internalSecret,
      nonceStore: this.nonceStore,
      nowMs: this.config.nowFn(),
    });
    if (!verified.ok) {
      throw new DomainApiException(verified.status, verified.code, verified.message);
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
