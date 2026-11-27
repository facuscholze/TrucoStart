import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { buildSchedule, pairRound, roundsForParticipants } from '../league-schedule.js';

const START = new Date('2027-01-04T12:00:00.000Z');
const END = new Date('2027-03-01T12:00:00.000Z');

function ids(count: number): string[] {
  return Array.from({ length: count }, (_, index) => `p${index}`);
}

describe('Ligas — emparejamiento de una jornada', () => {
  it('con dos jugadores arma un solo cruce, y la revancha invierte la localía', () => {
    const homeCounts = new Map<string, number>();
    const first = pairRound(['a', 'b'], 0, homeCounts);
    const second = pairRound(['a', 'b'], 1, homeCounts);
    expect(first).toEqual([{ homeUserId: 'a', awayUserId: 'b' }]);
    // La localía se balancea: `b` todavía no fue local, así que la revancha es suya.
    expect(second).toEqual([{ homeUserId: 'b', awayUserId: 'a' }]);
  });

  it('con un número impar de jugadores, uno descansa por jornada', () => {
    for (let index = 0; index < 5; index++) {
      const pairs = pairRound(ids(5), index);
      const playing = new Set(pairs.flatMap((pair) => [pair.homeUserId, pair.awayUserId]));
      expect(pairs).toHaveLength(2);
      expect(playing.size).toBe(4);
    }
  });

  it('en una vuelta completa todos juegan contra todos una vez', () => {
    for (const count of [2, 3, 4, 5, 6, 7, 8, 9, 12, 15]) {
      const seen = new Set<string>();
      const rounds = roundsForParticipants(count);
      for (let index = 0; index < rounds; index++) {
        for (const pair of pairRound(ids(count), index)) {
          const key = [pair.homeUserId, pair.awayUserId].sort().join('|');
          expect(seen.has(key)).toBe(false);
          seen.add(key);
        }
      }
      expect(seen.size).toBe((count * (count - 1)) / 2);
    }
  });

  it('nadie juega contra sí mismo ni aparece dos veces en la misma jornada', () => {
    for (const count of [2, 3, 5, 6, 8, 11]) {
      for (let index = 0; index < roundsForParticipants(count); index++) {
        const pairs = pairRound(ids(count), index);
        const seats = pairs.flatMap((pair) => [pair.homeUserId, pair.awayUserId]);
        expect(new Set(seats).size).toBe(seats.length);
        for (const pair of pairs) {
          expect(pair.homeUserId).not.toBe(pair.awayUserId);
        }
      }
    }
  });

  it('la localía se balancea: nadie queda sin ser local y la diferencia es a lo sumo 1', () => {
    // Con dos jugadores y una sola jornada (la vuelta completa son una partida) uno tiene que
    // ser local y el otro visitante: la propiedad se mide desde tres jugadores.
    for (const count of [3, 4, 5, 6, 7, 8, 9]) {
      const homeCounts = new Map<string, number>();
      for (let index = 0; index < roundsForParticipants(count); index++) {
        pairRound(ids(count), index, homeCounts);
      }
      const homes = ids(count).map((id) => homeCounts.get(id) ?? 0);
      for (const id of ids(count)) {
        expect(homeCounts.get(id) ?? 0).toBeGreaterThan(0);
      }
      expect(Math.max(...homes) - Math.min(...homes)).toBeLessThanOrEqual(1);
    }
  });

  it('cada jugador es local al menos una vez en la temporada (con 4 o más)', () => {
    for (const count of [4, 6, 8]) {
      const homeCount = new Map<string, number>();
      const homeCounts = new Map<string, number>();
      for (let index = 0; index < roundsForParticipants(count); index++) {
        for (const pair of pairRound(ids(count), index, homeCounts)) {
          homeCount.set(pair.homeUserId, (homeCount.get(pair.homeUserId) ?? 0) + 1);
        }
      }
      for (const id of ids(count)) {
        expect(homeCount.get(id) ?? 0).toBeGreaterThan(0);
      }
    }
  });
});

describe('Ligas — calendario', () => {
  it('en ROUNDS arma una jornada por semana con su ventana', () => {
    const rounds = buildSchedule({
      participantIds: ids(4),
      format: 'ROUNDS',
      rounds: 3,
      firstRoundStartsAt: START,
      daysBetweenRounds: 7,
      roundWindowHours: 48,
      endsAt: END,
    });
    expect(rounds.map((round) => round.number)).toEqual([1, 2, 3]);
    expect(rounds[0]!.deadlineAt.getTime() - rounds[0]!.startsAt.getTime()).toBe(48 * 3_600_000);
    expect(rounds[1]!.startsAt.getTime() - rounds[0]!.startsAt.getTime()).toBe(7 * 86_400_000);
  });

  it('ninguna ventana se pasa del fin de la temporada', () => {
    const nearEnd = new Date(END.getTime() - 3_600_000);
    const rounds = buildSchedule({
      participantIds: ids(4),
      format: 'ROUNDS',
      rounds: 2,
      firstRoundStartsAt: nearEnd,
      daysBetweenRounds: 7,
      roundWindowHours: 72,
      endsAt: END,
    });
    for (const round of rounds) {
      expect(round.deadlineAt.getTime()).toBeLessThanOrEqual(END.getTime());
      expect(round.deadlineAt.getTime()).toBeGreaterThan(round.startsAt.getTime());
    }
  });

  it('en WINDOW arma una sola jornada con todos los cruces y la ventana de la temporada', () => {
    const rounds = buildSchedule({
      participantIds: ids(5),
      format: 'WINDOW',
      rounds: 1,
      firstRoundStartsAt: START,
      daysBetweenRounds: 7,
      roundWindowHours: 72,
      endsAt: END,
    });
    expect(rounds).toHaveLength(1);
    expect(rounds[0]!.deadlineAt).toEqual(END);
    // Cinco jugadores: diez cruces distintos.
    expect(rounds[0]!.pairs).toHaveLength(10);
    const pairs = rounds[0]!.pairs.map((pair) =>
      [pair.homeUserId, pair.awayUserId].sort().join('|'),
    );
    expect(new Set(pairs).size).toBe(10);
  });

  it('con menos de dos jugadores no hay calendario', () => {
    expect(
      buildSchedule({
        participantIds: ['solo'],
        format: 'ROUNDS',
        rounds: 3,
        firstRoundStartsAt: START,
        daysBetweenRounds: 7,
        roundWindowHours: 48,
        endsAt: END,
      }),
    ).toEqual([]);
  });
});

describe('Ligas — propiedades del calendario', () => {
  it('todos los participantes quedan colocados y ninguno juega contra sí mismo', () => {
    fc.assert(
      fc.property(fc.integer({ min: 2, max: 20 }), (count) => {
        const roster = ids(count);
        const rosterSet = new Set(roster);
        const placed = new Set<string>();
        const rivals = new Map<string, Set<string>>();
        for (let index = 0; index < roundsForParticipants(count); index++) {
          for (const pair of pairRound(roster, index)) {
            // Nadie contra sí mismo y nadie fuera del plantel.
            expect(pair.homeUserId).not.toBe(pair.awayUserId);
            expect(rosterSet.has(pair.homeUserId)).toBe(true);
            expect(rosterSet.has(pair.awayUserId)).toBe(true);
            placed.add(pair.homeUserId);
            placed.add(pair.awayUserId);
            const homeRivals = rivals.get(pair.homeUserId) ?? new Set<string>();
            homeRivals.add(pair.awayUserId);
            rivals.set(pair.homeUserId, homeRivals);
            const awayRivals = rivals.get(pair.awayUserId) ?? new Set<string>();
            awayRivals.add(pair.homeUserId);
            rivals.set(pair.awayUserId, awayRivals);
          }
        }
        // Todos aparecen, y cada uno enfrenta exactamente a los otros una vez.
        expect(placed.size).toBe(count);
        for (const id of roster) {
          expect(rivals.get(id)?.size).toBe(count - 1);
        }
      }),
      { numRuns: 60 },
    );
  });

  it('un calendario de ROUNDS nunca solapa dos jornadas del mismo jugador en el mismo instante', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 12 }),
        fc.integer({ min: 1, max: 6 }),
        (count, rounds) => {
          const schedule = buildSchedule({
            participantIds: ids(count),
            format: 'ROUNDS',
            rounds,
            firstRoundStartsAt: START,
            daysBetweenRounds: 7,
            roundWindowHours: 48,
            endsAt: END,
          });
          expect(schedule).toHaveLength(rounds);
          // Las ventanas están ordenadas y no se pisan (48 h de ventana contra 7 días de
          // separación).
          for (let index = 1; index < schedule.length; index++) {
            expect(schedule[index]!.startsAt.getTime()).toBeGreaterThan(
              schedule[index - 1]!.deadlineAt.getTime(),
            );
          }
        },
      ),
      { numRuns: 40 },
    );
  });
});
