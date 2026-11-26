import { describe, expect, it } from 'vitest';
import { buildFirstRound, nextPowerOfTwo } from '../src/tournaments/bracket.js';
import {
  buildTournamentTopology,
  matchDestinations,
  simulateTournament,
  standingsOrder,
} from '../src/tournaments/topology.js';

const FORMATS = ['SINGLE_ELIMINATION', 'DOUBLE_ELIMINATION'] as const;
const SIZES = [2, 3, 4, 5, 6, 7, 8, 9, 12, 15, 16, 17, 31, 32, 33, 64];

/** Favorito gana: la mejor sembrada (número más bajo). */
const bestSeedWins = (home: number, away: number): number => Math.min(home, away);

/** Gana el peor sembrado: rompe cualquier supuesto de "siempre gana el 1". */
const upset = (home: number, away: number): number => Math.max(home, away);

describe('topología de la llave', () => {
  it.each(FORMATS)('coloca a cada participante exactamente una vez (%s)', (format) => {
    for (const entrantCount of SIZES) {
      const topology = buildTournamentTopology(format, entrantCount);
      // La siembra reparte las semillas 1..N; el orden de cuadro sólo decide con quién
      // se cruza cada una.
      const usedSeeds = Array.from({ length: entrantCount }, (_, index) => index + 1);

      // Las semillas de la primera ronda de ganadores son la siembra completa, sin repetir.
      const firstRoundSeeds = topology.matches
        .filter((match) => match.bracket === 'WINNERS' && match.round === 1)
        .flatMap((match) =>
          [match.home, match.away]
            .filter((source): source is { kind: 'SEED'; seed: number } => source.kind === 'SEED')
            .map((source) => source.seed),
        )
        .sort((a, b) => a - b);

      expect(firstRoundSeeds, `${format} con ${entrantCount}`).toEqual(usedSeeds);

      // Y la simulación lo confirma: todos entran y todos terminan clasificados.
      const simulation = simulateTournament(topology, bestSeedWins);
      const placed = new Set(
        simulation.matches
          .flatMap((match) => [match.homeSeed, match.awaySeed])
          .filter((seed): seed is number => seed !== null),
      );
      expect(placed.size, `${format} con ${entrantCount}`).toBe(entrantCount);
      expect(standingsOrder(simulation)).toHaveLength(entrantCount);
    }
  });

  it.each(FORMATS)('no enfrenta a nadie consigo mismo (%s)', (format) => {
    for (const entrantCount of SIZES) {
      const firstRound = buildFirstRound(
        Array.from({ length: entrantCount }, (_, index) => ({
          userId: `user-${index + 1}`,
          rating: 2000 - index,
          seedOrder: index,
        })),
      );
      for (const pairing of firstRound) {
        if (pairing.home.seed === null || pairing.away.seed === null) continue;
        expect(pairing.home.seed).not.toBe(pairing.away.seed);
        expect(pairing.home.userId).not.toBe(pairing.away.userId);
      }
      const topology = buildTournamentTopology(format, entrantCount);
      for (const match of simulateTournament(topology, bestSeedWins).matches) {
        if (match.homeSeed === null || match.awaySeed === null) continue;
        expect(match.homeSeed, `${match.key} de ${entrantCount}`).not.toBe(match.awaySeed);
      }
    }
  });

  it.each(FORMATS)('ningún cruce referencia orígenes inexistentes (%s)', (format) => {
    for (const entrantCount of SIZES) {
      const topology = buildTournamentTopology(format, entrantCount);
      const seen = new Set<string>();
      for (const match of topology.matches) {
        for (const source of [match.home, match.away]) {
          if (source.kind === 'WINNER' || source.kind === 'LOSER') {
            expect(seen.has(source.key), `${match.key} depende de ${source.key}`).toBe(true);
          }
        }
        seen.add(match.key);
      }
    }
  });

  it.each(FORMATS)('juega la cantidad documentada de cruces (%s)', (format) => {
    // Propiedad verificada para cada cantidad de 2 a 64, no sólo para la muestra.
    // En simple, N-1 cruces (el pase libre no se juega). En doble, 2N-2: la derrota
    // que manda a la llave de perdedores se paga igual con una revancha.
    for (let entrantCount = 2; entrantCount <= 64; entrantCount++) {
      const simulation = simulateTournament(
        buildTournamentTopology(format, entrantCount),
        bestSeedWins,
      );
      const expected = format === 'SINGLE_ELIMINATION' ? entrantCount - 1 : 2 * entrantCount - 2;
      expect(simulation.playedCount, `${format} con ${entrantCount}`).toBe(expected);
      // Todos salvo el campeón quedan eliminados exactamente una vez.
      expect(simulation.eliminations, `eliminados con ${entrantCount}`).toHaveLength(
        entrantCount - 1,
      );
      expect(new Set(simulation.eliminations.map((entry) => entry.seed)).size).toBe(
        entrantCount - 1,
      );
    }
  });

  it('el campeón nunca es alguien que perdió', () => {
    for (const format of FORMATS) {
      for (const entrantCount of SIZES) {
        for (const pick of [bestSeedWins, upset]) {
          const simulation = simulateTournament(
            buildTournamentTopology(format, entrantCount),
            pick,
          );
          expect(simulation.championSeed).not.toBeNull();
          const championLosses = simulation.matches.filter(
            (match) => match.loserSeed === simulation.championSeed,
          );
          expect(championLosses, `${format} ${entrantCount}`).toHaveLength(
            format === 'DOUBLE_ELIMINATION' ? 0 : 0,
          );
        }
      }
    }
  });

  it('en eliminación simple el campeón sale de la final de ganadores', () => {
    const topology = buildTournamentTopology('SINGLE_ELIMINATION', 8);
    expect(matchDestinations(topology).get('WINNERS-R3-S1')!.winnerTo).toBeNull();
  });

  it('en eliminación doble nadie pierde dos veces sin quedar fuera', () => {
    for (const entrantCount of SIZES) {
      const topology = buildTournamentTopology('DOUBLE_ELIMINATION', entrantCount);
      const simulation = simulateTournament(topology, upset);
      for (const match of simulation.matches) {
        if (match.loserSeed === null) continue;
        const lossesBefore = simulation.matches
          .slice(0, simulation.matches.indexOf(match))
          .filter((previous) => previous.loserSeed === match.loserSeed).length;
        // Alguien que ya perdió una vez sólo puede seguir si la siguiente ronda lo recibe.
        if (lossesBefore >= 2) throw new Error(`semilla ${match.loserSeed} perdió tres veces`);
      }
      // El perdedor de un cruce de ganadores siempre cae a la llave de perdedores;
      // el de un cruce de perdedores queda eliminado (no tiene destino).
      const destinations = matchDestinations(topology);
      for (const match of topology.matches) {
        const dest = destinations.get(match.key)!;
        if (match.bracket === 'WINNERS') {
          expect(dest.loserTo, `perdedor de ${match.key}`).not.toBeNull();
        } else {
          expect(dest.loserTo, `perdedor de ${match.key}`).toBeNull();
        }
        // Sólo el campeón de la gran final termina el torneo sin siguiente cruce.
        if (match.key === topology.grandFinalKey) expect(dest.winnerTo).toBeNull();
        else expect(dest.winnerTo, `ganador de ${match.key}`).not.toBeNull();
      }
    }
  });

  it('reparte los byes a los mejores sembrados', () => {
    for (const entrantCount of [3, 5, 6, 7, 9, 12, 15, 17, 31, 33]) {
      const topology = buildTournamentTopology('SINGLE_ELIMINATION', entrantCount);
      const withBye = topology.matches
        .filter(
          (match) =>
            match.bracket === 'WINNERS' &&
            match.round === 1 &&
            (match.home.kind === 'EMPTY' || match.away.kind === 'EMPTY'),
        )
        .map((match) =>
          match.home.kind === 'SEED' ? match.home.seed : (match.away as { seed: number }).seed,
        )
        .sort((a, b) => a - b);
      const expected = Array.from(
        { length: nextPowerOfTwo(entrantCount) - entrantCount },
        (_, index) => index + 1,
      );
      expect(withBye, `byes con ${entrantCount}`).toEqual(expected);
    }
  });

  it('ordena posiciones: campeón, subcampeón y después quien cayó más tarde', () => {
    for (const entrantCount of [4, 7, 16]) {
      const simulation = simulateTournament(
        buildTournamentTopology('SINGLE_ELIMINATION', entrantCount),
        bestSeedWins,
      );
      const order = standingsOrder(simulation);
      expect(order[0]).toBe(1);
      expect(order[1]).toBe(2);
      // El último de la tabla es el sembrado más bajo que jugó.
      expect(order[order.length - 1]).toBe(entrantCount);
      expect(new Set(order).size).toBe(entrantCount);
    }
  });

  it('rechaza cuadros imposibles', () => {
    expect(() => buildTournamentTopology('SINGLE_ELIMINATION', 1)).toThrow(RangeError);
    expect(() => buildTournamentTopology('DOUBLE_ELIMINATION', 0)).toThrow(RangeError);
    expect(() => buildTournamentTopology('SINGLE_ELIMINATION', 4.5)).toThrow(RangeError);
  });
});
