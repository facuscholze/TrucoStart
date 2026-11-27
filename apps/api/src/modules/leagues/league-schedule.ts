/**
 * Armado del calendario de una liga y emparejamiento de cada jornada (M10b, entrega 2).
 *
 * Todo es **puro**: recibe participantes, formato y fechas, y devuelve las jornadas y los cruces.
 * Sin base, sin red y sin azar interno. Eso permite probar las propiedades que importan —todos
 * colocados, nadie contra sí mismo, nadie repite rival en la temporada— sin levantar nada.
 *
 * El emparejamiento es el **método del círculo** (round-robin): se fija un participante y se
 * rota el resto en cada jornada. Con un número impar se agrega un «descanso» que rota como un
 * participante más: quien cae contra el descanso no juega esa jornada, y así cada jornada le
 * toca a otro (nadie descansa dos veces seguidas).
 */

export interface ScheduleRound {
  readonly number: number;
  readonly startsAt: Date;
  readonly deadlineAt: Date;
  readonly pairs: ReadonlyArray<{ readonly homeUserId: string; readonly awayUserId: string }>;
}

export const LEAGUE_BYE_SLOT = '__BYE__';

/**
 * Empareja una jornada con el método del círculo.
 *
 * `roundIndex` es la jornada menos uno: cada jornada rota a todos los participantes (menos el
 * fijo) una posición, así ningún par se repite hasta que se dio la vuelta completa. Con un
 * número impar de participantes, el último lugar del círculo es el descanso y quien lo ocupa no
 * juega esa jornada.
 *
 * La localía se **balancea**: en cada cruce es local quien menos veces lo fue hasta ese momento
 * (y, en empate, el primero del círculo). Ni la alternancia fija por índice ni una moneda al aire
 * alcanzan: con alternancia por índice, un participante podía no ser local nunca en la temporada;
 * con una moneda al aire podía pasar por azar. El balance garantiza que cada uno sea local al
 * menos una vez si juega más de una partida, y como mucho una vez más que visitante.
 *
 * `homeCounts` es el acumulado de la temporada; se pasa y se actualiza en el mismo mapa.
 */
export function pairRound(
  participantIds: readonly string[],
  roundIndex: number,
  homeCounts: Map<string, number> = new Map(),
): Array<{ homeUserId: string; awayUserId: string }> {
  const ids = [...participantIds];
  if (ids.length < 2) return [];
  if (ids.length % 2 === 1) ids.push(LEAGUE_BYE_SLOT);

  const fixed = ids[0]!;
  const rest = ids.slice(1);
  const shift = ((roundIndex % rest.length) + rest.length) % rest.length;
  // Rotación **a la derecha**: el último de la lista pasa al frente. Es la rotación del método
  // del círculo; con la contraria, la segunda jornada repite cruces.
  const rotated = rest.map((_, index) => rest[(index - shift + rest.length) % rest.length]!);
  const circle = [fixed, ...rotated];

  const pairs: Array<{ homeUserId: string; awayUserId: string }> = [];
  for (let offset = 0; offset < circle.length / 2; offset++) {
    const left = circle[offset]!;
    const right = circle[circle.length - 1 - offset]!;
    if (left === LEAGUE_BYE_SLOT || right === LEAGUE_BYE_SLOT) continue;
    const leftHome = homeCounts.get(left) ?? 0;
    const rightHome = homeCounts.get(right) ?? 0;
    // Es local quien menos localías lleva. En empate decide la paridad de la jornada y la
    // posición del cruce: sin ese desempate, el primero del círculo sería local en todos los
    // empates y el último de la lista podía no serlo nunca (pasaba con tres jugadores).
    const flip = leftHome === rightHome ? (roundIndex + offset) % 2 === 1 : rightHome < leftHome;
    const home = flip ? right : left;
    const away = flip ? left : right;
    homeCounts.set(home, (homeCounts.get(home) ?? 0) + 1);
    pairs.push({ homeUserId: home, awayUserId: away });
  }
  return pairs;
}

/** Cantidad de jornadas necesarias para que todos se enfrenten una vez. */
export function roundsForParticipants(count: number): number {
  if (count < 2) return 0;
  return count % 2 === 0 ? count - 1 : count;
}

export interface ScheduleOptions {
  readonly participantIds: readonly string[];
  readonly format: 'ROUNDS' | 'WINDOW';
  /** Jornadas planificadas cuando el formato es `ROUNDS`. */
  readonly rounds: number;
  readonly firstRoundStartsAt: Date;
  readonly daysBetweenRounds: number;
  readonly roundWindowHours: number;
  /** Fin de la temporada: ninguna ventana puede pasarse de acá. */
  readonly endsAt: Date;
}

/**
 * Construye el calendario completo.
 *
 * - `ROUNDS`: `rounds` jornadas, cada una con su ventana de `roundWindowHours` desde su inicio.
 * - `WINDOW`: **una sola** jornada con todos los cruces y la ventana de la temporada. Es el
 *   formato de liga de fin de semana, donde cada uno concierta sus partidas dentro del plazo.
 *
 * Las ventanas nunca pasan del fin de la temporada: una partida con plazo posterior al cierre
 * no se puede jugar y distorsionaría la tabla, así que la jornada se recorta.
 */
export function buildSchedule(options: ScheduleOptions): ScheduleRound[] {
  if (options.participantIds.length < 2) return [];

  /** Localías acumuladas del calendario: la localía de cada cruce se balancea con esto. */
  const homeCounts = new Map<string, number>();

  if (options.format === 'WINDOW') {
    // Todos los cruces posibles en una sola ventana, sin repetir el par (y sin revancha: el
    // método del círculo devuelve cada par una vez por vuelta, y acá se da una sola).
    const pairs: Array<{ homeUserId: string; awayUserId: string }> = [];
    const seen = new Set<string>();
    for (let index = 0; index < roundsForParticipants(options.participantIds.length); index++) {
      for (const pair of pairRound(options.participantIds, index, homeCounts)) {
        const key = [pair.homeUserId, pair.awayUserId].sort().join('|');
        if (seen.has(key)) continue;
        seen.add(key);
        pairs.push(pair);
      }
    }
    return [{ number: 1, startsAt: options.firstRoundStartsAt, deadlineAt: options.endsAt, pairs }];
  }

  const rounds: ScheduleRound[] = [];
  for (let index = 0; index < Math.max(1, options.rounds); index++) {
    const startsAt = new Date(
      options.firstRoundStartsAt.getTime() + index * options.daysBetweenRounds * 86_400_000,
    );
    // Una jornada que arrancaría después del cierre no se crea: no habría ventana para jugarla
    // y la tabla contaría partidas imposibles.
    if (startsAt >= options.endsAt) break;
    const naturalDeadline = new Date(startsAt.getTime() + options.roundWindowHours * 3_600_000);
    rounds.push({
      number: rounds.length + 1,
      startsAt,
      deadlineAt: naturalDeadline > options.endsAt ? options.endsAt : naturalDeadline,
      pairs: pairRound(options.participantIds, index, homeCounts),
    });
  }
  return rounds;
}
