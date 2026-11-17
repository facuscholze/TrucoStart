import { expect, type APIRequestContext, test } from '@playwright/test';
import { generateTotpCode } from '../../api/src/modules/admin/security/totp.js';
import { launchIsolatedChromium } from '../../web/e2e/support/launch.js';

const ADMIN_BASE = 'http://localhost:5174';
const WEB_BASE = 'http://localhost:4173';
const API_BASE = 'http://127.0.0.1:3001';

const ADMIN_EMAIL = 'e2e-admin@truco.ar';
const ADMIN_PASSWORD = 'E2eAdminPanel2026!';
const ADMIN_TOTP_SECRET = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';
const MATCH_ID = '019a7e40-0000-7000-8000-0000000000e1';
const REPORTER_EMAIL = 'e2e-reporter@truco.ar';
const TARGET_EMAIL = 'e2e-target@truco.ar';
const PLAYER_PASSWORD = 'JugadorE2E2026!';
/** Ids fijos sembrados por `e2e-stack.ts` junto con la partida terminada. */
const TARGET_ID = '019a7e40-0000-7000-8000-0000000000e3';

async function loginPlayer(ctx: APIRequestContext, email: string): Promise<void> {
  const res = await ctx.post(`${API_BASE}/v1/auth/login`, {
    data: { email, password: PLAYER_PASSWORD },
  });
  expect(res.status(), await res.text()).toBe(200);
}

test.describe('M8 — E2E del panel administrativo contra la API real', () => {
  test('login 2FA, reporte, claim, replay auditado, sanción y bloqueo del jugador', async ({
    playwright,
  }) => {
    const reporterCtx = await playwright.request.newContext();
    const targetCtx = await playwright.request.newContext();
    try {
      await loginPlayer(reporterCtx, REPORTER_EMAIL);
      await loginPlayer(targetCtx, TARGET_EMAIL);

      // El reportero crea el caso desde la API real, adjuntando la partida sembrada.
      const reportRes = await reporterCtx.post(`${API_BASE}/v1/me/reports`, {
        data: {
          targetUserId: TARGET_ID,
          reasonCode: 'COLLUSION',
          details: 'Sospecha de señas fuera del sistema durante la partida de prueba.',
          matchId: MATCH_ID,
        },
      });
      const reportBody = await reportRes.text();
      expect(reportRes.status(), reportBody).toBe(201);
      const report = JSON.parse(reportBody) as { id: string; eventLogRef: unknown };
      expect(report.eventLogRef).not.toBeNull();

      // --- Panel: login con 2FA obligatorio -------------------------------------------
      const browser = await launchIsolatedChromium();
      const adminPage = await browser.newPage({ viewport: { width: 1200, height: 900 } });
      await adminPage.goto(`${ADMIN_BASE}/`, { waitUntil: 'networkidle' });
      await expect(adminPage.getByRole('heading', { name: 'Ingreso con 2FA' })).toBeVisible();

      // Sin código TOTP válido no hay sesión: el formulario lo exige y el servidor lo rechaza.
      await adminPage.getByLabel('Email').fill(ADMIN_EMAIL);
      await adminPage.getByLabel('Contraseña').fill(ADMIN_PASSWORD);
      await expect(
        adminPage
          .getByLabel('Código 2FA (TOTP)')
          .evaluate((element) => (element as HTMLInputElement).checkValidity()),
      ).resolves.toBe(false);

      await adminPage.getByLabel('Código 2FA (TOTP)').fill('000000');
      await adminPage.getByRole('button', { name: 'Ingresar al panel' }).click();
      await expect(adminPage.getByRole('alert')).toContainText(/2FA|código|válid/i);

      await adminPage
        .getByLabel('Código 2FA (TOTP)')
        .fill(generateTotpCode(ADMIN_TOTP_SECRET, Date.now()));
      await adminPage.getByRole('button', { name: 'Ingresar al panel' }).click();
      await expect(adminPage.getByRole('heading', { name: 'Pulso de la comunidad' })).toBeVisible({
        timeout: 30_000,
      });

      // --- Reportes: ver el caso, reclamarlo, abrir replay con motivo ------------------
      await adminPage.getByRole('button', { name: 'Reportes', exact: true }).click();
      const caseRow = adminPage.locator('li', { hasText: 'Sospecha de colusión' }).first();
      await expect(caseRow).toBeVisible();
      await caseRow.getByRole('button', { name: 'Abrir caso' }).click();

      await expect(adminPage.getByRole('heading', { name: /reportó a/ })).toBeVisible();
      await adminPage.getByRole('button', { name: 'Tomar el caso' }).click();
      await expect(adminPage.getByRole('status')).toContainText(/Caso tomado/i);

      await adminPage
        .getByLabel('Motivo del acceso')
        .fill('Verificar denuncia de colusión en la partida reportada');
      await adminPage.getByRole('button', { name: 'Abrir replay auditado' }).click();
      await expect(adminPage.getByRole('status')).toContainText(/auditoría/i);

      // --- Sanción: suspensión temporal con motivo ------------------------------------
      await adminPage.getByLabel('Tipo').selectOption('SUSPEND');
      await adminPage
        .getByLabel('Motivo', { exact: true })
        .fill('Colusión comprobada en el replay');
      await adminPage.getByRole('button', { name: 'Aplicar sanción' }).click();
      await expect(adminPage.getByRole('status')).toContainText(/Sanción aplicada/i);

      // --- Auditoría: el acceso al replay quedó registrado -----------------------------
      await adminPage.getByRole('button', { name: 'Auditoría', exact: true }).click();
      await expect(adminPage.getByText('ADMIN_REPLAY_ACCESSED').first()).toBeVisible();
      await expect(adminPage.getByText(/Verificar denuncia de colusión/).first()).toBeVisible();

      // --- API: el jugador sancionado ya no puede iniciar sesión -----------------------
      const blocked = await targetCtx.post(`${API_BASE}/v1/auth/login`, {
        data: { email: TARGET_EMAIL, password: PLAYER_PASSWORD },
      });
      expect(blocked.status()).toBe(403);
      const blockedBody = await blocked.text();
      expect(blockedBody).toContain('ACCOUNT_SUSPENDED');
      expect(blockedBody).toMatch(/suspendida hasta/i);
      expect(blockedBody).toMatch(/Colusión comprobada/);

      // --- Web: la pantalla de acceso muestra el motivo y el vencimiento ---------------
      const webPage = await browser.newPage({ viewport: { width: 1200, height: 900 } });
      await webPage.goto(`${WEB_BASE}/acceso`, { waitUntil: 'networkidle' });
      await webPage.locator('#auth-login-email').fill(TARGET_EMAIL);
      await webPage.locator('#auth-login-password').fill(PLAYER_PASSWORD);
      await webPage.locator('form button[type="submit"]').first().click();
      await expect(webPage.getByRole('alert').first()).toContainText(/suspendida hasta/i, {
        timeout: 15_000,
      });
      await expect(webPage.getByRole('alert').first()).toContainText(/Colusión comprobada/i);

      await browser.close();
      expect(report.id.length).toBeGreaterThan(0);
    } finally {
      await reporterCtx.dispose();
      await targetCtx.dispose();
    }
  });
});
