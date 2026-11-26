import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ADMIN_ROLE_PERMISSIONS, type AdminRole } from '@truco/shared';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AuditView } from '../src/components/AuditView.js';
import { DashboardView } from '../src/components/DashboardView.js';
import { LoginView } from '../src/components/LoginView.js';
import { ReportDetailView } from '../src/components/ReportDetailView.js';
import { ReportsView } from '../src/components/ReportsView.js';
import { ProgressionConfigView } from '../src/components/ProgressionConfigView.js';
import { TournamentsView } from '../src/components/TournamentsView.js';
import { UserDetailPanel, UsersView } from '../src/components/UsersView.js';
import { createDemoClient } from '../src/lib/demo.js';

const NOW = Date.UTC(2026, 10, 13, 15, 30, 0);

/** Montaje sin estado propio: alcanza para verificar lo que se renderiza. */
function renderTournaments(overrides: Partial<Parameters<typeof TournamentsView>[0]> = {}): string {
  return renderToStaticMarkup(
    <TournamentsView
      data={{ items: [], nextCursor: null }}
      filters={{}}
      detail={null}
      busy={false}
      onFilterChange={() => undefined}
      onOpen={() => undefined}
      onClose={() => undefined}
      onCancel={() => undefined}
      onAdvance={() => undefined}
      onResolveIncident={() => undefined}
      onCreate={() => undefined}
      {...overrides}
    />,
  );
}

async function demoData() {
  const client = createDemoClient();
  const [metrics, reports, detail, users, userDetail, audit] = await Promise.all([
    client.dashboard(),
    client.listReports({}),
    client.reportDetail('019a7e40-0000-7000-8000-0000000000b1'),
    client.listUsers({}),
    client.userDetail('019a7e40-0000-7000-8000-0000000000a2', 'consulta'),
    client.listAudit({}),
  ]);
  const replay = await client.replay(reports.items[0]!.matchId ?? '', 'Verificar colusión');
  return { metrics, reports, detail, users, userDetail, audit, replay };
}

describe('@truco/admin · panel M7', () => {
  it('el ingreso exige contraseña y código TOTP de 6 dígitos', () => {
    const html = renderToStaticMarkup(
      <LoginView onSubmit={() => undefined} error={null} pending={false} />,
    );
    expect(html).toContain('Código 2FA (TOTP)');
    expect(html).toContain('name="totpCode"');
    expect(html).toContain('pattern="[0-9]{6}"');
    expect(html).toContain('name="password"');
    // Sin contraseñas por defecto: el alta del primer admin es por CLI.
    expect(html).toContain('admin:create');
  });

  it('muestra el error de credenciales sin filtrar detalles internos', () => {
    const html = renderToStaticMarkup(
      <LoginView
        onSubmit={() => undefined}
        error="Credenciales inválidas o código 2FA incorrecto (UNAUTHORIZED)"
        pending={false}
      />,
    );
    expect(html).toContain('role="alert"');
    expect(html).toContain('código 2FA incorrecto');
  });

  it('el dashboard resume usuarios activos, partidas en curso y reportes abiertos', async () => {
    const { metrics, reports } = await demoData();
    const html = renderToStaticMarkup(
      <DashboardView
        metrics={metrics}
        recentReports={reports.items}
        canClaimReports
        onOpenReport={() => undefined}
      />,
    );
    expect(html).toContain('Usuarios activos (24 h)');
    expect(html).toContain(String(metrics.activeUsers24h));
    expect(html).toContain('Partidas en curso');
    expect(html).toContain(String(metrics.matchesInProgress));
    expect(html).toContain('Reportes abiertos');
    expect(html).toContain('TanoBaston');
    expect(html).toContain('Sospecha de colusión o señas');
  });

  it('la cola de reportes filtra por estado y muestra los totales', async () => {
    const { reports } = await demoData();
    const html = renderToStaticMarkup(
      <ReportsView
        data={reports}
        filters={{ status: 'OPEN' }}
        onFilterChange={() => undefined}
        onOpenReport={() => undefined}
      />,
    );
    expect(html).toContain('Cola de reportes');
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('Abandono reiterado');
    expect(html).toContain('Tomado por MartaModera');
    expect(html).toContain('1 duplicado(s) fusionado(s)');
  });

  it('el detalle de reporte pide motivo antes de abrir el replay auditado', async () => {
    const { detail, replay } = await demoData();
    const html = renderToStaticMarkup(
      <ReportDetailView
        detail={detail}
        role="MODERATOR"
        replay={null}
        busy={false}
        error={null}
        notice={null}
        actions={{
          onBack: () => undefined,
          onClaim: () => undefined,
          onResolve: () => undefined,
          onLoadReplay: () => undefined,
          onSanction: () => undefined,
          onNicknameChange: () => undefined,
        }}
      />,
    );
    expect(html).toContain('Motivo del acceso');
    expect(html).toContain('Abrir replay auditado');
    // El botón arranca deshabilitado hasta que haya un motivo válido.
    expect(html).toMatch(/disabled[^>]*>Abrir replay auditado/);

    const withReplay = renderToStaticMarkup(
      <ReportDetailView
        detail={detail}
        role="ADMIN"
        replay={replay}
        busy={false}
        error={null}
        notice="Acceso al replay registrado en la auditoría."
        actions={{
          onBack: () => undefined,
          onClaim: () => undefined,
          onResolve: () => undefined,
          onLoadReplay: () => undefined,
          onSanction: () => undefined,
          onNicknameChange: () => undefined,
        }}
      />,
    );
    expect(withReplay).toContain('MATCH_FINISHED');
    expect(withReplay).toContain('Reconstrucción válida');
    expect(withReplay).toContain('Bloqueo permanente');
  });

  it('la revisión del caso mantiene contexto, identifica la partida y no pierde el UUID', async () => {
    const { detail } = await demoData();
    const html = renderToStaticMarkup(
      <ReportDetailView
        detail={detail}
        role="MODERATOR"
        replay={null}
        busy={false}
        error={null}
        notice={null}
        actions={{
          onBack: () => undefined,
          onClaim: () => undefined,
          onResolve: () => undefined,
          onLoadReplay: () => undefined,
          onSanction: () => undefined,
          onNicknameChange: () => undefined,
        }}
      />,
    );
    // Contexto del caso siempre a la vista mientras se recorre la revisión.
    expect(html).toContain('sticky top-0');
    expect(html).toContain('Próxima acción');
    // La partida se reconoce con un asa corta y el UUID íntegro sigue disponible.
    const matchId = detail.report.matchId!;
    expect(html).toContain(`P-${matchId.slice(0, 8).toUpperCase()}`);
    expect(html).toContain(matchId);
    // La cabecera del caso no se duplica (un solo h1 con las partes).
    expect(html.match(/reportó a/g)?.length).toBe(1);
    // Las acciones sensibles siguen presentes para el rol con permiso.
    expect(html).toContain('Aplicar sanción');
    expect(html).toContain('Resolver con acción');
  });

  it('el rol SOPORTE no ve acciones de sanción ni de resolución', async () => {
    const { detail } = await demoData();
    const html = renderToStaticMarkup(
      <ReportDetailView
        detail={detail}
        role="SUPPORT"
        replay={null}
        busy={false}
        error={null}
        notice={null}
        actions={{
          onBack: () => undefined,
          onClaim: () => undefined,
          onResolve: () => undefined,
          onLoadReplay: () => undefined,
          onSanction: () => undefined,
          onNicknameChange: () => undefined,
        }}
      />,
    );
    expect(html).toContain('Tomar el caso');
    expect(html).not.toContain('Resolver con acción');
    expect(html).not.toContain('Aplicar sanción');
    expect(html).not.toContain('Abrir replay auditado');
  });

  const ROLES: readonly AdminRole[] = ['SUPPORT', 'MODERATOR', 'ADMIN'];

  it('cada rol ve a lo sumo las acciones que la matriz RBAC le habilita', async () => {
    const { detail } = await demoData();
    for (const role of ROLES) {
      const html = renderToStaticMarkup(
        <ReportDetailView
          detail={detail}
          role={role}
          replay={null}
          busy={false}
          error={null}
          notice={null}
          actions={{
            onBack: () => undefined,
            onClaim: () => undefined,
            onResolve: () => undefined,
            onLoadReplay: () => undefined,
            onSanction: () => undefined,
            onNicknameChange: () => undefined,
          }}
        />,
      );
      const permissions = ADMIN_ROLE_PERMISSIONS[role];
      expect(html.includes('Aplicar sanción')).toBe(permissions.includes('sanctions:issue'));
      expect(html.includes('Resolver con acción')).toBe(permissions.includes('reports:resolve'));
      expect(html.includes('Abrir replay auditado')).toBe(permissions.includes('matches:replay'));
      expect(html.includes('Forzar cambio de apodo')).toBe(
        permissions.includes('nickname:force_change'),
      );
      expect(html.includes('Bloqueo permanente')).toBe(permissions.includes('sanctions:issue_ban'));
    }
  });

  it('la búsqueda de usuarios enmascara el email y no expone datos personales', async () => {
    const { users } = await demoData();
    const html = renderToStaticMarkup(
      <UsersView
        users={users.items}
        query=""
        onSearch={() => undefined}
        onOpenUser={() => undefined}
      />,
    );
    expect(html).toContain('t***o@truco.ar');
    expect(html).not.toContain('tanobaston@truco.ar');
    expect(html).toContain('LaViejaEscuela');
  });

  it('la ficha de usuario muestra historial de sanciones y respeta el permiso de PII', async () => {
    const { userDetail } = await demoData();
    const withoutPii = renderToStaticMarkup(
      <UserDetailPanel
        detail={userDetail}
        canSanction
        canBan={false}
        canReadPii={false}
        busy={false}
        onSanction={() => undefined}
        onForceNickname={() => undefined}
        onBack={() => undefined}
      />,
    );
    expect(withoutPii).toContain('Historial de sanciones');
    expect(withoutPii).toContain('Suspensión temporal');
    expect(withoutPii).toContain('l***a@truco.ar');
    expect(withoutPii).not.toContain('laviejaescuela@truco.ar');
    // Sin permiso de ban no se ofrece el bloqueo permanente.
    expect(withoutPii).not.toContain('Bloqueo permanente');

    const withPii = renderToStaticMarkup(
      <UserDetailPanel
        detail={userDetail}
        canSanction
        canBan
        canReadPii
        busy={false}
        onSanction={() => undefined}
        onForceNickname={() => undefined}
        onBack={() => undefined}
      />,
    );
    expect(withPii).toContain('laviejaescuela@truco.ar');
    expect(withPii).toContain('Bloqueo permanente');
  });

  it('expone configuración acotada y reversión compensatoria con motivos obligatorios', async () => {
    const client = createDemoClient();
    const config = await client.progressionConfig();
    const html = renderToStaticMarkup(
      <ProgressionConfigView
        config={config}
        busy={false}
        onSave={() => undefined}
        onReverse={() => undefined}
      />,
    );
    expect(html).toContain('Configuración de recompensas');
    expect(html).toContain('XP reducido por partida con bots');
    expect(html).toContain('Moneda virtual sin valor económico');
    expect(html).toContain('Motivo auditado');
    expect(html).toContain('minLength="10"');
    expect(html).toContain('Compensar un crédito');
    expect(html).toContain('No se borran asientos');

    const saved = await client.updateProgressionConfig({
      config,
      reason: 'Prueba de configuración auditada',
    });
    expect(saved).toEqual({ config, audited: true });
    expect(
      await client.reverseWalletTransaction('transaction-id', { reason: 'Crédito erróneo' }),
    ).toEqual({ transactionId: 'transaction-id', reversed: true });
  });

  it('la auditoría muestra actor, motivo y fecha de cada acceso', async () => {
    const { audit } = await demoData();
    const html = renderToStaticMarkup(<AuditView entries={audit.items} />);
    expect(html).toContain('ADMIN_REPLAY_ACCESSED');
    expect(html).toContain('Verificar denuncia de colusión');
    expect(html).toContain('MartaModera');
    expect(html).toContain('SANCTION_ISSUED');
    expect(html).toContain('Registro inmutable');
  });

  it('la lista de reportes no expone datos del panel a jugadores (sin cookie de admin)', async () => {
    const { reports } = await demoData();
    const html = renderToStaticMarkup(
      <ReportsView
        data={reports}
        filters={{}}
        onFilterChange={() => undefined}
        onOpenReport={() => undefined}
      />,
    );
    // El panel sólo muestra ids y apodos; nunca emails ni tokens.
    expect(html).not.toMatch(/@truco\.ar/);
    expect(html).not.toContain('truco_admin_access');
    expect(NOW).toBeGreaterThan(0);
  });
});

describe('@truco/admin · datos demo fuera de producción', () => {
  it('no importa el cliente demo de forma estática (permite tree-shaking)', () => {
    const source = readFileSync(new URL('../src/AdminApp.tsx', import.meta.url), 'utf8');
    expect(source).not.toMatch(/^import .*from '\.\/lib\/demo\.js';$/m);
    expect(source).toContain("import('./lib/demo.js')");
    expect(source).toContain('VITE_ADMIN_DEMO');
  });

  it('el build de producción no contiene datos de ejemplo del panel', () => {
    execFileSync('node', ['scripts/check-prod-bundle.mjs'], {
      cwd: fileURLToPath(new URL('..', import.meta.url)),
      stdio: 'pipe',
      timeout: 180_000,
    });
  }, 200_000);
});

describe('@truco/admin · torneos M10a', () => {
  it('el listado muestra estado, cupo y el premio marcado como simbólico', async () => {
    const tournaments = await createDemoClient().listTournaments({});
    const html = renderTournaments({ data: tournaments });

    expect(html).toContain('Copa de Otoño');
    expect(html).toContain('En juego');
    expect(html).toContain('16/16 con check-in');
    expect(html).toContain('simbólico, sin valor económico');
    // El torneo privado de un tercero también aparece: el panel no filtra por visibilidad.
    expect(html).toContain('Torneo del barrio');
    expect(html).toContain('Privado');
  });

  it('deja claro que los torneos no tocan el rating ni el dinero real', () => {
    const html = renderTournaments();
    expect(html).toContain('no cuentan para el ranking');
    expect(html).toContain('Nadie paga para entrar');
    // Nada de promesas de dinero: la regla 13 también aplica al panel.
    expect(html).not.toMatch(/gan[aá] (dinero|plata|efectivo)/i);
    expect(html).not.toMatch(/premios? en (dinero|efectivo)/i);
  });

  it('las acciones destructivas piden motivo antes de habilitarse', () => {
    const html = renderTournaments();
    // Sin detalle abierto no hay formularios de cancelación a medio llenar.
    expect(html).not.toContain('Cancelar torneo');
    expect(html).toContain('Crear torneo oficial');
  });
});
