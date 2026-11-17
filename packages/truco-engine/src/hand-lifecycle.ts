import { applyTrucoBid, createInitialTrucoState } from './calls.js';
import { createStandardDeck, dealHands } from './cards.js';
import {
  evaluateHandWinnerFromRounds,
  evaluateRound,
  findFirstActiveSeatFrom,
  findNextOpposingTeam,
  findNextTurnSeatInRound,
  selectActiveResponderSeat,
  shuffleDeckWithPrngState,
} from './rounds.js';
import type { RuleSet } from './rulesets.js';
import type {
  CompletedRound,
  DomainEvent,
  GameState,
  HandEndReason,
  HandState,
  ScoreReason,
} from './state.types.js';
import type { Card, PlayerSeat, SeatId, TeamId } from './types.js';

export function buildHandState(
  ruleset: RuleSet,
  _seats: readonly PlayerSeat[],
  handNumber: number,
  manoSeat: SeatId,
  handsBySeat: Readonly<Record<SeatId, readonly Card[]>>,
): HandState {
  const clonedInitial: Record<SeatId, readonly Card[]> = {};
  const clonedRemaining: Record<SeatId, readonly Card[]> = {};

  for (const [seatKey, cards] of Object.entries(handsBySeat)) {
    const seat = Number(seatKey);
    clonedInitial[seat] = [...cards];
    clonedRemaining[seat] = [...cards];
  }

  return {
    handNumber,
    manoSeat,
    currentRoundIndex: 0,
    roundLeadSeat: manoSeat,
    turnSeat: manoSeat,
    initialHandsBySeat: clonedInitial,
    remainingHandsBySeat: clonedRemaining,
    currentRoundPlays: [],
    completedRounds: [],
    foldedSeats: [],
    envidoStatus: 'OPEN',
    envidoChain: null,
    florStatus: ruleset.flor.enabled ? 'OPEN' : 'CLOSED',
    florChain: null,
    announcedFlorSeats: [],
    truco: createInitialTrucoState(ruleset),
    responderTeam: null,
    activeSeat: manoSeat,
    signalsSentThisHand: [],
    signalCountBySeat: {},
  };
}

export function awardTeamPoints(
  state: GameState,
  team: TeamId,
  delta: number,
  reason: ScoreReason,
  events: DomainEvent[],
): GameState {
  const prevScore = state.scoresByTeam[team] ?? 0;
  const newScore = Math.min(state.ruleset.targetScore, prevScore + delta);
  const actualDelta = newScore - prevScore;

  const updatedScores: Record<TeamId, number> = {
    ...state.scoresByTeam,
    [team]: newScore,
  };

  events.push({
    type: 'SCORE_UPDATED',
    handNumber: state.hand.handNumber,
    team,
    delta: actualDelta,
    newScore,
    reason,
  });

  if (newScore >= state.ruleset.targetScore) {
    events.push({
      type: 'MATCH_ENDED',
      winnerTeam: team,
      scoresByTeam: updatedScores,
      reason: reason === 'ABANDON' ? 'ABANDON' : 'TARGET_SCORE',
    });
    return {
      ...state,
      status: 'FINISHED',
      scoresByTeam: updatedScores,
      winnerTeam: team,
    };
  }

  return {
    ...state,
    scoresByTeam: updatedScores,
  };
}

export function finishHandAndAdvance(
  state: GameState,
  winnerTeam: TeamId,
  pointsAwarded: number,
  scoreReason: ScoreReason,
  handEndReason: HandEndReason,
  events: DomainEvent[],
): GameState {
  const scoredState = awardTeamPoints(state, winnerTeam, pointsAwarded, scoreReason, events);

  const handEndedEvent: DomainEvent = {
    type: 'HAND_ENDED',
    handNumber: state.hand.handNumber,
    winnerTeam,
    pointsAwarded,
    reason: handEndReason,
  };

  if (scoredState.status === 'FINISHED') {
    // Asegurar que MATCH_ENDED sea siempre el evento terminal absoluto del flujo
    const lastIdx = events.length - 1;
    if (events[lastIdx]?.type === 'MATCH_ENDED') {
      events.splice(lastIdx, 0, handEndedEvent);
    } else {
      events.push(handEndedEvent);
    }
    return scoredState;
  }

  events.push(handEndedEvent);

  const { shuffled, nextPrngState } = shuffleDeckWithPrngState(
    createStandardDeck(),
    scoredState.internalPrngState,
  );
  const nextManoSeat = (scoredState.hand.manoSeat + 1) % scoredState.seats.length;
  const nextHandNumber = scoredState.hand.handNumber + 1;
  const nextHandsBySeat = dealHands(shuffled, scoredState.seats.length, nextManoSeat);
  const nextHand = buildHandState(
    scoredState.ruleset,
    scoredState.seats,
    nextHandNumber,
    nextManoSeat,
    nextHandsBySeat,
  );

  events.push({
    type: 'HAND_STARTED',
    handNumber: nextHandNumber,
    manoSeat: nextManoSeat,
  });

  return {
    ...scoredState,
    hand: nextHand,
    internalPrngState: nextPrngState,
  };
}

export function resumeAfterSecondaryTrack(state: GameState, events: DomainEvent[]): GameState {
  if (state.status === 'FINISHED') return state;

  const suspended = state.hand.truco.suspendedCaller;
  if (suspended) {
    const resumedTruco = applyTrucoBid(
      state.ruleset,
      { ...state.hand.truco, suspendedCaller: null },
      'TRUCO',
      suspended.seat,
      suspended.team,
      state.scoresByTeam,
    );
    if (resumedTruco.ok) {
      const responderTeam = findNextOpposingTeam(
        suspended.seat,
        suspended.team,
        state.seats,
        state.hand.foldedSeats,
      );
      const activeSeat = selectActiveResponderSeat(
        suspended.seat,
        responderTeam,
        state.hand.manoSeat,
        state.seats,
        state.hand.foldedSeats,
        state.ruleset.responderSelectionMode,
      );
      events.push({
        type: 'TRUCO_CALLED',
        handNumber: state.hand.handNumber,
        seat: suspended.seat,
        team: suspended.team,
        bid: 'TRUCO',
      });
      return {
        ...state,
        hand: {
          ...state.hand,
          truco: resumedTruco.value,
          responderTeam,
          activeSeat,
        },
      };
    }
  }

  return {
    ...state,
    hand: {
      ...state.hand,
      responderTeam: null,
      activeSeat: state.hand.turnSeat,
    },
  };
}

export function advanceRoundProgress(state: GameState, events: DomainEvent[]): GameState {
  const { hand, seats } = state;
  const nextTurn = findNextTurnSeatInRound(
    hand.roundLeadSeat,
    seats,
    hand.foldedSeats,
    hand.currentRoundPlays,
  );

  if (nextTurn !== null) {
    return {
      ...state,
      hand: {
        ...hand,
        turnSeat: nextTurn,
        activeSeat: nextTurn,
        responderTeam: null,
      },
    };
  }

  const evalResult = evaluateRound(hand.currentRoundPlays);
  const completedRound: CompletedRound = {
    roundIndex: hand.currentRoundIndex,
    plays: hand.currentRoundPlays,
    winnerTeam: evalResult.winnerTeam,
    winningSeat: evalResult.winningSeat,
    isParda: evalResult.isParda,
  };

  events.push({
    type: 'ROUND_ENDED',
    handNumber: hand.handNumber,
    roundIndex: hand.currentRoundIndex,
    winnerTeam: evalResult.winnerTeam,
    winningSeat: evalResult.winningSeat,
    isParda: evalResult.isParda,
  });

  const nextCompleted = [...hand.completedRounds, completedRound];
  const manoTeam = seats[hand.manoSeat]?.team ?? 0;
  const handWinner = evaluateHandWinnerFromRounds(nextCompleted, manoTeam);

  const updatedHandBase: HandState = {
    ...hand,
    currentRoundPlays: [],
    completedRounds: nextCompleted,
    envidoStatus: hand.envidoStatus === 'OPEN' ? 'CLOSED' : hand.envidoStatus,
    florStatus: hand.florStatus === 'OPEN' ? 'CLOSED' : hand.florStatus,
  };

  if (handWinner !== null) {
    return finishHandAndAdvance(
      { ...state, hand: updatedHandBase },
      handWinner,
      hand.truco.currentPoints,
      'HAND_WON',
      'ROUNDS',
      events,
    );
  }

  const rawLead =
    evalResult.winningSeat !== null ? evalResult.winningSeat : updatedHandBase.manoSeat;
  const nextLead = findFirstActiveSeatFrom(rawLead, seats, updatedHandBase.foldedSeats);

  return {
    ...state,
    hand: {
      ...updatedHandBase,
      currentRoundIndex: hand.currentRoundIndex + 1,
      roundLeadSeat: nextLead,
      turnSeat: nextLead,
      activeSeat: nextLead,
      responderTeam: null,
    },
  };
}
