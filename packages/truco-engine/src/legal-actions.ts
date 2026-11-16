import { canTeamCallTrucoBid, getLegalEnvidoBids, getLegalFlorRaises } from './calls.js';
import { CARDS_PER_PLAYER } from './cards.js';
import { isFlor } from './scoring.js';
import { SIGNALS_CATALOG } from './signals.js';
import type { Action, GameState } from './state.types.js';
import type { SeatId } from './types.js';

export function seatHoldsEnabledFlor(state: GameState, seat: SeatId): boolean {
  if (!state.ruleset.flor.enabled) return false;
  const initialCards = state.hand.initialHandsBySeat[seat] ?? [];
  if (!isFlor(initialCards)) return false;
  const remainingCount = (state.hand.remainingHandsBySeat[seat] ?? []).length;
  return remainingCount === CARDS_PER_PLAYER || state.hand.announcedFlorSeats.includes(seat);
}

export function hasActiveTeammate(state: GameState, seat: SeatId): boolean {
  const seatInfo = state.seats[seat];
  if (!seatInfo) return false;
  const folded = new Set(state.hand.foldedSeats);
  return state.seats.some(
    (other) => other.seat !== seat && other.team === seatInfo.team && !folded.has(other.seat),
  );
}

export function canSeatRespondToPendingCall(state: GameState, seat: SeatId): boolean {
  const seatInfo = state.seats[seat];
  if (!seatInfo || seatInfo.team !== state.hand.responderTeam) return false;
  if (state.ruleset.responderSelectionMode === 'ANY_TEAM_MEMBER') {
    return true;
  }
  return seat === state.hand.activeSeat;
}

/**
 * Calcula todas las acciones válidas que el asiento `seat` puede ejecutar en `state`.
 */
export function legalActions(state: GameState, seat: SeatId): Action[] {
  if (state.status !== 'IN_PROGRESS') return [];

  const seatInfo = state.seats[seat];
  if (!seatInfo) return [];
  if (state.hand.foldedSeats.includes(seat)) return [];

  const actions: Action[] = [];
  const { ruleset, hand } = state;

  // Señas disponibles para cualquier jugador activo con compañero activo, dentro del cupo por mano
  if (
    ruleset.signals.enabled &&
    hasActiveTeammate(state, seat) &&
    (hand.signalCountBySeat[seat] ?? 0) < ruleset.signals.maxSignalsPerHandPerPlayer
  ) {
    for (const signal of SIGNALS_CATALOG) {
      actions.push({ type: 'SEND_SIGNAL', seat, signalId: signal.id });
    }
  }

  // 1. Flor pendiente de respuesta
  if (hand.florStatus === 'PENDING' && hand.florChain !== null) {
    if (canSeatRespondToPendingCall(state, seat) && seatHoldsEnabledFlor(state, seat)) {
      actions.push({ type: 'RESPOND_FLOR', seat, decision: 'CON_FLOR_QUIERO' });
      actions.push({ type: 'RESPOND_FLOR', seat, decision: 'ACHICO' });
      for (const raise of getLegalFlorRaises(ruleset, hand.florChain)) {
        actions.push({ type: 'CALL_FLOR', seat, bid: raise });
      }
    }
    return actions;
  }

  // 2. Envido pendiente de respuesta
  if (hand.envidoStatus === 'PENDING' && hand.envidoChain !== null) {
    if (canSeatRespondToPendingCall(state, seat)) {
      if (seatHoldsEnabledFlor(state, seat)) {
        // La Flor mata al Envido pendiente; un jugador con Flor no compite en Envido
        actions.push({ type: 'CALL_FLOR', seat, bid: 'FLOR' });
        actions.push({ type: 'RESPOND_ENVIDO', seat, decision: 'NO_QUIERO' });
      } else {
        actions.push({ type: 'RESPOND_ENVIDO', seat, decision: 'QUIERO' });
        actions.push({ type: 'RESPOND_ENVIDO', seat, decision: 'NO_QUIERO' });
        for (const bid of getLegalEnvidoBids(ruleset, hand.envidoChain)) {
          actions.push({ type: 'CALL_ENVIDO', seat, bid });
        }
      }
      // Irse al mazo ante envido pendiente si es el último jugador activo de su equipo
      if (!hasActiveTeammate(state, seat)) {
        actions.push({ type: 'FOLD_HAND', seat });
      }
    } else if (seatInfo.team === hand.responderTeam && seatHoldsEnabledFlor(state, seat)) {
      // Compañero con Flor puede cantar su Flor para anular el Envido pendiente
      actions.push({ type: 'CALL_FLOR', seat, bid: 'FLOR' });
    }
    return actions;
  }

  // 3. Truco pendiente de respuesta
  if (hand.truco.pending !== null) {
    if (canSeatRespondToPendingCall(state, seat)) {
      actions.push({ type: 'RESPOND_TRUCO', seat, decision: 'QUIERO' });
      actions.push({ type: 'RESPOND_TRUCO', seat, decision: 'NO_QUIERO' });

      const nextTruco = canTeamCallTrucoBid(ruleset, hand.truco, seatInfo.team, state.scoresByTeam);
      if (nextTruco !== null) {
        actions.push({ type: 'CALL_TRUCO', seat, bid: nextTruco });
      }

      // "El envido está primero": solo en ronda 1 ante el primer canto de TRUCO
      if (
        hand.currentRoundIndex === 0 &&
        hand.truco.acceptedBid === null &&
        hand.truco.pending.bid === 'TRUCO' &&
        hand.envidoStatus === 'OPEN' &&
        hand.florStatus !== 'PENDING' &&
        hand.florStatus !== 'RESOLVED' &&
        ruleset.envido.envidoFirstMode !== 'DISABLED'
      ) {
        if (seatHoldsEnabledFlor(state, seat)) {
          actions.push({ type: 'CALL_FLOR', seat, bid: 'FLOR' });
        } else {
          for (const bid of getLegalEnvidoBids(ruleset, null)) {
            actions.push({ type: 'CALL_ENVIDO', seat, bid });
          }
        }
      }
    }
    return actions;
  }

  // 4. Turno normal de juego de carta
  if (seat !== hand.turnSeat) {
    return actions;
  }

  const remainingCards = hand.remainingHandsBySeat[seat] ?? [];
  for (const card of remainingCards) {
    actions.push({ type: 'PLAY_CARD', seat, cardId: card.id });
  }

  if (hand.currentRoundIndex === 0) {
    if (
      seatHoldsEnabledFlor(state, seat) &&
      hand.florStatus === 'OPEN' &&
      !hand.announcedFlorSeats.includes(seat)
    ) {
      actions.push({ type: 'CALL_FLOR', seat, bid: 'FLOR' });
    } else if (
      !seatHoldsEnabledFlor(state, seat) &&
      hand.envidoStatus === 'OPEN' &&
      hand.florStatus !== 'PENDING' &&
      hand.florStatus !== 'RESOLVED'
    ) {
      for (const bid of getLegalEnvidoBids(ruleset, null)) {
        actions.push({ type: 'CALL_ENVIDO', seat, bid });
      }
    }
  }

  const nextTruco = canTeamCallTrucoBid(ruleset, hand.truco, seatInfo.team, state.scoresByTeam);
  if (nextTruco !== null) {
    actions.push({ type: 'CALL_TRUCO', seat, bid: nextTruco });
  }

  actions.push({ type: 'FOLD_HAND', seat });

  return actions;
}
