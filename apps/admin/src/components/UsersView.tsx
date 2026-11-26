import {
  SANCTION_TYPE_LABELS_ES_AR,
  type AdminUserDetail,
  type AdminUserListItem,
  type SanctionType,
} from '@truco/shared';
import { useState } from 'react';
import { formatDateTime, formatExpiry } from '../lib/format.js';
import {
  Button,
  Card,
  EmptyState,
  Field,
  StatusPill,
  inputClass,
  type Tone,
} from './primitives.js';

const STATUS_TONES: Record<AdminUserListItem['status'], Tone> = {
  ACTIVE: 'success',
  SUSPENDED: 'gold',
  BANNED: 'danger',
  DELETED: 'neutral',
};

export function UsersView({
  users,
  query,
  onSearch,
  onOpenUser,
}: {
  readonly users: readonly AdminUserListItem[];
  readonly query: string;
  readonly onSearch: (query: string) => void;
  readonly onOpenUser: (userId: string) => void;
}) {
  const [draft, setDraft] = useState(query);

  return (
    <Card
      title="Usuarios"
      subtitle="Búsqueda por apodo o email. Los emails se muestran enmascarados salvo permiso explícito."
      actions={
        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            onSearch(draft.trim());
          }}
        >
          <label className="sr-only" htmlFor="user-search">
            Buscar usuario
          </label>
          <input
            id="user-search"
            className={`${inputClass} w-48`}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Apodo o email"
          />
          <Button type="submit" variant="secondary">
            Buscar
          </Button>
        </form>
      }
    >
      {users.length === 0 ? (
        <EmptyState>Sin resultados para la búsqueda actual.</EmptyState>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead>
              <tr className="text-[11px] uppercase tracking-wider text-muted">
                <th className="pb-2">Jugador</th>
                <th className="pb-2">Email</th>
                <th className="pb-2">Rol</th>
                <th className="pb-2">Estado</th>
                <th className="pb-2">Reportes</th>
                <th className="pb-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-ivory/10">
              {users.map((user) => (
                <tr key={user.id}>
                  <td className="py-2">
                    <p className="font-semibold text-ivory">{user.nickname}</p>
                    <p className="text-[11px] text-muted">
                      Última conexión: {formatDateTime(user.lastSeenAt)}
                    </p>
                  </td>
                  <td className="py-2 text-ivory/70">{user.emailMasked ?? '—'}</td>
                  <td className="py-2 text-ivory/70">{user.role}</td>
                  <td className="py-2">
                    <StatusPill tone={STATUS_TONES[user.status]}>{user.status}</StatusPill>
                  </td>
                  <td className="py-2 text-ivory/70">{user.openReportsAgainst}</td>
                  <td className="py-2 text-right">
                    <Button variant="ghost" onClick={() => onOpenUser(user.id)}>
                      Ver ficha
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

export function UserDetailPanel({
  detail,
  canSanction,
  canBan,
  canReadPii,
  busy,
  onSanction,
  onForceNickname,
  onBack,
}: {
  readonly detail: AdminUserDetail;
  readonly canSanction: boolean;
  readonly canBan: boolean;
  readonly canReadPii: boolean;
  readonly busy: boolean;
  readonly onSanction: (input: {
    type: SanctionType;
    reason: string;
    durationHours?: number;
  }) => void;
  readonly onForceNickname: () => void;
  readonly onBack: () => void;
}) {
  const [type, setType] = useState<SanctionType>('WARNING');
  const [reason, setReason] = useState('');
  const [hours, setHours] = useState('72');
  const types: readonly SanctionType[] = canBan
    ? ['WARNING', 'MUTE', 'SUSPEND', 'BAN']
    : ['WARNING', 'MUTE', 'SUSPEND'];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="font-display text-xl font-bold text-ivory sm:text-2xl">
          {detail.nickname}{' '}
          <StatusPill tone={STATUS_TONES[detail.status]}>{detail.status}</StatusPill>
        </h1>
        <Button variant="ghost" onClick={onBack}>
          ← Volver a usuarios
        </Button>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Card
          title="Historial de sanciones"
          subtitle="Advertencias, silencios, suspensiones y bloqueos"
        >
          {detail.sanctions.length === 0 ? (
            <EmptyState>El jugador no tiene sanciones registradas.</EmptyState>
          ) : (
            <ul className="space-y-2">
              {detail.sanctions.map((sanction) => (
                <li
                  key={sanction.id}
                  className="rounded-xl border border-ivory/10 bg-surface/50 p-3"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-ivory">
                      {SANCTION_TYPE_LABELS_ES_AR[sanction.type]}
                    </p>
                    <div className="flex items-center gap-2">
                      {sanction.revokedAt && <StatusPill tone="neutral">Revocada</StatusPill>}
                      <span className="text-[11px] text-muted">
                        {formatDateTime(sanction.createdAt)}
                      </span>
                    </div>
                  </div>
                  <p className="mt-1 text-xs text-ivory/70">{sanction.reason}</p>
                  <p className="mt-1 text-[11px] text-muted">
                    {sanction.issuedByNickname ? `Por ${sanction.issuedByNickname}` : 'Sistema'} ·{' '}
                    {formatExpiry(sanction.expiresAt)}
                  </p>
                </li>
              ))}
            </ul>
          )}

          <div className="mt-4">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
              Partidas recientes
            </h3>
            {detail.recentMatches.length === 0 ? (
              <EmptyState>Sin partidas registradas.</EmptyState>
            ) : (
              <ul className="space-y-1 text-xs text-ivory/70">
                {detail.recentMatches.map((match) => (
                  <li key={match.matchId} className="flex justify-between gap-2">
                    <span className="font-mono text-muted">{match.matchId.slice(0, 8)}…</span>
                    <span>
                      {match.mode} · {match.outcome}
                    </span>
                    <span className="text-muted">{formatDateTime(match.endedAt)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Card>

        <div className="space-y-4">
          <Card title="Datos de la cuenta">
            <dl className="space-y-1 text-xs text-ivory/75">
              <div>
                <dt className="text-muted">Email</dt>
                <dd>{canReadPii ? (detail.email ?? '—') : (detail.emailMasked ?? '—')}</dd>
              </div>
              <div>
                <dt className="text-muted">Rol</dt>
                <dd>{detail.role}</dd>
              </div>
              <div>
                <dt className="text-muted">Alta</dt>
                <dd>{formatDateTime(detail.createdAt)}</dd>
              </div>
              <div>
                <dt className="text-muted">Reportes abiertos</dt>
                <dd>{detail.openReportsAgainst}</dd>
              </div>
            </dl>
          </Card>

          {canSanction && (
            <Card title="Nueva sanción">
              <div className="space-y-2">
                <Field label="Tipo">
                  <select
                    className={inputClass}
                    value={type}
                    onChange={(event) => setType(event.target.value as SanctionType)}
                  >
                    {types.map((option) => (
                      <option key={option} value={option}>
                        {SANCTION_TYPE_LABELS_ES_AR[option]}
                      </option>
                    ))}
                  </select>
                </Field>
                {type !== 'WARNING' && (
                  <Field label="Duración (horas)">
                    <input
                      type="number"
                      min={1}
                      max={8760}
                      className={inputClass}
                      value={hours}
                      onChange={(event) => setHours(event.target.value)}
                    />
                  </Field>
                )}
                <Field label="Motivo">
                  <textarea
                    className={`${inputClass} min-h-[70px]`}
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                  />
                </Field>
                <Button
                  variant="danger"
                  disabled={busy || reason.trim().length < 10}
                  onClick={() =>
                    onSanction({
                      type,
                      reason: reason.trim(),
                      ...(type === 'WARNING' ? {} : { durationHours: Number(hours) }),
                    })
                  }
                >
                  Aplicar sanción
                </Button>
              </div>
            </Card>
          )}

          <Card title="Apodo">
            <Button variant="secondary" disabled={busy} onClick={onForceNickname}>
              Forzar cambio de apodo
            </Button>
          </Card>
        </div>
      </div>
    </div>
  );
}
