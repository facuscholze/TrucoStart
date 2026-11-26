import type { AdminAuditEntry } from '@truco/shared';
import { formatDateTime } from '../lib/format.js';
import { Card, EmptyState, StatusPill } from './primitives.js';

export function AuditView({ entries }: { readonly entries: readonly AdminAuditEntry[] }) {
  return (
    <Card
      title="Auditoría"
      subtitle="Registro inmutable: UPDATE y DELETE están bloqueados a nivel de base de datos."
    >
      {entries.length === 0 ? (
        <EmptyState>Sin registros de auditoría para los filtros actuales.</EmptyState>
      ) : (
        <ul className="space-y-2">
          {entries.map((entry) => (
            <li key={entry.id} className="rounded-xl border border-ivory/10 bg-surface/50 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusPill tone="sky">{entry.action}</StatusPill>
                  <span className="text-xs text-ivory/60">
                    {entry.entity}
                    {entry.entityId ? ` · ${entry.entityId.slice(0, 8)}…` : ''}
                  </span>
                </div>
                <span className="text-[11px] text-muted">{formatDateTime(entry.createdAt)}</span>
              </div>
              <p className="mt-1 text-xs text-ivory/70">
                Actor: {entry.actorNickname ?? 'sistema'} · Motivo: {entry.reason ?? 'no informado'}
                {entry.ip ? ` · IP ${entry.ip}` : ''}
              </p>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
