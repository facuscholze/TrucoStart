import { getTrucoPower } from './cards.js';
import type { ResponderSelectionMode } from './rulesets.js';
import { seatHandOrder } from './scoring.js';
import type { CompletedRound, PrngState, RoundPlay } from './state.types.js';
import type { Card, PlayerSeat, Rng, SeatId, TeamId } from './types.js';

export interface RoundEvaluation {
  readonly winnerTeam: TeamId | null;
  readonly winningSeat: SeatId | null;
  readonly isParda: boolean;
}

/**
 * Evalúa quién ganó una ronda entre N jugadas:
 * - Si todas las cartas de mayor poder pertenecen al mismo equipo, gana ese equipo
 *   (y sale en la próxima el primer asiento que jugó esa carta máxima).
 * - Si dos o más equipos empatan en el poder máximo, la ronda es parda.
 */
export function evaluateRound(plays: readonly RoundPlay[]): RoundEvaluation {
  const first = plays[0];
  if (!first) {
    return { winnerTeam: null, winningSeat: null, isParda: true };
  }

  let maxPower = getTrucoPower(first.card);
  let topPlays: RoundPlay[] = [first];

  for (let i = 1; i < plays.length; i++) {
    const play = plays[i];
    if (!play) continue;
    const power = getTrucoPower(play.card);
    if (power > maxPower) {
      maxPower = power;
      topPlays = [play];
    } else if (power === maxPower) {
      topPlays.push(play);
    }
  }

  const distinctTeams = new Set(topPlays.map((p) => p.team));
  if (distinctTeams.size === 1) {
    const winner = topPlays[0]!;
    return {
      winnerTeam: winner.team,
      winningSeat: winner.seat,
      isParda: false,
    };
  }

  return {
    winnerTeam: null,
    winningSeat: null,
    isParda: true,
  };
}

/**
 * Determina si la mano ya tiene un equipo ganador tras las rondas completadas (1 a 3),
 * aplicando exactamente todas las reglas de parda del Truco Argentino:
 *  - Ganar 2 rondas define la mano inmediatamente.
 *  - Parda en 1ª: define quien gane la 2ª; si la 2ª también es parda, define la 3ª.
 *  - Ganada 1ª y parda en 2ª: gana quien ganó la 1ª.
 *  - Ganada 1ª por X, ganada 2ª por Y y parda en 3ª: gana X (ganador de 1ª).
 *  - Triple parda: gana el equipo del jugador mano (`manoTeam`).
 *  - Caso N equipos (3 equipos, 1 ronda cada uno): gana quien ganó la 1ª ("primera vale doble").
 */
export function evaluateHandWinnerFromRounds(
  completedRounds: readonly CompletedRound[],
  manoTeam: TeamId,
): TeamId | null {
  if (completedRounds.length === 0) return null;

  const winsByTeam = new Map<TeamId, number>();
  for (const round of completedRounds) {
    if (round.winnerTeam !== null) {
      const nextCount = (winsByTeam.get(round.winnerTeam) ?? 0) + 1;
      winsByTeam.set(round.winnerTeam, nextCount);
      if (nextCount >= 2) {
        return round.winnerTeam;
      }
    }
  }

  const r1 = completedRounds[0]!;
  if (completedRounds.length === 1) {
    return null;
  }

  const r2 = completedRounds[1]!;
  if (completedRounds.length === 2) {
    if (r1.isParda && r2.winnerTeam !== null) {
      return r2.winnerTeam;
    }
    if (!r1.isParda && r2.isParda) {
      return r1.winnerTeam;
    }
    return null;
  }

  const r3 = completedRounds[2]!;
  if (r1.isParda && r2.isParda) {
    return r3.winnerTeam !== null ? r3.winnerTeam : manoTeam;
  }

  if (r3.isParda) {
    return r1.winnerTeam ?? manoTeam;
  }

  // Tres rondas ganadas por tres equipos distintos en modo de 3 equipos: define primera
  return r1.winnerTeam ?? r3.winnerTeam ?? manoTeam;
}

export function getActiveSeats(
  seats: readonly PlayerSeat[],
  foldedSeats: readonly SeatId[],
): readonly PlayerSeat[] {
  const folded = new Set(foldedSeats);
  return seats.filter((s) => !folded.has(s.seat));
}

export function getActiveTeams(
  seats: readonly PlayerSeat[],
  foldedSeats: readonly SeatId[],
): readonly TeamId[] {
  const seen = new Set<TeamId>();
  const ordered: TeamId[] = [];
  for (const s of getActiveSeats(seats, foldedSeats)) {
    if (!seen.has(s.team)) {
      seen.add(s.team);
      ordered.push(s.team);
    }
  }
  return ordered;
}

export function findFirstActiveSeatFrom(
  startSeat: SeatId,
  seats: readonly PlayerSeat[],
  foldedSeats: readonly SeatId[],
): SeatId {
  const folded = new Set(foldedSeats);
  const total = seats.length;
  for (let offset = 0; offset < total; offset++) {
    const candidate = (startSeat + offset) % total;
    if (!folded.has(candidate)) {
      return candidate;
    }
  }
  return startSeat;
}

export function findNextTurnSeatInRound(
  roundLeadSeat: SeatId,
  seats: readonly PlayerSeat[],
  foldedSeats: readonly SeatId[],
  currentRoundPlays: readonly RoundPlay[],
): SeatId | null {
  const folded = new Set(foldedSeats);
  const played = new Set(currentRoundPlays.map((p) => p.seat));
  const total = seats.length;

  for (let offset = 0; offset < total; offset++) {
    const candidate = (roundLeadSeat + offset) % total;
    if (!folded.has(candidate) && !played.has(candidate)) {
      return candidate;
    }
  }
  return null;
}

export function findNextOpposingTeam(
  callerSeat: SeatId,
  callerTeam: TeamId,
  seats: readonly PlayerSeat[],
  foldedSeats: readonly SeatId[],
): TeamId {
  const folded = new Set(foldedSeats);
  const total = seats.length;
  for (let offset = 1; offset <= total; offset++) {
    const candidateSeat = (callerSeat + offset) % total;
    const info = seats[candidateSeat];
    if (info && !folded.has(candidateSeat) && info.team !== callerTeam) {
      return info.team;
    }
  }
  return callerTeam;
}

/**
 * Elige el asiento activo de `responderTeam` responsable de responder un canto según `mode`:
 * - `'NEXT_IN_TURN'` (por defecto) / `'ANY_TEAM_MEMBER'`: el primer asiento elegible y activo
 *   de `responderTeam` que sigue a `callerSeat` en el sentido antihorario de turnos.
 * - `'PIE_OF_TEAM'`: el asiento elegible y activo de `responderTeam` más lejano a `manoSeat` (el pie).
 */
export function selectActiveResponderSeat(
  callerSeat: SeatId,
  responderTeam: TeamId,
  manoSeat: SeatId,
  seats: readonly PlayerSeat[],
  foldedSeats: readonly SeatId[],
  mode: ResponderSelectionMode = 'NEXT_IN_TURN',
  eligibleFilter?: (seat: SeatId) => boolean,
): SeatId {
  const folded = new Set(foldedSeats);

  if (mode === 'PIE_OF_TEAM') {
    const candidates = seats
      .filter(
        (s) =>
          s.team === responderTeam &&
          !folded.has(s.seat) &&
          (eligibleFilter ? eligibleFilter(s.seat) : true),
      )
      .sort(
        (a, b) =>
          seatHandOrder(b.seat, manoSeat, seats.length) -
          seatHandOrder(a.seat, manoSeat, seats.length),
      );
    return candidates[0]?.seat ?? manoSeat;
  }

  const total = seats.length;
  for (let offset = 1; offset <= total; offset++) {
    const candidateSeat = (callerSeat + offset) % total;
    const info = seats[candidateSeat];
    if (
      info &&
      info.team === responderTeam &&
      !folded.has(candidateSeat) &&
      (eligibleFilter ? eligibleFilter(candidateSeat) : true)
    ) {
      return candidateSeat;
    }
  }

  return manoSeat;
}

export function seedPrngStateFromRng(rng: Rng): PrngState {
  const nextUint32 = (): number => {
    const sample = rng.nextFloat();
    if (!Number.isFinite(sample) || sample < 0 || sample >= 1) {
      throw new Error(`RNG inválido fuera de [0, 1): ${String(sample)}`);
    }
    return Math.floor(sample * 4294967296) >>> 0;
  };
  return [nextUint32(), nextUint32(), nextUint32(), nextUint32()];
}

function stepSfc32(state: PrngState): { float: number; nextState: PrngState } {
  let [a, b, c, d] = state;
  a >>>= 0;
  b >>>= 0;
  c >>>= 0;
  d >>>= 0;
  const t = (((a + b) | 0) + d) | 0;
  d = (d + 1) | 0;
  a = b ^ (b >>> 9);
  b = (c + (c << 3)) | 0;
  c = (c << 21) | (c >>> 11);
  c = (c + t) | 0;
  return {
    float: (t >>> 0) / 4294967296,
    nextState: [a >>> 0, b >>> 0, c >>> 0, d >>> 0],
  };
}

export function shuffleDeckWithPrngState(
  deck: readonly Card[],
  initialPrngState: PrngState,
): { shuffled: readonly Card[]; nextPrngState: PrngState } {
  const copy = [...deck];
  let prng = initialPrngState;

  for (let i = copy.length - 1; i > 0; i--) {
    const stepped = stepSfc32(prng);
    prng = stepped.nextState;
    const j = Math.floor(stepped.float * (i + 1));
    const tmp = copy[i]!;
    copy[i] = copy[j]!;
    copy[j] = tmp;
  }

  return { shuffled: copy, nextPrngState: prng };
}
