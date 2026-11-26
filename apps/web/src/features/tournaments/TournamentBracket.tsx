import type { TournamentFormat, TournamentMatchView } from '@truco/shared';
import { describeMatch, groupBracket, roundLabel } from './tournament-bracket.js';

/**
 * Cuadro de torneo (M10a).
 *
 * En 360 px el cuadro no cabe de costado, así que **cada ronda es una lista vertical**
 * dentro de un contenedor con scroll horizontal por sección: se lee de arriba abajo y se
 * desplaza de ronda en ronda. No se usan flechas ni líneas entre cruces —que a ese
 * ancho se vuelven ilegibles—; la relación se explica con el texto del rival ("espera
 * al ganador de…") y con los encabezados de ronda.
 *
 * Accesibilidad: el cuadro es una lista anidada (`ul`/`li`) con encabezados reales, cada
 * cruce es un `article` con un nombre accesible completo, y el estado nunca depende sólo
 * del color (siempre hay texto).
 */
export function TournamentBracket({
  matches,
  format,
  currentUserId,
}: {
  readonly matches: readonly TournamentMatchView[];
  readonly format: TournamentFormat;
  readonly currentUserId: string | null;
}) {
  const sections = groupBracket(matches, format);

  if (sections.length === 0) {
    return (
      <p className="rounded-xl border border-white/10 bg-surface/60 p-4 text-sm text-white/70">
        El cuadro se arma cuando arranca el torneo, con quienes hicieron check-in.
      </p>
    );
  }

  return (
    <div className="space-y-6">
      {sections.map((section) => (
        <section key={section.bracket} aria-labelledby={`bracket-${section.bracket}`}>
          <h3 id={`bracket-${section.bracket}`} className="mb-3 font-display text-base text-gold">
            {section.title}
          </h3>
          {/* Scroll horizontal sólo si hace falta; el foco y el lector de pantalla
              recorren la lista completa igual. */}
          <div className="-mx-1 overflow-x-auto px-1 pb-2">
            <ul className="flex min-w-full gap-3">
              {section.rounds.map((round) => (
                <li key={round.round} className="min-w-[15rem] flex-1 space-y-2">
                  <h4 className="text-xs font-semibold tracking-wide text-white/60 uppercase">
                    {roundLabel(section.bracket, round.round)}
                  </h4>
                  <ul className="space-y-2">
                    {round.matches.map((match) => (
                      <li key={match.id}>
                        <MatchCard match={match} currentUserId={currentUserId} />
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          </div>
        </section>
      ))}
    </div>
  );
}

function MatchCard({
  match,
  currentUserId,
}: {
  readonly match: TournamentMatchView;
  readonly currentUserId: string | null;
}) {
  const isMine =
    currentUserId !== null &&
    (match.homeUserId === currentUserId || match.awayUserId === currentUserId);
  const finished = match.status === 'COMPLETED' || match.status === 'FORFEITED';

  return (
    <article
      // El nombre accesible completo incluye ronda, rivales y estado: el texto visible
      // puede ser corto sin perder información para lectores de pantalla.
      aria-label={`Ronda ${match.round}, cruce ${match.slot}: ${describeMatch(match)}`}
      className={[
        'rounded-xl border p-2.5 text-sm',
        isMine ? 'border-gold/60 bg-gold/10' : 'border-white/10 bg-surface/60',
      ].join(' ')}
    >
      <div className="flex flex-col gap-1">
        <Side
          nickname={match.homeNickname}
          isWinner={finished && match.winnerUserId === match.homeUserId}
          isMe={match.homeUserId === currentUserId}
        />
        <Side
          nickname={match.awayNickname}
          isWinner={finished && match.winnerUserId === match.awayUserId}
          isMe={match.awayUserId === currentUserId}
        />
      </div>
      <p className="mt-1.5 text-xs break-words text-white/60">{describeMatch(match)}</p>
    </article>
  );
}

function Side({
  nickname,
  isWinner,
  isMe,
}: {
  readonly nickname: string | null;
  readonly isWinner: boolean;
  readonly isMe: boolean;
}) {
  const name = nickname ?? 'A confirmar';
  return (
    <div className="flex min-w-0 items-center gap-1.5">
      {/* El ganador se marca con texto, no sólo con color ni con un ícono decorativo. */}
      <span aria-hidden="true" className="w-3 shrink-0 text-gold">
        {isWinner ? '✓' : ''}
      </span>
      <span
        className={[
          'min-w-0 flex-1 break-words',
          nickname === null ? 'text-white/40 italic' : 'text-white',
          isWinner ? 'font-semibold' : '',
        ].join(' ')}
      >
        {name}
        {isMe ? <span className="text-white/60"> (vos)</span> : null}
      </span>
      {isWinner ? <span className="sr-only">Ganador</span> : null}
    </div>
  );
}
