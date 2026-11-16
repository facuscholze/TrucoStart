import {
  CARDS_PER_PLAYER,
  createStandardDeck,
  dealHands,
  getTrucoPower,
  shuffleDeck,
} from './cards.js';
import { awardTeamPoints, buildHandState } from './hand-lifecycle.js';
import {
  handleCallEnvido,
  handleCallFlor,
  handleRespondEnvido,
  handleRespondFlor,
} from './handlers/secondary-handlers.js';
import {
  handleCallTruco,
  handleFoldHand,
  handlePlayCard,
  handleRespondTruco,
  handleSendSignal,
} from './handlers/truco-fold-handlers.js';
import {
  canSeatRespondToPendingCall,
  legalActions,
  seatHoldsEnabledFlor,
} from './legal-actions.js';
import { findNextOpposingTeam, seedPrngStateFromRng } from './rounds.js';
import { type RuleSet, validateRuleSet } from './rulesets.js';
import { isValidSignalId } from './signals.js';
import type { Action, DomainEvent, GameState } from './state.types.js';
import {
  type Card,
  ok,
  type PlayerSeat,
  type Result,
  type Rng,
  type RuleError,
  ruleError,
  type SeatId,
  type TeamId,
} from './types.js';

function validateSeatsConfiguration(players: readonly PlayerSeat[]): {
  seats: readonly PlayerSeat[];
  teams: readonly TeamId[];
} {
  if (players.length < 2 || players.length * CARDS_PER_PLAYER > 40) {
    throw new Error(
      `Cantidad de jugadores inválida (${players.length}); se requieren entre 2 y 13`,
    );
  }

  const sorted = [...players].sort((a, b) => a.seat - b.seat);
  for (let i = 0; i < sorted.length; i++) {
    if (sorted[i]?.seat !== i) {
      throw new Error('Los asientos deben ser contiguos desde 0 hasta N-1');
    }
  }

  const teamCounts = new Map<TeamId, number>();
  for (const p of sorted) {
    teamCounts.set(p.team, (teamCounts.get(p.team) ?? 0) + 1);
  }

  const teams = [...teamCounts.keys()].sort((a, b) => a - b);
  if (teams.length < 2) {
    throw new Error('Se requieren al menos 2 equipos distintos');
  }

  const expectedPerTeam = sorted.length / teams.length;
  for (const count of teamCounts.values()) {
    if (count !== expectedPerTeam) {
      throw new Error('Todos los equipos deben tener igual cantidad de integrantes');
    }
  }

  return { seats: sorted, teams };
}

/**
 * Crea una partida nueva validando RuleSet, asientos N-jugadores y mezclando con el RNG inyectado.
 */
export function createGame(ruleset: RuleSet, players: PlayerSeat[], rng: Rng): GameState {
  const rsValid = validateRuleSet(ruleset);
  if (!rsValid.ok) {
    throw new Error(rsValid.error.message);
  }
  const { seats, teams } = validateSeatsConfiguration(players);

  const deckShuffle = shuffleDeck(createStandardDeck(), rng);
  if (!deckShuffle.ok) {
    throw new Error(deckShuffle.error.message);
  }

  const internalPrngState = seedPrngStateFromRng(rng);
  const manoSeat: SeatId = 0;
  const initialHands = dealHands(deckShuffle.value, seats.length, manoSeat);
  const scoresByTeam: Record<TeamId, number> = {};
  for (const team of teams) {
    scoresByTeam[team] = 0;
  }

  return {
    status: 'IN_PROGRESS',
    ruleset,
    seats,
    teams,
    scoresByTeam,
    winnerTeam: null,
    abandonedBySeat: null,
    hand: buildHandState(ruleset, seats, 1, manoSeat, initialHands),
    internalPrngState,
  };
}

export interface CustomGameInit {
  readonly ruleset: RuleSet;
  readonly players: PlayerSeat[];
  readonly handsBySeat: Readonly<Record<SeatId, readonly Card[]>>;
  readonly manoSeat?: SeatId;
  readonly scoresByTeam?: Readonly<Record<TeamId, number>>;
  readonly rng: Rng;
}

/**
 * Inicializador determinista de escenarios específicos para pruebas exhaustivas de reglas.
 */
export function createGameWithHands(init: CustomGameInit): GameState {
  const rsValid = validateRuleSet(init.ruleset);
  if (!rsValid.ok) {
    throw new Error(rsValid.error.message);
  }
  const { seats, teams } = validateSeatsConfiguration(init.players);
  const seenCardIds = new Set<string>();
  for (const s of seats) {
    const cards = init.handsBySeat[s.seat];
    if (!cards || cards.length !== CARDS_PER_PLAYER) {
      throw new Error(`El asiento ${s.seat} debe recibir exactamente ${CARDS_PER_PLAYER} cartas`);
    }
    for (const card of cards) {
      if (seenCardIds.has(card.id)) {
        throw new Error(`Carta duplicada en createGameWithHands: ${card.id}`);
      }
      seenCardIds.add(card.id);
    }
  }
  const manoSeat = init.manoSeat ?? 0;
  const scoresByTeam: Record<TeamId, number> = {};
  for (const team of teams) {
    scoresByTeam[team] = init.scoresByTeam?.[team] ?? 0;
  }

  return {
    status: 'IN_PROGRESS',
    ruleset: init.ruleset,
    seats,
    teams,
    scoresByTeam,
    winnerTeam: null,
    abandonedBySeat: null,
    hand: buildHandState(init.ruleset, seats, 1, manoSeat, init.handsBySeat),
    internalPrngState: seedPrngStateFromRng(init.rng),
  };
}

function actionsMatch(a: Action, b: Action): boolean {
  if (a.type !== b.type || a.seat !== b.seat) return false;
  switch (a.type) {
    case 'PLAY_CARD':
      return b.type === 'PLAY_CARD' && a.cardId === b.cardId;
    case 'CALL_ENVIDO':
      return b.type === 'CALL_ENVIDO' && a.bid === b.bid;
    case 'RESPOND_ENVIDO':
      return b.type === 'RESPOND_ENVIDO' && a.decision === b.decision;
    case 'CALL_FLOR':
      return b.type === 'CALL_FLOR' && a.bid === b.bid;
    case 'RESPOND_FLOR':
      return b.type === 'RESPOND_FLOR' && a.decision === b.decision;
    case 'CALL_TRUCO':
      return b.type === 'CALL_TRUCO' && a.bid === b.bid;
    case 'RESPOND_TRUCO':
      return b.type === 'RESPOND_TRUCO' && a.decision === b.decision;
    case 'SEND_SIGNAL':
      return b.type === 'SEND_SIGNAL' && a.signalId === b.signalId;
    case 'FOLD_HAND':
      return b.type === 'FOLD_HAND';
    default:
      return false;
  }
}

function classifyIllegalActionError(state: GameState, action: Action): RuleError {
  if (action.type === 'CALL_FLOR' || action.type === 'RESPOND_FLOR') {
    if (!state.ruleset.flor.enabled) {
      return { code: 'FLOR_DISABLED', message: 'La Flor está desactivada en este RuleSet' };
    }
    if (!seatHoldsEnabledFlor(state, action.seat)) {
      return { code: 'FLOR_NOT_HELD', message: 'El jugador no posee Flor en esta mano' };
    }
    return { code: 'FLOR_NOT_ALLOWED', message: 'No es válido cantar o responder Flor ahora' };
  }
  if (action.type === 'SEND_SIGNAL') {
    if (!state.ruleset.signals.enabled || state.seats.length <= state.teams.length) {
      return { code: 'SIGNALS_DISABLED', message: 'Las señas no están disponibles en este modo' };
    }
    if (!isValidSignalId(action.signalId)) {
      return { code: 'SIGNAL_INVALID', message: `Seña desconocida: ${action.signalId}` };
    }
    if (
      (state.hand.signalCountBySeat[action.seat] ?? 0) >=
      state.ruleset.signals.maxSignalsPerHandPerPlayer
    ) {
      return {
        code: 'SIGNAL_LIMIT_EXCEEDED',
        message: 'Se alcanzó el límite de señas permitido en esta mano',
      };
    }
  }
  if (action.type === 'PLAY_CARD') {
    const hasPending =
      state.hand.florStatus === 'PENDING' ||
      state.hand.envidoStatus === 'PENDING' ||
      state.hand.truco.pending !== null;
    if (hasPending) {
      return { code: 'PENDING_CALL_ACTIVE', message: 'Debe resolverse el canto pendiente primero' };
    }
    if (action.seat !== state.hand.turnSeat) {
      return { code: 'NOT_YOUR_TURN', message: 'No es el turno de este asiento' };
    }
    return { code: 'CARD_NOT_IN_HAND', message: 'La carta indicada no está disponible en la mano' };
  }
  if (action.type === 'CALL_ENVIDO' || action.type === 'RESPOND_ENVIDO') {
    return { code: 'ENVIDO_NOT_ALLOWED', message: 'Acción de envido no permitida en este estado' };
  }
  if (action.type === 'CALL_TRUCO' || action.type === 'RESPOND_TRUCO') {
    return { code: 'TRUCO_NOT_ALLOWED', message: 'Acción de truco no permitida en este estado' };
  }
  return {
    code: 'NOT_YOUR_TURN',
    message: 'Acción no permitida para este asiento en este momento',
  };
}

/**
 * Aplica una acción validada de forma inmutable sobre `state`, devolviendo el nuevo `GameState`
 * y la secuencia ordenada de `DomainEvent` ocurridos.
 */
export function applyAction(
  state: GameState,
  action: Action,
): Result<{ state: GameState; events: DomainEvent[] }, RuleError> {
  if (state.status !== 'IN_PROGRESS') {
    return ruleError('MATCH_ALREADY_FINISHED', 'La partida ya finalizó');
  }

  const seatInfo = state.seats[action.seat];
  if (!seatInfo) {
    return ruleError('INVALID_SEAT', `Asiento inexistente: ${action.seat}`);
  }

  if (action.type === 'SYSTEM_ABANDON') {
    const events: DomainEvent[] = [
      {
        type: 'SYSTEM_ACTION_APPLIED',
        seat: action.seat,
        actionKind: 'ABANDON',
        resolvedAs: 'FORFEIT_MATCH',
      },
    ];
    const rivalTeam = findNextOpposingTeam(action.seat, seatInfo.team, state.seats, []);
    const remainingToWin = state.ruleset.targetScore - (state.scoresByTeam[rivalTeam] ?? 0);
    const nextState = awardTeamPoints(
      { ...state, abandonedBySeat: action.seat },
      rivalTeam,
      Math.max(1, remainingToWin),
      'ABANDON',
      events,
    );
    return ok({ state: nextState, events });
  }

  if (action.type === 'SYSTEM_TIMEOUT') {
    return applySystemTimeout(state, action.seat);
  }

  if (state.hand.foldedSeats.includes(action.seat)) {
    return ruleError('PLAYER_FOLDED', 'El jugador ya se fue al mazo en esta mano');
  }

  const allowed = legalActions(state, action.seat);
  if (!allowed.some((candidate) => actionsMatch(candidate, action))) {
    return { ok: false, error: classifyIllegalActionError(state, action) };
  }

  switch (action.type) {
    case 'SEND_SIGNAL':
      return handleSendSignal(state, action.seat, seatInfo.team, action.signalId);
    case 'PLAY_CARD':
      return handlePlayCard(state, action.seat, seatInfo.team, action.cardId);
    case 'CALL_ENVIDO':
      return handleCallEnvido(state, action.seat, seatInfo.team, action.bid);
    case 'RESPOND_ENVIDO':
      return handleRespondEnvido(state, action.seat, action.decision);
    case 'CALL_FLOR':
      return handleCallFlor(state, action.seat, seatInfo.team, action.bid);
    case 'RESPOND_FLOR':
      return handleRespondFlor(state, action.decision);
    case 'CALL_TRUCO':
      return handleCallTruco(state, action.seat, seatInfo.team, action.bid);
    case 'RESPOND_TRUCO':
      return handleRespondTruco(state, action.seat, action.decision);
    case 'FOLD_HAND':
      return handleFoldHand(state, action.seat, seatInfo.team);
  }
}

function applySystemTimeout(
  state: GameState,
  seat: SeatId,
): Result<{ state: GameState; events: DomainEvent[] }, RuleError> {
  const { hand, ruleset } = state;

  let delegatedAction: Action | null = null;
  let resolvedAs = '';

  if (hand.florStatus === 'PENDING' && canSeatRespondToPendingCall(state, seat)) {
    delegatedAction = { type: 'RESPOND_FLOR', seat, decision: 'ACHICO' };
    resolvedAs = 'RESPOND_FLOR:ACHICO';
  } else if (hand.envidoStatus === 'PENDING' && canSeatRespondToPendingCall(state, seat)) {
    delegatedAction = { type: 'RESPOND_ENVIDO', seat, decision: 'NO_QUIERO' };
    resolvedAs = 'RESPOND_ENVIDO:NO_QUIERO';
  } else if (hand.truco.pending !== null && canSeatRespondToPendingCall(state, seat)) {
    delegatedAction = { type: 'RESPOND_TRUCO', seat, decision: 'NO_QUIERO' };
    resolvedAs = 'RESPOND_TRUCO:NO_QUIERO';
  } else if (
    hand.florStatus !== 'PENDING' &&
    hand.envidoStatus !== 'PENDING' &&
    hand.truco.pending === null &&
    seat === hand.turnSeat
  ) {
    if (ruleset.system.timeoutOnTurn === 'PLAY_LOWEST_CARD') {
      const cards = [...(hand.remainingHandsBySeat[seat] ?? [])].sort(
        (a, b) => getTrucoPower(a) - getTrucoPower(b),
      );
      if (cards[0]) {
        delegatedAction = { type: 'PLAY_CARD', seat, cardId: cards[0].id };
        resolvedAs = `PLAY_CARD:${cards[0].id}`;
      }
    }
    if (!delegatedAction) {
      delegatedAction = { type: 'FOLD_HAND', seat };
      resolvedAs = 'FOLD_HAND';
    }
  }

  if (!delegatedAction) {
    return ruleError('NOT_YOUR_TURN', 'El asiento indicado no tiene acción pendiente para timeout');
  }

  const res = applyAction(state, delegatedAction);
  if (!res.ok) return res;

  return ok({
    state: res.value.state,
    events: [
      { type: 'SYSTEM_ACTION_APPLIED', seat, actionKind: 'TIMEOUT', resolvedAs },
      ...res.value.events,
    ],
  });
}
