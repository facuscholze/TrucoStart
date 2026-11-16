import { Inject, Injectable } from '@nestjs/common';
import {
  type MatchmakingCancelResponse,
  MatchmakingCancelResponseSchema,
  type MatchmakingEnqueueRequest,
  type MatchmakingQueueStatusResponse,
  MatchmakingQueueStatusResponseSchema,
  type RulesetCode,
} from '@truco/shared';
import { DomainApiException } from '../../common/api-exception.js';
import type { AuthenticatedPrincipal } from '../auth/guards/session-auth.guard.js';
import { LOBBY_RUNTIME_CONFIG, type LobbyRuntimeConfig } from '../lobby/lobby.config.js';
import { LobbyRepository } from '../lobby/lobby.repository.js';
import { LobbyService } from '../lobby/lobby.service.js';
import { LobbyRealtimeGateway } from '../lobby/lobby-realtime.gateway.js';
import { MATCHMAKING_STORE, type MatchmakingStore } from './store/matchmaking-store.interface.js';

@Injectable()
export class MatchmakingService {
  constructor(
    @Inject(LOBBY_RUNTIME_CONFIG) private readonly config: LobbyRuntimeConfig,
    @Inject(MATCHMAKING_STORE) private readonly matchmakingStore: MatchmakingStore,
    @Inject(LobbyRepository) private readonly lobbyRepository: LobbyRepository,
    @Inject(LobbyService) private readonly lobbyService: LobbyService,
    @Inject(LobbyRealtimeGateway) private readonly realtimeGateway: LobbyRealtimeGateway,
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

    const nowMs = this.config.nowFn();
    const expiresAtMs = nowMs + this.config.matchmakingTimeoutMs;
    const quota = body.mode === '1v1' ? 2 : 4;

    const outcome = await this.matchmakingStore.enqueueAndTryMatch(
      {
        userId: principal.userId,
        nickname: principal.nickname,
        mode: body.mode,
        rulesetCode: body.rulesetCode,
        enqueuedAtMs: nowMs,
        expiresAtMs,
      },
      quota,
      nowMs,
    );

    if (outcome.kind === 'QUEUED') {
      return {
        httpStatus: 200,
        payload: MatchmakingQueueStatusResponseSchema.parse({
          status: 'QUEUED',
          mode: outcome.entry.mode,
          rulesetCode: outcome.entry.rulesetCode,
          enqueuedAt: new Date(outcome.entry.enqueuedAtMs).toISOString(),
          expiresAt: new Date(outcome.entry.expiresAtMs).toISOString(),
          position: outcome.position,
        }),
      };
    }

    const aggregate = await this.lobbyService.createMatchmadeTable({
      mode: body.mode,
      rulesetCode: body.rulesetCode,
      players: outcome.players.map((p) => ({ userId: p.userId, nickname: p.nickname })),
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
