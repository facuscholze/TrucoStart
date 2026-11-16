import { randomUUID } from 'node:crypto';
import { type DomainEvent, type GameState, projectEventsForSeat, viewFor } from '@truco/engine';
import type { ServerEventType } from '@truco/shared';
import type { EventAudience, PersistedSequencedEvent } from '../store/game-store.interface.js';

export function isEventVisibleToSeat(
  audience: EventAudience,
  viewerSeat: number,
  viewerTeam: number,
): boolean {
  switch (audience.kind) {
    case 'ALL':
      return true;
    case 'SEAT':
      return audience.seat === viewerSeat;
    case 'TEAM':
      return audience.team === viewerTeam;
  }
}

export interface ProjectEngineStepParams {
  readonly roomId: string;
  readonly matchId: string;
  readonly seedCommitment: string;
  readonly revealedSeed: string | null;
  readonly state: GameState;
  readonly domainEvents: readonly DomainEvent[];
  readonly turnDeadline: number | null;
  readonly turnWarningAt: number | null;
  readonly nowMs: number;
  readonly allocateSeq: () => number;
}

export function buildSequencedEvent(
  allocateSeq: () => number,
  nowMs: number,
  type: ServerEventType,
  payload: Record<string, unknown>,
  audience: EventAudience,
): PersistedSequencedEvent {
  return {
    eventId: randomUUID(),
    seq: allocateSeq(),
    ts: nowMs,
    type,
    payload,
    audience,
  };
}

export function projectEngineStepToWsEvents(
  params: ProjectEngineStepParams,
): PersistedSequencedEvent[] {
  const {
    roomId,
    matchId,
    seedCommitment,
    revealedSeed,
    state,
    domainEvents,
    turnDeadline,
    turnWarningAt,
    nowMs,
    allocateSeq,
  } = params;

  const outbound: PersistedSequencedEvent[] = [];
  const pushAll = (type: ServerEventType, payload: Record<string, unknown>) =>
    outbound.push(buildSequencedEvent(allocateSeq, nowMs, type, payload, { kind: 'ALL' }));

  for (let i = 0; i < domainEvents.length; i++) {
    const ev = domainEvents[i]!;

    switch (ev.type) {
      case 'SIGNAL_SENT':
        for (const s of state.seats) {
          if (projectEventsForSeat([ev], state.seats, s.seat).length > 0 && s.team === ev.team) {
            outbound.push(
              buildSequencedEvent(
                allocateSeq,
                nowMs,
                'game.signalSent',
                {
                  roomId,
                  handNumber: ev.handNumber,
                  seat: ev.seat,
                  team: ev.team,
                  signalId: ev.signalId,
                },
                { kind: 'SEAT', seat: s.seat },
              ),
            );
          }
        }
        break;

      case 'CARD_PLAYED': {
        const nextEv = domainEvents[i + 1];
        const roundEnded =
          nextEv?.type === 'ROUND_ENDED'
            ? {
                winnerTeam: nextEv.winnerTeam,
                winningSeat: nextEv.winningSeat,
                isParda: nextEv.isParda,
              }
            : null;
        if (roundEnded) i++;
        pushAll('game.cardPlayed', {
          roomId,
          handNumber: ev.handNumber,
          roundIndex: ev.roundIndex,
          seat: ev.seat,
          team: ev.team,
          card: ev.card,
          roundEnded,
        });
        break;
      }

      case 'ENVIDO_CALLED':
        pushAll('game.callMade', {
          roomId,
          handNumber: ev.handNumber,
          family: 'ENVIDO',
          bid: ev.bid,
          seat: ev.seat,
          team: ev.team,
          cancelledPendingTruco: ev.cancelledPendingTruco,
        });
        break;

      case 'FLOR_CALLED':
      case 'TRUCO_CALLED':
        pushAll('game.callMade', {
          roomId,
          handNumber: ev.handNumber,
          family: ev.type === 'FLOR_CALLED' ? 'FLOR' : 'TRUCO',
          bid: ev.bid,
          seat: ev.seat,
          team: ev.team,
        });
        break;

      case 'ENVIDO_RESOLVED':
        pushAll('game.callResolved', {
          roomId,
          handNumber: ev.handNumber,
          family: 'ENVIDO',
          accepted: ev.accepted,
          winningTeam: ev.winningTeam,
          winningSeat: ev.winningSeat,
          winningScore: ev.winningScore,
          pointsAwarded: ev.pointsAwarded,
          responderSeat: ev.responderSeat,
        });
        break;

      case 'FLOR_RESOLVED':
        pushAll('game.callResolved', {
          roomId,
          handNumber: ev.handNumber,
          family: 'FLOR',
          accepted: ev.accepted,
          winningTeam: ev.winningTeam,
          winningSeat: ev.winningSeat,
          winningScore: ev.winningScore,
          pointsAwarded: ev.pointsAwarded,
          responderSeat: null,
        });
        break;

      case 'TRUCO_ACCEPTED':
        pushAll('game.callResolved', {
          roomId,
          handNumber: ev.handNumber,
          family: 'TRUCO',
          accepted: true,
          winningTeam: null,
          winningSeat: null,
          winningScore: null,
          pointsAwarded: ev.currentPoints,
          responderSeat: ev.responderSeat,
        });
        break;

      case 'TRUCO_DECLINED':
        pushAll('game.callResolved', {
          roomId,
          handNumber: ev.handNumber,
          family: 'TRUCO',
          accepted: false,
          winningTeam: ev.winningTeam,
          winningSeat: null,
          winningScore: null,
          pointsAwarded: ev.pointsAwarded,
          responderSeat: ev.responderSeat,
        });
        break;

      case 'SCORE_UPDATED':
        pushAll('game.scoreUpdated', {
          roomId,
          handNumber: ev.handNumber,
          team: ev.team,
          delta: ev.delta,
          newScore: ev.newScore,
          reason: ev.reason,
        });
        break;

      case 'HAND_ENDED':
        pushAll('game.handEnded', {
          roomId,
          handNumber: ev.handNumber,
          winnerTeam: ev.winnerTeam,
          pointsAwarded: ev.pointsAwarded,
          reason: ev.reason,
        });
        break;

      case 'HAND_STARTED':
        for (const s of state.seats) {
          const seatView = viewFor(state, s.seat);
          outbound.push(
            buildSequencedEvent(
              allocateSeq,
              nowMs,
              'game.dealt',
              {
                roomId,
                handNumber: ev.handNumber,
                manoSeat: ev.manoSeat,
                mySeat: s.seat,
                myCards: seatView.hand.myInitialCards,
                view: seatView as unknown as Record<string, unknown>,
              },
              { kind: 'SEAT', seat: s.seat },
            ),
          );
        }
        break;

      case 'MATCH_ENDED':
        pushAll('game.ended', {
          roomId,
          matchId,
          winnerTeam: ev.winnerTeam,
          scoresByTeam: ev.scoresByTeam,
          reason: ev.reason,
          seedCommitment,
          seedReveal: revealedSeed ?? '',
        });
        break;

      case 'PLAYER_FOLDED':
      case 'ROUND_ENDED':
      case 'SYSTEM_ACTION_APPLIED':
      case 'MATCH_STARTED':
        break;
    }
  }

  if (state.status === 'IN_PROGRESS' && turnDeadline !== null && turnWarningAt !== null) {
    for (const s of state.seats) {
      const seatView = viewFor(state, s.seat);
      outbound.push(
        buildSequencedEvent(
          allocateSeq,
          nowMs,
          'game.turn',
          {
            roomId,
            handNumber: state.hand.handNumber,
            seat: state.hand.activeSeat,
            responderTeam: state.hand.responderTeam,
            deadline: turnDeadline,
            warningAt: turnWarningAt,
            view: seatView as unknown as Record<string, unknown>,
          },
          { kind: 'SEAT', seat: s.seat },
        ),
      );
    }
  }

  return outbound;
}
