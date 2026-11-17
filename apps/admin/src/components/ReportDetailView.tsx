import { useState } from 'react';
import {
  REPORT_REASON_LABELS_ES_AR,
  REPORT_STATUS_LABELS_ES_AR,
  SANCTION_TYPE_LABELS_ES_AR,
  adminRoleHasPermission,
  type AdminMatchReplay,
  type AdminReportDetail,
  type AdminRole,
  type SanctionType,
} from '@truco/shared';
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

const STATUS_TONES: Record<AdminReportDetail['report']['status'], Tone> = {
  OPEN: 'danger',
  IN_REVIEW: 'gold',
  RESOLVED_ACTIONED: 'success',
  RESOLVED_DISMISSED: 'neutral',
};

export interface ReportDetailActions {
  readonly onBack: () => void;
  readonly onClaim: (expectedVersion: number) => void;
  readonly onResolve: (input: {
    outcome: 'RESOLVED_ACTIONED' | 'RESOLVED_DISMISSED';
    note: string;
    expectedVersion: number;
  }) => void;
  readonly onLoadReplay: (reason: string) => void;
  readonly onSanction: (input: {
    type: SanctionType;
    reason: string;
    durationHours?: number;
  }) => void;
  readonly onNicknameChange: (reason: string) => void;
}

export function ReportDetailView({
  detail,
  role,
  actions,
  replay,
  busy,
  error,
  notice,
}: {
  readonly detail: AdminReportDetail;
  readonly role: AdminRole;
  readonly actions: ReportDetailActions;
  readonly replay: AdminMatchReplay | null;
  readonly busy: boolean;
  readonly error: string | null;
  readonly notice: string | null;
}) {
  const [note, setNote] = useState('');
  const [replayReason, setReplayReason] = useState('');
  const [sanctionType, setSanctionType] = useState<SanctionType>('WARNING');
  const [sanctionReason, setSanctionReason] = useState('');
  const [sanctionHours, setSanctionHours] = useState('72');

  const { report, target } = detail;
  const canClaim = adminRoleHasPermission(role, 'reports:claim');
  const canResolve = adminRoleHasPermission(role, 'reports:resolve');
  const canReplay = adminRoleHasPermission(role, 'matches:replay');
  const canSanction = adminRoleHasPermission(role, 'sanctions:issue');
  const canBan = adminRoleHasPermission(role, 'sanctions:issue_ban');
  const canNickname = adminRoleHasPermission(role, 'nickname:force_change');
  const isResolved =
    report.status === 'RESOLVED_ACTIONED' || report.status === 'RESOLVED_DISMISSED';
  const sanctionTypes: readonly SanctionType[] = canBan
    ? ['WARNING', 'MUTE', 'SUSPEND', 'BAN']
    : ['WARNING', 'MUTE', 'SUSPEND'];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-gold">
            Caso {report.id.slice(0, 8)}
          </p>
          <h1 className="font-display text-xl font-bold text-ivory sm:text-2xl">
            {report.reporterNickname} reportó a {report.targetNickname}
          </h1>
        </div>
        <Button variant="ghost" onClick={actions.onBack}>
          ← Volver a la cola
        </Button>
      </div>

      {error && (
        <p
          role="alert"
          className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger"
        >
          {error}
        </p>
      )}
      {notice && (
        <p
          role="status"
          className="rounded-lg border border-success/40 bg-success/10 px-3 py-2 text-sm text-success"
        >
          {notice}
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-4">
          <Card
            title="Detalle del reporte"
            actions={
              <StatusPill tone={STATUS_TONES[report.status]}>
                {REPORT_STATUS_LABELS_ES_AR[report.status]}
              </StatusPill>
            }
          >
            <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-[11px] uppercase tracking-wide text-ivory/50">Motivo</dt>
                <dd className="text-ivory">{REPORT_REASON_LABELS_ES_AR[report.reasonCode]}</dd>
              </div>
              <div>
                <dt className="text-[11px] uppercase tracking-wide text-ivory/50">Creado</dt>
                <dd className="text-ivory">{formatDateTime(report.createdAt)}</dd>
              </div>
              <div>
                <dt className="text-[11px] uppercase tracking-wide text-ivory/50">Partida</dt>
                <dd className="text-ivory">
                  {report.matchId ? report.matchId : 'Sin partida asociada'}
                </dd>
              </div>
              <div>
                <dt className="text-[11px] uppercase tracking-wide text-ivory/50">Versión</dt>
                <dd className="text-ivory">
                  v{report.version}
                  {report.claimedByNickname ? ` · tomado por ${report.claimedByNickname}` : ''}
                </dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-[11px] uppercase tracking-wide text-ivory/50">
                  Comentario del jugador
                </dt>
                <dd className="text-ivory/85">{report.details ?? 'Sin comentario adicional.'}</dd>
              </div>
              {report.resolutionNote && (
                <div className="sm:col-span-2">
                  <dt className="text-[11px] uppercase tracking-wide text-ivory/50">Resolución</dt>
                  <dd className="text-ivory/85">
                    {report.resolutionNote}
                    {report.resolvedByNickname ? ` · ${report.resolvedByNickname}` : ''} ·{' '}
                    {formatDateTime(report.resolvedAt)}
                  </dd>
                </div>
              )}
            </dl>

            {!isResolved && (
              <div className="mt-4 flex flex-wrap gap-2">
                {canClaim && report.status === 'OPEN' && (
                  <Button
                    variant="secondary"
                    disabled={busy}
                    onClick={() => actions.onClaim(report.version)}
                  >
                    Tomar el caso
                  </Button>
                )}
                {canResolve && (
                  <span className="text-xs text-ivory/50">
                    Para resolver, justificá la decisión abajo (mínimo 10 caracteres).
                  </span>
                )}
              </div>
            )}
          </Card>

          {!isResolved && canResolve && (
            <Card title="Resolver el caso">
              <Field label="Nota de resolución" hint="Queda en audit_logs con tu usuario.">
                <textarea
                  className={`${inputClass} min-h-[80px]`}
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  placeholder="Se verificó el log de la partida y se aplicó la sanción correspondiente."
                />
              </Field>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  variant="primary"
                  disabled={busy || note.trim().length < 10}
                  onClick={() =>
                    actions.onResolve({
                      outcome: 'RESOLVED_ACTIONED',
                      note: note.trim(),
                      expectedVersion: report.version,
                    })
                  }
                >
                  Resolver con acción
                </Button>
                <Button
                  variant="secondary"
                  disabled={busy || note.trim().length < 10}
                  onClick={() =>
                    actions.onResolve({
                      outcome: 'RESOLVED_DISMISSED',
                      note: note.trim(),
                      expectedVersion: report.version,
                    })
                  }
                >
                  Desestimar
                </Button>
              </div>
            </Card>
          )}

          <Card
            title="Replay de la partida"
            subtitle="Reconstruido desde match_events con el motor. Sólo partidas terminadas."
          >
            {!detail.replayAvailable ? (
              <EmptyState>
                Sin replay disponible: el caso no tiene partida terminada con eventos.
              </EmptyState>
            ) : !canReplay ? (
              <EmptyState>
                Tu rol no tiene el permiso <code>matches:replay</code>: pedile a un moderador que
                revise la partida.
              </EmptyState>
            ) : replay ? (
              <div className="space-y-3">
                <div className="flex flex-wrap gap-2 text-xs">
                  <StatusPill tone="sky">{replay.mode}</StatusPill>
                  <StatusPill tone="neutral">{replay.rulesetCode}</StatusPill>
                  <StatusPill tone={replay.reconstructed.valid ? 'success' : 'danger'}>
                    {replay.reconstructed.valid ? 'Reconstrucción válida' : 'Inconsistente'}
                  </StatusPill>
                  <StatusPill tone="gold">{replay.reconstructed.handsPlayed} manos</StatusPill>
                </div>
                <ol className="max-h-64 space-y-1 overflow-auto rounded-xl border border-ivory/10 bg-surface/50 p-3 text-xs">
                  {replay.events.map((event) => (
                    <li key={event.seq} className="flex gap-2">
                      <span className="w-8 shrink-0 text-ivory/40">#{event.seq}</span>
                      <span className="font-mono text-sky">{event.type}</span>
                      <span className="text-ivory/55">{formatDateTime(event.at)}</span>
                    </li>
                  ))}
                </ol>
              </div>
            ) : (
              <div className="space-y-2">
                <Field
                  label="Motivo del acceso"
                  hint="Obligatorio: se audita con actor, motivo y fecha."
                >
                  <input
                    className={inputClass}
                    value={replayReason}
                    onChange={(event) => setReplayReason(event.target.value)}
                    placeholder="Verificar una denuncia de colusión"
                  />
                </Field>
                <Button
                  variant="secondary"
                  disabled={busy || replayReason.trim().length < 10}
                  onClick={() => actions.onLoadReplay(replayReason.trim())}
                >
                  Abrir replay auditado
                </Button>
              </div>
            )}
          </Card>
        </div>

        <div className="space-y-4">
          <Card title="Jugador reportado" subtitle={`Estado actual de ${target.nickname}`}>
            <div className="space-y-1.5 text-xs text-ivory/75">
              <p>
                <span className="text-ivory/50">Estado:</span>{' '}
                <StatusPill
                  tone={
                    target.status === 'ACTIVE'
                      ? 'success'
                      : target.status === 'SUSPENDED'
                        ? 'gold'
                        : 'danger'
                  }
                >
                  {target.status}
                </StatusPill>
              </p>
              {target.statusReason && <p>Motivo: {target.statusReason}</p>}
              {target.statusExpiresAt && <p>Vence: {formatExpiry(target.statusExpiresAt)}</p>}
              {target.mutedUntil && <p>Silenciado: {formatExpiry(target.mutedUntil)}</p>}
              <p>Sanciones históricas: {target.sanctionsCount}</p>
              <p>Reportes abiertos en su contra: {target.openReportsAgainst}</p>
            </div>
          </Card>

          {canSanction && (
            <Card
              title="Sancionar"
              subtitle="Motivo obligatorio y vencimiento para silencio o más."
            >
              <div className="space-y-2">
                <Field label="Tipo">
                  <select
                    className={inputClass}
                    value={sanctionType}
                    onChange={(event) => setSanctionType(event.target.value as SanctionType)}
                  >
                    {sanctionTypes.map((type) => (
                      <option key={type} value={type}>
                        {SANCTION_TYPE_LABELS_ES_AR[type]}
                      </option>
                    ))}
                  </select>
                </Field>
                {sanctionType !== 'WARNING' && (
                  <Field label="Duración (horas)">
                    <input
                      type="number"
                      min={1}
                      max={8760}
                      className={inputClass}
                      value={sanctionHours}
                      onChange={(event) => setSanctionHours(event.target.value)}
                    />
                  </Field>
                )}
                <Field label="Motivo">
                  <textarea
                    className={`${inputClass} min-h-[70px]`}
                    value={sanctionReason}
                    onChange={(event) => setSanctionReason(event.target.value)}
                    placeholder="Se verificó colusión en tres manos consecutivas."
                  />
                </Field>
                <Button
                  variant="danger"
                  disabled={busy || sanctionReason.trim().length < 10}
                  onClick={() =>
                    actions.onSanction({
                      type: sanctionType,
                      reason: sanctionReason.trim(),
                      ...(sanctionType === 'WARNING'
                        ? {}
                        : { durationHours: Number(sanctionHours) }),
                    })
                  }
                >
                  Aplicar sanción
                </Button>
              </div>
            </Card>
          )}

          {canNickname && (
            <Card title="Apodo ofensivo" subtitle="Fuerza el cambio de apodo del jugador.">
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() =>
                  actions.onNicknameChange(
                    report.reasonCode === 'OFFENSIVE_NICKNAME'
                      ? 'Apodo ofensivo reportado y verificado'
                      : 'Apodo ofensivo detectado en moderación',
                  )
                }
              >
                Forzar cambio de apodo
              </Button>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
