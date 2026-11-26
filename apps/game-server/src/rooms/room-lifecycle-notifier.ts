import type { Action, GameState } from '@truco/engine';
import type { GameMode, MatchOutcome, RulesetCode, TableStatus } from '@truco/shared';
import type { MatchLifecyclePublisher } from '../events/match-lifecycle-publisher.js';
import type { GameStore, PersistedSeatBinding } from '../store/game-store.interface.js';

/**
 * Publica la destrucción de una sala por inactividad para que `apps/api` deje la fila
 * de la mesa en un estado consistente (`CLOSED`/`FINISHED` + `closedReason`).
 */
export async function emitRoomExpiredLifecycle(params: {
  readonly publisher: MatchLifecyclePublisher;
  readonly roomId: string;
  readonly tableStatus: TableStatus;
  readonly reason: 'IDLE_TIMEOUT' | 'FINISHED_TTL';
  readonly expiredAtMs: number;
}): Promise<void> {
  await params.publisher.publish({
    kind: 'room.expired',
    roomId: params.roomId,
    tableStatus: params.tableStatus,
    reason: params.reason,
    expiredAtMs: params.expiredAtMs,
  });
}

export async function emitMatchStartedLifecycle(params: {
  readonly publisher: MatchLifecyclePublisher;
  readonly roomId: string;
  readonly matchId: string;
  readonly startedAtMs: number;
  readonly seats: readonly PersistedSeatBinding[];
  readonly practice?: boolean;
}): Promise<void> {
  await params.publisher.publish({
    kind: 'match.started',
    practice: params.practice ?? false,
    roomId: params.roomId,
    matchId: params.matchId,
    startedAtMs: params.startedAtMs,
    seats: params.seats
      .filter((s): s is PersistedSeatBinding & { userId: string } => s.userId !== null && !s.isBot)
      .map((s) => ({
        seat: s.seat,
        team: s.team,
        userId: s.userId,
      })),
  });
}

export async function emitSeatVacatedLifecycle(params: {
  readonly publisher: MatchLifecyclePublisher;
  readonly roomId: string;
  readonly userId: string;
  readonly seat: number;
  readonly vacatedAtMs: number;
}): Promise<void> {
  await params.publisher.publish({
    kind: 'table.seatVacated',
    roomId: params.roomId,
    userId: params.userId,
    seat: params.seat,
    vacatedAtMs: params.vacatedAtMs,
  });
}

export async function emitMatchCompletedLifecycle(params: {
  readonly publisher: MatchLifecyclePublisher;
  readonly store: GameStore;
  readonly roomId: string;
  readonly matchId: string;
  readonly mode: GameMode;
  readonly rulesetCode: RulesetCode;
  readonly seedCommitment: string;
  readonly seedReveal: string;
  readonly startedAtMs: number;
  readonly endedAtMs: number;
  readonly finalState: GameState;
  readonly triggeringAction: Action;
  readonly seats: readonly PersistedSeatBinding[];
  readonly practice?: boolean;
}): Promise<void> {
  const {
    publisher,
    store,
    roomId,
    matchId,
    mode,
    rulesetCode,
    seedCommitment,
    seedReveal,
    startedAtMs,
    endedAtMs,
    finalState,
    triggeringAction,
    seats,
  } = params;

  const winnerTeam = finalState.winnerTeam ?? 0;
  const abandonedSeat = triggeringAction.type === 'SYSTEM_ABANDON' ? triggeringAction.seat : null;
  const reason = abandonedSeat !== null ? 'ABANDON' : 'TARGET_SCORE';

  const scoresByTeam: Record<string, number> = {};
  for (const [teamKey, pts] of Object.entries(finalState.scoresByTeam)) {
    scoresByTeam[teamKey] = pts;
  }

  const players = seats
    .filter((s): s is PersistedSeatBinding & { userId: string } => s.userId !== null && !s.isBot)
    .map((s) => {
      let outcome: MatchOutcome;
      if (abandonedSeat !== null && s.seat === abandonedSeat) {
        outcome = 'ABANDON';
      } else if (s.team === winnerTeam) {
        outcome = 'WIN';
      } else {
        outcome = 'LOSS';
      }
      return {
        seat: s.seat,
        userId: s.userId,
        nickname: s.nickname ?? `Jugador ${s.seat}`,
        team: s.team,
        score: finalState.scoresByTeam[s.team] ?? 0,
        outcome,
      };
    });

  const storedEvents = await store.loadRoomEventsAfter(roomId, 0);
  const startIdx = storedEvents.findIndex(
    (ev) => ev.type === 'game.started' && ev.payload['matchId'] === matchId,
  );
  const matchSlice = startIdx >= 0 ? storedEvents.slice(startIdx) : storedEvents;
  const events = matchSlice.map((ev) => ({
    seq: ev.seq,
    type: ev.type,
    ts: ev.ts,
    payload: ev.payload,
  }));

  await publisher.publish({
    kind: 'match.completed',
    practice: params.practice ?? false,
    hasBots: seats.some((seat) => seat.isBot),
    matchId,
    roomId,
    mode,
    rulesetCode,
    seedCommitment,
    seedReveal,
    startedAtMs,
    endedAtMs,
    winnerTeam,
    scoresByTeam,
    reason,
    players,
    events,
  });
}
