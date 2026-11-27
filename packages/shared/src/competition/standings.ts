import {
  LEAGUE_POINTS,
  type LeagueDivision,
  type LeaguePromotionRules,
  type LeagueStandingRow,
  type LeagueTiebreaker,
} from './league.schema.js';

/**
 * Tabla de posiciones de una liga (M10b, entrega 2).
 *
 * Todo lo de este archivo es **puro**: no toca base, red ni fechas. Recibe los resultados ya
 * normalizados y devuelve la tabla ordenada, el desempate que decidió cada posición y los
 * movimientos de ascenso y descenso. Es lo que se prueba con propiedades y lo que la API, la
 * web y el panel comparten: si la tabla se calculara dos veces en lugares distintos, una
 * pantalla podría mostrar un orden y la otra otro.
 */

/** Un resultado de liga ya normalizado: quién jugó, quién ganó y cuánto sacó cada uno. */
export interface LeagueResult {
  readonly homeUserId: string;
  readonly awayUserId: string;
  readonly winnerUserId: string | null;
  /** Puntos de truco. `null` en una partida anulada o resuelta sin jugarse. */
  readonly homeScore: number | null;
  readonly awayScore: number | null;
  /** Motivo por el que no se jugó, si aplica. */
  readonly forfeitReason: string | null;
  /**
   * Quiénes se ausentaron. Un `DOUBLE_NO_SHOW` lleva a los dos; un `NO_SHOW` sólo al que no
   * se presentó. El ausente suma 0 puntos y cuenta como partida jugada para el mínimo.
   */
  readonly noShowUserIds: readonly string[];
  /** Una partida `VOID` no cuenta para nadie: ni jugada, ni puntos, ni desempate. */
  readonly voided?: boolean;
}

/** Participante de la liga tal como entra al cálculo de la tabla. */
export interface LeagueParticipant {
  readonly userId: string;
  readonly nickname: string;
  readonly status: string;
  /** Número de inscripción: último desempate determinista. */
  readonly seed: number;
}

interface Accumulator {
  readonly userId: string;
  readonly nickname: string;
  readonly status: string;
  readonly seed: number;
  played: number;
  wins: number;
  losses: number;
  noShows: number;
  points: number;
  scoreFor: number;
  scoreAgainst: number;
  /** Resultado directo contra cada rival, para el desempate `HEAD_TO_HEAD`. */
  readonly headToHead: Map<string, number>;
}

function emptyAccumulator(participant: LeagueParticipant): Accumulator {
  return {
    userId: participant.userId,
    nickname: participant.nickname,
    status: participant.status,
    seed: participant.seed,
    played: 0,
    wins: 0,
    losses: 0,
    noShows: 0,
    points: 0,
    scoreFor: 0,
    scoreAgainst: 0,
    headToHead: new Map(),
  };
}

/**
 * Acumula los resultados por jugador.
 *
 * Reglas de conteo, todas del ADR-035:
 * - Una partida jugada cuenta como jugada para los dos.
 * - El ganador suma `LEAGUE_POINTS.WIN`; el perdedor, `LEAGUE_POINTS.LOSS`.
 * - Un `DOUBLE_NO_SHOW` suma 0 a los dos y cuenta como partida jugada para el mínimo de
 *   ascenso: quien no se presentó no puede ascender «por no jugar».
 * - Una partida `VOID` (anulada por la administración) no cuenta para nadie.
 */
function accumulate(
  acc: Accumulator,
  ownScore: number | null,
  rivalScore: number | null,
  /** `null` cuando la partida no se definió por juego (doble ausencia): no hay ganador. */
  won: boolean | null,
  rivalId: string,
  isNoShow: boolean,
): void {
  acc.played += 1;
  if (isNoShow) acc.noShows += 1;
  if (won === null) {
    // Sin ganador no hay victoria, ni derrota, ni puntos, ni desempate directo. La partida
    // cuenta como jugada para el mínimo de ascenso: quien no se presentó jugó su partida.
    return;
  }
  if (won) {
    acc.wins += 1;
    acc.points += LEAGUE_POINTS.WIN;
    acc.headToHead.set(rivalId, (acc.headToHead.get(rivalId) ?? 0) + 1);
  } else {
    acc.losses += 1;
    acc.points += LEAGUE_POINTS.LOSS;
    acc.headToHead.set(rivalId, (acc.headToHead.get(rivalId) ?? 0) - 1);
  }
  if (ownScore !== null) acc.scoreFor += ownScore;
  if (rivalScore !== null) acc.scoreAgainst += rivalScore;
}

/**
 * Resultados directos entre los jugadores que están empatados en puntos.
 *
 * El desempate `HEAD_TO_HEAD` sólo mira las partidas jugadas **entre los empatados**: si dos
 * jugadores nunca se enfrentaron, el criterio no decide nada y se pasa al siguiente. Se cuenta
 * como diferencia de victorias contra el grupo: positivo significa que ganó más de las que
 * perdió contra ellos.
 */
function headToHeadScore(userId: string, group: ReadonlySet<string>, acc: Accumulator): number {
  let score = 0;
  for (const [rivalId, delta] of acc.headToHead) {
    if (group.has(rivalId)) score += delta;
  }
  return score;
}

/**
 * Ordena la tabla completa y arma cada fila con el desempate que la decidió.
 *
 * `decidedBy` es la parte que hace auditable la tabla: no alcanza con que el orden sea el
 * correcto, la pantalla tiene que poder explicar *por qué* alguien quedó arriba. Cada fila
 * informa el primer desempate que la separó de la fila de abajo.
 */
export function buildLeagueStandings(input: {
  readonly participants: readonly LeagueParticipant[];
  readonly results: readonly LeagueResult[];
}): LeagueStandingRow[] {
  const byId = new Map<string, Accumulator>();
  for (const participant of input.participants) {
    byId.set(participant.userId, emptyAccumulator(participant));
  }

  for (const result of input.results) {
    if (result.voided) continue;
    const home = byId.get(result.homeUserId);
    const away = byId.get(result.awayUserId);
    // Un resultado de alguien que ya no está en la liga no se descarta en silencio: si el
    // jugador se fue, sigue en la tabla (su tabla no se borra) pero no se inventa una fila.
    if (!home || !away) continue;

    const winnerId = result.winnerUserId;
    const decidedOnGames = winnerId !== null;
    // Un doble ausente no tiene ganador: los dos suman 0 y los dos se cuentan la ausencia.
    const doubleNoShow = result.forfeitReason === 'DOUBLE_NO_SHOW';
    accumulate(
      home,
      result.homeScore,
      result.awayScore,
      decidedOnGames ? winnerId === home.userId : null,
      away.userId,
      result.noShowUserIds.includes(home.userId) || doubleNoShow,
    );
    accumulate(
      away,
      result.awayScore,
      result.homeScore,
      decidedOnGames ? winnerId === away.userId : null,
      home.userId,
      result.noShowUserIds.includes(away.userId) || doubleNoShow,
    );
  }

  const rows = [...byId.values()];

  // Agrupación por puntos: el desempate `HEAD_TO_HEAD` se calcula contra los empatados, así
  // que hay que conocer el grupo antes de ordenar dentro de él.
  const pointsGroups = new Map<number, Set<string>>();
  for (const row of rows) {
    const group = pointsGroups.get(row.points) ?? new Set<string>();
    group.add(row.userId);
    pointsGroups.set(row.points, group);
  }

  /** Compara dos filas y devuelve qué desempate las separó (`null` si son idénticas). */
  const compare = (a: Accumulator, b: Accumulator): LeagueTiebreaker | null => {
    if (a.points !== b.points) return 'POINTS';
    const group = pointsGroups.get(a.points) ?? new Set<string>();
    const h2hA = headToHeadScore(a.userId, group, a);
    const h2hB = headToHeadScore(b.userId, group, b);
    if (h2hA !== h2hB) return 'HEAD_TO_HEAD';
    if (a.wins !== b.wins) return 'WINS';
    const diffA = a.scoreFor - a.scoreAgainst;
    const diffB = b.scoreFor - b.scoreAgainst;
    if (diffA !== diffB) return 'SCORE_DIFFERENCE';
    if (a.scoreFor !== b.scoreFor) return 'SCORE_FOR';
    if (a.noShows !== b.noShows) return 'FEWER_NO_SHOWS';
    if (a.seed !== b.seed) return 'SEED';
    return null;
  };

  // Orden completo aplicando todos los criterios en cascada. El comparador es total porque el
  // último criterio (`SEED`) es único por jugador: dos filas nunca quedan «empatadas» sin
  // desempate, y por eso el orden es el mismo en dos consultas distintas.
  const sorted = [...rows].sort((a, b) => {
    const tiebreaker = compare(a, b);
    if (tiebreaker === null) return 0;
    // `compare` devuelve el primer criterio que difiere; para ordenar hace falta el signo.
    switch (tiebreaker) {
      case 'POINTS':
        return b.points - a.points;
      case 'HEAD_TO_HEAD':
        return (
          headToHeadScore(b.userId, pointsGroups.get(a.points) ?? new Set(), b) -
          headToHeadScore(a.userId, pointsGroups.get(a.points) ?? new Set(), a)
        );
      case 'WINS':
        return b.wins - a.wins;
      case 'SCORE_DIFFERENCE':
        return b.scoreFor - b.scoreAgainst - (a.scoreFor - a.scoreAgainst);
      case 'SCORE_FOR':
        return b.scoreFor - a.scoreFor;
      case 'FEWER_NO_SHOWS':
        return a.noShows - b.noShows;
      case 'SEED':
        return a.seed - b.seed;
      default:
        return 0;
    }
  });

  return sorted.map((row, index) => {
    const next = sorted[index + 1];
    const decidedBy = next ? compare(row, next) : null;
    return {
      position: index + 1,
      userId: row.userId,
      nickname: row.nickname,
      status: row.status as LeagueStandingRow['status'],
      played: row.played,
      wins: row.wins,
      losses: row.losses,
      noShows: row.noShows,
      points: row.points,
      scoreFor: row.scoreFor,
      scoreAgainst: row.scoreAgainst,
      scoreDifference: row.scoreFor - row.scoreAgainst,
      seed: row.seed,
      decidedBy,
      // El movimiento se completa en `resolveMovements`, que necesita la división.
      movement: 'NONE',
      eligibleToMove: row.played >= 0,
    };
  });
}

/** Un movimiento de ascenso o descenso decidido por la tabla. */
export interface LeagueMovement {
  readonly userId: string;
  readonly kind: 'PROMOTION' | 'RELEGATION' | 'TIE_AT_CUT';
  readonly division: LeagueDivision;
}

/**
 * Resuelve ascensos y descensos de una tabla (ADR-035).
 *
 * Reglas:
 * 1. **Inactivos no se mueven.** Quien jugó menos de `minMatchesToMove` no asciende ni
 *    desciende: su posición en una tabla corta no dice nada.
 * 2. **El corte por empate no se rompe.** Si el último que asciende y el primero que no
 *    asciende tienen la misma posición resuelta por `SEED` (o sea, la tabla los distingue sólo
 *    por el número de inscripción), **suben los dos**: nadie queda afuera por un desempate que
 *    la tabla no resuelve. Lo mismo, simétrico, en el corte de descenso. El movimiento se
 *    marca `TIE_AT_CUT` para que la administración lo vea y lo pueda explicar.
 * 3. **La escalera termina.** En la división más alta no hay ascenso y en la más baja no hay
 *    descenso.
 */
export function resolveMovements(input: {
  readonly standings: readonly LeagueStandingRow[];
  readonly division: LeagueDivision;
  readonly promotion: LeaguePromotionRules;
  readonly hasDivisionAbove: boolean;
  readonly hasDivisionBelow: boolean;
}): LeagueMovement[] {
  const { standings, promotion } = input;
  const movements: LeagueMovement[] = [];
  if (standings.length === 0) return movements;

  const eligible = (row: LeagueStandingRow) => row.played >= promotion.minMatchesToMove;
  /** Ya movido: nadie asciende y desciende en la misma temporada. */
  const taken = new Set<string>();

  /**
   * ¿Dos filas están empatadas en todo lo deportivo y sólo las separa el número de inscripción?
   * Es la condición del corte discutido: la posición no es un mérito.
   */
  const tiedSportingly = (a: LeagueStandingRow, b: LeagueStandingRow) =>
    a.points === b.points &&
    a.wins === b.wins &&
    a.scoreDifference === b.scoreDifference &&
    a.scoreFor === b.scoreFor &&
    a.noShows === b.noShows;

  if (input.hasDivisionAbove && promotion.promotions > 0) {
    const cut = Math.min(promotion.promotions, standings.length);
    for (let index = 0; index < cut; index++) {
      const row = standings[index]!;
      if (!eligible(row)) continue;
      const boundary = standings[index + 1];
      const tiedAtCut =
        boundary !== undefined && tiedSportingly(row, boundary) && eligible(boundary);
      movements.push({
        userId: row.userId,
        kind: tiedAtCut ? 'TIE_AT_CUT' : 'PROMOTION',
        division: input.division,
      });
      taken.add(row.userId);
    }
    // Quien quedó justo afuera con todo empatado también sube: sin esto «suben los dos» sería
    // sólo una frase. Se compara la fila del corte con la última que sí ascendió.
    const lastPromoted = standings
      .slice(0, cut)
      .reverse()
      .find((row) => taken.has(row.userId));
    const boundary = standings[cut];
    if (
      lastPromoted !== undefined &&
      boundary !== undefined &&
      eligible(boundary) &&
      !taken.has(boundary.userId) &&
      tiedSportingly(lastPromoted, boundary)
    ) {
      movements.push({ userId: boundary.userId, kind: 'TIE_AT_CUT', division: input.division });
      taken.add(boundary.userId);
    }
  }

  if (input.hasDivisionBelow && promotion.relegations > 0) {
    // El descenso nunca pisa a quien ya ascendió: con ligas chicas las dos bandas pueden
    // solaparse, y una persona no puede subir y bajar en la misma temporada.
    let reassigned = 0;
    for (
      let offset = 1;
      offset <= standings.length && reassigned < promotion.relegations;
      offset++
    ) {
      const row = standings[standings.length - offset]!;
      if (!eligible(row) || taken.has(row.userId)) continue;
      movements.push({ userId: row.userId, kind: 'RELEGATION', division: input.division });
      taken.add(row.userId);
      reassigned += 1;
    }
  }

  return movements;
}

/**
 * ¿La tabla distingue a estas dos filas sólo por el número de inscripción?
 *
 * Se usa para el aviso de empate en el corte: si todo lo deportivo es igual y sólo el `SEED`
 * separa, la posición no es un mérito y el ascenso se resuelve a favor de los dos.
 */
export function onlySeedSeparates(a: LeagueStandingRow, b: LeagueStandingRow): boolean {
  return (
    a.points === b.points &&
    a.wins === b.wins &&
    a.scoreFor === b.scoreFor &&
    a.scoreAgainst === b.scoreAgainst &&
    a.noShows === b.noShows &&
    a.seed !== b.seed
  );
}
