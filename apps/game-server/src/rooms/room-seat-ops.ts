import type {
  ErrorCode,
  GameMode,
  RulesetCode,
  TableStatus,
  WsAuthTicketClaims,
} from '@truco/shared';
import type { PersistedRoomSnapshot, PersistedSeatBinding } from '../store/game-store.interface.js';

export function createEmptySeatBinding(seat: number): PersistedSeatBinding {
  return {
    seat,
    team: seat % 2,
    userId: null,
    nickname: null,
    sessionId: null,
    ready: false,
    connected: false,
    disconnectedAt: null,
    graceDeadline: null,
  };
}

export function buildEmptyRoomSnapshot(params: {
  readonly roomId: string;
  readonly mode: GameMode;
  readonly rulesetCode: RulesetCode;
  readonly turnTimeoutMs: number;
  readonly nowMs: number;
}): PersistedRoomSnapshot {
  const numSeats = params.mode === '2v2' ? 4 : 2;
  return {
    roomId: params.roomId,
    status: 'WAITING',
    mode: params.mode,
    rulesetCode: params.rulesetCode,
    turnTimeoutMs: params.turnTimeoutMs,
    seats: Array.from({ length: numSeats }, (_, idx) => createEmptySeatBinding(idx)),
    matchId: null,
    seedCommitment: null,
    encryptedSeed: null,
    revealedSeed: null,
    gameState: null,
    seq: 0,
    turnDeadline: null,
    processedEventIds: [],
    updatedAt: params.nowMs,
  };
}

export function prepareRecoveredSnapshot(
  snapshot: PersistedRoomSnapshot,
  nowMs: number,
  graceMs: number,
): PersistedRoomSnapshot {
  const adjustedSeats = snapshot.seats.map((s) =>
    s.userId !== null && snapshot.status === 'IN_GAME'
      ? {
          ...s,
          connected: false,
          disconnectedAt: s.disconnectedAt ?? nowMs,
          graceDeadline: s.graceDeadline ?? nowMs + graceMs,
        }
      : { ...s, connected: false },
  );
  return { ...snapshot, seats: adjustedSeats };
}

export type JoinSeatOutcome =
  | { readonly ok: true; readonly seatIdx: number; readonly alreadySeated: boolean }
  | { readonly ok: false; readonly code: ErrorCode; readonly message: string };

export function evaluateSeatJoin(
  seats: PersistedSeatBinding[],
  status: TableStatus,
  claims: WsAuthTicketClaims,
  preferredSeat?: number,
): JoinSeatOutcome {
  const existingSeat = seats.findIndex((s) => s.userId === claims.userId);
  if (existingSeat !== -1) {
    seats[existingSeat] = { ...seats[existingSeat]!, connected: true };
    return { ok: true, seatIdx: existingSeat, alreadySeated: true };
  }

  if (status === 'IN_GAME') {
    return { ok: false, code: 'ROOM_FULL', message: 'La partida ya está en curso' };
  }

  const targetSeat =
    preferredSeat !== undefined &&
    preferredSeat < seats.length &&
    seats[preferredSeat]?.userId === null
      ? preferredSeat
      : seats.findIndex((s) => s.userId === null);

  if (targetSeat === -1) {
    return { ok: false, code: 'ROOM_FULL', message: 'La sala está llena' };
  }

  seats[targetSeat] = {
    ...seats[targetSeat]!,
    userId: claims.userId,
    nickname: claims.nickname,
    sessionId: claims.sessionId,
    ready: false,
    connected: true,
    disconnectedAt: null,
    graceDeadline: null,
  };
  return { ok: true, seatIdx: targetSeat, alreadySeated: false };
}
