import { seatsForMode, type TournamentMode } from '@truco/shared';

/**
 * Reglas de equipos para torneos 2v2 (M10a).
 *
 * Son funciones puras: no tocan la base ni el reloj, así se pueden probar exhaustivamente
 * y son la única fuente de verdad para el servicio. La documentación de cada decisión
 * está en `docs/RULES.md` § Torneos con equipos.
 */

/** Integrantes necesarios por equipo según el modo del torneo. */
export const TEAM_SIZE: Record<TournamentMode, number> = { '1v1': 1, '2v2': 2 };

/**
 * Asientos por modo en la mesa real. Se toman de `@truco/shared` para que la mesa del torneo y
 * la mesa del lobby no puedan divergir (1v1→2, 2v2→4).
 */
export const SEATS_PER_MODE: Record<TournamentMode, number> = {
  '1v1': seatsForMode('1v1'),
  '2v2': seatsForMode('2v2'),
};

/** Un integrante del equipo con su asistencia. */
export interface TeamMemberState {
  readonly userId: string;
  /** `CHECKED_IN` cuando se presentó al check-in del torneo. */
  readonly checkedIn: boolean;
}

export type TeamPresence =
  /** Todos los integrantes se presentaron: el equipo puede jugar. */
  | { readonly kind: 'COMPLETE' }
  /** Nadie se presentó: no hay equipo. */
  | { readonly kind: 'ABSENT' }
  /** Alguno falta: no se puede completar la mesa. Ver `teamForfeitOutcome`. */
  | { readonly kind: 'INCOMPLETE'; readonly missing: readonly string[] };

/**
 * Estado de asistencia de un equipo en el check-in del torneo.
 *
 * Regla documentada: un equipo 2v2 sólo entra al cuadro con sus dos integrantes. Un solo
 * jugador no puede ocupar una mesa de cuatro asientos, y hacerlo ganar por walkover sería
 * regalarle el torneo a quien no completó su equipo.
 */
export function teamPresence(
  members: readonly TeamMemberState[],
  mode: TournamentMode,
): TeamPresence {
  const required = TEAM_SIZE[mode] ?? 1;
  const present = members.filter((member) => member.checkedIn);
  if (present.length >= required) return { kind: 'COMPLETE' };
  if (present.length === 0) return { kind: 'ABSENT' };
  return {
    kind: 'INCOMPLETE',
    missing: members.filter((member) => !member.checkedIn).map((member) => member.userId),
  };
}

/** Qué lado gana un cruce definido por incomparecencia (`BOTH` = sin ganador). */
export type WalkoverWinner = 'HOME' | 'AWAY' | 'BOTH' | 'NONE';

/**
 * Define un cruce por incomparecencia a partir de la asistencia de cada lado.
 *
 * - Los dos lados completos ⇒ `NONE`: hay que jugarlo, no se define por escritorio.
 * - Un lado completo y el otro no ⇒ gana el completo (el rival no se presentó).
 * - Los dos lados incompletos o ausentes ⇒ `BOTH`: el cruce se cierra sin ganador.
 *   No se elige "el que tenía más gente": un cruce de 2v2 con un solo jugador de cada
 *   lado no es una partida, y adjudicarlo sería inventar un resultado.
 */
export function walkoverWinner(home: TeamPresence, away: TeamPresence): WalkoverWinner {
  const homeReady = home.kind === 'COMPLETE';
  const awayReady = away.kind === 'COMPLETE';
  if (homeReady && awayReady) return 'NONE';
  // El que se presenta completo gana; el otro no completó la mesa.
  if (homeReady) return 'HOME';
  if (awayReady) return 'AWAY';
  return 'BOTH';
}

/**
 * Qué pasa si un integrante abandona **durante** la partida.
 *
 * Regla documentada: el equipo sigue jugando mientras le quede un integrante activo
 * (la mesa lo resuelve el motor: el asiento pasa a `foldedSeats`). El torneo no cierra
 * el cruce por eso. Sólo si se van todos los integrantes el equipo pierde el cruce, y
 * eso lo reporta el motor al terminar la partida, no una decisión del torneo.
 *
 * Esta función existe para que la decisión sea explícita y testeable: el servicio no
 * debe cerrar un cruce por un abandono individual.
 */
export function abandonmentKeepsMatchAlive(input: {
  readonly mode: TournamentMode;
  readonly teamMembersTotal: number;
  readonly teamMembersStillActive: number;
}): boolean {
  if (input.mode === '1v1') return false;
  return input.teamMembersStillActive >= 1 && input.teamMembersTotal > input.teamMembersStillActive;
}

/** Asiento de cada integrante en la mesa: los equipos se intercalan (`seat % 2`). */
export function seatForTeamMember(teamIndex: 0 | 1, memberIndex: number): number {
  return memberIndex * 2 + teamIndex;
}

/** Nombre visible de un lado del cruce: nombre del equipo o apodo del jugador. */
export function sideDisplayName(input: {
  readonly teamName: string | null;
  readonly memberNicknames: readonly string[];
}): string {
  if (input.teamName) return input.teamName;
  return input.memberNicknames.join(' y ');
}
