import type { LeagueStandingRow } from '@truco/shared';
import { LEAGUE_MOVEMENT_LABELS, LEAGUE_TIEBREAKER_LABELS } from './league-labels.js';

/**
 * Tabla de posiciones de una liga.
 *
 * Decisiones de pantalla:
 * - La tabla es un `table` de verdad, con `scope="col"` y encabezados: es la única forma de que
 *   un lector de pantalla anuncie la columna de cada número.
 * - Se muestra **por qué** se decidió cada posición (`decidedBy`) cuando hubo empate: la tabla
 *   de una liga se discute, y sin esa columna no hay forma de explicarla.
 * - El ascenso y el descenso se marcan con texto, no sólo con color, y el inactivo dice
 *   «sin partidas para mover»: un lector de pantalla no ve el verde.
 */
export function LeagueStandings({
  standings,
  currentUserId,
}: {
  readonly standings: readonly LeagueStandingRow[];
  readonly currentUserId?: string | undefined;
}) {
  if (standings.length === 0) {
    return (
      <p className="text-sm text-white/70">
        Todavía no hay jugadores ubicados en la tabla de esta liga.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Tabla de posiciones">
      <table className="w-full min-w-[560px] border-collapse text-left text-sm">
        <caption className="sr-only">
          Tabla de posiciones de la liga con puntos, partidas y desempate aplicado
        </caption>
        <thead>
          <tr className="text-xs tracking-wide text-white/60 uppercase">
            <th scope="col" className="py-2 pr-2">
              #
            </th>
            <th scope="col" className="py-2 pr-2">
              Jugador
            </th>
            <th scope="col" className="py-2 pr-2 text-right">
              PJ
            </th>
            <th scope="col" className="py-2 pr-2 text-right">
              G
            </th>
            <th scope="col" className="py-2 pr-2 text-right">
              P
            </th>
            <th scope="col" className="py-2 pr-2 text-right">
              Tantos
            </th>
            <th scope="col" className="py-2 pr-2 text-right">
              Pts
            </th>
            <th scope="col" className="py-2">
              Situación
            </th>
          </tr>
        </thead>
        <tbody>
          {standings.map((row) => {
            const isMe = currentUserId !== undefined && row.userId === currentUserId;
            return (
              <tr
                key={row.userId}
                className={`border-t border-white/10 ${isMe ? 'bg-white/5' : ''}`}
                aria-current={isMe ? 'true' : undefined}
              >
                <td className="py-2 pr-2 tabular-nums">{row.position}</td>
                <td className="max-w-[12rem] py-2 pr-2">
                  <span className="block truncate" title={row.nickname}>
                    {row.nickname}
                    {isMe ? <span className="ml-1 text-xs text-gold">(vos)</span> : null}
                  </span>
                  {row.decidedBy && row.decidedBy !== 'POINTS' ? (
                    <span className="block text-xs text-white/50">
                      Desempata por {LEAGUE_TIEBREAKER_LABELS[row.decidedBy]}
                    </span>
                  ) : null}
                </td>
                <td className="py-2 pr-2 text-right tabular-nums">{row.played}</td>
                <td className="py-2 pr-2 text-right tabular-nums">{row.wins}</td>
                <td className="py-2 pr-2 text-right tabular-nums">{row.losses}</td>
                <td className="py-2 pr-2 text-right tabular-nums">{row.scoreDifference}</td>
                <td className="py-2 pr-2 text-right font-semibold tabular-nums">{row.points}</td>
                <td className="py-2 text-xs">
                  {row.movement !== 'NONE' && row.eligibleToMove ? (
                    <span
                      className={
                        row.movement === 'RELEGATION'
                          ? 'text-red-300'
                          : row.movement === 'TIE_AT_CUT'
                            ? 'text-amber-300'
                            : 'text-emerald-300'
                      }
                    >
                      {LEAGUE_MOVEMENT_LABELS[row.movement]}
                    </span>
                  ) : row.played > 0 && !row.eligibleToMove ? (
                    <span className="text-white/50">Sin partidas para mover</span>
                  ) : (
                    <span className="text-white/40">—</span>
                  )}
                  {row.noShows > 0 ? (
                    <span className="ml-1 text-white/50">({row.noShows} ausencia/s)</span>
                  ) : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
