import { createStandardDeck, getTrucoPower } from '../cards.js';
import { evaluateHandWinnerFromRounds } from '../rounds.js';
import { scoreEnvido } from '../scoring.js';
import type { CompletedRound, RoundPlay } from '../state.types.js';
import type { Card, CardId, SeatId, TeamId } from '../types.js';
import type { PlayerView } from '../view.js';

/**
 * Memoria de cartas de la IA: todo se deriva de `PlayerView` (nunca del estado completo).
 * El bot "recuerda" las cartas ya jugadas en bazas cerradas y en la baza en curso, y
 * deduce el conjunto de cartas que todavía no vio (posibles manos rivales/compañero).
 */
export interface CardKnowledge {
  /** Cartas propias todavía en mano. */
  readonly myCards: readonly Card[];
  /** Cartas visibles en la mesa (bazas cerradas + baza en curso). */
  readonly playedCards: readonly Card[];
  /** Cartas que ningún asiento mostró todavía (universo de inferencia). */
  readonly unseenCards: readonly Card[];
  /** Poder de truco más alto que ya se jugó y sigue siendo imbatible en la mesa. */
  readonly tableBestPower: number;
  /** Mejor poder de la mesa por equipo. */
  readonly bestPowerByTeam: Readonly<Record<TeamId, number>>;
  /** Cartas rivales pendientes estimadas (3 por asiento menos las ya jugadas). */
  readonly estimatedOpponentCards: number;
}

export function buildCardKnowledge(view: PlayerView): CardKnowledge {
  const playedCards: Card[] = [];
  for (const round of view.hand.completedRounds) {
    for (const play of round.plays) playedCards.push(play.card);
  }
  for (const play of view.hand.currentRoundPlays) playedCards.push(play.card);

  const myCards = [...view.hand.myRemainingCards];
  const known = new Set<CardId>([...playedCards.map((c) => c.id), ...myCards.map((c) => c.id)]);
  const unseenCards = createStandardDeck().filter((card) => !known.has(card.id));

  const bestPowerByTeam: Record<TeamId, number> = {};
  let tableBestPower = 0;
  const currentPlays = view.hand.currentRoundPlays;
  for (const play of currentPlays) {
    const power = getTrucoPower(play.card);
    bestPowerByTeam[play.team] = Math.max(bestPowerByTeam[play.team] ?? 0, power);
    tableBestPower = Math.max(tableBestPower, power);
  }

  const opponentSeats = view.seats.filter((s) => s.team !== view.myTeam);
  const playedByOpponent = new Set<SeatId>();
  for (const round of view.hand.completedRounds) {
    for (const play of round.plays) {
      if (play.team !== view.myTeam) playedByOpponent.add(play.seat);
    }
  }
  for (const play of currentPlays) {
    if (play.team !== view.myTeam) playedByOpponent.add(play.seat);
  }
  const estimatedOpponentCards = Math.max(0, opponentSeats.length * 3 - playedByOpponent.size);

  return {
    myCards,
    playedCards,
    unseenCards,
    tableBestPower,
    bestPowerByTeam,
    estimatedOpponentCards,
  };
}

/**
 * Probabilidad estimada (0..1) de que una carta de poder `power` gane la baza actual,
 * ponderando las cartas que todavía no salieron y las cartas rivales pendientes.
 */
export function estimateCardWinProbability(power: number, knowledge: CardKnowledge): number {
  if (knowledge.unseenCards.length === 0) {
    return power > knowledge.tableBestPower ? 1 : power === knowledge.tableBestPower ? 0.5 : 0;
  }
  const beating = knowledge.unseenCards.filter((card) => getTrucoPower(card) > power).length;
  const remainingThreats = Math.min(knowledge.estimatedOpponentCards, knowledge.unseenCards.length);
  const perCardRisk = beating / knowledge.unseenCards.length;
  // Probabilidad de que ninguna de las cartas rivales pendientes supere la nuestra.
  return Math.pow(1 - perCardRisk, Math.max(1, remainingThreats));
}

/** PRNG determinista xorshift32 para Monte Carlo reproducible del bot. */
function createDeterministicRng(seed: number): () => number {
  let state = seed >>> 0 || 0x9e3779b9;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 0x1_0000_0000;
  };
}

/**
 * Probabilidad estimada (0..1) de ganarle el envido a un rival con una mano al azar
 * del universo de cartas desconocidas (Monte Carlo determinista, sin mirar manos ajenas).
 */
export function estimateEnvidoWinProbability(
  myEnvido: number,
  knowledge: CardKnowledge,
  samples = 96,
): number {
  const pool = knowledge.unseenCards;
  if (pool.length < 3) return myEnvido > 0 ? 0.5 : 0;
  const rng = createDeterministicRng(hashViewSeedValue(myEnvido, pool.length));
  let wins = 0;
  for (let i = 0; i < samples; i++) {
    const picks: Card[] = [];
    const used = new Set<number>();
    while (picks.length < 3) {
      const idx = Math.floor(rng() * pool.length);
      if (used.has(idx)) continue;
      used.add(idx);
      picks.push(pool[idx]!);
    }
    if (scoreEnvido(picks) < myEnvido) wins++;
  }
  return wins / samples;
}

function hashViewSeedValue(envido: number, poolSize: number): number {
  let hash = 2166136261 ^ envido;
  hash = Math.imul(hash ^ poolSize, 16777619);
  return hash >>> 0;
}

/**
 * Probabilidad estimada de ganar la mano (mejor de 3 bazas) con las cartas actuales,
 * considerando bazas ya cerradas, bazas ganadas y la fuerza relativa de cada carta.
 */
export function estimateHandWinProbability(view: PlayerView, knowledge: CardKnowledge): number {
  const powers = knowledge.myCards.map((card) => getTrucoPower(card)).sort((a, b) => b - a);
  const wonRounds = view.hand.completedRounds.filter((r) => r.winnerTeam === view.myTeam).length;
  const lostRounds = view.hand.completedRounds.filter(
    (r) => r.winnerTeam !== null && r.winnerTeam !== view.myTeam,
  ).length;

  if (wonRounds === 2) return 1;
  if (lostRounds === 2) return 0;

  const cardProbs = powers.map((power) => estimateCardWinProbability(power, knowledge));
  const top = cardProbs[0] ?? 0;
  const second = cardProbs[1] ?? 0;
  const third = cardProbs[2] ?? top;

  // Cada baza restante se estima con la mejor carta disponible para el equipo.
  const needed = 2 - wonRounds;
  if (needed <= 0) return 1;
  if (needed === 1) {
    return Math.min(1, Math.max(top, second * 0.85, third * 0.55));
  }
  return Math.min(1, Math.max(top * 0.9 + second * 0.6 - 0.35, second * 0.75, third * 0.45));
}

/** Estado por asiento usado en el rollout de Monte Carlo. */
interface RolloutSeatState {
  readonly seat: SeatId;
  readonly team: TeamId;
  readonly cards: Card[];
}

function hashStringSeed(input: string): number {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export interface HandWinRateOptions {
  /** Cantidad de repartos rivales muestreados (mayor = más preciso y más costoso). */
  readonly samples?: number;
}

/**
 * Probabilidad de ganar la mano estimada por Monte Carlo sobre las cartas que NO salieron:
 * se muestrean las manos ajenas desconocidas desde `unseenCards` y se juega el resto de la
 * mano con la política "cada asiento baja su carta más alta". Nunca usa el estado completo:
 * el universo de muestreo sale de `PlayerView` + `CardKnowledge`.
 */
export function estimateHandWinRate(
  view: PlayerView,
  knowledge: CardKnowledge,
  options: HandWinRateOptions = {},
): number {
  const samples = options.samples ?? 120;
  const manoTeam = view.seats[view.hand.manoSeat]?.team ?? 0;
  const completedRounds = view.hand.completedRounds;
  if (!view.hand.currentRoundPlays.length) {
    const decided = evaluateCompletedRounds(completedRounds, manoTeam);
    if (decided !== null) return decided === view.myTeam ? 1 : 0;
  }

  const playedCountBySeat = new Map<SeatId, number>();
  for (const round of completedRounds) {
    for (const play of round.plays) {
      playedCountBySeat.set(play.seat, (playedCountBySeat.get(play.seat) ?? 0) + 1);
    }
  }
  for (const play of view.hand.currentRoundPlays) {
    playedCountBySeat.set(play.seat, (playedCountBySeat.get(play.seat) ?? 0) + 1);
  }

  const otherSeats = view.seats.filter((s) => s.seat !== view.mySeat);
  const neededBySeat = otherSeats.map((s) => ({
    ...s,
    needed: Math.max(0, 3 - (playedCountBySeat.get(s.seat) ?? 0)),
  }));
  const totalNeeded = neededBySeat.reduce((acc, s) => acc + s.needed, 0);
  const pool = knowledge.unseenCards;
  if (totalNeeded > pool.length) return 0.5;

  const rng = createDeterministicRng(
    hashStringSeed(
      `${view.hand.handNumber}:${view.hand.currentRoundIndex}:${view.mySeat}:${pool.length}:${knowledge.myCards.length}`,
    ),
  );

  let wins = 0;
  for (let sample = 0; sample < samples; sample++) {
    // Muestreo sin reemplazo del universo de cartas desconocidas.
    const indices = pool.map((_, i) => i);
    for (let i = indices.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [indices[i], indices[j]] = [indices[j]!, indices[i]!];
    }
    const drawn: Card[] = [];
    for (let i = 0; i < totalNeeded; i++) drawn.push(pool[indices[i]!]!);

    const seatStates: RolloutSeatState[] = [];
    let cursor = 0;
    for (const seat of otherSeats) {
      const count = Math.max(0, 3 - (playedCountBySeat.get(seat.seat) ?? 0));
      seatStates.push({
        seat: seat.seat,
        team: seat.team,
        cards: drawn.slice(cursor, cursor + count),
      });
      cursor += count;
    }
    seatStates.push({ seat: view.mySeat, team: view.myTeam, cards: [...knowledge.myCards] });
    for (const state of seatStates) state.cards.sort((a, b) => getTrucoPower(b) - getTrucoPower(a));

    const simulatedRounds: CompletedRound[] = [...completedRounds];
    const currentPlays: RoundPlay[] = [...view.hand.currentRoundPlays];
    let roundIndex = view.hand.currentRoundIndex;

    // Baza en curso: se completan las cartas de los asientos que todavía no jugaron.
    for (const state of seatStates) {
      if (!currentPlays.some((p) => p.seat === state.seat) && state.cards.length > 0) {
        const card = state.cards.shift()!;
        currentPlays.push({ seat: state.seat, team: state.team, card });
      }
    }
    const currentResult = evaluateRoundPlays(currentPlays, roundIndex);
    simulatedRounds.push(currentResult);

    let decided = evaluateCompletedRounds(simulatedRounds, manoTeam);
    roundIndex++;
    while (decided === null && roundIndex <= 2) {
      const plays: RoundPlay[] = [];
      for (const state of seatStates) {
        const card = state.cards.shift();
        if (card) plays.push({ seat: state.seat, team: state.team, card });
      }
      if (plays.length === 0) break;
      simulatedRounds.push(evaluateRoundPlays(plays, roundIndex));
      decided = evaluateCompletedRounds(simulatedRounds, manoTeam);
      roundIndex++;
    }

    const winner = decided ?? manoTeam;
    if (winner === view.myTeam) wins++;
  }

  return wins / samples;
}

function evaluateRoundPlays(plays: readonly RoundPlay[], roundIndex: number): CompletedRound {
  let best = 0;
  for (const play of plays) best = Math.max(best, getTrucoPower(play.card));
  const topPlays = plays.filter((play) => getTrucoPower(play.card) === best);
  const winningTeams = new Set(topPlays.map((play) => play.team));
  if (winningTeams.size > 1) {
    return { roundIndex, plays, winnerTeam: null, winningSeat: null, isParda: true };
  }
  const winner = topPlays[0]!;
  return { roundIndex, plays, winnerTeam: winner.team, winningSeat: winner.seat, isParda: false };
}

function evaluateCompletedRounds(
  rounds: readonly CompletedRound[],
  manoTeam: TeamId,
): TeamId | null {
  return evaluateHandWinnerFromRounds(rounds, manoTeam);
}
