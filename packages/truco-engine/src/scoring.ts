import type { Card, SeatId, Suit, TeamId } from './types.js';

export function envidoCardValue(card: Card): number {
  return card.rank >= 10 ? 0 : card.rank;
}

/**
 * Devuelve `true` si y solo si las 3 cartas pertenecen exactamente al mismo palo.
 */
export function isFlor(cards: readonly Card[]): boolean {
  if (cards.length !== 3) return false;
  const first = cards[0];
  const second = cards[1];
  const third = cards[2];
  if (!first || !second || !third) return false;
  return first.suit === second.suit && second.suit === third.suit;
}

/**
 * Calcula el tanto de Envido de un conjunto de cartas (habitualmente las 3 cartas repartidas):
 * - Con 2 o más cartas del mismo palo: 20 + suma de las DOS cartas de mayor valor de ese palo.
 * - Con palos todos distintos: el mayor valor individual (0 a 7).
 */
export function scoreEnvido(cards: readonly Card[]): number {
  if (cards.length === 0) return 0;

  const bySuit = new Map<Suit, number[]>();
  let highestSingle = 0;

  for (const card of cards) {
    const val = envidoCardValue(card);
    if (val > highestSingle) {
      highestSingle = val;
    }
    const list = bySuit.get(card.suit);
    if (list) {
      list.push(val);
    } else {
      bySuit.set(card.suit, [val]);
    }
  }

  let bestSameSuitScore = -1;
  for (const values of bySuit.values()) {
    if (values.length >= 2) {
      const sortedDesc = [...values].sort((a, b) => b - a);
      const top1 = sortedDesc[0] ?? 0;
      const top2 = sortedDesc[1] ?? 0;
      const score = 20 + top1 + top2;
      if (score > bestSameSuitScore) {
        bestSameSuitScore = score;
      }
    }
  }

  return bestSameSuitScore >= 0 ? bestSameSuitScore : highestSingle;
}

/**
 * Calcula el puntaje de una Flor (3 cartas del mismo palo): 20 + suma de las 3 cartas (20 a 38).
 * Si las cartas no forman Flor, devuelve 0.
 */
export function scoreFlor(cards: readonly Card[]): number {
  if (!isFlor(cards)) return 0;
  let total = 20;
  for (const card of cards) {
    total += envidoCardValue(card);
  }
  return total;
}

/**
 * Distancia antihoraria desde el asiento mano (`0` = mano, `1` = segundo, ..., `N - 1` = pie).
 */
export function seatHandOrder(seat: SeatId, manoSeat: SeatId, numSeats: number): number {
  return (((seat - manoSeat) % numSeats) + numSeats) % numSeats;
}

export interface ShowdownCandidate {
  readonly seat: SeatId;
  readonly team: TeamId;
  readonly score: number;
}

export interface ShowdownWinner {
  readonly winningSeat: SeatId;
  readonly winningTeam: TeamId;
  readonly winningScore: number;
  readonly scoresBySeat: Readonly<Record<SeatId, number>>;
}

/**
 * Determina el asiento y equipo ganador en una compulsa de tantos (Envido o Flor).
 * En caso de empate de puntaje, gana quien esté antes en el orden desde `manoSeat`.
 */
export function resolveShowdownWinner(
  candidates: readonly ShowdownCandidate[],
  manoSeat: SeatId,
  numSeats: number,
): ShowdownWinner {
  const first = candidates[0];
  if (!first) {
    throw new Error('Se requiere al menos un candidato para resolver tanto');
  }

  const scoresBySeat: Record<SeatId, number> = {};
  let best = first;

  for (const candidate of candidates) {
    scoresBySeat[candidate.seat] = candidate.score;
    if (candidate.score > best.score) {
      best = candidate;
    } else if (candidate.score === best.score) {
      const candidateOrder = seatHandOrder(candidate.seat, manoSeat, numSeats);
      const bestOrder = seatHandOrder(best.seat, manoSeat, numSeats);
      if (candidateOrder < bestOrder) {
        best = candidate;
      }
    }
  }

  return {
    winningSeat: best.seat,
    winningTeam: best.team,
    winningScore: best.score,
    scoresBySeat,
  };
}
