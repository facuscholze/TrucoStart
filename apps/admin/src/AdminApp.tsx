import {
  adminRoleHasPermission,
  type AdminAuditEntry,
  type AdminDashboardMetrics,
  type AdminMatchReplay,
  type AdminReportDetail,
  type AdminReportListResponse,
  type AdminSessionSummary,
  type AdminUserDetail,
  type AdminUserListItem,
} from '@truco/shared';
import { useCallback, useEffect, useState } from 'react';
import { AuditView } from './components/AuditView.js';
import { DashboardView } from './components/DashboardView.js';
import { LoginView } from './components/LoginView.js';
import { ReportDetailView } from './components/ReportDetailView.js';
import { ReportsView } from './components/ReportsView.js';
import { UserDetailPanel, UsersView } from './components/UsersView.js';
import { Button, StatusPill } from './components/primitives.js';
import { AdminApiError, httpAdminClient, type AdminClient, type ReportFilters } from './lib/api.js';

type View =
  | { readonly name: 'dashboard' }
  | { readonly name: 'reports'; readonly filters: ReportFilters }
  | { readonly name: 'report'; readonly reportId: string }
  | { readonly name: 'users'; readonly query: string }
  | { readonly name: 'user'; readonly userId: string }
  | { readonly name: 'audit' };

const NAV: ReadonlyArray<{
  readonly key: View['name'];
  readonly label: string;
  readonly permission: 'dashboard:read' | 'reports:read' | 'users:read' | 'audit:read';
}> = [
  { key: 'dashboard', label: 'Dashboard', permission: 'dashboard:read' },
  { key: 'reports', label: 'Reportes', permission: 'reports:read' },
  { key: 'users', label: 'Usuarios', permission: 'users:read' },
  { key: 'audit', label: 'Auditoría', permission: 'audit:read' },
];

const ROLE_LABELS: Record<AdminSessionSummary['role'], string> = {
  SUPPORT: 'Soporte',
  MODERATOR: 'Moderador',
  ADMIN: 'Administrador',
};

function errorMessage(error: unknown): string {
  if (error instanceof AdminApiError) {
    return `${error.message} (${error.code})`;
  }
  return error instanceof Error ? error.message : 'Error inesperado';
}

export function AdminApp({
  client = httpAdminClient,
}: {
  readonly client?: AdminClient;
} = {}) {
  // El cliente con datos de ejemplo se carga con `import()` dinámico sólo si el flag
  // existe en tiempo de build: en producción Vite lo elimina por completo del bundle.
  const demoMode = import.meta.env?.['VITE_ADMIN_DEMO'] === '1';
  const [activeClient, setActiveClient] = useState<AdminClient | null>(demoMode ? null : client);

  const [session, setSession] = useState<AdminSessionSummary | null>(null);
  const [booting, setBooting] = useState(true);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [loginPending, setLoginPending] = useState(false);
  const [view, setView] = useState<View>({ name: 'dashboard' });
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [metrics, setMetrics] = useState<AdminDashboardMetrics | null>(null);
  const [reportList, setReportList] = useState<AdminReportListResponse | null>(null);
  const [reportDetail, setReportDetail] = useState<AdminReportDetail | null>(null);
  const [replay, setReplay] = useState<AdminMatchReplay | null>(null);
  const [users, setUsers] = useState<readonly AdminUserListItem[]>([]);
  const [userDetail, setUserDetail] = useState<AdminUserDetail | null>(null);
  const [auditEntries, setAuditEntries] = useState<readonly AdminAuditEntry[]>([]);

  useEffect(() => {
    if (!demoMode) {
      setActiveClient(client);
      return;
    }
    let cancelled = false;
    void import('./lib/demo.js')
      .then((module) => {
        if (!cancelled) setActiveClient(module.createDemoClient());
      })
      .catch(() => {
        if (!cancelled) setActiveClient(client);
      });
    return () => {
      cancelled = true;
    };
  }, [client, demoMode]);

  useEffect(() => {
    if (!activeClient) return;
    let cancelled = false;
    void activeClient
      .me()
      .then((summary) => {
        if (!cancelled) setSession(summary);
      })
      .catch(() => {
        if (!cancelled) setSession(null);
      })
      .finally(() => {
        if (!cancelled) setBooting(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeClient]);

  useEffect(() => {
    if (!session || !activeClient) return;
    let cancelled = false;
    const load = async () => {
      try {
        if (view.name === 'dashboard') {
          const [dashboard, reports] = await Promise.all([
            activeClient.dashboard(),
            activeClient.listReports({ status: 'OPEN' }),
          ]);
          if (cancelled) return;
          setMetrics(dashboard);
          setReportList(reports);
        } else if (view.name === 'reports') {
          const reports = await activeClient.listReports(view.filters);
          if (cancelled) return;
          setReportList(reports);
        } else if (view.name === 'report') {
          const detail = await activeClient.reportDetail(view.reportId);
          if (cancelled) return;
          setReportDetail(detail);
          setReplay(null);
        } else if (view.name === 'users') {
          const list = await activeClient.listUsers({ query: view.query });
          if (cancelled) return;
          setUsers(list.items);
        } else if (view.name === 'user') {
          const detail = await activeClient.userDetail(
            view.userId,
            'Consulta de historial de sanciones',
          );
          if (cancelled) return;
          setUserDetail(detail);
        } else {
          const audit = await activeClient.listAudit({});
          if (cancelled) return;
          setAuditEntries(audit.items);
        }
      } catch (loadError) {
        if (!cancelled) setError(errorMessage(loadError));
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [activeClient, session, view]);

  const navigate = useCallback((next: View) => {
    setError(null);
    setNotice(null);
    setView(next);
  }, []);

  const handleLogin = useCallback(
    (credentials: Parameters<AdminClient['login']>[0]) => {
      if (!activeClient) return;
      setLoginPending(true);
      setLoginError(null);
      void activeClient
        .login(credentials)
        .then((summary) => {
          setSession(summary);
          setView({ name: 'dashboard' });
        })
        .catch((loginFailure: unknown) => setLoginError(errorMessage(loginFailure)))
        .finally(() => setLoginPending(false));
    },
    [activeClient],
  );

  const handleLogout = useCallback(() => {
    if (!activeClient) return;
    void activeClient.logout().finally(() => {
      setSession(null);
      setNotice(null);
      setReportDetail(null);
      setUserDetail(null);
    });
  }, [activeClient]);

  if (booting || !activeClient) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-surface text-ivory/70">
        Cargando panel…
      </main>
    );
  }

  if (!session) {
    return <LoginView onSubmit={handleLogin} error={loginError} pending={loginPending} />;
  }

  const visibleNav = NAV.filter((item) => adminRoleHasPermission(session.role, item.permission));
  const currentKey =
    view.name === 'report' ? 'reports' : view.name === 'user' ? 'users' : view.name;

  const withBusy = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await action();
    } catch (actionError) {
      setError(errorMessage(actionError));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-surface text-ivory">
      <div className="mx-auto flex max-w-[1200px] flex-col gap-4 px-4 py-4 lg:flex-row lg:gap-6 lg:py-6">
        <aside className="lg:w-56 lg:shrink-0">
          <div className="rounded-2xl border border-sky/25 bg-cloth/40 p-4">
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-gold">
              Truco Start
            </p>
            <h1 className="font-display text-lg font-bold">Panel administrativo</h1>
            <p className="mt-2 text-[11px] text-ivory/60">
              {session.nickname} · {ROLE_LABELS[session.role]}
            </p>
            <p className="text-[11px] text-ivory/45">{session.emailMasked}</p>
            <div className="mt-2">
              <StatusPill tone="success">2FA activo</StatusPill>
            </div>
            <nav className="mt-4 flex flex-wrap gap-1 lg:flex-col">
              {visibleNav.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  aria-current={currentKey === item.key ? 'page' : undefined}
                  onClick={() =>
                    navigate(
                      item.key === 'reports'
                        ? { name: 'reports', filters: {} }
                        : item.key === 'users'
                          ? { name: 'users', query: '' }
                          : { name: item.key as 'dashboard' | 'audit' },
                    )
                  }
                  className={`rounded-lg px-3 py-1.5 text-left text-sm font-semibold transition ${
                    currentKey === item.key
                      ? 'bg-sky/20 text-sky'
                      : 'text-ivory/70 hover:bg-ivory/5'
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </nav>
            <div className="mt-4 border-t border-ivory/10 pt-3">
              <Button variant="ghost" onClick={handleLogout}>
                Cerrar sesión
              </Button>
            </div>
          </div>
        </aside>

        <main className="min-w-0 flex-1 space-y-4">
          {error && (
            <p
              role="alert"
              className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger"
            >
              {error}
            </p>
          )}

          {view.name === 'dashboard' && metrics && reportList && (
            <DashboardView
              metrics={metrics}
              recentReports={reportList.items}
              canClaimReports={adminRoleHasPermission(session.role, 'reports:claim')}
              onOpenReport={(reportId) => navigate({ name: 'report', reportId })}
            />
          )}

          {view.name === 'reports' && reportList && (
            <ReportsView
              data={reportList}
              filters={view.filters}
              onFilterChange={(filters) => navigate({ name: 'reports', filters })}
              onOpenReport={(reportId) => navigate({ name: 'report', reportId })}
            />
          )}

          {view.name === 'report' && reportDetail && (
            <ReportDetailView
              detail={reportDetail}
              role={session.role}
              replay={replay}
              busy={busy}
              error={null}
              notice={notice}
              actions={{
                onBack: () => navigate({ name: 'reports', filters: {} }),
                onClaim: (expectedVersion) =>
                  void withBusy(async () => {
                    await activeClient.claimReport(view.reportId, { expectedVersion });
                    setReportDetail(await activeClient.reportDetail(view.reportId));
                    setNotice('Caso tomado: otros moderadores no podrán resolverlo.');
                  }),
                onResolve: (input) =>
                  void withBusy(async () => {
                    await activeClient.resolveReport(view.reportId, input);
                    setReportDetail(await activeClient.reportDetail(view.reportId));
                    setNotice('Reporte resuelto y auditado.');
                  }),
                onLoadReplay: (reason) =>
                  void withBusy(async () => {
                    if (!reportDetail.report.matchId) throw new Error('El caso no tiene partida.');
                    setReplay(await activeClient.replay(reportDetail.report.matchId, reason));
                    setNotice('Acceso al replay registrado en la auditoría.');
                  }),
                onSanction: (input) =>
                  void withBusy(async () => {
                    const result = await activeClient.sanctionUser(reportDetail.target.id, {
                      ...input,
                      reportId: reportDetail.report.id,
                    });
                    setReportDetail(await activeClient.reportDetail(view.reportId));
                    setNotice(`Sanción aplicada. Sesiones revocadas: ${result.sessionsRevoked}.`);
                  }),
                onNicknameChange: (reason) =>
                  void withBusy(async () => {
                    await activeClient.forceNicknameChange(reportDetail.target.id, reason);
                    setNotice('Se forzó el cambio de apodo del jugador.');
                  }),
              }}
            />
          )}

          {view.name === 'users' && (
            <UsersView
              users={users}
              query={view.query}
              onSearch={(query) => navigate({ name: 'users', query })}
              onOpenUser={(userId) => navigate({ name: 'user', userId })}
            />
          )}

          {view.name === 'user' && userDetail && (
            <UserDetailPanel
              detail={userDetail}
              canSanction={adminRoleHasPermission(session.role, 'sanctions:issue')}
              canBan={adminRoleHasPermission(session.role, 'sanctions:issue_ban')}
              canReadPii={adminRoleHasPermission(session.role, 'users:read_pii')}
              busy={busy}
              onBack={() => navigate({ name: 'users', query: '' })}
              onSanction={(input) =>
                void withBusy(async () => {
                  await activeClient.sanctionUser(view.userId, input);
                  setUserDetail(
                    await activeClient.userDetail(
                      view.userId,
                      'Consulta de historial de sanciones',
                    ),
                  );
                  setNotice('Sanción aplicada y auditada.');
                })
              }
              onForceNickname={() =>
                void withBusy(async () => {
                  await activeClient.forceNicknameChange(
                    view.userId,
                    'Apodo ofensivo detectado en revisión de perfil',
                  );
                  setNotice('Se forzó el cambio de apodo.');
                })
              }
            />
          )}

          {view.name === 'audit' && <AuditView entries={auditEntries} />}
        </main>
      </div>
    </div>
  );
}
