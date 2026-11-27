import { describe, expect, it } from 'vitest';
import { GameModeSchema } from '../src/ws/client-events.schema.js';
import {
  COMPETITIVE_MODES,
  CompetitiveModeSchema,
  isCompetitiveMode,
  isTournamentMode,
  SEATS_BY_MODE,
  seatsForMode,
  TEAMS_BY_MODE,
  teamCountForMode,
  teamForSeat,
  TOURNAMENT_MODES,
} from '../src/lobby/game-mode.js';

/**
 * La geometría de las mesas es la única fuente de verdad para API, game-server y web. Estos
 * tests fijan el contrato que sostiene el truco de 6: seis asientos, tres equipos de dos y el
 * compañero enfrentado, más la separación entre modos sociales y modos que puntúan.
 */

describe('seatsForMode', () => {
  it('devuelve 2, 4 y 6 asientos para 1v1, 2v2 y 3v3', () => {
    expect(seatsForMode('1v1')).toBe(2);
    expect(seatsForMode('2v2')).toBe(4);
    expect(seatsForMode('3v3')).toBe(6);
  });

  it('coincide con la tabla exportada para todos los modos', () => {
    for (const mode of GameModeSchema.options) {
      expect(seatsForMode(mode)).toBe(SEATS_BY_MODE[mode]);
    }
  });

  it('siempre tiene asientos pares: no hay mesas con un jugador sin compañero ni equipo impar', () => {
    for (const mode of GameModeSchema.options) {
      expect(seatsForMode(mode) % 2).toBe(0);
    }
  });
});

describe('teamCountForMode', () => {
  it('devuelve 2, 2 y 3 equipos para 1v1, 2v2 y 3v3', () => {
    expect(teamCountForMode('1v1')).toBe(2);
    expect(teamCountForMode('2v2')).toBe(2);
    expect(teamCountForMode('3v3')).toBe(3);
  });

  it('coincide con la tabla exportada para todos los modos', () => {
    for (const mode of GameModeSchema.options) {
      expect(teamCountForMode(mode)).toBe(TEAMS_BY_MODE[mode]);
    }
  });

  it('cada equipo tiene exactamente dos integrantes en 2v2 y 3v3', () => {
    for (const mode of ['2v2', '3v3'] as const) {
      expect(seatsForMode(mode) / teamCountForMode(mode)).toBe(2);
    }
  });
});

describe('teamForSeat', () => {
  it('reparte las mesas de seis como 0,1,2,0,1,2', () => {
    const seats = [0, 1, 2, 3, 4, 5].map((seat) => teamForSeat('3v3', seat));
    expect(seats).toEqual([0, 1, 2, 0, 1, 2]);
  });

  it('deja al compañero enfrentado en 3v3: 0-3, 1-4 y 2-5', () => {
    for (let seat = 0; seat < 3; seat++) {
      expect(teamForSeat('3v3', seat)).toBe(teamForSeat('3v3', seat + 3));
      expect(teamForSeat('3v3', seat)).toBe(seat);
    }
  });

  it('mantiene el reparto histórico de 1v1 y 2v2', () => {
    expect([0, 1].map((seat) => teamForSeat('1v1', seat))).toEqual([0, 1]);
    expect([0, 1, 2, 3].map((seat) => teamForSeat('2v2', seat))).toEqual([0, 1, 0, 1]);
  });

  it('nunca devuelve un equipo fuera del rango del modo', () => {
    for (const mode of GameModeSchema.options) {
      for (let seat = 0; seat < seatsForMode(mode); seat++) {
        const team = teamForSeat(mode, seat);
        expect(team).toBeGreaterThanOrEqual(0);
        expect(team).toBeLessThan(teamCountForMode(mode));
      }
    }
  });

  it('reparte todos los equipos con la misma cantidad de asientos', () => {
    for (const mode of GameModeSchema.options) {
      const counts = new Map<number, number>();
      for (let seat = 0; seat < seatsForMode(mode); seat++) {
        const team = teamForSeat(mode, seat);
        counts.set(team, (counts.get(team) ?? 0) + 1);
      }
      expect(counts.size).toBe(teamCountForMode(mode));
      expect(
        [...counts.values()].every((count) => count === seatsForMode(mode) / counts.size),
      ).toBe(true);
    }
  });
});

describe('modos competitivos', () => {
  it('el truco de 6 nace fuera del ranking', () => {
    expect(COMPETITIVE_MODES).toEqual(['1v1', '2v2']);
    expect(isCompetitiveMode('3v3')).toBe(false);
    expect(isCompetitiveMode('1v1')).toBe(true);
    expect(isCompetitiveMode('2v2')).toBe(true);
  });

  it('el esquema de ranking rechaza 3v3', () => {
    // Pedir el ranking de un modo social tiene que ser un error de validación, no un
    // listado vacío que sugiera que el modo compite.
    expect(CompetitiveModeSchema.safeParse('3v3').success).toBe(false);
    expect(CompetitiveModeSchema.safeParse('2v2').success).toBe(true);
    expect(CompetitiveModeSchema.options).toEqual([...COMPETITIVE_MODES]);
  });

  it('los modos de torneo tampoco incluyen el truco de 6', () => {
    expect(TOURNAMENT_MODES).toEqual(['1v1', '2v2']);
    expect(isTournamentMode('3v3')).toBe(false);
  });

  it('el modo social es un GameMode válido: la separación es de ranking, no de contrato', () => {
    // `3v3` se puede crear, jugar y guardar en el historial; lo que no puede es puntuar.
    expect(GameModeSchema.safeParse('3v3').success).toBe(true);
    expect(
      COMPETITIVE_MODES.every((mode) => (GameModeSchema.options as string[]).includes(mode)),
    ).toBe(true);
  });
});
