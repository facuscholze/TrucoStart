import type { CompetitiveReviewListResponse, CompetitiveReviewStatus } from '@truco/shared';
import { useState, type FormEvent } from 'react';
import { formatDateTime } from '../lib/format.js';
import { Button, Card, EmptyState, Field, StatusPill, inputClass } from './primitives.js';

const STATUS_LABELS: Record<CompetitiveReviewStatus, string> = {
  OPEN: 'Pendiente',
  IN_REVIEW: 'En revisión',
  RESOLVED: 'Resuelto',
};

const SEVERITY_TONE = {
  LOW: 'neutral',
  MEDIUM: 'gold',
  HIGH: 'danger',
} as const;

export function CompetitiveReviewView({
  data,
  status,
  currentAdminNickname,
  busy,
  onFilterChange,
  onClaim,
  onResolve,
  onLoadMore,
}: {
  readonly data: CompetitiveReviewListResponse | null;
  readonly status: CompetitiveReviewStatus | undefined;
  readonly currentAdminNickname: string;
  readonly busy: boolean;
  readonly onFilterChange: (status: CompetitiveReviewStatus | undefined) => void;
  readonly onClaim: (caseId: string, version: number) => void;
  readonly onResolve: (caseId: string, version: number, note: string) => void;
  readonly onLoadMore: () => void;
}) {
  const [notes, setNotes] = useState<Record<string, string>>({});

  const submitResolution = (event: FormEvent<HTMLFormElement>, caseId: string, version: number) => {
    event.preventDefault();
    onResolve(caseId, version, notes[caseId] ?? '');
  };

  return (
    <div className="space-y-4">
      <Card
        title="Integridad competitiva"
        subtitle="Señales automáticas para priorizar revisión humana. No se aplican sanciones automáticas ni se bloquea el rating por una señal."
        actions={
          <label className="flex items-center gap-2 text-xs text-ivory/70">
            Estado
            <select
              className={inputClass}
              value={status ?? 'ALL'}
              onChange={(event) =>
                onFilterChange(
                  event.target.value === 'ALL'
                    ? undefined
                    : (event.target.value as CompetitiveReviewStatus),
                )
              }
              aria-label="Filtrar casos por estado"
            >
              <option value="OPEN">Pendientes</option>
              <option value="IN_REVIEW">En revisión</option>
              <option value="RESOLVED">Resueltos</option>
              <option value="ALL">Todos</option>
            </select>
          </label>
        }
      >
        <p className="text-sm leading-6 text-ivory/65">
          Las repeticiones de rivales, partidas inusualmente cortas, abandonos coordinados y
          posibles patrones de alimentación de cuentas nuevas son indicios, no conclusiones. Revisá
          la evidencia antes de tomar cualquier medida fuera de este panel.
        </p>
      </Card>

      {!data || data.items.length === 0 ? (
        <EmptyState>No hay casos para este filtro.</EmptyState>
      ) : (
        <div className="space-y-3">
          {data.items.map((item) => {
            const claimedByCurrentAdmin = item.claimedByNickname === currentAdminNickname;
            return (
              <Card
                key={item.id}
                title={`Caso ${item.id.slice(0, 8)}`}
                subtitle={`Creado ${formatDateTime(item.createdAt)} · actualizado ${formatDateTime(item.updatedAt)}`}
                actions={
                  <>
                    <StatusPill tone={SEVERITY_TONE[item.severity]}>{item.severity}</StatusPill>
                    <StatusPill tone={item.status === 'RESOLVED' ? 'success' : 'sky'}>
                      {STATUS_LABELS[item.status]}
                    </StatusPill>
                  </>
                }
              >
                <div className="space-y-4">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">
                      Señales
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {item.signals.map((signal) => (
                        <StatusPill key={signal} tone="gold">
                          {signal.replaceAll('_', ' ').toLowerCase()}
                        </StatusPill>
                      ))}
                    </div>
                  </div>

                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">
                      Cuentas relacionadas
                    </p>
                    <ul className="mt-2 flex flex-wrap gap-2">
                      {item.users.map((user) => (
                        <li
                          key={user.id}
                          className="rounded-lg border border-ivory/10 bg-surface/50 px-3 py-2 text-sm"
                        >
                          <span className="font-semibold text-ivory">{user.nickname}</span>
                          <span className="ml-2 text-xs text-muted">
                            cuenta{' '}
                            {user.accountCreatedAt
                              ? formatDateTime(user.accountCreatedAt)
                              : 'eliminada'}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">
                      Partidas vinculadas
                    </p>
                    <ul className="mt-1 flex flex-wrap gap-2 text-xs text-ivory/65">
                      {item.matchIds.map((matchId) => (
                        <li key={matchId} className="rounded bg-surface/60 px-2 py-1 font-mono">
                          {matchId}
                        </li>
                      ))}
                    </ul>
                  </div>

                  <details className="rounded-lg border border-ivory/10 bg-surface/40 p-3">
                    <summary className="cursor-pointer text-sm font-semibold text-sky">
                      Ver evidencia registrada
                    </summary>
                    <pre className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap break-words text-xs leading-5 text-ivory/70">
                      {JSON.stringify(item.evidence, null, 2)}
                    </pre>
                  </details>

                  {item.status === 'OPEN' && (
                    <Button disabled={busy} onClick={() => onClaim(item.id, item.version)}>
                      Tomar caso para revisión
                    </Button>
                  )}

                  {item.status === 'IN_REVIEW' && claimedByCurrentAdmin && (
                    <form
                      className="space-y-3 rounded-xl border border-sky/20 bg-surface/35 p-3"
                      onSubmit={(event) => submitResolution(event, item.id, item.version)}
                    >
                      <Field
                        label="Nota de resolución"
                        hint="La decisión queda auditada. No se ejecutan sanciones desde esta cola."
                      >
                        <textarea
                          className={inputClass}
                          minLength={10}
                          maxLength={1000}
                          required
                          rows={3}
                          value={notes[item.id] ?? ''}
                          onChange={(event) =>
                            setNotes((current) => ({ ...current, [item.id]: event.target.value }))
                          }
                          placeholder="Documentá el contexto revisado y la conclusión humana…"
                        />
                      </Field>
                      <Button type="submit" disabled={busy}>
                        Marcar revisión resuelta
                      </Button>
                    </form>
                  )}

                  {item.status === 'IN_REVIEW' && !claimedByCurrentAdmin && (
                    <p className="text-xs text-muted">
                      Asignado a {item.claimedByNickname ?? 'otro moderador'}.
                    </p>
                  )}

                  {item.status === 'RESOLVED' && (
                    <p className="rounded-lg border border-success/20 bg-success/5 p-3 text-sm text-ivory/75">
                      Resuelto por {item.resolvedByNickname ?? 'moderación'}
                      {item.resolutionNote ? `: ${item.resolutionNote}` : '.'}
                    </p>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {data?.nextCursor && (
        <div className="flex justify-center">
          <Button variant="secondary" disabled={busy} onClick={onLoadMore}>
            Cargar más casos
          </Button>
        </div>
      )}
    </div>
  );
}
