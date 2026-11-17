import { randomUUID } from 'node:crypto';
import { type GameState, viewFor } from '@truco/engine';
import type { WsEnvelope } from '@truco/shared';
import type { Socket } from 'socket.io';
import type { GameStore } from '../store/game-store.interface.js';
import { isEventVisibleToSeat } from './event-projector.js';

export interface DeliverRejoinParams {
  readonly socket: Socket;
  readonly store: GameStore;
  readonly roomId: string;
  readonly seatIdx: number;
  readonly team: number;
  readonly lastSeq: number;
  readonly currentSeq: number;
  readonly nowMs: number;
  readonly matchId: string | null;
  readonly seedCommitment: string | null;
  readonly turnDeadline: number | null;
  readonly gameState: GameState | null;
}

export async function deliverRejoinDeltaOrResync(params: DeliverRejoinParams): Promise<void> {
  const {
    socket,
    store,
    roomId,
    seatIdx,
    team,
    lastSeq,
    currentSeq,
    nowMs,
    matchId,
    seedCommitment,
    turnDeadline,
    gameState,
  } = params;

  const allAfter = await store.loadRoomEventsAfter(roomId, lastSeq);
  const missedVisible = allAfter.filter((ev) => isEventVisibleToSeat(ev.audience, seatIdx, team));

  if (lastSeq > 0 && (missedVisible.length > 0 || lastSeq === currentSeq)) {
    for (const ev of missedVisible) {
      const wire: WsEnvelope = {
        eventId: ev.eventId,
        seq: ev.seq,
        ts: ev.ts,
        type: ev.type,
        payload: ev.payload,
      };
      socket.emit('envelope', wire);
    }
    return;
  }

  if (gameState) {
    const resyncWire: WsEnvelope = {
      eventId: randomUUID(),
      seq: currentSeq,
      ts: nowMs,
      type: 'game.resync',
      payload: {
        roomId,
        matchId,
        seedCommitment,
        turnDeadline,
        view: viewFor(gameState, seatIdx) as unknown as Record<string, unknown>,
      },
    };
    socket.emit('envelope', resyncWire);
  }
}
