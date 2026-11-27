import { Inject, Injectable } from '@nestjs/common';
import {
  type MatchmakingCancelResponse,
  MatchmakingCancelResponseSchema,
  type MatchmakingEnqueueRequest,
  type MatchmakingQueueStatusResponse,
  MatchmakingQueueStatusResponseSchema,
  type RulesetCode,
  isCompetitiveMode,
  seatsForMode,
} from '@truco/shared';
import { DomainApiException } from '../../common/api-exception.js';
import type { AuthenticatedPrincipal } from '../auth/guards/session-auth.guard.js';
import { LOBBY_RUNTIME_CONFIG, type LobbyRuntimeConfig } from '../lobby/lobby.config.js';
import { LobbyRepository } from '../lobby/lobby.repository.js';
import { LobbyService } from '../lobby/lobby.service.js';
import { LobbyRealtimeGateway } from '../lobby/lobby-realtime.gateway.js';
import { MATCHMAKING_STORE, type MatchmakingStore } from './store/matchmaking-store.interface.js';
import { RatingsService } from '../ratings/ratings.service.js';

@Injectable()
export class MatchmakingService {
  constructor(
    @Inject(LOBBY_RUNTIME_CONFIG) private readonly config: LobbyRuntimeConfig,
    @Inject(MATCHMAKING_STORE) private readonly matchmakingStore: MatchmakingStore,
    @Inject(LobbyRepository) private readonly lobbyRepository: LobbyRepository,
    @Inject(LobbyService) private readonly lobbyService: LobbyService,
    @Inject(LobbyRealtimeGateway) private readonly realtimeGateway: LobbyRealtimeGateway,
    @Inject(RatingsService) private readonly ratingsService: RatingsService,
  ) {}

  async enqueue(
    principal: AuthenticatedPrincipal,
    body: MatchmakingEnqueueRequest,
  ): Promise<{ readonly httpStatus: 200 | 201; readonly payload: MatchmakingQueueStatusResponse }> {
    await this.lobbyService.sweepExpiredTables();

    const activeSeat = await this.lobbyRepository.findActiveSeatForUser(principal.userId);
    if (activeSeat) {
      throw new DomainApiException(
        409,
        'CONFLICT',
        'Ya participás de una mesa o partida activa. Finalizala o salí antes de buscar partida.',
        { reason: 'ALREADY_IN_ACTIVE_TABLE', activeTableId: activeSeat.tableId },
      );
    }

    // El truco de 6 es social: no tiene cola competitiva (ADR-033). Se rechaza antes de
    // encolar para que el jugador no quede esperando una partida que nunca se puntúa.
    if (body.competitive && !isCompetitiveMode(body.mode)) {
      throw new DomainApiException(
        400,
        'VALIDATION_ERROR',
        'El truco de 6 (3v3) es un modo social y no tiene cola competitiva.',
        { reason: 'COMPETITIVE_MODE_NOT_ALLOWED', mode: body.mode },
      );
    }

    const nowMs = this.config.nowFn();
    const expiresAtMs = nowMs + this.config.matchmakingTimeoutMs;
    const quota = seatsForMode(body.mode);

    const competitiveProfile = body.competitive
      ? await this.ratingsService.getCompetitiveMatchmakingProfile(principal.userId, body.mode)
      : null;
    const outcome = await this.matchmakingStore.enqueueAndTryMatch(
      {
        userId: principal.userId,
        nickname: principal.nickname,
        mode: body.mode,
        rulesetCode: body.rulesetCode,
        enqueuedAtMs: nowMs,
        expiresAtMs,
        competitive: body.competitive,
        ...(competitiveProfile
          ? {
              rating: competitiveProfile.rating,
              ratingDeviation: competitiveProfile.deviation,
              blockedOpponentIds: competitiveProfile.blockedOpponentIds,
            }
          : {}),
      },
      quota,
      nowMs,
      body.competitive ? this.ratingsService.getCompetitiveMatchmakingOptions() : undefined,
    );

    if (outcome.kind === 'QUEUED' && Boolean(outcome.entry.competitive) !== body.competitive) {
      throw new DomainApiException(
        409,
        'CONFLICT',
        'Ya tenés una búsqueda activa de otro tipo. Cancelala antes de cambiar entre cola casual y competitiva.',
      );
    }

    if (outcome.kind === 'QUEUED') {
      return {
        httpStatus: 200,
        payload: MatchmakingQueueStatusResponseSchema.parse({
          status: 'QUEUED',
          mode: outcome.entry.mode,
          rulesetCode: outcome.entry.rulesetCode,
          competitive: outcome.entry.competitive ?? false,
          enqueuedAt: new Date(outcome.entry.enqueuedAtMs).toISOString(),
          expiresAt: new Date(outcome.entry.expiresAtMs).toISOString(),
          position: outcome.position,
        }),
      };
    }

    const aggregate = await this.lobbyService.createMatchmadeTable({
      mode: body.mode,
      rulesetCode: body.rulesetCode,
      competitive: body.competitive,
      players: outcome.players.map((p) => ({
        userId: p.userId,
        nickname: p.nickname,
        team: p.team,
      })),
    });

    let callerSeat = 0;
    let callerTeam = 0;

    for (const seatRow of aggregate.activeSeats) {
      if (seatRow.userId === principal.userId) {
        callerSeat = seatRow.seat;
        callerTeam = seatRow.team;
      }

      this.realtimeGateway.notifyUserMatched(seatRow.userId, {
        tableId: aggregate.row.id,
        roomId: aggregate.row.id,
        mode: aggregate.row.mode,
        rulesetCode: aggregate.row.rulesetCode as RulesetCode,
        seat: seatRow.seat,
        team: seatRow.team,
      });
    }

    return {
      httpStatus: 201,
      payload: MatchmakingQueueStatusResponseSchema.parse({
        status: 'MATCHED',
        tableId: aggregate.row.id,
        roomId: aggregate.row.id,
        mode: aggregate.row.mode,
        rulesetCode: aggregate.row.rulesetCode,
        competitive: aggregate.row.isCompetitive,
        mySeat: callerSeat,
        myTeam: callerTeam,
      }),
    };
  }

  async getQueueStatus(principal: AuthenticatedPrincipal): Promise<MatchmakingQueueStatusResponse> {
    await this.lobbyService.sweepExpiredTables();
    const nowMs = this.config.nowFn();
    const lookup = await this.matchmakingStore.getUserQueue(principal.userId, nowMs);

    if (lookup.status === 'QUEUED') {
      return MatchmakingQueueStatusResponseSchema.parse({
        status: 'QUEUED',
        mode: lookup.entry.mode,
        rulesetCode: lookup.entry.rulesetCode,
        competitive: lookup.entry.competitive ?? false,
        enqueuedAt: new Date(lookup.entry.enqueuedAtMs).toISOString(),
        expiresAt: new Date(lookup.entry.expiresAtMs).toISOString(),
        position: lookup.position,
      });
    }

    const activeSeat = await this.lobbyRepository.findActiveSeatForUser(principal.userId);
    if (activeSeat) {
      const agg = await this.lobbyRepository.getTableWithSeats(activeSeat.tableId);
      if (agg && (agg.row.status === 'WAITING' || agg.row.status === 'IN_GAME')) {
        return MatchmakingQueueStatusResponseSchema.parse({
          status: 'MATCHED',
          tableId: agg.row.id,
          roomId: agg.row.id,
          mode: agg.row.mode,
          rulesetCode: agg.row.rulesetCode,
          competitive: agg.row.isCompetitive,
          mySeat: activeSeat.seat,
          myTeam: activeSeat.team,
        });
      }
    }

    return MatchmakingQueueStatusResponseSchema.parse({ status: 'IDLE' });
  }

  async cancelQueue(principal: AuthenticatedPrincipal): Promise<MatchmakingCancelResponse> {
    const cancelled = await this.matchmakingStore.cancelUserQueue(principal.userId);
    return MatchmakingCancelResponseSchema.parse({ cancelled });
  }
}
