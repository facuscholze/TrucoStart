import type { TournamentDetailResponse } from '@truco/shared';
import { useCallback, useEffect, useState } from 'react';
import {
  checkInTournamentRequest,
  getTournamentDetailRequest,
  registerForTournamentRequest,
  unregisterFromTournamentRequest,
} from '../../lib/api-client.js';
import { TournamentBracket } from './TournamentBracket.js';
import {
  PARTICIPANT_STATUS_LABELS_ES_AR,
  TOURNAMENT_FORMAT_LABELS_ES_AR,
  TOURNAMENT_STATUS_LABELS_ES_AR,
} from './tournament-bracket.js';

/**
 * Detalle de un torneo (M10a).
 *
 * Reúne las tres acciones del ciclo (inscribirse, check-in, darse de baja) con el
 * cuadro, la tabla y "mi próxima partida". El bloque de acciones sólo muestra lo que
 * corresponde ahora: el servidor decide con `canRegister`/`canCheckIn` y explica el
 * motivo cuando algo está cerrado, en vez de dejar botones que fallan.
 */
export function TournamentDetailScreen({
  tournamentId,
  currentUserId,
  onNavigate,
}: {
  readonly tournamentId: string;
  readonly currentUserId: string | null;
  readonly onNavigate: (path: string) => void;
}) {
  const [detail, setDetail] = useState<TournamentDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setDetail(await getTournamentDetailRequest(tournamentId));
    } catch {
      setError('No pudimos abrir este torneo. Puede que necesites el código de acceso.');
    } finally {
      setLoading(false);
    }
  }, [tournamentId]);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * El torneo cambia solo con el paso del tiempo: la inscripción cierra, arranca el
   * check-in, el barrido del servidor arma la llave y la ronda siguiente se abre cuando
   * termina una partida. Sin refresco, quien espera en esta pantalla ve un estado congelado
   * y tiene que recargar a mano para enterarse de que ya puede jugar.
   *
   * El intervalo se corta en los estados finales y no solapa pedidos: si el anterior no
   * terminó, este ciclo se saltea.
   */
  const settled =
    detail?.tournament.status === 'FINISHED' || detail?.tournament.status === 'CANCELLED';
  useEffect(() => {
    if (settled) return undefined;
    let inFlight = false;
    const timer = setInterval(() => {
      if (inFlight) return;
      inFlight = true;
      void getTournamentDetailRequest(tournamentId)
        .then((fresh) => {
          setDetail(fresh);
        })
        .catch(() => {
          // Un refresco fallido no borra lo que la persona ya está viendo; el siguiente
          // intento lo corrige. El error de carga inicial sí se muestra.
        })
        .finally(() => {
          inFlight = false;
        });
    }, 5_000);
    return () => clearInterval(timer);
  }, [settled, tournamentId]);

  const run = async (action: () => Promise<unknown>, successMessage: string) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await action();
      setNotice(successMessage);
      await load();
    } catch (caught) {
      setError(readableError(caught));
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <p className="text-sm text-white/60">Cargando torneo…</p>;
  if (error && !detail) {
    return (
      <p role="alert" className="rounded-xl border border-amber-400/40 bg-amber-500/10 p-3 text-sm">
        {error}
      </p>
    );
  }
  if (!detail) return null;

  const { tournament, canRegister, canCheckIn, myNextMatch, standings } = detail;
  const myParticipation = detail.participants.find(
    (participant) => participant.userId === currentUserId,
  );
  const openRegistration =
    (tournament.status === 'REGISTRATION' || tournament.status === 'CHECK_IN') &&
    tournament.registrationClosesAt > new Date().toISOString();

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        {/* Sin glifos de flecha: la fuente de display no los incluye y quedaban como
            un carácter suelto. El texto solo alcanza y se lee igual en el lector. */}
        <button
          type="button"
          onClick={() => onNavigate('/torneos')}
          className="min-h-11 text-sm text-white/70 underline-offset-2 hover:underline"
        >
          Volver a todos los torneos
        </button>
        <h1 className="font-display text-2xl break-words text-gold">{tournament.name}</h1>
        <p className="text-sm text-white/70">
          {TOURNAMENT_FORMAT_LABELS_ES_AR[tournament.format] ?? tournament.format} ·{' '}
          {tournament.mode} · {tournament.targetScore} puntos ·{' '}
          {tournament.florEnabled ? 'con flor' : 'sin flor'} ·{' '}
          {tournament.visibility === 'OFFICIAL' ? 'Oficial' : 'Privado'}
        </p>
        <p className="text-sm text-white/80">
          <span className="font-semibold text-gold">
            {TOURNAMENT_STATUS_LABELS_ES_AR[tournament.status] ?? tournament.status}
          </span>{' '}
          · {tournament.registeredCount}/{tournament.capacity} inscriptos ·{' '}
          {tournament.checkedInCount} con check-in
        </p>
        {tournament.joinCode ? (
          <p className="text-sm text-white/80">
            Código para invitar:{' '}
            <span className="rounded bg-white/10 px-2 py-0.5 font-mono tracking-widest text-gold">
              {tournament.joinCode}
            </span>
          </p>
        ) : null}
        {tournament.cancelledReason ? (
          <p className="rounded-lg border border-amber-400/40 bg-amber-500/10 p-2 text-sm">
            {tournament.cancelledReason}
          </p>
        ) : null}
      </header>

      {notice ? (
        <p
          role="status"
          className="rounded-lg border border-emerald-400/40 bg-emerald-500/10 p-2 text-sm"
        >
          {notice}
        </p>
      ) : null}
      {error ? (
        <p
          role="alert"
          className="rounded-lg border border-amber-400/40 bg-amber-500/10 p-2 text-sm"
        >
          {error}
        </p>
      ) : null}

      {myNextMatch ? (
        <section
          aria-labelledby="my-next-match"
          className="rounded-xl border border-gold/50 bg-gold/10 p-4"
        >
          <h2 id="my-next-match" className="font-display text-base text-gold">
            Mi próxima partida
          </h2>
          <p className="mt-1 text-sm break-words text-white">
            {myNextMatch.homeNickname ?? 'A confirmar'} vs{' '}
            {myNextMatch.awayNickname ?? 'A confirmar'}
          </p>
          <p className="text-xs text-white/70">
            Ronda {myNextMatch.round}
            {myNextMatch.deadlineAt
              ? ` · presentate antes de ${new Date(myNextMatch.deadlineAt).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}`
              : ''}
          </p>
          {myNextMatch.roomId ? (
            <button
              type="button"
              onClick={() => onNavigate(`/mesa/${myNextMatch.roomId}`)}
              className="mt-2 min-h-11 rounded-lg bg-gold px-4 py-2 text-sm font-bold text-black"
            >
              Entrar a la mesa
            </button>
          ) : null}
        </section>
      ) : null}

      <section aria-labelledby="tournament-actions" className="space-y-2">
        <h2 id="tournament-actions" className="sr-only">
          Acciones del torneo
        </h2>
        {canRegister ? (
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              run(() => registerForTournamentRequest(tournament.id), 'Quedaste inscripto.')
            }
            className="min-h-11 w-full rounded-lg bg-gold px-4 py-2 font-bold text-black disabled:opacity-50"
          >
            Inscribirme
          </button>
        ) : null}
        {canCheckIn ? (
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              run(() => checkInTournamentRequest(tournament.id), 'Check-in registrado.')
            }
            className="min-h-11 w-full rounded-lg border border-gold/70 px-4 py-2 font-semibold text-gold disabled:opacity-50"
          >
            Hacer check-in
          </button>
        ) : null}
        {openRegistration &&
        myParticipation &&
        (myParticipation.status === 'REGISTERED' || myParticipation.status === 'CHECKED_IN') ? (
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              run(
                () => unregisterFromTournamentRequest(tournament.id),
                'Te dimos de baja del torneo.',
              )
            }
            className="min-h-11 w-full rounded-lg border border-white/20 px-4 py-2 text-sm text-white/80 disabled:opacity-50"
          >
            Darme de baja
          </button>
        ) : null}
        {detail.registrationClosedReason ? (
          <p className="text-sm text-white/60">{detail.registrationClosedReason}</p>
        ) : null}
        {myParticipation ? (
          <p className="text-sm text-white/80">
            Tu estado:{' '}
            {PARTICIPANT_STATUS_LABELS_ES_AR[myParticipation.status] ?? myParticipation.status}
            {myParticipation.seed ? ` · sembrado ${myParticipation.seed}` : ''}
          </p>
        ) : null}
      </section>

      {tournament.prizes.length > 0 ? (
        <section aria-labelledby="tournament-prizes">
          <h2 id="tournament-prizes" className="font-display text-base text-gold">
            Premios
          </h2>
          <ul className="mt-1 space-y-1 text-sm text-white/80">
            {tournament.prizes.map((prize) => (
              <li key={prize.position} className="break-words">
                {prize.position}º puesto:{' '}
                {[
                  prize.coins > 0 ? `${prize.coins} monedas` : null,
                  prize.cosmeticName ?? (prize.cosmeticId ? 'cosmético' : null),
                ]
                  .filter(Boolean)
                  .join(' y ')}{' '}
                <span className="text-xs text-white/50">(simbólico, sin valor económico)</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section aria-labelledby="tournament-bracket">
        <h2 id="tournament-bracket" className="font-display text-base text-gold">
          Cuadro
        </h2>
        <div className="mt-2">
          <TournamentBracket
            matches={detail.matches}
            format={tournament.format}
            currentUserId={currentUserId}
          />
        </div>
      </section>

      {standings.length > 0 ? (
        <section aria-labelledby="tournament-standings">
          <h2 id="tournament-standings" className="font-display text-base text-gold">
            Posiciones
          </h2>
          <p className="mt-1 text-xs text-white/60">
            Desempate: campeón, subcampeón y después quien cayó más tarde; a igual ronda, mejor
            sembrado.
          </p>
          <ol className="mt-2 space-y-1">
            {standings.map((standing) => (
              <li
                key={standing.userId}
                className="flex min-w-0 flex-wrap items-baseline gap-x-2 text-sm"
              >
                <span className="w-6 shrink-0 text-white/50">{standing.position}º</span>
                <span className="min-w-0 break-words text-white">{standing.nickname}</span>
                {/* La nota acompaña al nombre: con `flex-1` en el nombre se iba al borde
                    derecho de la pantalla y había que recorrer media línea para leerla. */}
                <span className="text-xs text-white/60">{standing.tiebreakNote}</span>
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      <section aria-labelledby="tournament-participants">
        <h2 id="tournament-participants" className="font-display text-base text-gold">
          Participantes ({detail.participants.length})
        </h2>
        <ul className="mt-2 space-y-1">
          {detail.participants.map((participant) => (
            <li
              key={participant.userId}
              className="flex min-w-0 flex-wrap items-baseline gap-x-2 text-sm"
            >
              <span className="min-w-0 break-words text-white">{participant.nickname}</span>
              <span className="text-xs text-white/60">
                {PARTICIPANT_STATUS_LABELS_ES_AR[participant.status] ?? participant.status}
                {participant.seed ? ` · #${participant.seed}` : ''}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

/** Mensaje en rioplatense para los errores esperables del ciclo. */
function readableError(caught: unknown): string {
  const reason = (caught as { details?: { reason?: string } })?.details?.reason;
  switch (reason) {
    case 'ALREADY_REGISTERED':
      return 'Ya estás inscripto en este torneo.';
    case 'TOURNAMENT_FULL':
      return 'El torneo se completó. Probá con otro o mirá el cuadro.';
    case 'REGISTRATION_CLOSED':
    case 'REGISTRATION_DEADLINE_PASSED':
      return 'La inscripción ya cerró.';
    case 'CHECK_IN_DEADLINE_PASSED':
    case 'CHECK_IN_CLOSED':
      return 'El check-in ya cerró.';
    case 'WITHDRAWAL_CLOSED':
      return 'La inscripción ya cerró: no podés darte de baja. Si no vas a jugar, no te presentes al check-in.';
    case 'NOT_REGISTERED':
      return 'No estás inscripto en este torneo.';
    case 'RATE_LIMITED':
      return 'Demasiados intentos seguidos. Esperá un momento.';
    default:
      return 'No pudimos completar la acción. Probá de nuevo en un momento.';
  }
}
