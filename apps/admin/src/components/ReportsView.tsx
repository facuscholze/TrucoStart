import {
  REPORT_REASON_LABELS_ES_AR,
  REPORT_STATUS_LABELS_ES_AR,
  type AdminReportListItem,
  type AdminReportListResponse,
  type ReportReasonCode,
  type ReportStatus,
} from '@truco/shared';
import type { ReportFilters } from '../lib/api.js';
import { formatDateTime } from '../lib/format.js';
import { Button, Card, EmptyState, StatusPill, inputClass, type Tone } from './primitives.js';

const STATUS_TONES: Record<ReportStatus, Tone> = {
  OPEN: 'danger',
  IN_REVIEW: 'gold',
  RESOLVED_ACTIONED: 'success',
  RESOLVED_DISMISSED: 'neutral',
};

const STATUS_ORDER: readonly ReportStatus[] = [
  'OPEN',
  'IN_REVIEW',
  'RESOLVED_ACTIONED',
  'RESOLVED_DISMISSED',
];

const REASON_ORDER: readonly ReportReasonCode[] = [
  'ABANDONMENT',
  'COLLUSION',
  'OFFENSIVE_NICKNAME',
  'ABUSIVE_BEHAVIOR',
  'OTHER',
];

export function ReportsView({
  data,
  filters,
  onFilterChange,
  onOpenReport,
}: {
  readonly data: AdminReportListResponse;
  readonly filters: ReportFilters;
  readonly onFilterChange: (filters: ReportFilters) => void;
  readonly onOpenReport: (reportId: string) => void;
}) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {STATUS_ORDER.map((status) => (
          <button
            key={status}
            type="button"
            onClick={() => onFilterChange({ ...filters, status })}
            aria-pressed={filters.status === status}
            className={`rounded-2xl border p-3 text-left transition ${
              filters.status === status
                ? 'border-sky/60 bg-sky/15'
                : 'border-ivory/15 bg-surface/50 hover:border-sky/30'
            }`}
          >
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">
              {REPORT_STATUS_LABELS_ES_AR[status]}
            </p>
            <p className="mt-1 font-display text-2xl font-bold text-ivory">{data.totals[status]}</p>
          </button>
        ))}
      </div>

      <Card
        title="Cola de reportes"
        subtitle="Filtrá por estado y motivo. Dos moderadores no pueden resolver el mismo caso."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <label className="sr-only" htmlFor="report-reason-filter">
              Motivo
            </label>
            <select
              id="report-reason-filter"
              className={`${inputClass} w-auto`}
              value={filters.reasonCode ?? ''}
              onChange={(event) =>
                onFilterChange({
                  ...filters,
                  reasonCode: (event.target.value || undefined) as ReportReasonCode | undefined,
                })
              }
            >
              <option value="">Todos los motivos</option>
              {REASON_ORDER.map((reason) => (
                <option key={reason} value={reason}>
                  {REPORT_REASON_LABELS_ES_AR[reason]}
                </option>
              ))}
            </select>
            <Button variant="ghost" onClick={() => onFilterChange({})}>
              Limpiar
            </Button>
          </div>
        }
      >
        {data.items.length === 0 ? (
          <EmptyState>No hay reportes con estos filtros.</EmptyState>
        ) : (
          <ul className="space-y-2">
            {data.items.map((report: AdminReportListItem) => (
              <li key={report.id} className="rounded-xl border border-ivory/10 bg-surface/50 p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-ivory">
                      {report.reporterNickname} reportó a {report.targetNickname}
                    </p>
                    <p className="mt-1 text-xs text-ivory/60">
                      {REPORT_REASON_LABELS_ES_AR[report.reasonCode]} ·{' '}
                      {formatDateTime(report.createdAt)}
                      {report.matchId
                        ? ` · partida ${report.matchId.slice(0, 8)}…`
                        : ' · sin partida'}
                      {report.duplicateCount > 0
                        ? ` · ${report.duplicateCount} duplicado(s) fusionado(s)`
                        : ''}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusPill tone={STATUS_TONES[report.status]}>
                      {REPORT_STATUS_LABELS_ES_AR[report.status]}
                    </StatusPill>
                    {report.claimedByNickname && report.status === 'IN_REVIEW' && (
                      <StatusPill tone="sky">Tomado por {report.claimedByNickname}</StatusPill>
                    )}
                    <Button variant="secondary" onClick={() => onOpenReport(report.id)}>
                      Abrir caso
                    </Button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
