import { describe, expect, it } from 'vitest';
import { buildTournamentsRuntimeConfig } from '../tournaments/tournaments.config.js';
import { buildLeaguesRuntimeConfig } from '../leagues/leagues.config.js';

/**
 * Topes anti-abuso con sus **valores de producción**.
 *
 * El stack de pruebas y los E2E elevan estos límites a propósito (`apps/api/scripts/e2e-stack.ts`
 * los sube a 50/200/500, y las suites los suben en su propio `beforeAll`), porque una suite que
 * crea varios torneos seguidos desde la misma IP del runner chocaría con el tope y fallaría por
 * motivos que no son del producto. Consecuencia: **ningún test estaba cubriendo los valores
 * reales**. Si alguien cambiara el defecto a 500 o lo dejara en `undefined`, todo habría seguido
 * en verde.
 *
 * Este archivo verifica los números que sí rigen en producción y, además, que las variables de
 * entorno mandan sobre el defecto y que un valor inválido **no** se acepta silenciosamente.
 */

/** Entorno limpio: las variables del runner no deben contaminar este archivo. */
function withoutEnv<T>(names: readonly string[], action: () => T): T {
  const saved = new Map(names.map((name) => [name, process.env[name]]));
  for (const name of names) delete process.env[name];
  try {
    return action();
  } finally {
    for (const [name, value] of saved) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

const TOURNAMENT_ENV = [
  'TOURNAMENTS_MAX_ACTIVE_PRIVATE',
  'TOURNAMENTS_CREATE_PER_ACCOUNT',
  'TOURNAMENTS_CREATE_PER_IP',
  'TOURNAMENTS_REGISTER_PER_ACCOUNT',
  'TOURNAMENTS_MAX_PRIZE_COINS',
] as const;

const LEAGUE_ENV = [
  'LEAGUES_MAX_ACTIVE_PER_CREATOR',
  'LEAGUES_CREATE_PER_ACCOUNT',
  'LEAGUES_CREATE_PER_IP',
  'LEAGUES_JOIN_PER_ACCOUNT',
  'LEAGUES_RESCHEDULE_PER_ACCOUNT',
  'LEAGUES_MAX_PRIZE_COINS',
  'LEAGUES_MAX_ROOMS_PER_SWEEP',
] as const;

describe('Topes anti-abuso con valores de producción', () => {
  it('torneos: los topes reales son los que el producto aplica', () => {
    withoutEnv(TOURNAMENT_ENV, () => {
      const config = buildTournamentsRuntimeConfig();
      // Cada número, con su justificación de producto.
      expect({
        maxActivePrivatePerCreator: config.maxActivePrivatePerCreator,
        createPerAccountMax: config.createPerAccountMax,
        createPerIpMax: config.createPerIpMax,
        registerPerAccountMax: config.registerPerAccountMax,
        maxTotalPrizeCoins: config.maxTotalPrizeCoins,
        rateLimitWindowMs: config.rateLimitWindowMs,
      }).toEqual({
        // Una cuenta no puede acumular torneos privados activos: tres es lo que una persona
        // puede seguir a la vez sin convertir la creación en una vía de spam.
        maxActivePrivatePerCreator: 3,
        // Cinco torneos por hora por cuenta, diez por IP (más amplio por las redes compartidas).
        createPerAccountMax: 5,
        createPerIpMax: 10,
        // Veinte inscripciones por hora: alcanza para varios torneos legítimos y corta el scrapeo.
        registerPerAccountMax: 20,
        // Tope de monedas virtuales que un torneo puede repartir: 5 000.
        maxTotalPrizeCoins: 5_000,
        rateLimitWindowMs: 60 * 60 * 1000,
      });
    });
  });

  it('torneos: los valores de producción son más bajos que los que eleva el stack de pruebas', () => {
    withoutEnv(TOURNAMENT_ENV, () => {
      const production = buildTournamentsRuntimeConfig();
      // Los mismos números que fija `apps/api/scripts/e2e-stack.ts`.
      expect(production.maxActivePrivatePerCreator).toBeLessThan(50);
      expect(production.createPerAccountMax).toBeLessThan(200);
      expect(production.createPerIpMax).toBeLessThan(500);
      expect(production.registerPerAccountMax).toBeLessThan(200);
    });
  });

  it('torneos: la variable de entorno manda sobre el defecto', () => {
    withoutEnv(TOURNAMENT_ENV, () => {
      process.env['TOURNAMENTS_MAX_ACTIVE_PRIVATE'] = '7';
      process.env['TOURNAMENTS_CREATE_PER_IP'] = '3';
      const config = buildTournamentsRuntimeConfig();
      expect(config.maxActivePrivatePerCreator).toBe(7);
      expect(config.createPerIpMax).toBe(3);
    });
  });

  it('torneos: un valor inválido cae al defecto, no a cero ni a infinito', () => {
    withoutEnv(TOURNAMENT_ENV, () => {
      for (const invalid of ['0', '-5', 'no-es-un-numero', '']) {
        process.env['TOURNAMENTS_CREATE_PER_ACCOUNT'] = invalid;
        const config = buildTournamentsRuntimeConfig();
        // Un tope de 0 bloquearía a todos; uno infinito no protegería nada.
        expect(config.createPerAccountMax).toBe(5);
      }
    });
  });

  it('ligas: los topes reales son los que el producto aplica', () => {
    withoutEnv(LEAGUE_ENV, () => {
      const config = buildLeaguesRuntimeConfig();
      expect({
        maxActivePerCreator: config.maxActivePerCreator,
        createPerAccountMax: config.createPerAccountMax,
        createPerIpMax: config.createPerIpMax,
        joinPerAccountMax: config.joinPerAccountMax,
        reschedulePerAccountMax: config.reschedulePerAccountMax,
        maxTotalPrizeCoins: config.maxTotalPrizeCoins,
        maxRoomsPerSweep: config.maxRoomsPerSweep,
      }).toEqual({
        maxActivePerCreator: 3,
        createPerAccountMax: 5,
        createPerIpMax: 10,
        joinPerAccountMax: 30,
        reschedulePerAccountMax: 10,
        maxTotalPrizeCoins: 20_000,
        // Una jornada de 200 jugadores son 100 partidas: se aprovisionan por tandas de 50 por
        // ciclo para no abrir cien salas de golpe.
        maxRoomsPerSweep: 50,
      });
    });
  });

  it('ligas: la reprogramación por cuenta es más amplia que la de una sola partida', () => {
    withoutEnv(LEAGUE_ENV, () => {
      const config = buildLeaguesRuntimeConfig();
      // La regla de la liga admite hasta 5 por partida; el tope por cuenta no puede ser menor,
      // o una sola partida usada al máximo agotaría el cupo de la persona.
      expect(config.reschedulePerAccountMax).toBeGreaterThanOrEqual(5);
    });
  });

  it('ningún tope es cero ni negativo: un tope así bloquearía el producto', () => {
    withoutEnv([...TOURNAMENT_ENV, ...LEAGUE_ENV], () => {
      const tournaments = buildTournamentsRuntimeConfig();
      const leagues = buildLeaguesRuntimeConfig();
      const numbers = [
        tournaments.maxActivePrivatePerCreator,
        tournaments.createPerAccountMax,
        tournaments.createPerIpMax,
        tournaments.registerPerAccountMax,
        tournaments.maxTotalPrizeCoins,
        leagues.maxActivePerCreator,
        leagues.createPerAccountMax,
        leagues.createPerIpMax,
        leagues.joinPerAccountMax,
        leagues.reschedulePerAccountMax,
        leagues.maxTotalPrizeCoins,
        leagues.maxRoomsPerSweep,
      ];
      for (const value of numbers) {
        expect(value).toBeGreaterThan(0);
        expect(Number.isInteger(value)).toBe(true);
      }
    });
  });
});
