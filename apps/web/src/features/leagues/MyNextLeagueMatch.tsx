import type { LeagueMatchView } from '@truco/shared';
import { useState } from 'react';
import { rescheduleLeagueMatchRequest } from '../../lib/api-client.js';
import { formatLeagueDate } from './league-labels.js';

/**
 * «Mi próxima partida de liga».
 *
 * Es lo primero que un jugador necesita saber al entrar: cuándo juega, contra quién y hasta
 * cuándo tiene para hacerlo. El botón de entrar a la mesa aparece sólo si la sala ya existe
 * (`roomId`), porque una partida sin sala todavía no se puede jugar.
 *
 * La reprogramación pide un motivo (queda auditado) y respeta los topes de la liga: si ya no le
 * quedan, el botón no se muestra en vez de fallar al apretarlo.
 */
export function MyNextLeagueMatch({
  match,
  onOpenRoom,
  onRescheduled,
}: {
  readonly match: LeagueMatchView | null;
  readonly onOpenRoom: (roomId: string) => void;
  readonly onRescheduled?: (() => void) | undefined;
}) {
  const [reason, setReason] = useState('');
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!match) {
    return (
      <section className="rounded-xl border border-white/10 bg-white/5 p-4">
        <h2 className="font-display text-lg text-gold">Mi próxima partida</h2>
        <p className="mt-1 text-sm text-white/70">
          No tenés partidas pendientes en esta liga. Cuando abra la próxima jornada, te avisamos.
        </p>
      </section>
    );
  }

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (reason.trim().length < 5) {
      setError('Contá en una línea por qué necesitás mover la fecha.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await rescheduleLeagueMatchRequest(match.id, reason.trim());
      setOpen(false);
      setReason('');
      onRescheduled?.();
    } catch {
      setError('No pudimos reprogramar la partida. Puede que ya no queden cambios disponibles.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-xl border border-gold/30 bg-gold/5 p-4">
      <h2 className="font-display text-lg text-gold">Mi próxima partida</h2>
      <p className="mt-1 text-sm text-white">
        <span className="font-semibold">{match.homeNickname ?? 'Jugador'}</span> contra{' '}
        <span className="font-semibold">{match.awayNickname ?? 'Jugador'}</span>
      </p>
      <p className="text-sm text-white/70">
        Jornada {match.roundNumber ?? '—'} · tenés tiempo hasta{' '}
        <time dateTime={match.deadlineAt ?? undefined}>{formatLeagueDate(match.deadlineAt)}</time>
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        {match.roomId ? (
          <button
            type="button"
            onClick={() => onOpenRoom(match.roomId!)}
            className="rounded-lg bg-gold px-3 py-2 text-sm font-semibold text-black"
          >
            Entrar a la mesa
          </button>
        ) : (
          <span className="rounded-lg border border-white/20 px-3 py-2 text-sm text-white/70">
            La mesa se abre cuando arranque la jornada
          </span>
        )}
        {match.reschedulesUsed < match.maxReschedules ? (
          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            className="rounded-lg border border-white/30 px-3 py-2 text-sm"
            aria-expanded={open}
          >
            Pedir reprogramación ({match.maxReschedules - match.reschedulesUsed} disponible/s)
          </button>
        ) : (
          <span className="px-1 py-2 text-sm text-white/50">Sin reprogramaciones disponibles</span>
        )}
      </div>
      {open ? (
        <form onSubmit={submit} className="mt-3 space-y-2">
          <label htmlFor="reschedule-reason" className="block text-sm text-white/80">
            Motivo de la reprogramación
          </label>
          <textarea
            id="reschedule-reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            maxLength={300}
            rows={2}
            className="w-full rounded-lg border border-white/20 bg-black/30 p-2 text-sm"
          />
          {error ? (
            <p role="alert" className="text-sm text-red-300">
              {error}
            </p>
          ) : null}
          <button
            type="submit"
            disabled={busy}
            className="rounded-lg bg-white/90 px-3 py-2 text-sm font-semibold text-black disabled:opacity-50"
          >
            {busy ? 'Guardando…' : 'Confirmar reprogramación'}
          </button>
        </form>
      ) : null}
    </section>
  );
}

/** Lista corta de las partidas del jugador, con su estado y resultado. */
export function LeagueMatchesList({ matches }: { readonly matches: readonly LeagueMatchView[] }) {
  if (matches.length === 0) {
    return <p className="text-sm text-white/70">Todavía no hay partidas para mostrar.</p>;
  }
  return (
    <ul className="space-y-2">
      {matches.map((match) => (
        <li
          key={match.id}
          className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm"
        >
          <span className="max-w-[16rem] truncate">
            Jornada {match.roundNumber ?? '—'}: {match.homeNickname ?? '—'} vs{' '}
            {match.awayNickname ?? '—'}
          </span>
          <span className="text-xs text-white/60">
            {match.status === 'COMPLETED'
              ? `Ganó ${match.winnerUserId === match.homeUserId ? match.homeNickname : match.awayNickname} ${match.homeScore ?? 0}–${match.awayScore ?? 0}`
              : match.status === 'FORFEITED'
                ? match.forfeitReason === 'DOUBLE_NO_SHOW'
                  ? 'No se jugó: faltaron los dos'
                  : `Se definió sin jugar (${match.forfeitReason ?? 'ausencia'})`
                : match.status === 'VOID'
                  ? 'Anulada'
                  : match.roomId
                    ? 'Pendiente — la mesa está lista'
                    : 'Pendiente'}
          </span>
        </li>
      ))}
    </ul>
  );
}
