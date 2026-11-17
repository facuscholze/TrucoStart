import {
  REPORT_REASON_LABELS_ES_AR,
  REPORT_STATUS_LABELS_ES_AR,
  type AdminDashboardMetrics,
  type AdminReportListItem,
} from '@truco/shared';
import { formatDateTime } from '../lib/format.js';
import { Button, Card, EmptyState, StatCard, StatusPill, type Tone } from './primitives.js';

const STATUS_TONES: Record<AdminReportListItem['status'], Tone> = {
  OPEN: 'danger',
  IN_REVIEW: 'gold',
  RESOLVED_ACTIONED: 'success',
  RESOLVED_DISMISSED: 'neutral',
};

export function DashboardView({
  metrics,
  recentReports,
  onOpenReport,
  canClaimReports,
}: {
  readonly metrics: AdminDashboardMetrics;
  readonly recentReports: readonly AdminReportListItem[];
  readonly onOpenReport: (reportId: string) => void;
  readonly canClaimReports: boolean;
}) {
  return (
    <div className="space-y-4">
      <Card
        title="Pulso de la comunidad"
        subtitle={`Métricas generadas el ${formatDateTime(metrics.generatedAt)}`}
      >
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard label="Usuarios activos (24 h)" value={metrics.activeUsers24h} tone="sky" />
          <StatCard label="Partidas en curso" value={metrics.matchesInProgress} tone="gold" />
          <StatCard
            label="Reportes abiertos"
            value={metrics.openReports}
            tone={metrics.openReports > 0 ? 'danger' : 'success'}
            hint="Cola de moderación pendiente"
          />
          <StatCard label="Sanciones vigentes" value={metrics.sanctionsActive} tone="danger" />
          <StatCard label="Usuarios totales" value={metrics.usersTotal} tone="neutral" />
          <StatCard label="Partidas terminadas (24 h)" value={metrics.matchesFinished24h} />
          <StatCard
            label="Reportes resueltos (24 h)"
            value={metrics.reportsResolved24h}
            tone="success"
          />
        </div>
      </Card>

      <Card title="Reportes recientes" subtitle="Últimos casos ingresados a la cola">
        {recentReports.length === 0 ? (
          <EmptyState>No hay reportes abiertos: la cola está limpia.</EmptyState>
        ) : (
          <ul className="divide-y divide-ivory/10">
            {recentReports.map((report) => (
              <li
                key={report.id}
                className="flex flex-wrap items-center justify-between gap-2 py-2.5"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-ivory">
                    {report.reporterNickname} → {report.targetNickname}
                  </p>
                  <p className="text-xs text-ivory/60">
                    {REPORT_REASON_LABELS_ES_AR[report.reasonCode]} ·{' '}
                    {formatDateTime(report.createdAt)}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <StatusPill tone={STATUS_TONES[report.status]}>
                    {REPORT_STATUS_LABELS_ES_AR[report.status]}
                  </StatusPill>
                  <Button variant="ghost" onClick={() => onOpenReport(report.id)}>
                    {canClaimReports ? 'Revisar' : 'Ver'}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
