import { DEFAULT_APP_NAME } from '@truco/shared';
import { Badge } from '@truco/ui';

// TODO(STATE-07): Implementar en M7 autenticación con 2FA obligatorio, RBAC, reportes, sanciones, auditoría y replay de partidas.
export function AdminApp() {
  const appName = (import.meta.env?.['VITE_APP_NAME'] as string | undefined) ?? DEFAULT_APP_NAME;

  return (
    <main className="min-h-screen bg-surface text-ivory flex items-center justify-center p-6">
      <section
        aria-labelledby="admin-heading"
        className="max-w-lg w-full rounded-2xl bg-cloth/40 p-8 border border-sky/30 shadow-xl space-y-4"
      >
        <div className="flex items-center justify-between gap-3">
          <Badge variant="sky">Panel Administrativo</Badge>
          <Badge variant="gold">M0 Fundación activa</Badge>
        </div>
        <h1 id="admin-heading" className="font-display text-2xl font-bold text-ivory">
          Administración · {appName}
        </h1>
        <p className="text-ivory/85 text-sm leading-relaxed">
          Aplicación administrativa aislada. Los flujos de RBAC, 2FA obligatorio, reportes,
          sanciones, replay desde match_events y audit_logs están programados en el módulo M7
          (STATE-07).
        </p>
      </section>
    </main>
  );
}
