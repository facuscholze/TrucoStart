import type { TournamentFormat } from './bracket.js';
import { nextPowerOfTwo, roundCount, seedOrderForBracket } from './bracket.js';

/**
 * Topología de la llave (M10a).
 *
 * Funciones puras: describen **de dónde sale cada lado** de cada cruce y, por lo tanto,
 * a dónde va el ganador y el perdedor. El servicio no guarda este grafo en la base:
 * lo reconstruye desde el formato y la cantidad de participantes, que quedan
 * congelados al arrancar el torneo. Así la llave no puede desincronizarse de la base,
 * y las propiedades se prueban sin infraestructura.
 *
 * Convenciones:
 * - `size` es la potencia de 2 que contiene a los participantes; los lugares sin
 *   participante son byes y se resuelven como cruces ganados sin jugar.
 * - Eliminación simple: `N - 1` cruces jugados.
 * - Eliminación doble: `2N - 2` cruces jugados, incluida la gran final. La gran final
 *   es a partida única (no hay "bracket reset"); queda registrado en ADR-029.
 */

export type BracketKind = 'WINNERS' | 'LOSERS' | 'GRAND_FINAL';

/** Origen de un lado de un cruce. */
export type TopologySource =
  | { readonly kind: 'SEED'; readonly seed: number }
  | { readonly kind: 'WINNER'; readonly key: string }
  | { readonly kind: 'LOSER'; readonly key: string }
  | { readonly kind: 'EMPTY' };

export interface TopologyMatch {
  /** Clave estable `BRACKET-Rr-Ss`, p. ej. `WINNERS-R2-S1`. */
  readonly key: string;
  readonly bracket: BracketKind;
  readonly round: number;
  readonly slot: number;
  readonly home: TopologySource;
  readonly away: TopologySource;
}

export interface TournamentTopology {
  readonly format: TournamentFormat;
  readonly entrantCount: number;
  /** Potencia de 2 que contiene a los participantes (incluye los lugares de bye). */
  readonly size: number;
  /** Cruces en orden topológico: cada cruce aparece después de sus orígenes. */
  readonly matches: readonly TopologyMatch[];
  readonly grandFinalKey: string;
}

const MIN_ENTRANTS = 2;

export function matchKey(bracket: BracketKind, round: number, slot: number): string {
  return `${bracket}-R${round}-S${slot}`;
}

const EMPTY: TopologySource = Object.freeze({ kind: 'EMPTY' });

function seedSource(seed: number, entrantCount: number): TopologySource {
  return seed <= entrantCount ? { kind: 'SEED', seed } : EMPTY;
}

/** Cruces de la llave de ganadores (igual en ambos formatos). */
function buildWinnersMatches(entrantCount: number, size: number): TopologyMatch[] {
  const order = seedOrderForBracket(size);
  const matches: TopologyMatch[] = [];

  for (let round = 1; round <= roundCount(entrantCount); round++) {
    const count = size / 2 ** round;
    for (let slot = 1; slot <= count; slot++) {
      const home: TopologySource =
        round === 1
          ? seedSource(order[slot * 2 - 2]!, entrantCount)
          : {
              kind: 'WINNER',
              key: matchKey('WINNERS', round - 1, slot * 2 - 1),
            };
      const away: TopologySource =
        round === 1
          ? seedSource(order[slot * 2 - 1]!, entrantCount)
          : {
              kind: 'WINNER',
              key: matchKey('WINNERS', round - 1, slot * 2),
            };
      matches.push({
        key: matchKey('WINNERS', round, slot),
        bracket: 'WINNERS',
        round,
        slot,
        home,
        away,
      });
    }
  }
  return matches;
}

/**
 * Cruces de la llave de perdedores, con la estructura estándar de 2R-2 rondas.
 *
 * Para una llave de `size = 2^R` participantes:
 * - Ronda 1: cruza a los que cayeron en la ronda 1 de ganadores.
 * - Rondas impares (3, 5, …): los ganadores de la ronda anterior juegan entre sí
 *   y el cuadro se reduce a la mitad.
 * - Rondas pares (2, 4, …): los ganadores de la ronda anterior reciben a los que
 *   caen de la llave de ganadores.
 *
 * La cantidad de cruces de la ronda `r` es `size / 2^(floor((r+1)/2) + 1)`, que da
 * `size - 2` cruces en total: con `size - 1` de ganadores y la gran final suman
 * `2 * size - 2`.
 */
function buildLosersMatches(size: number): TopologyMatch[] {
  const rounds = Math.log2(size);
  const matches: TopologyMatch[] = [];

  for (let r = 1; r <= 2 * (rounds - 1); r++) {
    const count = size / 2 ** (Math.floor((r + 1) / 2) + 1);
    for (let slot = 1; slot <= count; slot++) {
      const home: TopologySource =
        r === 1
          ? // Los que cayeron en la primera ronda de ganadores.
            { kind: 'LOSER', key: matchKey('WINNERS', 1, slot * 2 - 1) }
          : r % 2 === 1
            ? // Ronda menor: se cruzan los ganadores de la ronda anterior.
              { kind: 'WINNER', key: matchKey('LOSERS', r - 1, slot * 2 - 1) }
            : // Ronda mayor: recibe a los que caen de la llave de ganadores.
              { kind: 'WINNER', key: matchKey('LOSERS', r - 1, slot) };

      const away: TopologySource =
        r === 1
          ? { kind: 'LOSER', key: matchKey('WINNERS', 1, slot * 2) }
          : r % 2 === 1
            ? { kind: 'WINNER', key: matchKey('LOSERS', r - 1, slot * 2) }
            : { kind: 'LOSER', key: matchKey('WINNERS', r / 2 + 1, slot) };

      matches.push({
        key: matchKey('LOSERS', r, slot),
        bracket: 'LOSERS',
        round: r,
        slot,
        home,
        away,
      });
    }
  }
  return matches;
}

/**
 * Construye la topología completa de la llave para `entrantCount` participantes.
 * Los cruces salen en orden topológico: primero ganadores, después perdedores y al
 * final la gran final.
 */
export function buildTournamentTopology(
  format: TournamentFormat,
  entrantCount: number,
): TournamentTopology {
  if (!Number.isInteger(entrantCount) || entrantCount < MIN_ENTRANTS) {
    throw new RangeError('Un torneo necesita al menos 2 participantes');
  }
  const size = nextPowerOfTwo(entrantCount);
  const winners = buildWinnersMatches(entrantCount, size);

  if (format === 'SINGLE_ELIMINATION') {
    const finalKey = matchKey('WINNERS', roundCount(entrantCount), 1);
    return { format, entrantCount, size, matches: winners, grandFinalKey: finalKey };
  }

  const losers = buildLosersMatches(size);
  const winnersRounds = Math.log2(size);
  const losersRounds = Math.max(0, 2 * (winnersRounds - 1));
  const grandFinal: TopologyMatch = {
    key: matchKey('GRAND_FINAL', 1, 1),
    bracket: 'GRAND_FINAL',
    round: 1,
    slot: 1,
    home: { kind: 'WINNER', key: matchKey('WINNERS', winnersRounds, 1) },
    away:
      losersRounds === 0
        ? { kind: 'LOSER', key: matchKey('WINNERS', 1, 1) }
        : { kind: 'WINNER', key: matchKey('LOSERS', losersRounds, 1) },
  };

  return {
    format,
    entrantCount,
    size,
    matches: [...winners, ...losers, grandFinal],
    grandFinalKey: grandFinal.key,
  };
}

/** Índice por clave para resolver orígenes en O(1). */
export function indexTopology(topology: TournamentTopology): Map<string, TopologyMatch> {
  return new Map(topology.matches.map((match) => [match.key, match]));
}

/**
 * Destinos de un cruce: dónde avanza el ganador y a dónde cae el perdedor.
 * En eliminación simple el campeón no tiene destino (es el final del cuadro).
 */
export interface MatchDestinations {
  readonly winnerTo: { readonly as: 'WINNER' | 'LOSER'; readonly key: string } | null;
  readonly loserTo: { readonly as: 'WINNER' | 'LOSER'; readonly key: string } | null;
}

export function matchDestinations(topology: TournamentTopology): Map<string, MatchDestinations> {
  const destinations = new Map<
    string,
    { winnerTo: MatchDestinations['winnerTo']; loserTo: MatchDestinations['loserTo'] }
  >();
  const setRole = (from: string, role: 'WINNER' | 'LOSER', to: string): void => {
    const current = destinations.get(from) ?? { winnerTo: null, loserTo: null };
    destinations.set(
      from,
      role === 'WINNER'
        ? { ...current, winnerTo: { as: 'WINNER', key: to } }
        : { ...current, loserTo: { as: 'LOSER', key: to } },
    );
  };
  for (const match of topology.matches) {
    for (const source of [match.home, match.away]) {
      if (source.kind === 'WINNER') setRole(source.key, 'WINNER', match.key);
      if (source.kind === 'LOSER') setRole(source.key, 'LOSER', match.key);
    }
  }
  const result = new Map<string, MatchDestinations>();
  for (const match of topology.matches) {
    result.set(match.key, destinations.get(match.key) ?? { winnerTo: null, loserTo: null });
  }
  return result;
}

/**
 * Cruces que se juegan en un cuadro sin byes. Con byes se juegan menos o —en
 * eliminación doble— la misma cantidad, porque un pase libre no otorga derrota.
 * `simulateTournament` cuenta los cruces realmente jugados.
 */
export function playedMatchCount(format: TournamentFormat, entrantCount: number): number {
  if (entrantCount < MIN_ENTRANTS) return 0;
  return format === 'SINGLE_ELIMINATION' ? entrantCount - 1 : 2 * entrantCount - 2;
}

/** Resultado de un cruce dentro de una simulación. */
export interface SimulatedMatch {
  readonly key: string;
  readonly bracket: BracketKind;
  readonly round: number;
  readonly slot: number;
  readonly homeSeed: number | null;
  readonly awaySeed: number | null;
  readonly winnerSeed: number | null;
  readonly loserSeed: number | null;
  /** `false` cuando hubo pase libre (bye) o cruce sin participantes. */
  readonly played: boolean;
}

export interface TournamentSimulation {
  readonly matches: readonly SimulatedMatch[];
  readonly championSeed: number | null;
  readonly runnerUpSeed: number | null;
  readonly playedCount: number;
  /**
   * Una entrada por derrota: la ronda en que el participante quedó fuera. En
   * eliminación doble alguien puede perder y seguir; sólo cuenta su segunda caída.
   * Es la base del orden de posiciones (ver `standingsOrder`).
   */
  readonly eliminations: readonly { readonly seed: number; readonly round: number }[];
}

/**
 * Simula el torneo completo sobre la topología, sin base de datos ni azar propio:
 * quien decide cada cruce es `pickWinner(homeSeed, awaySeed)`, que debe devolver uno
 * de los dos. Los pases libres se propagan solos y **no** cuentan como cruce jugado,
 * igual que en el servicio.
 *
 * Se usa en pruebas (incluida la simulación con bots de 4, 7, 16 y 64 participantes)
 * y para explicar el cuadro en la web, porque es determinista.
 */
export function simulateTournament(
  topology: TournamentTopology,
  pickWinner: (homeSeed: number, awaySeed: number) => number,
): TournamentSimulation {
  const destinations = matchDestinations(topology);
  const winners = new Map<string, number | null>();
  const losers = new Map<string, number | null>();
  const matches: SimulatedMatch[] = [];
  const losses = new Map<number, { round: number; count: number }>();
  const lossesAllowed = topology.format === 'DOUBLE_ELIMINATION' ? 2 : 1;
  let championSeed: number | null = null;
  let runnerUpSeed: number | null = null;

  const resolve = (source: TopologySource): number | null => {
    if (source.kind === 'SEED') return source.seed;
    if (source.kind === 'EMPTY') return null;
    return source.kind === 'WINNER'
      ? (winners.get(source.key) ?? null)
      : (losers.get(source.key) ?? null);
  };

  for (const match of topology.matches) {
    const homeSeed = resolve(match.home);
    const awaySeed = resolve(match.away);
    let winnerSeed: number | null = null;
    let loserSeed: number | null = null;
    let played = false;

    if (homeSeed !== null && awaySeed !== null) {
      played = true;
      const picked = pickWinner(homeSeed, awaySeed);
      if (picked !== homeSeed && picked !== awaySeed) {
        throw new RangeError(`pickWinner devolvió ${picked}, que no juega ${match.key}`);
      }
      winnerSeed = picked;
      loserSeed = picked === homeSeed ? awaySeed : homeSeed;
    } else {
      // Pase libre: avanza quien está presente. Si no hay nadie, el cruce queda vacío.
      winnerSeed = homeSeed ?? awaySeed;
    }

    winners.set(match.key, winnerSeed);
    losers.set(match.key, loserSeed);
    matches.push({
      key: match.key,
      bracket: match.bracket,
      round: match.round,
      slot: match.slot,
      homeSeed,
      awaySeed,
      winnerSeed,
      loserSeed,
      played,
    });

    const destination = destinations.get(match.key)!;
    if (loserSeed !== null) {
      const previous = losses.get(loserSeed) ?? { round: match.round, count: 0 };
      losses.set(loserSeed, { round: previous.round, count: previous.count + 1 });
    }
    if (winnerSeed !== null && destination.winnerTo === null) {
      championSeed = winnerSeed;
      runnerUpSeed = loserSeed;
    }
  }

  const eliminations = [...losses.entries()]
    .filter(([, record]) => record.count >= lossesAllowed)
    .map(([seed, record]) => ({ seed, round: record.round }))
    .sort((a, b) => a.seed - b.seed);

  return {
    matches,
    championSeed,
    runnerUpSeed,
    playedCount: matches.filter((match) => match.played).length,
    eliminations,
  };
}

/**
 * Orden de posiciones de un torneo terminado.
 *
 * Regla documentada (ver `docs/RULES.md` § Torneos y ADR-029): 1.º el campeón, 2.º el
 * subcampeón (perdedor de la final) y después quien cayó más tarde; a igual ronda de
 * eliminación manda la mejor semilla. Los participantes sin derrota registrada (por
 * ejemplo, dados de baja antes de jugar) van al final, también por semilla.
 *
 * Es el criterio que usa la API para repartir premios y armar la tabla, y es
 * determinista: la misma llave produce siempre el mismo orden.
 */
export function standingsOrder(simulation: TournamentSimulation): number[] {
  const eliminatedAt = new Map<number, number>();
  for (const record of simulation.eliminations) eliminatedAt.set(record.seed, record.round);
  const seeds = new Set<number>();
  for (const match of simulation.matches) {
    for (const seed of [match.homeSeed, match.awaySeed]) if (seed !== null) seeds.add(seed);
  }

  return [...seeds].sort((a, b) => {
    if (a === simulation.championSeed) return -1;
    if (b === simulation.championSeed) return 1;
    if (a === simulation.runnerUpSeed) return -1;
    if (b === simulation.runnerUpSeed) return 1;
    const roundA = eliminatedAt.get(a) ?? Number.POSITIVE_INFINITY;
    const roundB = eliminatedAt.get(b) ?? Number.POSITIVE_INFINITY;
    if (roundA !== roundB) return roundB - roundA;
    return a - b;
  });
}
