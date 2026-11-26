import type { TournamentSummary } from '@truco/shared';
import { useCallback, useEffect, useState } from 'react';
import { listTournamentsRequest, resolveTournamentJoinCodeRequest } from '../../lib/api-client.js';
import {
  TOURNAMENT_FORMAT_LABELS_ES_AR,
  TOURNAMENT_STATUS_LABELS_ES_AR,
} from './tournament-bracket.js';

const FILTERS = [
  { id: 'open', label: 'Con inscripción abierta', statuses: ['REGISTRATION', 'CHECK_IN'] },
  { id: 'live', label: 'En juego', statuses: ['IN_PROGRESS'] },
  { id: 'done', label: 'Terminados', statuses: ['FINISHED', 'CANCELLED'] },
] as const;

/**
 * Listado de torneos (M10a).
 *
 * Muestra primero los que están abiertos, con cupo y plazo a la vista. El buscador por
 * código permite entrar a un torneo privado sin exponerlo en la lista pública.
 */
export function TournamentsScreen({
  onOpenTournament,
}: {
  readonly onOpenTournament: (id: string) => void;
}) {
  const [filter, setFilter] = useState<(typeof FILTERS)[number]['id']>('open');
  const [items, setItems] = useState<TournamentSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [joinCode, setJoinCode] = useState('');
  const [joinError, setJoinError] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);

  const statuses = FILTERS.find((entry) => entry.id === filter)?.statuses ?? [];

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await listTournamentsRequest({ status: [...statuses], limit: 30 });
      setItems(response.items);
    } catch {
      setError('No pudimos cargar los torneos. Probá de nuevo en un momento.');
    } finally {
      setLoading(false);
    }
  }, [statuses.join(',')]);

  useEffect(() => {
    void load();
  }, [load]);

  const submitCode = async (event: React.FormEvent) => {
    event.preventDefault();
    const code = joinCode.trim().toUpperCase();
    if (code.length < 4) {
      setJoinError('El código tiene 6 caracteres.');
      return;
    }
    setJoining(true);
    setJoinError(null);
    try {
      const { tournamentId } = await resolveTournamentJoinCodeRequest(code);
      onOpenTournament(tournamentId);
    } catch {
      setJoinError('No encontramos un torneo con ese código.');
    } finally {
      setJoining(false);
    }
  };

  return (
    <div className="space-y-5">
      <header className="space-y-1">
        <h1 className="font-display text-2xl break-words text-gold">Torneos</h1>
        <p className="text-sm text-white/70">
          Copas simbólicas: se juegan por premios cosméticos y monedas que no valen dinero.
        </p>
      </header>

      <form onSubmit={submitCode} className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <div className="min-w-0 flex-1">
          <label htmlFor="tournament-join-code" className="block text-xs text-white/70">
            Entrar con código de torneo
          </label>
          <input
            id="tournament-join-code"
            value={joinCode}
            onChange={(event) => setJoinCode(event.target.value.toUpperCase())}
            maxLength={12}
            autoComplete="off"
            placeholder="ABC234"
            className="mt-1 w-full rounded-lg border border-white/15 bg-surface/70 px-3 py-2 font-mono tracking-widest text-white uppercase"
          />
        </div>
        <button
          type="submit"
          disabled={joining}
          className="min-h-11 rounded-lg border border-gold/60 px-4 py-2 text-sm font-semibold text-gold disabled:opacity-50"
        >
          {joining ? 'Buscando…' : 'Entrar'}
        </button>
      </form>
      {joinError ? (
        <p role="alert" className="text-sm text-amber-300">
          {joinError}
        </p>
      ) : null}

      <div role="tablist" aria-label="Filtrar torneos" className="flex flex-wrap gap-2">
        {FILTERS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            role="tab"
            aria-selected={filter === entry.id}
            onClick={() => setFilter(entry.id)}
            className={[
              'min-h-11 rounded-full border px-3 py-1.5 text-sm',
              filter === entry.id
                ? 'border-gold/70 bg-gold/15 text-gold'
                : 'border-white/15 text-white/70',
            ].join(' ')}
          >
            {entry.label}
          </button>
        ))}
      </div>

      {error ? (
        <p
          role="alert"
          className="rounded-xl border border-amber-400/40 bg-amber-500/10 p-3 text-sm"
        >
          {error}
        </p>
      ) : null}

      {loading ? <p className="text-sm text-white/60">Cargando torneos…</p> : null}

      {!loading && items.length === 0 && !error ? (
        <p className="rounded-xl border border-white/10 bg-surface/60 p-4 text-sm text-white/70">
          No hay torneos en este momento. Podés crear uno privado desde el perfil o entrar con un
          código.
        </p>
      ) : null}

      <ul className="space-y-3">
        {items.map((tournament) => (
          <li key={tournament.id}>
            <TournamentCard
              tournament={tournament}
              onOpen={() => onOpenTournament(tournament.id)}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}

function TournamentCard({
  tournament,
  onOpen,
}: {
  readonly tournament: TournamentSummary;
  readonly onOpen: () => void;
}) {
  const full = tournament.registeredCount >= tournament.capacity;
  return (
    <article className="rounded-xl border border-white/10 bg-surface/60 p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-lg break-words text-white">{tournament.name}</h2>
          <p className="mt-1 text-xs text-white/60">
            {TOURNAMENT_FORMAT_LABELS_ES_AR[tournament.format] ?? tournament.format} ·{' '}
            {tournament.mode} · {tournament.targetScore} puntos ·{' '}
            {tournament.visibility === 'OFFICIAL' ? 'Oficial' : 'Privado'}
          </p>
          <p className="mt-1 text-sm text-white/80">
            <span className="font-semibold text-gold">
              {TOURNAMENT_STATUS_LABELS_ES_AR[tournament.status] ?? tournament.status}
            </span>
            {' · '}
            {tournament.registeredCount}/{tournament.capacity} inscriptos
            {tournament.checkedInCount > 0 ? `, ${tournament.checkedInCount} presentes` : ''}
            {full ? ' · completo' : ''}
          </p>
          {tournament.prizes.length > 0 ? (
            <p className="mt-1 text-xs break-words text-white/70">
              Premios:{' '}
              {tournament.prizes
                .map((prize) =>
                  [
                    `#${prize.position}`,
                    prize.coins > 0 ? `${prize.coins} monedas` : null,
                    prize.cosmeticName ?? null,
                  ]
                    .filter(Boolean)
                    .join(' '),
                )
                .join(' · ')}
            </p>
          ) : null}
        </div>
        <button
          type="button"
          onClick={onOpen}
          className="min-h-11 shrink-0 rounded-lg border border-gold/60 px-4 py-2 text-sm font-semibold text-gold"
        >
          Ver torneo
        </button>
      </div>
    </article>
  );
}
