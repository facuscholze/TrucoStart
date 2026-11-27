import type { LeagueDetail } from '@truco/shared';
import { useCallback, useEffect, useState } from 'react';
import {
  getLeagueDetailRequest,
  joinLeagueRequest,
  leaveLeagueRequest,
} from '../../lib/api-client.js';
import { LeagueMatchesList, MyNextLeagueMatch } from './MyNextLeagueMatch.js';
import { LeagueStandings } from './LeagueStandings.js';
import { LEAGUE_DIVISION_LABELS, LEAGUE_STATUS_LABELS, formatLeagueDate } from './league-labels.js';

/**
 * Detalle de una liga (M10b, entrega 2).
 *
 * Tres bloques, en el orden en que se necesitan al entrar: mi próxima partida, la tabla y las
 * jornadas. La pantalla se refresca sola cada 15 s mientras la liga está en juego, porque la
 * tabla cambia con las partidas de los demás y sin refresco quedaría vieja en pantalla.
 */
export function LeagueDetailScreen({
  leagueId,
  currentUserId,
  onOpenRoom,
  onBack,
}: {
  readonly leagueId: string;
  readonly currentUserId?: string | undefined;
  readonly onOpenRoom: (roomId: string) => void;
  readonly onBack: () => void;
}) {
  const [detail, setDetail] = useState<LeagueDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await getLeagueDetailRequest(leagueId);
      setDetail(response);
      setError(null);
    } catch {
      setError('No pudimos cargar la liga. Probá de nuevo en un momento.');
    } finally {
      setLoading(false);
    }
  }, [leagueId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!detail) return;
    if (detail.status !== 'ACTIVE' && detail.status !== 'REGISTRATION') return;
    // Refresco sin solapar pedidos: si uno tarda, el siguiente no se dispara encima.
    let cancelled = false;
    const timer = setInterval(() => {
      if (cancelled) return;
      void load();
    }, 15_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [detail?.status, load, detail]);

  const act = async (action: 'join' | 'leave') => {
    setBusy(true);
    setJoinError(null);
    try {
      if (action === 'join') await joinLeagueRequest(leagueId);
      else await leaveLeagueRequest(leagueId);
      await load();
    } catch {
      setJoinError(
        action === 'join'
          ? 'No pudimos inscribirte. Puede que la liga esté llena o la inscripción cerrada.'
          : 'No pudimos darte de baja. Una liga que ya empezó no admite bajas.',
      );
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <p role="status" className="text-sm text-white/70">
        Cargando la liga…
      </p>
    );
  }
  if (error || !detail) {
    return (
      <div className="space-y-3">
        <p role="alert" className="text-sm text-red-300">
          {error ?? 'No encontramos la liga.'}
        </p>
        <button type="button" onClick={onBack} className="text-sm underline">
          Volver a ligas
        </button>
      </div>
    );
  }

  const canJoin =
    detail.status === 'REGISTRATION' &&
    !detail.isParticipant &&
    detail.participantCount < detail.capacity;

  return (
    <div className="space-y-5">
      <header className="space-y-2">
        <button type="button" onClick={onBack} className="text-sm underline">
          ← Ligas
        </button>
        <h1 className="font-display text-2xl break-words text-gold">{detail.name}</h1>
        <p className="text-sm text-white/70">
          {LEAGUE_DIVISION_LABELS[detail.division]} · {detail.mode} · {detail.seasonLabel} ·{' '}
          {LEAGUE_STATUS_LABELS[detail.status]}
        </p>
        <p className="text-xs text-white/60">
          Del {formatLeagueDate(detail.startsAt)} al {formatLeagueDate(detail.endsAt)} · hasta{' '}
          {detail.capacity} jugadores
          {detail.official ? ' · oficial' : ''}
        </p>
        <p className="text-xs text-white/50">
          Se juega a {detail.targetScore} puntos{detail.florEnabled ? ' con flor' : ' sin flor'}.
          Inscripción gratuita: los premios son cosméticos o monedas simbólicas.
        </p>
      </header>

      {joinError ? (
        <p role="alert" className="text-sm text-red-300">
          {joinError}
        </p>
      ) : null}

      {canJoin ? (
        <button
          type="button"
          onClick={() => void act('join')}
          disabled={busy}
          className="rounded-lg bg-gold px-4 py-2 text-sm font-semibold text-black disabled:opacity-50"
        >
          {busy ? 'Inscribiendo…' : 'Inscribirme (gratis)'}
        </button>
      ) : null}
      {detail.isParticipant && detail.status === 'REGISTRATION' ? (
        <button
          type="button"
          onClick={() => void act('leave')}
          disabled={busy}
          className="rounded-lg border border-white/30 px-4 py-2 text-sm disabled:opacity-50"
        >
          Darme de baja
        </button>
      ) : null}

      {detail.isParticipant ? (
        <MyNextLeagueMatch
          match={detail.myNextMatch}
          onOpenRoom={onOpenRoom}
          onRescheduled={() => void load()}
        />
      ) : null}

      <section aria-labelledby="tabla-liga" className="space-y-2">
        <h2 id="tabla-liga" className="font-display text-lg text-white">
          Tabla de posiciones
        </h2>
        <p className="text-xs text-white/60">
          Desempates en orden: puntos, resultado directo, partidas ganadas, diferencia de tantos,
          tantos a favor, menos ausencias y orden de inscripción.
        </p>
        <LeagueStandings standings={detail.standings} currentUserId={currentUserId} />
      </section>

      {detail.rounds.length > 0 ? (
        <section aria-labelledby="jornadas-liga" className="space-y-2">
          <h2 id="jornadas-liga" className="font-display text-lg text-white">
            Jornadas
          </h2>
          <ul className="space-y-1">
            {detail.rounds.map((round) => (
              <li
                key={round.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-white/10 px-3 py-2 text-sm"
              >
                <span>Jornada {round.number}</span>
                <span className="text-xs text-white/60">
                  {round.status === 'OPEN'
                    ? 'Abierta'
                    : round.status === 'SCHEDULED'
                      ? `Abre el ${formatLeagueDate(round.startsAt)}`
                      : round.status === 'CLOSED'
                        ? 'Cerrada'
                        : 'Cancelada'}{' '}
                  · plazo {formatLeagueDate(round.deadlineAt)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section aria-labelledby="partidas-liga" className="space-y-2">
        <h2 id="partidas-liga" className="font-display text-lg text-white">
          {detail.isParticipant ? 'Mis partidas' : 'Partidas'}
        </h2>
        <LeagueMatchesList matches={detail.matches} />
      </section>

      {detail.prizes.length > 0 ? (
        <section aria-labelledby="premios-liga" className="space-y-2">
          <h2 id="premios-liga" className="font-display text-lg text-white">
            Premios
          </h2>
          <ul className="space-y-1 text-sm text-white/80">
            {detail.prizes.map((prize) => (
              <li key={prize.position}>
                {prize.position}° puesto:{' '}
                {prize.coins > 0 ? `${prize.coins} monedas virtuales` : ''}
                {prize.coins > 0 && prize.cosmeticId ? ' y ' : ''}
                {prize.cosmeticId ? (prize.cosmeticName ?? 'un cosmético') : ''}
              </li>
            ))}
          </ul>
          <p className="text-xs text-white/50">
            Las monedas virtuales no valen dinero, no se compran ni se transfieren.
          </p>
        </section>
      ) : null}
    </div>
  );
}
