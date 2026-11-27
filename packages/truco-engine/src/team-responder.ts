import { getActiveTeams, selectActiveResponderSeat } from './rounds.js';
import type { TeamId } from './types.js';

/**
 * Truco de 6: qué equipo responde un canto según el `RuleSet`.
 *
 * Con **dos** equipos (1v1, 2v2, 3v3) el rival es uno solo y no hay nada que elegir. Con
 * **tres** equipos de 2 (el truco de 6 que suma esta etapa) el canto de un equipo involucra
 * a los otros dos, y la elección no es un detalle: define qué equipo puede querer, subir o
 * rechazar, y de quién corre el reloj de turno.
 */
export type TeamResponderMode = 'NEXT_IN_TURN' | 'HIGHEST_SCORE';

/**
 * `NEXT_IN_TURN` (por defecto): responde el equipo del **primer asiento activo** que sigue al
 * cantor en el sentido antihorario. Es el criterio más conservador y el más parecido a lo que
 * ya hacía el motor: se reutiliza la misma función (`findNextOpposingTeam`) y no se inventa
 * una prioridad por puntaje. Con dos equipos coincide exactamente con el comportamiento previo.
 *
 * `HIGHEST_SCORE` _(configurable)_: responde el equipo rival con **más puntos**; a igualdad,
 * el más cercano al cantor en el orden de turnos. Sirve para variantes de club donde "el que
 * va ganando contesta primero".
 */
export function resolveRespondingTeam(
  callerSeat: number,
  callerTeam: TeamId,
  seats: readonly { readonly seat: number; readonly team: TeamId }[],
  foldedSeats: readonly number[],
  scoresByTeam: Readonly<Record<TeamId, number>>,
  mode: TeamResponderMode = 'NEXT_IN_TURN',
): TeamId {
  const folded = new Set(foldedSeats);
  const activeTeams = getActiveTeams(seats, foldedSeats);
  const rivals = activeTeams.filter((team) => team !== callerTeam);
  if (rivals.length === 0) return callerTeam;
  if (rivals.length === 1) return rivals[0]!;

  const total = seats.length;
  const orderOf = (team: TeamId): number => {
    for (let offset = 1; offset <= total; offset++) {
      const candidate = seats[(callerSeat + offset) % total];
      if (candidate && !folded.has(candidate.seat) && candidate.team === team) return offset;
    }
    return Number.POSITIVE_INFINITY;
  };

  if (mode === 'HIGHEST_SCORE') {
    return [...rivals].sort((a, b) => {
      const scoreDiff = (scoresByTeam[b] ?? 0) - (scoresByTeam[a] ?? 0);
      if (scoreDiff !== 0) return scoreDiff;
      return orderOf(a) - orderOf(b);
    })[0]!;
  }

  return [...rivals].sort((a, b) => orderOf(a) - orderOf(b))[0]!;
}

/**
 * Asiento activo de `responderTeam` que queda habilitado para contestar.
 *
 * `NEXT_IN_TURN` y `PIE_OF_TEAM` ya están resueltos por `selectActiveResponderSeat` (funcionan
 * igual con N equipos). `ANY_TEAM_MEMBER` necesitaba algo más con **tres** equipos: el motor
 * anterior devolvía el primer asiento del equipo, lo que dejaba la mesa esperando a un asiento
 * que no fuera el que actuó. Ahora elige el **asiento activo del equipo más cercano al cantor**
 * (y, si ninguno está activo, el más lejano a la mano), de modo que la partida siempre avanza.
 */
export function resolveRespondingSeat(
  callerSeat: number,
  responderTeam: TeamId,
  manoSeat: number,
  seats: readonly { readonly seat: number; readonly team: TeamId }[],
  foldedSeats: readonly number[],
  mode: 'NEXT_IN_TURN' | 'PIE_OF_TEAM' | 'ANY_TEAM_MEMBER',
  eligibleFilter?: (seat: number) => boolean,
): number {
  if (mode !== 'ANY_TEAM_MEMBER') {
    return selectActiveResponderSeat(
      callerSeat,
      responderTeam,
      manoSeat,
      seats,
      foldedSeats,
      mode,
      eligibleFilter,
    );
  }

  const folded = new Set(foldedSeats);
  const total = seats.length;
  for (let offset = 1; offset <= total; offset++) {
    const candidateSeat = (callerSeat + offset) % total;
    const info = seats[candidateSeat];
    if (
      info &&
      info.team === responderTeam &&
      !folded.has(candidateSeat) &&
      (eligibleFilter ? eligibleFilter(candidateSeat) : true)
    ) {
      return candidateSeat;
    }
  }
  return selectActiveResponderSeat(
    callerSeat,
    responderTeam,
    manoSeat,
    seats,
    foldedSeats,
    'PIE_OF_TEAM',
    eligibleFilter,
  );
}
