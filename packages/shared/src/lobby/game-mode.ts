import { z } from 'zod';
import type { GameMode } from '../ws/client-events.schema.js';

/**
 * Geometría de las mesas por modo. Es la única fuente de verdad para API, game-server y web:
 * antes cada capa repetía `mode === '2v2' ? 4 : 2` y `seat % 2`, lo que hacía imposible sumar
 * modos sin desincronizarse.
 *
 * - `1v1`: 2 asientos, 2 equipos de 1.
 * - `2v2`: 4 asientos, 2 equipos de 2 (compañero enfrentado: 0-2 y 1-3).
 * - `3v3`: 6 asientos, 3 equipos de 2 (compañero enfrentado: 0-3, 1-4 y 2-5), de modo que el
 *   orden de turnos alterna equipos 0, 1, 2, 0, 1, 2.
 */
export const SEATS_BY_MODE: Readonly<Record<GameMode, number>> = Object.freeze({
  '1v1': 2,
  '2v2': 4,
  '3v3': 6,
});

export const TEAMS_BY_MODE: Readonly<Record<GameMode, number>> = Object.freeze({
  '1v1': 2,
  '2v2': 2,
  '3v3': 3,
});

/** Cantidad de asientos de una mesa del modo indicado. */
export function seatsForMode(mode: GameMode): number {
  return SEATS_BY_MODE[mode];
}

/** Cantidad de equipos del modo indicado. */
export function teamCountForMode(mode: GameMode): number {
  return TEAMS_BY_MODE[mode];
}

/**
 * Equipo de un asiento. Con `seat % equipos` el compañero queda enfrentado en todos los modos y,
 * en `3v3`, los turnos alternan los tres equipos.
 */
export function teamForSeat(mode: GameMode, seat: number): number {
  return seat % teamCountForMode(mode);
}

/**
 * Modos que suman al ranking competitivo. El truco de 6 (`3v3`) nace **fuera** del ranking: son
 * partidas sociales, sin rating, sin torneos y sin ligas (ver ADR-033). Los contadores de
 * estadísticas sí los registran.
 */
export const COMPETITIVE_MODES = ['1v1', '2v2'] as const satisfies readonly GameMode[];

/**
 * Esquema de los modos que puntúan. `LeaderboardQuerySchema` y cualquier contrato de ranking
 * lo usan para que pedir el ranking de `3v3` sea un error de validación y no un listado vacío
 * que sugiera que el modo sí compite.
 */
export const CompetitiveModeSchema = z.enum(['1v1', '2v2']);
export type CompetitiveMode = z.infer<typeof CompetitiveModeSchema>;

export function isCompetitiveMode(mode: GameMode): boolean {
  return (COMPETITIVE_MODES as readonly string[]).includes(mode);
}

/** Modos que pueden disputar torneos en esta etapa (los equipos de torneo son de 2). */
export const TOURNAMENT_MODES = ['1v1', '2v2'] as const satisfies readonly GameMode[];

export function isTournamentMode(mode: GameMode): boolean {
  return (TOURNAMENT_MODES as readonly string[]).includes(mode);
}
