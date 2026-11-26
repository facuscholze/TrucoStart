import type { TournamentFormat, TournamentMatchView } from '@truco/shared';

/**
 * Armado del cuadro para pantalla (M10a).
 *
 * El servidor manda una lista plana de cruces; acá se agrupan por llave y ronda y se
 * calcula lo mínimo para dibujarlos. Se resuelve en funciones puras para poder probar
 * el agrupado sin montar React, y para que la vista sea sólo presentación.
 */

export interface BracketRound {
  readonly round: number;
  readonly matches: readonly TournamentMatchView[];
}

export interface BracketSection {
  readonly bracket: 'WINNERS' | 'LOSERS' | 'GRAND_FINAL';
  readonly title: string;
  readonly rounds: readonly BracketRound[];
}

/** Etiqueta corta y en rioplatense; se usa en la vista y en los nombres accesibles. */
export function roundLabel(bracket: BracketSection['bracket'], round: number): string {
  if (bracket === 'GRAND_FINAL') return 'Gran final';
  if (bracket === 'LOSERS') return `Perdedores, ronda ${round}`;
  return round === 1 ? 'Primera ronda' : `Ronda ${round}`;
}

/**
 * Agrupa los cruces por llave y ronda, en orden. Los torneos de eliminación simple no
 * tienen llave de perdedores, así que esa sección no aparece si no hay filas.
 */
export function groupBracket(
  matches: readonly TournamentMatchView[],
  format: TournamentFormat,
): BracketSection[] {
  const sections: BracketSection[] = [];
  const order: Array<BracketSection['bracket']> = ['WINNERS', 'LOSERS', 'GRAND_FINAL'];

  for (const bracket of order) {
    const ofBracket = matches.filter((match) => match.bracket === bracket);
    if (ofBracket.length === 0) continue;
    if (format === 'SINGLE_ELIMINATION' && bracket !== 'WINNERS') continue;

    const rounds = new Map<number, TournamentMatchView[]>();
    for (const match of ofBracket) {
      const bucket = rounds.get(match.round) ?? [];
      bucket.push(match);
      rounds.set(match.round, bucket);
    }
    sections.push({
      bracket,
      title:
        bracket === 'WINNERS'
          ? 'Llave de ganadores'
          : bracket === 'LOSERS'
            ? 'Llave de perdedores'
            : 'Final',
      rounds: [...rounds.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([round, roundMatches]) => ({
          round,
          matches: [...roundMatches].sort((a, b) => a.slot - b.slot),
        })),
    });
  }
  return sections;
}

/** Estado legible de un cruce, para el texto y para las etiquetas accesibles. */
export function describeMatch(match: TournamentMatchView): string {
  const home = match.homeNickname ?? 'A confirmar';
  const away = match.awayNickname ?? 'A confirmar';
  if (match.status === 'FORFEITED') {
    return match.forfeitReason === 'NO_SHOW'
      ? `${home} contra ${away}: sin presentarse`
      : `${home} contra ${away}: definido por incidencia`;
  }
  if (match.status === 'COMPLETED') {
    const winner = match.winnerUserId === match.homeUserId ? home : away;
    return `Ganó ${winner}`;
  }
  if (match.homeNickname === null && match.awayNickname === null) return 'A confirmar';
  if (match.homeNickname === null || match.awayNickname === null) return 'Esperando rival';
  return match.status === 'READY' ? 'Listo para jugar' : 'En juego';
}

/** `true` si el jugador actual todavía está en ese cruce y puede entrar. */
export function isMyPendingMatch(match: TournamentMatchView, userId: string | null): boolean {
  if (!userId) return false;
  if (match.status === 'COMPLETED' || match.status === 'FORFEITED') return false;
  return match.homeUserId === userId || match.awayUserId === userId;
}

export const TOURNAMENT_STATUS_LABELS_ES_AR: Readonly<Record<string, string>> = Object.freeze({
  DRAFT: 'Borrador',
  REGISTRATION: 'Inscripción abierta',
  CHECK_IN: 'Check-in',
  IN_PROGRESS: 'En juego',
  FINISHED: 'Terminado',
  CANCELLED: 'Cancelado',
});

export const TOURNAMENT_FORMAT_LABELS_ES_AR: Readonly<Record<string, string>> = Object.freeze({
  SINGLE_ELIMINATION: 'Eliminación simple',
  DOUBLE_ELIMINATION: 'Eliminación doble',
});

export const PARTICIPANT_STATUS_LABELS_ES_AR: Readonly<Record<string, string>> = Object.freeze({
  REGISTERED: 'Inscripto',
  CHECKED_IN: 'Presente',
  NO_SHOW: 'No se presentó',
  WITHDRAWN: 'Se dio de baja',
  DISQUALIFIED: 'Descalificado',
  ELIMINATED: 'Eliminado',
  WINNER: 'Campeón',
});
