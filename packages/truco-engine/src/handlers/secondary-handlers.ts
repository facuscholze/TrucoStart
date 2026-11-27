import {
  createInitialTrucoState,
  pushEnvidoBid,
  pushFlorBid,
  resolveEnvidoAcceptedPoints,
  resolveFlorAcceptedPoints,
} from '../calls.js';
import { awardTeamPoints, resumeAfterSecondaryTrack } from '../hand-lifecycle.js';
import { seatHoldsEnabledFlor } from '../legal-actions.js';
import { resolveRespondingSeat, resolveRespondingTeam } from '../team-responder.js';
import type { EnvidoBidType, FlorBidType } from '../rulesets.js';
import { resolveShowdownWinner, scoreEnvido, scoreFlor } from '../scoring.js';
import type { DomainEvent, EnvidoDecision, FlorDecision, GameState } from '../state.types.js';
import { ok, type Result, type RuleError, type SeatId, type TeamId } from '../types.js';

export function handleCallEnvido(
  state: GameState,
  seat: SeatId,
  team: TeamId,
  bid: EnvidoBidType,
): Result<{ state: GameState; events: DomainEvent[] }, RuleError> {
  const events: DomainEvent[] = [];
  let trucoNext = state.hand.truco;
  let cancelledPendingTruco = false;

  if (state.hand.truco.pending !== null) {
    cancelledPendingTruco = true;
    const pendingCaller = state.hand.truco.pending;
    trucoNext = {
      ...createInitialTrucoState(state.ruleset),
      suspendedCaller:
        state.ruleset.envido.envidoFirstMode === 'SUSPEND_TRUCO'
          ? { seat: pendingCaller.callerSeat, team: pendingCaller.callerTeam }
          : null,
    };
  }

  const pushed = pushEnvidoBid(state.ruleset, state.hand.envidoChain, bid, seat, team);
  if (!pushed.ok) return pushed;

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

  events.push({
    type: 'ENVIDO_CALLED',
    handNumber: state.hand.handNumber,
    seat,
    team,
    bid,
    cancelledPendingTruco,
  });

  return ok({
    state: {
      ...state,
      hand: {
        ...state.hand,
        envidoStatus: 'PENDING',
        envidoChain: pushed.value,
        truco: trucoNext,
        responderTeam,
        activeSeat,
      },
    },
    events,
  });
}

export function handleRespondEnvido(
  state: GameState,
  seat: SeatId,
  decision: EnvidoDecision,
): Result<{ state: GameState; events: DomainEvent[] }, RuleError> {
  const events: DomainEvent[] = [];
  const chain = state.hand.envidoChain!;

  if (decision === 'NO_QUIERO') {
    const pts = chain.declinedPoints;
    events.push({
      type: 'ENVIDO_RESOLVED',
      handNumber: state.hand.handNumber,
      accepted: false,
      responderSeat: seat,
      winningTeam: chain.lastCallerTeam,
      winningSeat: null,
      winningScore: null,
      pointsAwarded: pts,
    });

    const baseNext: GameState = {
      ...state,
      hand: {
        ...state.hand,
        envidoStatus: 'RESOLVED',
        envidoChain: null,
        florStatus: 'CLOSED',
      },
    };
    const scored = awardTeamPoints(baseNext, chain.lastCallerTeam, pts, 'ENVIDO', events);
    return ok({ state: resumeAfterSecondaryTrack(scored, events), events });
  }

  const foldedSet = new Set(state.hand.foldedSeats);
  const eligibleSeats = state.seats.filter(
    (s) => !foldedSet.has(s.seat) && !seatHoldsEnabledFlor(state, s.seat),
  );
  const showdown = resolveShowdownWinner(
    eligibleSeats.map((s) => ({
      seat: s.seat,
      team: s.team,
      score: scoreEnvido(state.hand.initialHandsBySeat[s.seat]!),
    })),
    state.hand.manoSeat,
    state.seats.length,
  );
  const pts = resolveEnvidoAcceptedPoints(
    state.ruleset,
    chain,
    state.scoresByTeam,
    showdown.winningTeam,
  );

  events.push({
    type: 'ENVIDO_RESOLVED',
    handNumber: state.hand.handNumber,
    accepted: true,
    responderSeat: seat,
    winningTeam: showdown.winningTeam,
    winningSeat: showdown.winningSeat,
    winningScore: showdown.winningScore,
    pointsAwarded: pts,
    declaredScoresBySeat: showdown.scoresBySeat,
  });

  const baseNext: GameState = {
    ...state,
    hand: {
      ...state.hand,
      envidoStatus: 'RESOLVED',
      envidoChain: null,
      florStatus: 'CLOSED',
    },
  };
  const scored = awardTeamPoints(baseNext, showdown.winningTeam, pts, 'ENVIDO', events);
  return ok({ state: resumeAfterSecondaryTrack(scored, events), events });
}

export function handleCallFlor(
  state: GameState,
  seat: SeatId,
  team: TeamId,
  bid: FlorBidType,
): Result<{ state: GameState; events: DomainEvent[] }, RuleError> {
  const events: DomainEvent[] = [];
  let trucoNext = state.hand.truco;

  if (state.hand.truco.pending !== null) {
    const pendingCaller = state.hand.truco.pending;
    trucoNext = {
      ...createInitialTrucoState(state.ruleset),
      suspendedCaller:
        state.ruleset.envido.envidoFirstMode === 'SUSPEND_TRUCO'
          ? { seat: pendingCaller.callerSeat, team: pendingCaller.callerTeam }
          : null,
    };
  }

  const pushed = pushFlorBid(state.ruleset, state.hand.florChain, bid, seat, team);
  if (!pushed.ok) return pushed;

  events.push({
    type: 'FLOR_CALLED',
    handNumber: state.hand.handNumber,
    seat,
    team,
    bid,
  });

  const nextAnnounced = state.hand.announcedFlorSeats.includes(seat)
    ? state.hand.announcedFlorSeats
    : [...state.hand.announcedFlorSeats, seat];

  const foldedSet = new Set(state.hand.foldedSeats);
  const rivalsWithFlor = state.seats.filter(
    (s) => s.team !== team && !foldedSet.has(s.seat) && seatHoldsEnabledFlor(state, s.seat),
  );

  if (rivalsWithFlor.length === 0) {
    const pts = state.ruleset.flor.florPoints;
    events.push({
      type: 'FLOR_RESOLVED',
      handNumber: state.hand.handNumber,
      accepted: false,
      winningTeam: team,
      winningSeat: seat,
      winningScore: null,
      pointsAwarded: pts,
    });
    const baseNext: GameState = {
      ...state,
      hand: {
        ...state.hand,
        envidoStatus: 'CLOSED',
        envidoChain: null,
        florStatus: 'RESOLVED',
        florChain: null,
        announcedFlorSeats: nextAnnounced,
        truco: trucoNext,
      },
    };
    const scored = awardTeamPoints(baseNext, team, pts, 'FLOR', events);
    return ok({ state: resumeAfterSecondaryTrack(scored, events), events });
  }

  // Con tres equipos puede haber varios rivales con Flor: contesta el primero en el orden de
  // turnos desde el cantor (nunca "el primero del arreglo de asientos", que era un artefacto).
  const totalSeats = state.seats.length;
  const responderTeam = [...rivalsWithFlor].sort(
    (a, b) =>
      ((a.seat - seat + totalSeats) % totalSeats) - ((b.seat - seat + totalSeats) % totalSeats),
  )[0]!.team;
  const activeSeat = resolveRespondingSeat(
    seat,
    responderTeam,
    state.hand.manoSeat,
    state.seats,
    state.hand.foldedSeats,
    state.ruleset.responderSelectionMode,
    (s) => seatHoldsEnabledFlor(state, s),
  );

  return ok({
    state: {
      ...state,
      hand: {
        ...state.hand,
        envidoStatus: 'CLOSED',
        envidoChain: null,
        florStatus: 'PENDING',
        florChain: pushed.value,
        announcedFlorSeats: nextAnnounced,
        truco: trucoNext,
        responderTeam,
        activeSeat,
      },
    },
    events,
  });
}

export function handleRespondFlor(
  state: GameState,
  decision: FlorDecision,
): Result<{ state: GameState; events: DomainEvent[] }, RuleError> {
  const events: DomainEvent[] = [];
  const chain = state.hand.florChain!;

  if (decision === 'ACHICO') {
    const pts = chain.declinedPoints;
    events.push({
      type: 'FLOR_RESOLVED',
      handNumber: state.hand.handNumber,
      accepted: false,
      winningTeam: chain.lastCallerTeam,
      winningSeat: chain.lastCallerSeat,
      winningScore: null,
      pointsAwarded: pts,
    });
    const baseNext: GameState = {
      ...state,
      hand: {
        ...state.hand,
        florStatus: 'RESOLVED',
        florChain: null,
        envidoStatus: 'CLOSED',
      },
    };
    const scored = awardTeamPoints(baseNext, chain.lastCallerTeam, pts, 'FLOR', events);
    return ok({ state: resumeAfterSecondaryTrack(scored, events), events });
  }

  const foldedSet = new Set(state.hand.foldedSeats);
  const florHolders = state.seats.filter(
    (s) => !foldedSet.has(s.seat) && seatHoldsEnabledFlor(state, s.seat),
  );
  const showdown = resolveShowdownWinner(
    florHolders.map((s) => ({
      seat: s.seat,
      team: s.team,
      score: scoreFlor(state.hand.initialHandsBySeat[s.seat]!),
    })),
    state.hand.manoSeat,
    state.seats.length,
  );
  const pts = resolveFlorAcceptedPoints(
    state.ruleset,
    chain,
    state.scoresByTeam,
    showdown.winningTeam,
  );

  events.push({
    type: 'FLOR_RESOLVED',
    handNumber: state.hand.handNumber,
    accepted: true,
    winningTeam: showdown.winningTeam,
    winningSeat: showdown.winningSeat,
    winningScore: showdown.winningScore,
    pointsAwarded: pts,
  });

  const baseNext: GameState = {
    ...state,
    hand: {
      ...state.hand,
      florStatus: 'RESOLVED',
      florChain: null,
      envidoStatus: 'CLOSED',
    },
  };
  const scored = awardTeamPoints(baseNext, showdown.winningTeam, pts, 'FLOR', events);
  return ok({ state: resumeAfterSecondaryTrack(scored, events), events });
}
