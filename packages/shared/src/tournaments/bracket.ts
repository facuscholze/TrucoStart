import { z } from 'zod';

/**
 * Generador de llaves de torneo (M10a).
 *
 * Funciones puras y deterministas: reciben participantes ya sembrados y devuelven la
 * estructura de la llave. No tocan base de datos, red ni reloj, así que se pueden
 * probar con propiedades y simular torneos completos sin infraestructura.
 *
 * Reglas documentadas de siembra y byes:
 * - Siembra por rating descendente (Glicko-2). A igual rating, orden estable por
 *   `seedOrder` (fecha de inscripción) y luego por userId, para que dos corridas con
 *   los mismos datos den exactamente la misma llave.
 * - En eliminación simple el cuadro se redondea a la potencia de 2 siguiente. Los
 *   byes se reparten **desde arriba de la siembra**: el sembrado 1 recibe el primer
 *   bye, después el 2, y así. Un participante con bye no juega la primera ronda.
 * - Nunca hay un participante contra sí mismo: los byes ocupan un lado del par.
 * - En eliminación doble se juega una llave de ganadores y una de perdedores; la
 *   final de perdedores y la gran final se resuelven aparte.
 */

export type TournamentFormat = z.infer<typeof TournamentFormatSchema>;

export interface SeededEntrant {
  readonly userId: string;
  /** Rating Glicko-2 usado para sembrar; `null` se trata como el más bajo. */
  readonly rating: number | null;
  /** Desempate estable: fecha de inscripción (epoch ms) y luego userId. */
  readonly seedOrder: number;
}

export interface BracketSlot {
  /** Semilla 1..N del participante, o `null` si el slot está vacío (bye). */
  readonly seed: number | null;
  readonly userId: string | null;
}

export interface BracketPairing {
  /** Índice de la ronda, 1-based. */
  readonly round: number;
  /** Posición del cruce dentro de la ronda, 1-based. */
  readonly slot: number;
  readonly home: BracketSlot;
  readonly away: BracketSlot;
  /** `true` si el cruce no se juega: un lado tiene bye y avanza directo. */
  readonly isBye: boolean;
}

export interface DoubleEliminationBracket {
  readonly winners: readonly BracketPairing[];
  readonly losers: readonly BracketPairing[];
  /** Gran final: ganador de ganadores contra ganador de perdedores. */
  readonly grandFinal: BracketPairing;
}

const MIN_ENTRANTS = 2;

/** Potencia de 2 mínima que puede contener a `count` participantes. */
export function nextPowerOfTwo(count: number): number {
  if (count <= 1) return 1;
  let size = 1;
  while (size < count) size *= 2;
  return size;
}

/** Cantidad de byes necesarios para completar el cuadro. */
export function byeCount(entrantCount: number): number {
  return nextPowerOfTwo(entrantCount) - entrantCount;
}

/**
 * Ordena a los participantes para sembrar la llave. `null` en rating va al final;
 * el desempate es estable para que la llave sea reproducible.
 */
export function seedEntrants(entrants: readonly SeededEntrant[]): SeededEntrant[] {
  return [...entrants].sort((a, b) => {
    const ratingA = a.rating ?? Number.NEGATIVE_INFINITY;
    const ratingB = b.rating ?? Number.NEGATIVE_INFINITY;
    if (ratingA !== ratingB) return ratingB - ratingA;
    if (a.seedOrder !== b.seedOrder) return a.seedOrder - b.seedOrder;
    return a.userId.localeCompare(b.userId);
  });
}

/**
 * Distribución de semillas en el orden de cuadro estándar (1 vs último, 2 vs
 * anteúltimo…), para que los mejores sembrados se crucen lo más tarde posible.
 * Devuelve un arreglo de semillas (1-based) de longitud `size`.
 */
export function seedOrderForBracket(size: number): number[] {
  let order = [1];
  while (order.length < size) {
    const total = order.length * 2 + 1;
    const next: number[] = [];
    for (const seed of order) {
      next.push(seed);
      next.push(total - seed);
    }
    order = next;
  }
  return order;
}

/**
 * Arma la primera ronda de eliminación simple. Cada par enfrenta dos participantes;
 * si falta uno, el cruce es un bye y el presente avanza sin jugar.
 */
export function buildFirstRound(entrants: readonly SeededEntrant[]): BracketPairing[] {
  if (entrants.length < MIN_ENTRANTS) {
    throw new RangeError('Un torneo necesita al menos 2 participantes');
  }
  const seeded = seedEntrants(entrants);
  const size = nextPowerOfTwo(seeded.length);
  const order = seedOrderForBracket(size);
  const bySeed = new Map<number, SeededEntrant>();
  seeded.forEach((entrant, index) => bySeed.set(index + 1, entrant));

  const pairings: BracketPairing[] = [];
  for (let index = 0; index < order.length; index += 2) {
    const homeSeed = order[index]!;
    const awaySeed = order[index + 1]!;
    const home = bySeed.get(homeSeed) ?? null;
    const away = bySeed.get(awaySeed) ?? null;
    pairings.push({
      round: 1,
      slot: index / 2 + 1,
      home: { seed: home ? homeSeed : null, userId: home?.userId ?? null },
      away: { seed: away ? awaySeed : null, userId: away?.userId ?? null },
      isBye: home === null || away === null,
    });
  }
  return pairings;
}

/**
 * Cantidad de cruces que se juegan realmente en eliminación simple.
 *
 * Cada cruce elimina exactamente a un participante, así que terminar con un campeón
 * exige `N - 1` cruces. Los byes no son cruces: no suman. (Un cuadro de 8 con 5
 * participantes juega 4 para llegar a 4, 2 para llegar a 2 y 1 final: 4 + 2 + 1 = 7
 * = N - 1 = 4, y los 3 byes no juegan nada.)
 */
export function singleEliminationMatchCount(entrantCount: number): number {
  if (entrantCount < MIN_ENTRANTS) return 0;
  return entrantCount - 1;
}

/** Cantidad de rondas de una llave de eliminación simple. */
export function roundCount(entrantCount: number): number {
  if (entrantCount < MIN_ENTRANTS) return 0;
  return Math.log2(nextPowerOfTwo(entrantCount));
}

/**
 * Eliminación doble: llave de ganadores (misma construcción que simple) y llave de
 * perdedores, que recibe a quien cae en cada ronda de ganadores. La gran final
 * enfrenta a los dos campeones de llave.
 */
export function buildDoubleElimination(
  entrants: readonly SeededEntrant[],
): DoubleEliminationBracket {
  const winners = buildFirstRound(entrants);
  const rounds = roundCount(entrants.length);
  const size = nextPowerOfTwo(entrants.length);

  // Ronda 1 de perdedores: los que caen en la primera ronda de ganadores.
  const losers: BracketPairing[] = [];
  let losersSlots = Math.max(1, Math.floor(size / 4));
  for (let round = 1; round <= Math.max(0, rounds - 1); round++) {
    for (let slot = 1; slot <= losersSlots; slot++) {
      losers.push({
        round,
        slot,
        home: { seed: null, userId: null },
        away: { seed: null, userId: null },
        isBye: false,
      });
    }
    losersSlots = Math.max(1, Math.floor(losersSlots / 2));
  }

  return {
    winners,
    losers,
    grandFinal: {
      round: rounds + 1,
      slot: 1,
      home: { seed: null, userId: null },
      away: { seed: null, userId: null },
      isBye: false,
    },
  };
}

/** Cantidad de cruces de una llave de eliminación doble. */
export function doubleEliminationMatchCount(entrantCount: number): number {
  if (entrantCount < MIN_ENTRANTS) return 0;
  // 2N-2 cruces (incluida la gran final) cuando no se repite la final.
  return 2 * entrantCount - 2;
}

/** Esquema Zod del formato, compartido por API y web. */
export const TournamentFormatSchema = z.enum(['SINGLE_ELIMINATION', 'DOUBLE_ELIMINATION']);
