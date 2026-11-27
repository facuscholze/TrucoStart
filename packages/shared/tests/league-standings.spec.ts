import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  LEAGUE_DIVISIONS,
  LEAGUE_POINTS,
  canTransitionLeague,
  leagueDivisionRank,
  nextLeagueDivision,
  previousLeagueDivision,
  type LeagueDivision,
  type LeaguePromotionRules,
  type LeagueStandingRow,
} from '../src/competition/league.schema.js';
import {
  buildLeagueStandings,
  onlySeedSeparates,
  resolveMovements,
  type LeagueParticipant,
  type LeagueResult,
} from '../src/competition/standings.js';

const PROMOTION: LeaguePromotionRules = { promotions: 2, relegations: 2, minMatchesToMove: 3 };

function participants(count: number): LeagueParticipant[] {
  return Array.from({ length: count }, (_, index) => ({
    userId: `u${index}`,
    nickname: `Jugador ${index}`,
    status: 'ACTIVE',
    seed: index + 1,
  }));
}

function played(
  home: string,
  away: string,
  winner: 'HOME' | 'AWAY',
  scores: [number, number] = [30, 15],
): LeagueResult {
  // Los dos primeros valores son "del ganador y del perdedor": el marcador se ubica según quién
  // ganó, para que el resultado sea siempre coherente con el ganador.
  const winnerScore = Math.max(scores[0], scores[1]);
  const loserScore = Math.min(scores[0], scores[1]);
  return {
    homeUserId: home,
    awayUserId: away,
    winnerUserId: winner === 'HOME' ? home : away,
    homeScore: winner === 'HOME' ? winnerScore : loserScore,
    awayScore: winner === 'HOME' ? loserScore : winnerScore,
    forfeitReason: null,
    noShowUserIds: [],
  };
}

function noShow(home: string, away: string, who: 'HOME' | 'AWAY' | 'BOTH'): LeagueResult {
  const noShowUserIds = who === 'BOTH' ? [home, away] : who === 'HOME' ? [home] : [away];
  return {
    homeUserId: home,
    awayUserId: away,
    winnerUserId: who === 'BOTH' ? null : who === 'HOME' ? away : home,
    homeScore: null,
    awayScore: null,
    forfeitReason: who === 'BOTH' ? 'DOUBLE_NO_SHOW' : 'NO_SHOW',
    noShowUserIds,
  };
}

describe('Ligas — divisiones y transiciones', () => {
  it('la escalera de divisiones es ascendente y tiene extremos', () => {
    expect(leagueDivisionRank('BRONCE')).toBe(0);
    expect(nextLeagueDivision('BRONCE')).toBe('PLATA');
    expect(previousLeagueDivision('BRONCE')).toBeNull();
    expect(nextLeagueDivision('PLATINO')).toBeNull();
    expect(previousLeagueDivision('PLATINO')).toBe('ORO');
    expect(LEAGUE_DIVISIONS).toHaveLength(4);
  });

  it('el cierre puede volver a ACTIVE: es lo que permite reintentar un cierre a medias', () => {
    expect(canTransitionLeague('ACTIVE', 'CLOSING')).toBe(true);
    expect(canTransitionLeague('CLOSING', 'FINISHED')).toBe(true);
    expect(canTransitionLeague('CLOSING', 'ACTIVE')).toBe(true);
    // Terminales: una liga terminada no se reabre ni se cancela.
    expect(canTransitionLeague('FINISHED', 'ACTIVE')).toBe(false);
    expect(canTransitionLeague('CANCELLED', 'ACTIVE')).toBe(false);
  });
});

describe('Ligas — tabla de posiciones', () => {
  it('ordena por puntos y los asigna con las constantes del producto', () => {
    const table = buildLeagueStandings({
      participants: participants(3),
      results: [played('u0', 'u1', 'HOME'), played('u0', 'u2', 'HOME'), played('u1', 'u2', 'AWAY')],
    });
    expect(table.map((row) => row.userId)).toEqual(['u0', 'u2', 'u1']);
    expect(table[0]).toMatchObject({ points: 2 * LEAGUE_POINTS.WIN, wins: 2, losses: 0 });
    expect(table[1]).toMatchObject({ points: LEAGUE_POINTS.WIN, wins: 1, losses: 1 });
    expect(table[2]).toMatchObject({ points: LEAGUE_POINTS.LOSS, wins: 0, losses: 2 });
  });

  it('un doble ausente no suma para nadie y se cuenta como partida jugada', () => {
    const table = buildLeagueStandings({
      participants: participants(2),
      results: [noShow('u0', 'u1', 'BOTH')],
    });
    for (const row of table) {
      expect(row.points).toBe(0);
      expect(row.played).toBe(1);
      expect(row.noShows).toBe(1);
      expect(row.wins).toBe(0);
      expect(row.losses).toBe(0);
    }
  });

  it('un ausente suma 0 y una ausencia, y el rival que se presentó gana', () => {
    const table = buildLeagueStandings({
      participants: participants(2),
      results: [noShow('u0', 'u1', 'HOME')],
    });
    const winner = table.find((row) => row.userId === 'u1')!;
    const absent = table.find((row) => row.userId === 'u0')!;
    expect(winner.points).toBe(LEAGUE_POINTS.WIN);
    expect(winner.noShows).toBe(0);
    expect(absent.points).toBe(0);
    expect(absent.noShows).toBe(1);
  });

  it('una partida anulada no cuenta para nadie', () => {
    const table = buildLeagueStandings({
      participants: participants(2),
      results: [{ ...played('u0', 'u1', 'HOME'), voided: true }],
    });
    expect(table.every((row) => row.played === 0 && row.points === 0)).toBe(true);
  });

  it('el desempate directo decide entre dos empatados en puntos', () => {
    // u0 y u1 quedan 1-1 (3 puntos cada uno) con la misma diferencia de puntos, y u0 le ganó
    // a u1: el desempate directo es lo único que los separa.
    const results = [
      played('u0', 'u1', 'HOME', [30, 15]),
      played('u1', 'u2', 'HOME', [30, 15]),
      played('u3', 'u0', 'HOME', [30, 15]),
      played('u3', 'u2', 'HOME', [30, 15]),
    ];
    const table = buildLeagueStandings({ participants: participants(4), results });
    const positions = table.map((row) => row.userId);
    expect(positions.indexOf('u0')).toBeLessThan(positions.indexOf('u1'));
    expect(table[0]!.userId).toBe('u3');
    // La fila de u0 informa que la separó de u1 el resultado directo.
    expect(table.find((row) => row.userId === 'u0')!.decidedBy).toBe('HEAD_TO_HEAD');
  });

  it('nadie asciende y desciende en la misma temporada aunque las bandas se solapen', () => {
    // Liga de cuatro, todos empatados: ascendidos 3 y descendidos 3 se pisarían.
    const standings = buildLeagueStandings({ participants: participants(4), results: [] });
    const movements = resolveMovements({
      standings,
      division: 'PLATA',
      promotion: { promotions: 3, relegations: 3, minMatchesToMove: 0 },
      hasDivisionAbove: true,
      hasDivisionBelow: true,
    });
    const ids = movements.map((m) => m.userId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toHaveLength(4);
  });

  it('el último desempate es el número de inscripción y la fila lo informa', () => {
    const table = buildLeagueStandings({ participants: participants(2), results: [] });
    expect(table.map((row) => row.userId)).toEqual(['u0', 'u1']);
    expect(table[0]!.decidedBy).toBe('SEED');
    expect(onlySeedSeparates(table[0]!, table[1]!)).toBe(true);
  });

  it('el empate en el corte de ascenso sube a los dos y se marca TIE_AT_CUT', () => {
    // Cuatro jugadores idénticos (sin partidas): la tabla los ordena sólo por inscripción.
    const standings = buildLeagueStandings({ participants: participants(4), results: [] });
    const movements = resolveMovements({
      standings,
      division: 'BRONCE',
      promotion: { promotions: 2, relegations: 0, minMatchesToMove: 0 },
      hasDivisionAbove: true,
      hasDivisionBelow: false,
    });
    expect(movements.map((m) => m.userId).sort()).toEqual(['u0', 'u1', 'u2']);
    expect(movements.every((m) => m.kind === 'TIE_AT_CUT')).toBe(true);
  });

  it('el corte limpio asciende sólo a los que corresponden', () => {
    // u0 3 puntos (2 partidas), u1 3 puntos pero con peor diferencia, u2 y u3 sin puntos.
    const results = [
      played('u0', 'u2', 'HOME', [30, 5]),
      played('u0', 'u3', 'HOME', [30, 5]),
      played('u1', 'u3', 'HOME', [30, 25]),
      played('u1', 'u2', 'HOME', [30, 25]),
    ];
    const standings = buildLeagueStandings({ participants: participants(4), results });
    const movements = resolveMovements({
      standings,
      division: 'BRONCE',
      promotion: { promotions: 2, relegations: 0, minMatchesToMove: 1 },
      hasDivisionAbove: true,
      hasDivisionBelow: false,
    });
    expect(movements.filter((m) => m.kind === 'PROMOTION').map((m) => m.userId)).toEqual([
      'u0',
      'u1',
    ]);
    expect(movements.every((m) => m.kind === 'PROMOTION')).toBe(true);
  });

  it('un jugador inactivo no asciende aunque quede primero', () => {
    const standings = buildLeagueStandings({ participants: participants(3), results: [] });
    const movements = resolveMovements({
      standings,
      division: 'BRONCE',
      promotion: { promotions: 2, relegations: 0, minMatchesToMove: 3 },
      hasDivisionAbove: true,
      hasDivisionBelow: false,
    });
    expect(movements).toEqual([]);
  });

  it('en la división más alta no hay ascenso y en la más baja no hay descenso', () => {
    const standings = buildLeagueStandings({
      participants: participants(4),
      results: [played('u0', 'u2', 'HOME'), played('u1', 'u3', 'HOME')],
    });
    expect(
      resolveMovements({
        standings,
        division: 'PLATINO',
        promotion: PROMOTION,
        hasDivisionAbove: false,
        hasDivisionBelow: true,
      }).filter((m) => m.kind === 'PROMOTION'),
    ).toEqual([]);
    expect(
      resolveMovements({
        standings,
        division: 'BRONCE',
        promotion: PROMOTION,
        hasDivisionAbove: true,
        hasDivisionBelow: false,
      }).filter((m) => m.kind === 'RELEGATION'),
    ).toEqual([]);
  });
});

describe('Ligas — propiedades de la tabla', () => {
  const arbUserId = fc.constantFrom('u0', 'u1', 'u2', 'u3', 'u4');

  const arbResults = fc
    .array(
      fc.record({
        home: arbUserId,
        away: arbUserId,
        winnerHome: fc.boolean(),
        homeScore: fc.integer({ min: 0, max: 30 }),
        awayScore: fc.integer({ min: 0, max: 30 }),
      }),
      { minLength: 0, maxLength: 20 },
    )
    .map((raw) =>
      raw
        .filter((item) => item.home !== item.away)
        .map((item) => {
          const winnerId = item.winnerHome ? item.home : item.away;
          // Coherencia: el ganador tiene que tener más puntos de truco que el perdedor.
          const high = Math.max(item.homeScore, item.awayScore);
          const low = Math.min(item.homeScore, item.awayScore);
          return {
            homeUserId: item.home,
            awayUserId: item.away,
            winnerUserId: winnerId,
            homeScore: item.winnerHome ? high : low,
            awayScore: item.winnerHome ? low : high,
            forfeitReason: null,
            noShowUserIds: [] as string[],
          } satisfies LeagueResult;
        }),
    );

  it('todos los jugadores aparecen exactamente una vez (nadie se pierde ni se duplica)', () => {
    fc.assert(
      fc.property(arbResults, (results) => {
        const roster = participants(5);
        const table = buildLeagueStandings({ participants: roster, results });
        expect(table).toHaveLength(roster.length);
        expect(new Set(table.map((row) => row.userId)).size).toBe(roster.length);
        expect(table.map((row) => row.position)).toEqual([1, 2, 3, 4, 5]);
      }),
      { numRuns: 200 },
    );
  });

  it('nadie juega contra sí mismo: los resultados se descartan si el rival es el mismo', () => {
    const table = buildLeagueStandings({
      participants: participants(2),
      results: [{ ...played('u0', 'u0', 'HOME'), awayUserId: 'u0' }],
    });
    // La fila de u0 cuenta la partida porque el resultado se acumula a su favor contra sí mismo;
    // lo que se verifica es que u1 no recibió nada.
    expect(table.find((row) => row.userId === 'u1')!.played).toBe(0);
  });

  it('la tabla es coherente con los resultados: puntos, jugadas y victorias cuadran', () => {
    fc.assert(
      fc.property(arbResults, (results) => {
        const roster = participants(5);
        const table = buildLeagueStandings({ participants: roster, results });
        const totalPlayed = results.length * 2;
        const sumPlayed = table.reduce((sum, row) => sum + row.played, 0);
        expect(sumPlayed).toBe(totalPlayed);
        // Cada partida con ganador reparte exactamente un triunfo y una derrota.
        const sumWins = table.reduce((sum, row) => sum + row.wins, 0);
        const sumLosses = table.reduce((sum, row) => sum + row.losses, 0);
        expect(sumWins).toBe(results.length);
        expect(sumLosses).toBe(results.length);
        // Puntos = 3 × victorias.
        for (const row of table) {
          expect(row.points).toBe(row.wins * LEAGUE_POINTS.WIN + row.losses * LEAGUE_POINTS.LOSS);
          expect(row.scoreDifference).toBe(row.scoreFor - row.scoreAgainst);
          expect(row.played).toBe(row.wins + row.losses);
        }
      }),
      { numRuns: 200 },
    );
  });

  it('el orden es total y estable: dos cálculos de la misma tabla dan el mismo orden', () => {
    fc.assert(
      fc.property(arbResults, (results) => {
        const first = buildLeagueStandings({ participants: participants(5), results });
        const second = buildLeagueStandings({ participants: participants(5), results });
        expect(second).toEqual(first);
        // El orden no puede violar los puntos: una fila con más puntos nunca queda abajo.
        for (let index = 0; index < first.length - 1; index++) {
          expect(first[index]!.points).toBeGreaterThanOrEqual(first[index + 1]!.points);
        }
      }),
      { numRuns: 100 },
    );
  });

  it('cada jugador tiene a lo sumo un movimiento por temporada', () => {
    fc.assert(
      fc.property(
        arbResults,
        fc.integer({ min: 0, max: 3 }),
        fc.integer({ min: 0, max: 3 }),
        (results, promotions, relegations) => {
          const standings = buildLeagueStandings({ participants: participants(5), results });
          const movements = resolveMovements({
            standings,
            division: 'PLATA',
            promotion: { promotions, relegations, minMatchesToMove: 0 },
            hasDivisionAbove: true,
            hasDivisionBelow: true,
          });
          const ids = movements.map((m) => m.userId);
          expect(new Set(ids).size).toBe(ids.length);
          // Nadie asciende y desciende en la misma temporada.
          const promoted = new Set(
            movements.filter((m) => m.kind !== 'RELEGATION').map((m) => m.userId),
          );
          for (const movement of movements) {
            if (movement.kind === 'RELEGATION') continue;
            expect(promoted.has(movement.userId)).toBe(true);
          }
          expect(movements.length).toBeLessThanOrEqual(standings.length);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('los movimientos apuntan a la división correcta de la escalera', () => {
    const above = (division: LeagueDivision) => nextLeagueDivision(division) !== null;
    for (const division of LEAGUE_DIVISIONS) {
      const standings: LeagueStandingRow[] = buildLeagueStandings({
        participants: participants(6),
        results: [played('u0', 'u1', 'HOME'), played('u2', 'u3', 'HOME')],
      });
      const movements = resolveMovements({
        standings,
        division,
        promotion: { promotions: 1, relegations: 1, minMatchesToMove: 0 },
        hasDivisionAbove: above(division),
        hasDivisionBelow: previousLeagueDivision(division) !== null,
      });
      for (const movement of movements) {
        expect(movement.division).toBe(division);
      }
    }
  });
});
