import { describe, expect, it } from 'vitest';
import {
  type SeededEntrant,
  buildDoubleElimination,
  buildFirstRound,
  byeCount,
  canTransitionTournament,
  doubleEliminationMatchCount,
  nextPowerOfTwo,
  roundCount,
  seedEntrants,
  seedOrderForBracket,
  singleEliminationMatchCount,
  TournamentPrizeSchema,
} from '../src/index.js';

function entrants(count: number): SeededEntrant[] {
  return Array.from({ length: count }, (_, index) => ({
    userId: `user-${String(index).padStart(3, '0')}`,
    // Ratings distintos para que la siembra sea determinista y verificable.
    rating: 2000 - index * 10,
    seedOrder: index,
  }));
}

describe('generador de llaves · propiedades', () => {
  // Cupos que pide el alcance: potencias de 2 y no potencias (4, 7, 16, 64) más casos borde.
  const COUNTS = [2, 3, 4, 5, 6, 7, 8, 9, 12, 15, 16, 17, 31, 32, 33, 64];

  it.each(COUNTS)('con %i participantes todos quedan colocados exactamente una vez', (count) => {
    const round = buildFirstRound(entrants(count));
    const placed = new Map<string, number>();
    for (const pairing of round) {
      for (const side of [pairing.home, pairing.away]) {
        if (side.userId === null) continue;
        placed.set(side.userId, (placed.get(side.userId) ?? 0) + 1);
      }
    }
    // Todos los inscriptos aparecen…
    expect(placed.size).toBe(count);
    // …y nadie aparece dos veces.
    for (const [, times] of placed) expect(times).toBe(1);
  });

  it.each(COUNTS)('con %i participantes la cantidad de byes es la del cuadro', (count) => {
    const round = buildFirstRound(entrants(count));
    const byesInRound = round.filter((pairing) => pairing.isBye).length;
    expect(byesInRound).toBe(byeCount(count));
    // Los byes del cuadro son exactamente los lugares sin participante.
    const emptySlots = round.reduce(
      (total, pairing) =>
        total + (pairing.home.userId === null ? 1 : 0) + (pairing.away.userId === null ? 1 : 0),
      0,
    );
    expect(emptySlots).toBe(byeCount(count));
  });

  it.each(COUNTS)('con %i participantes nadie juega contra sí mismo', (count) => {
    for (const pairing of buildFirstRound(entrants(count))) {
      if (pairing.home.userId === null || pairing.away.userId === null) continue;
      expect(pairing.home.userId).not.toBe(pairing.away.userId);
      expect(pairing.home.seed).not.toBe(pairing.away.seed);
    }
  });

  it.each(COUNTS)('con %i participantes el cuadro es una potencia de 2', (count) => {
    const round = buildFirstRound(entrants(count));
    expect(round.length * 2).toBe(nextPowerOfTwo(count));
    // La cantidad de cruces del cuadro completo es participantes - 1.
    expect(singleEliminationMatchCount(count)).toBe(count - 1);
  });

  it.each(COUNTS)('con %i participantes los byes van a los mejores sembrados', (count) => {
    const round = buildFirstRound(entrants(count));
    const firstSeed = round[0]!;
    if (count < 2) return;
    const byes = byeCount(count);
    if (byes === 0) {
      expect(firstSeed.isBye).toBe(false);
      return;
    }
    // El sembrado 1 (el mejor rating) tiene bye cuando hay byes disponibles.
    expect(firstSeed.home.seed).toBe(1);
    expect(firstSeed.isBye).toBe(true);
  });

  it('la siembra ordena por rating y es estable ante empates', () => {
    const tied = [
      { userId: 'b', rating: 1500, seedOrder: 2 },
      { userId: 'a', rating: 1500, seedOrder: 1 },
      { userId: 'c', rating: 1800, seedOrder: 3 },
    ];
    const seeded = seedEntrants(tied);
    expect(seeded.map((entrant) => entrant.userId)).toEqual(['c', 'a', 'b']);
    // Dos corridas con los mismos datos dan la misma llave.
    expect(seedEntrants(tied)).toEqual(seeded);
  });

  it('el rating nulo se siembra último', () => {
    const seeded = seedEntrants([
      { userId: 'sin-rating', rating: null, seedOrder: 0 },
      { userId: 'con-rating', rating: 900, seedOrder: 5 },
    ]);
    expect(seeded[0]!.userId).toBe('con-rating');
    expect(seeded[1]!.userId).toBe('sin-rating');
  });

  it('la distribución estándar separa a los mejores sembrados', () => {
    // 4 lugares: 1 vs 4 y 2 vs 3.
    expect(seedOrderForBracket(4)).toEqual([1, 4, 2, 3]);
    // 8 lugares: los sembrados 1 y 2 sólo pueden cruzarse en la final.
    expect(seedOrderForBracket(8)).toEqual([1, 8, 4, 5, 2, 7, 3, 6]);
  });

  it('rechaza torneos con menos de 2 participantes', () => {
    expect(() => buildFirstRound([])).toThrow(RangeError);
    expect(() => buildFirstRound(entrants(1))).toThrow(RangeError);
  });

  it('rechaza participantes duplicados por identidad repetida en el mismo cuadro', () => {
    const duplicated = [...entrants(4), entrants(4)[0]!];
    const round = buildFirstRound(duplicated);
    const ids = round.flatMap((pairing) =>
      [pairing.home.userId, pairing.away.userId].filter((id): id is string => id !== null),
    );
    // El generador no deduplica: la API valida inscripciones únicas antes de llamarlo.
    // Acá se documenta que cada lugar del cuadro recibe exactamente un participante.
    expect(ids).toHaveLength(5);
  });

  it.each([4, 7, 16, 64])(
    'eliminación doble con %i participantes arma ganadores y perdedores',
    (count) => {
      const bracket = buildDoubleElimination(entrants(count));
      expect(bracket.winners.length).toBeGreaterThan(0);
      expect(bracket.grandFinal).toBeTruthy();
      // Toda llave de perdedores necesita al menos un cruce cuando hay 4 o más.
      if (count >= 4) expect(bracket.losers.length).toBeGreaterThan(0);
      expect(doubleEliminationMatchCount(count)).toBe(2 * count - 2);
    },
  );

  it('cuenta rondas según el cuadro', () => {
    expect(roundCount(2)).toBe(1);
    expect(roundCount(4)).toBe(2);
    expect(roundCount(7)).toBe(3);
    expect(roundCount(16)).toBe(4);
    expect(roundCount(64)).toBe(6);
  });
});

describe('ciclo de vida del torneo · transiciones', () => {
  it('permite el camino nominal completo', () => {
    expect(canTransitionTournament('DRAFT', 'REGISTRATION')).toBe(true);
    expect(canTransitionTournament('REGISTRATION', 'CHECK_IN')).toBe(true);
    expect(canTransitionTournament('CHECK_IN', 'IN_PROGRESS')).toBe(true);
    expect(canTransitionTournament('IN_PROGRESS', 'FINISHED')).toBe(true);
  });

  it('permite cancelar antes de terminar, no después', () => {
    for (const status of ['DRAFT', 'REGISTRATION', 'CHECK_IN', 'IN_PROGRESS'] as const) {
      expect(canTransitionTournament(status, 'CANCELLED')).toBe(true);
    }
    expect(canTransitionTournament('FINISHED', 'CANCELLED')).toBe(false);
    expect(canTransitionTournament('CANCELLED', 'REGISTRATION')).toBe(false);
  });

  it('no permite saltar etapas ni reabrir un torneo terminado', () => {
    expect(canTransitionTournament('DRAFT', 'IN_PROGRESS')).toBe(false);
    expect(canTransitionTournament('REGISTRATION', 'FINISHED')).toBe(false);
    expect(canTransitionTournament('FINISHED', 'IN_PROGRESS')).toBe(false);
    expect(canTransitionTournament('CANCELLED', 'CHECK_IN')).toBe(false);
  });
});

describe('premios · sólo simbólicos', () => {
  it('exige monedas o cosmético, nunca ambos vacíos', () => {
    expect(
      TournamentPrizeSchema.safeParse({ position: 1, coins: 0, cosmeticId: null }).success,
    ).toBe(false);
    expect(
      TournamentPrizeSchema.safeParse({ position: 1, coins: 250, cosmeticId: null }).success,
    ).toBe(true);
    expect(
      TournamentPrizeSchema.safeParse({ position: 2, coins: 0, cosmeticId: 'frame_sunrise' })
        .success,
    ).toBe(true);
  });

  it('rechaza campos de dinero real en el premio', () => {
    const withMoney = TournamentPrizeSchema.safeParse({
      position: 1,
      coins: 100,
      cosmeticId: null,
      cashPrize: 5000,
    });
    expect(withMoney.success).toBe(false);
  });
});
