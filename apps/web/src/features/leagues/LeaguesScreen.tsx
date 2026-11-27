import type { LeagueDivision, LeagueSummary } from '@truco/shared';
import { useCallback, useEffect, useState } from 'react';
import { listLeaguesRequest } from '../../lib/api-client.js';
import { LEAGUE_DIVISION_LABELS, LEAGUE_STATUS_LABELS, formatLeagueDate } from './league-labels.js';

const FILTERS = [
  { id: 'open', label: 'Con inscripción abierta', statuses: ['REGISTRATION'] },
  { id: 'live', label: 'En juego', statuses: ['ACTIVE', 'CLOSING'] },
  { id: 'done', label: 'Terminadas', statuses: ['FINISHED', 'CANCELLED'] },
] as const;

const DIVISIONS: readonly (LeagueDivision | 'ALL')[] = ['ALL', 'BRONCE', 'PLATA', 'ORO', 'PLATINO'];

/** Listado de ligas por temporada y división (M10b, entrega 2). */
export function LeaguesScreen({ onOpenLeague }: { readonly onOpenLeague: (id: string) => void }) {
  const [filter, setFilter] = useState<(typeof FILTERS)[number]['id']>('live');
  const [division, setDivision] = useState<LeagueDivision | 'ALL'>('ALL');
  const [items, setItems] = useState<LeagueSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // El arreglo de estados se deriva del filtro activo y se guarda como texto: así la
  // dependencia es un valor estable y no un arreglo nuevo en cada render.
  const statusKey = (FILTERS.find((entry) => entry.id === filter)?.statuses ?? []).join(',');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await listLeaguesRequest({
        status: statusKey === '' ? [] : statusKey.split(','),
        limit: 30,
        ...(division === 'ALL' ? {} : { division }),
      });
      setItems(response.items);
    } catch {
      setError('No pudimos cargar las ligas. Probá de nuevo en un momento.');
    } finally {
      setLoading(false);
    }
  }, [statusKey, division]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-5">
      <header className="space-y-1">
        <h1 className="font-display text-2xl break-words text-gold">Ligas</h1>
        <p className="text-sm text-white/70">
          Temporadas por división, con ascensos y descensos. Se juegan por premios cosméticos y
          monedas que no valen dinero: la inscripción nunca se paga.
        </p>
      </header>

      <div className="flex flex-wrap gap-2" role="group" aria-label="Filtrar por estado">
        {FILTERS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            onClick={() => setFilter(entry.id)}
            aria-pressed={filter === entry.id}
            className={`rounded-full px-3 py-1.5 text-sm ${
              filter === entry.id ? 'bg-gold text-black' : 'border border-white/20 text-white/80'
            }`}
          >
            {entry.label}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap gap-2" role="group" aria-label="Filtrar por división">
        {DIVISIONS.map((entry) => (
          <button
            key={entry}
            type="button"
            onClick={() => setDivision(entry)}
            aria-pressed={division === entry}
            className={`rounded-full px-3 py-1.5 text-sm ${
              division === entry ? 'bg-white text-black' : 'border border-white/20 text-white/80'
            }`}
          >
            {entry === 'ALL' ? 'Todas' : LEAGUE_DIVISION_LABELS[entry]}
          </button>
        ))}
      </div>

      {loading ? (
        <p role="status" className="text-sm text-white/70">
          Cargando ligas…
        </p>
      ) : error ? (
        <p role="alert" className="text-sm text-red-300">
          {error}
        </p>
      ) : items.length === 0 ? (
        <p className="text-sm text-white/70">
          No hay ligas en esta categoría todavía. Volvé más tarde o mirá otra división.
        </p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {items.map((league) => (
            <li key={league.id}>
              <button
                type="button"
                onClick={() => onOpenLeague(league.id)}
                className="w-full rounded-xl border border-white/10 bg-white/5 p-4 text-left transition hover:border-gold/40"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-display text-lg text-white">{league.name}</span>
                  <span className="rounded-full bg-white/10 px-2 py-0.5 text-xs">
                    {LEAGUE_DIVISION_LABELS[league.division]} · {league.mode}
                  </span>
                </div>
                <p className="mt-1 text-sm text-white/70">{league.seasonLabel}</p>
                <p className="mt-2 text-xs text-white/60">
                  {LEAGUE_STATUS_LABELS[league.status]}
                  {league.currentRound !== null ? ` · jornada ${league.currentRound}` : ''}
                  {' · '}
                  {league.participantCount}/{league.capacity} jugadores
                </p>
                <p className="text-xs text-white/50">
                  Hasta {formatLeagueDate(league.endsAt)}
                  {league.official ? ' · oficial' : ''}
                </p>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
