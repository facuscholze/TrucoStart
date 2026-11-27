import type { LeagueDivision, LeagueStatus, LeagueTiebreaker } from '@truco/shared';

/** Etiquetas en castellano rioplatense de las ligas. */
export const LEAGUE_DIVISION_LABELS: Readonly<Record<LeagueDivision, string>> = {
  BRONCE: 'Bronce',
  PLATA: 'Plata',
  ORO: 'Oro',
  PLATINO: 'Platino',
};

export const LEAGUE_STATUS_LABELS: Readonly<Record<LeagueStatus, string>> = {
  DRAFT: 'Borrador',
  REGISTRATION: 'Inscripción abierta',
  ACTIVE: 'En juego',
  CLOSING: 'Cerrando temporada',
  FINISHED: 'Terminada',
  CANCELLED: 'Cancelada',
};

/**
 * Nombre legible de cada desempate.
 *
 * Se muestran en la tabla para poder explicar por qué alguien quedó arriba: el orden no es
 * arbitrario y la pantalla tiene que poder decirlo (ADR-035).
 */
export const LEAGUE_TIEBREAKER_LABELS: Readonly<Record<LeagueTiebreaker, string>> = {
  POINTS: 'puntos',
  HEAD_TO_HEAD: 'resultado directo',
  WINS: 'partidas ganadas',
  SCORE_DIFFERENCE: 'diferencia de tantos',
  SCORE_FOR: 'tantos a favor',
  FEWER_NO_SHOWS: 'menos ausencias',
  SEED: 'orden de inscripción',
};

export const LEAGUE_MOVEMENT_LABELS: Readonly<Record<string, string>> = {
  PROMOTION: 'Asciende',
  RELEGATION: 'Desciende',
  TIE_AT_CUT: 'Empate en el corte',
  NONE: '',
};

/** Fecha corta en la zona del navegador; nunca relativa a un huso fijo. */
export function formatLeagueDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('es-AR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}
