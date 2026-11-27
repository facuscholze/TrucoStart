import type { AdminLeagueAuditResponse, LeagueStatus, LeagueSummary } from '@truco/shared';
import { useState, type FormEvent } from 'react';
import { Button, Card, EmptyState, Field, inputClass, StatusPill } from './primitives.js';

const STATUS_LABELS: Record<LeagueStatus, string> = {
  DRAFT: 'Borrador',
  REGISTRATION: 'Inscripción abierta',
  ACTIVE: 'En juego',
  CLOSING: 'Cerrando',
  FINISHED: 'Terminada',
  CANCELLED: 'Cancelada',
};

const STATUS_TONE: Record<LeagueStatus, 'neutral' | 'sky' | 'gold' | 'danger' | 'success'> = {
  DRAFT: 'neutral',
  REGISTRATION: 'sky',
  ACTIVE: 'gold',
  CLOSING: 'gold',
  FINISHED: 'success',
  CANCELLED: 'danger',
};

const FILTERS: ReadonlyArray<{ readonly label: string; readonly value: LeagueStatus | '' }> = [
  { label: 'Todas', value: '' },
  { label: 'Inscripción', value: 'REGISTRATION' },
  { label: 'En juego', value: 'ACTIVE' },
  { label: 'Cerrando', value: 'CLOSING' },
  { label: 'Terminadas', value: 'FINISHED' },
];

/** Motivo mínimo del servidor: 5 caracteres. Se avisa antes de mandar el formulario. */
const MIN_REASON = 5;

/**
 * Administración de ligas (M10b, entrega 2).
 *
 * Cada acción destructiva pide un motivo y el servidor lo guarda con el estado anterior y el
 * posterior en `audit_logs`: la pantalla no inventa auditoría, la muestra. Después de cada
 * acción se recarga el detalle para que lo que se ve sea lo que quedó guardado.
 *
 * El cierre de temporada es el mismo camino que el automático: si dos personas aprietan el
 * botón a la vez, el segundo cierre ve la liga ya terminada y no duplica premios.
 */
export function LeaguesAdminView({
  data,
  filters,
  audit,
  busy,
  error,
  onFilterChange,
  onOpenAudit,
  onCloseAudit,
  onStart,
  onCloseRound,
  onCloseSeason,
}: {
  readonly data: { readonly items: readonly LeagueSummary[] };
  readonly filters: { readonly status?: LeagueStatus | undefined };
  readonly audit: AdminLeagueAuditResponse | null;
  readonly busy: boolean;
  readonly error: string | null;
  readonly onFilterChange: (status: LeagueStatus | undefined) => void;
  readonly onOpenAudit: (leagueId: string) => void;
  readonly onCloseAudit: () => void;
  readonly onStart: (leagueId: string, reason: string) => void;
  readonly onCloseRound: (roundId: string, reason: string) => void;
  readonly onCloseSeason: (leagueId: string, reason: string) => void;
}) {
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState<string | null>(null);

  const submitReason = (event: FormEvent, action: (reason: string) => void) => {
    event.preventDefault();
    const trimmed = reason.trim();
    if (trimmed.length < MIN_REASON) {
      setReasonError(`El motivo tiene que tener al menos ${MIN_REASON} caracteres.`);
      return;
    }
    setReasonError(null);
    action(trimmed);
    setReason('');
  };

  return (
    <div className="space-y-4">
      <Card
        title="Ligas por temporada"
        subtitle="Divisiones con ascensos y descensos. Toda acción queda auditada con su motivo."
        actions={
          <div className="flex flex-wrap gap-1">
            {FILTERS.map((filter) => (
              <Button
                key={filter.label}
                variant={filters.status === (filter.value || undefined) ? 'primary' : 'ghost'}
                onClick={() => onFilterChange(filter.value === '' ? undefined : filter.value)}
              >
                {filter.label}
              </Button>
            ))}
          </div>
        }
      >
        {error ? (
          <p role="alert" className="mb-3 rounded-lg bg-danger/15 px-3 py-2 text-sm text-danger">
            {error}
          </p>
        ) : null}

        {data.items.length === 0 ? (
          <EmptyState>No hay ligas en este filtro.</EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] border-collapse text-left text-sm">
              <caption className="sr-only">Ligas administrables con su estado y acciones</caption>
              <thead>
                <tr className="text-[11px] uppercase tracking-wide text-ivory/55">
                  <th scope="col" className="py-2 pr-3">
                    Liga
                  </th>
                  <th scope="col" className="py-2 pr-3">
                    División
                  </th>
                  <th scope="col" className="py-2 pr-3">
                    Estado
                  </th>
                  <th scope="col" className="py-2 pr-3">
                    Jugadores
                  </th>
                  <th scope="col" className="py-2">
                    Acciones
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((league) => (
                  <tr key={league.id} className="border-t border-ivory/10 align-top">
                    <td className="py-2 pr-3">
                      <span className="block font-semibold">{league.name}</span>
                      <span className="block text-[11px] text-ivory/55">
                        {league.seasonLabel} · {league.mode} · organiza{' '}
                        {league.createdByNickname || 'cuenta eliminada'}
                      </span>
                    </td>
                    <td className="py-2 pr-3">{league.division}</td>
                    <td className="py-2 pr-3">
                      <StatusPill tone={STATUS_TONE[league.status]}>
                        {STATUS_LABELS[league.status]}
                      </StatusPill>
                    </td>
                    <td className="py-2 pr-3 tabular-nums">
                      {league.participantCount}/{league.capacity}
                    </td>
                    <td className="py-2">
                      <div className="flex flex-wrap gap-1">
                        <Button variant="ghost" onClick={() => onOpenAudit(league.id)}>
                          Ver auditoría
                        </Button>
                        {league.status === 'REGISTRATION' ? (
                          <Button
                            variant="secondary"
                            disabled={busy}
                            onClick={() => onStart(league.id, 'Inicio manual desde el panel')}
                          >
                            Iniciar
                          </Button>
                        ) : null}
                        {league.status === 'ACTIVE' || league.status === 'CLOSING' ? (
                          <Button
                            variant="danger"
                            disabled={busy}
                            onClick={() =>
                              onCloseSeason(league.id, 'Cierre de temporada desde el panel')
                            }
                          >
                            Cerrar temporada
                          </Button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {audit ? (
        <Card
          title="Auditoría de la liga"
          subtitle="Cierre, movimientos de división y partidas definidas sin jugar."
          actions={
            <Button variant="ghost" onClick={onCloseAudit}>
              Cerrar
            </Button>
          }
        >
          <dl className="grid gap-2 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-[11px] uppercase tracking-wide text-ivory/55">Estado</dt>
              <dd>{STATUS_LABELS[audit.status]}</dd>
            </div>
            <div>
              <dt className="text-[11px] uppercase tracking-wide text-ivory/55">Cierre</dt>
              <dd>
                {audit.closure
                  ? `${new Date(audit.closure.closedAt).toLocaleString('es-AR')} · ${audit.closure.forfeitedMatches} partida(s) sin jugar`
                  : 'Todavía sin cerrar'}
              </dd>
            </div>
            <div>
              <dt className="text-[11px] uppercase tracking-wide text-ivory/55">Ascendidos</dt>
              <dd className="font-mono text-[11px] break-all">
                {audit.closure?.promoted.length ? audit.closure.promoted.join(', ') : '—'}
              </dd>
            </div>
            <div>
              <dt className="text-[11px] uppercase tracking-wide text-ivory/55">Descendidos</dt>
              <dd className="font-mono text-[11px] break-all">
                {audit.closure?.relegated.length ? audit.closure.relegated.join(', ') : '—'}
              </dd>
            </div>
          </dl>

          <p className="mt-3 text-sm text-ivory/75">
            {audit.currentRound
              ? `Jornada abierta: la ${audit.currentRound.number}, con plazo hasta ${new Date(
                  audit.currentRound.deadlineAt,
                ).toLocaleString('es-AR')}.`
              : 'No hay una jornada abierta en este momento.'}
          </p>

          <h3 className="mt-4 mb-2 text-sm font-semibold">Movimientos de división</h3>
          {audit.movements.length === 0 ? (
            <EmptyState>Sin movimientos: la temporada todavía no cerró.</EmptyState>
          ) : (
            <ul className="space-y-1 text-sm">
              {audit.movements.map((movement) => (
                <li
                  key={`${movement.userId}-${movement.kind}-${movement.createdAt}`}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-ivory/10 px-3 py-1.5"
                >
                  <span className="font-mono text-[11px] break-all">{movement.userId}</span>
                  <span className="text-[11px] text-ivory/65">
                    {movement.kind} · {movement.fromDivision} → {movement.toDivision} ·{' '}
                    {new Date(movement.createdAt).toLocaleString('es-AR')}
                  </span>
                </li>
              ))}
            </ul>
          )}

          {audit.currentRound ? (
            <form
              className="mt-4 space-y-2"
              onSubmit={(event) =>
                submitReason(event, (value) => onCloseRound(audit.currentRound!.id, value))
              }
            >
              <Field
                label="Motivo del cierre de jornada"
                hint="Se guarda en la auditoría junto con el estado anterior y el posterior."
              >
                <input
                  className={inputClass}
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  maxLength={300}
                />
              </Field>
              {reasonError ? (
                <p role="alert" className="text-sm text-danger">
                  {reasonError}
                </p>
              ) : null}
              <Button type="submit" variant="secondary" disabled={busy}>
                Cerrar jornada {audit.currentRound.number}
              </Button>
            </form>
          ) : null}
        </Card>
      ) : null}
    </div>
  );
}
