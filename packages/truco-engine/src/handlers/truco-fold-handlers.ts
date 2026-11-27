import { acceptPendingTruco, applyTrucoBid } from '../calls.js';
import { advanceRoundProgress, awardTeamPoints, finishHandAndAdvance } from '../hand-lifecycle.js';
import { getActiveTeams } from '../rounds.js';
import { resolveRespondingSeat, resolveRespondingTeam } from '../team-responder.js';
import type { TrucoBidType } from '../rulesets.js';
import type { DomainEvent, GameState, TrucoDecision } from '../state.types.js';
import {
  type CardId,
  ok,
  type Result,
  type RuleError,
  type SeatId,
  type TeamId,
} from '../types.js';

export function handleSendSignal(
  state: GameState,
  seat: SeatId,
  team: TeamId,
  signalId: string,
): Result<{ state: GameState; events: DomainEvent[] }, RuleError> {
  const prevCount = state.hand.signalCountBySeat[seat] ?? 0;
  const events: DomainEvent[] = [
    {
      type: 'SIGNAL_SENT',
      handNumber: state.hand.handNumber,
      seat,
      team,
      signalId,
    },
  ];
  return ok({
    state: {
      ...state,
      hand: {
        ...state.hand,
        signalsSentThisHand: [
          ...state.hand.signalsSentThisHand,
          { seat, team, signalId, roundIndex: state.hand.currentRoundIndex },
        ],
        signalCountBySeat: {
          ...state.hand.signalCountBySeat,
          [seat]: prevCount + 1,
        },
      },
    },
    events,
  });
}

export function handlePlayCard(
  state: GameState,
  seat: SeatId,
  team: TeamId,
  cardId: CardId,
): Result<{ state: GameState; events: DomainEvent[] }, RuleError> {
  const events: DomainEvent[] = [];
  const seatCards = state.hand.remainingHandsBySeat[seat]!;
  const card = seatCards.find((c) => c.id === cardId)!;
  const nextSeatCards = seatCards.filter((c) => c.id !== cardId);

  events.push({
    type: 'CARD_PLAYED',
    handNumber: state.hand.handNumber,
    roundIndex: state.hand.currentRoundIndex,
    seat,
    team,
    card,
  });

  const updatedState: GameState = {
    ...state,
    hand: {
      ...state.hand,
      remainingHandsBySeat: {
        ...state.hand.remainingHandsBySeat,
        [seat]: nextSeatCards,
      },
      currentRoundPlays: [...state.hand.currentRoundPlays, { seat, team, card }],
    },
  };

  return ok({ state: advanceRoundProgress(updatedState, events), events });
}

export function handleCallTruco(
  state: GameState,
  seat: SeatId,
  team: TeamId,
  bid: TrucoBidType,
): Result<{ state: GameState; events: DomainEvent[] }, RuleError> {
  const events: DomainEvent[] = [];
  const applied = applyTrucoBid(
    state.ruleset,
    state.hand.truco,
    bid,
    seat,
    team,
    state.scoresByTeam,
  );
  if (!applied.ok) return applied;

  if (state.hand.truco.pending !== null) {
    events.push({
      type: 'TRUCO_ACCEPTED',
      handNumber: state.hand.handNumber,
      responderSeat: seat,
      bid: state.hand.truco.pending.bid,
      currentPoints: applied.value.currentPoints,
    });
  }

  events.push({
    type: 'TRUCO_CALLED',
    handNumber: state.hand.handNumber,
    seat,
    team,
    bid,
  });

  const responderTeam = resolveRespondingTeam(
    seat,
    team,
    state.seats,
    state.hand.foldedSeats,
    state.scoresByTeam,
    state.ruleset.teamResponderMode,
  );
  const activeSeat = resolveRespondingSeat(
    seat,
    responderTeam,
    state.hand.manoSeat,
    state.seats,
    state.hand.foldedSeats,
    state.ruleset.responderSelectionMode,
  );

  return ok({
    state: {
      ...state,
      hand: {
        ...state.hand,
        truco: applied.value,
        responderTeam,
        activeSeat,
      },
    },
    events,
  });
}

export function handleRespondTruco(
  state: GameState,
  seat: SeatId,
  decision: TrucoDecision,
): Result<{ state: GameState; events: DomainEvent[] }, RuleError> {
  const events: DomainEvent[] = [];
  const pending = state.hand.truco.pending!;

  if (decision === 'NO_QUIERO') {
    events.push({
      type: 'TRUCO_DECLINED',
      handNumber: state.hand.handNumber,
      responderSeat: seat,
      bid: pending.bid,
      winningTeam: pending.callerTeam,
      pointsAwarded: pending.declinedPoints,
    });
    const nextState = finishHandAndAdvance(
      {
        ...state,
        hand: {
          ...state.hand,
          envidoStatus: state.hand.envidoStatus === 'OPEN' ? 'CLOSED' : state.hand.envidoStatus,
          florStatus: state.hand.florStatus === 'OPEN' ? 'CLOSED' : state.hand.florStatus,
        },
      },
      pending.callerTeam,
      pending.declinedPoints,
      'TRUCO_DECLINED',
      'TRUCO_DECLINED',
      events,
    );
    return ok({ state: nextState, events });
  }

  const accepted = acceptPendingTruco(state.hand.truco);
  if (!accepted.ok) return accepted;

  events.push({
    type: 'TRUCO_ACCEPTED',
    handNumber: state.hand.handNumber,
    responderSeat: seat,
    bid: pending.bid,
    currentPoints: accepted.value.currentPoints,
  });

  return ok({
    state: {
      ...state,
      hand: {
        ...state.hand,
        truco: accepted.value,
        envidoStatus: state.hand.envidoStatus === 'OPEN' ? 'CLOSED' : state.hand.envidoStatus,
        florStatus: state.hand.florStatus === 'OPEN' ? 'CLOSED' : state.hand.florStatus,
        responderTeam: null,
        activeSeat: state.hand.turnSeat,
      },
    },
    events,
  });
}

export function handleFoldHand(
  state: GameState,
  seat: SeatId,
  team: TeamId,
): Result<{ state: GameState; events: DomainEvent[] }, RuleError> {
  const events: DomainEvent[] = [
    {
      type: 'PLAYER_FOLDED',
      handNumber: state.hand.handNumber,
      seat,
      team,
    },
  ];

  let workingState: GameState = {
    ...state,
    hand: {
      ...state.hand,
      foldedSeats: [...state.hand.foldedSeats, seat],
      remainingHandsBySeat: {
        ...state.hand.remainingHandsBySeat,
        [seat]: [],
      },
    },
  };

  if (workingState.hand.envidoStatus === 'PENDING' && workingState.hand.envidoChain !== null) {
    const pendingChain = workingState.hand.envidoChain;
    if (workingState.ruleset.envido.pendingEnvidoOnFold === 'AWARD_DECLINED_POINTS') {
      events.push({
        type: 'ENVIDO_RESOLVED',
        handNumber: workingState.hand.handNumber,
        accepted: false,
        responderSeat: seat,
        winningTeam: pendingChain.lastCallerTeam,
        winningSeat: null,
        winningScore: null,
        pointsAwarded: pendingChain.declinedPoints,
      });
      workingState = awardTeamPoints(
        {
          ...workingState,
          hand: {
            ...workingState.hand,
            envidoStatus: 'RESOLVED',
            envidoChain: null,
          },
        },
        pendingChain.lastCallerTeam,
        pendingChain.declinedPoints,
        'ENVIDO',
        events,
      );
      if (workingState.status === 'FINISHED') {
        events.push({
          type: 'HAND_ENDED',
          handNumber: workingState.hand.handNumber,
          winnerTeam: pendingChain.lastCallerTeam,
          pointsAwarded: 0,
          reason: 'TARGET_REACHED',
        });
        return ok({ state: workingState, events });
      }
    } else {
      workingState = {
        ...workingState,
        hand: {
          ...workingState.hand,
          envidoStatus: 'CLOSED',
          envidoChain: null,
        },
      };
    }
  }

  const activeTeams = getActiveTeams(workingState.seats, workingState.hand.foldedSeats);
  if (activeTeams.length === 1) {
    const winnerTeam = activeTeams[0]!;
    const finalState = finishHandAndAdvance(
      workingState,
      winnerTeam,
      workingState.hand.truco.currentPoints,
      'FOLD',
      'FOLD',
      events,
    );
    return ok({ state: finalState, events });
  }

  return ok({ state: advanceRoundProgress(workingState, events), events });
}
