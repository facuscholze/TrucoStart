import AxeBuilder from '@axe-core/playwright';
import { expect, test, type APIRequestContext, type Browser, type Page } from '@playwright/test';
import { generateTotpCode } from '../../api/src/modules/admin/security/totp.js';
import { launchIsolatedChromium } from '../../web/e2e/support/launch.js';

const ADMIN_BASE = 'http://localhost:5174';
const API_BASE = 'http://127.0.0.1:3001';
const ADMIN_EMAIL = 'e2e-admin@truco.ar';
const ADMIN_PASSWORD = 'E2eAdminPanel2026!';
const ADMIN_TOTP_SECRET = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';
const REPORTER_EMAIL = 'e2e-reporter@truco.ar';
const PLAYER_PASSWORD = 'JugadorE2E2026!';
const TARGET_ID = '019a7e40-0000-7000-8000-0000000000e3';
const MATCH_ID = '019a7e40-0000-7000-8000-0000000000e1';
const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22a', 'wcag22aa'];
const MOBILE = { label: 'mobile-360', width: 360, height: 800, isMobile: true } as const;
const DESKTOP = { label: 'desktop-1200', width: 1200, height: 900, isMobile: false } as const;

test('audita el panel admin — WCAG 2.2 A/AA, teclado y responsive', async ({ playwright }) => {
  test.setTimeout(240_000);
  const reporter = await playwright.request.newContext();
  let browser: Browser | undefined;
  const findings: Array<{
    viewport: string;
    route: string;
    id: string;
    impact: string | null;
    description: string;
    count: number;
    examples: string[];
  }> = [];

  try {
    await loginPlayer(reporter, REPORTER_EMAIL);
    const reportResponse = await reporter.post(`${API_BASE}/v1/me/reports`, {
      data: {
        targetUserId: TARGET_ID,
        reasonCode: 'COLLUSION',
        details: `Auditoría WCAG admin ${Date.now()}`,
        matchId: MATCH_ID,
      },
    });
    expect(reportResponse.status(), await reportResponse.text()).toBe(201);

    browser = await launchIsolatedChromium();
    const context = await browser.newContext({
      viewport: { width: MOBILE.width, height: MOBILE.height },
      isMobile: true,
      hasTouch: true,
      locale: 'es-AR',
    });
    const page = await context.newPage();
    let currentViewport = MOBILE;
    const scan = async (route: string) => {
      await page.waitForTimeout(150);
      const result = await new AxeBuilder({ page }).withTags([...WCAG_TAGS]).analyze();
      for (const violation of result.violations) {
        findings.push({
          viewport: currentViewport.label,
          route,
          id: violation.id,
          impact: violation.impact,
          description: violation.help,
          count: violation.nodes.length,
          examples: violation.nodes
            .slice(0, 3)
            .map((node) => [node.target.join(' '), node.failureSummary ?? ''].join(' — ')),
        });
      }
      if (currentViewport.isMobile) {
        const overflow = await page.evaluate(() => ({
          width: document.documentElement.scrollWidth,
          viewport: document.documentElement.clientWidth,
        }));
        if (overflow.width > overflow.viewport + 1) {
          findings.push({
            viewport: currentViewport.label,
            route,
            id: 'horizontal-overflow',
            impact: 'serious',
            description: `Document width ${overflow.width}px exceeds viewport ${overflow.viewport}px`,
            count: 1,
            examples: [],
          });
        }
      }
    };

    await page.goto(ADMIN_BASE, { waitUntil: 'domcontentloaded' });
    await page.getByRole('heading', { name: 'Ingreso con 2FA' }).waitFor();
    await scan('login');

    const loginFocusableCount = await page.evaluate(
      () =>
        Array.from(
          document.querySelectorAll<HTMLElement>(
            'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
          ),
        ).filter((element) => element.getClientRects().length > 0).length,
    );
    expect(loginFocusableCount).toBeGreaterThan(0);
    for (let step = 0; step < Math.min(8, loginFocusableCount); step++) {
      await page.keyboard.press('Tab');
      const focused = await page.evaluate(() => {
        const element = document.activeElement as HTMLElement | null;
        if (!element) return null;
        const rect = element.getBoundingClientRect();
        return { tag: element.tagName, width: rect.width, height: rect.height };
      });
      expect(focused?.tag, `Tab ${step + 1} debe alcanzar un control admin`).not.toBe('BODY');
      expect(focused?.width).toBeGreaterThan(0);
      expect(focused?.height).toBeGreaterThan(0);
    }

    currentViewport = DESKTOP;
    await page.setViewportSize({ width: DESKTOP.width, height: DESKTOP.height });
    await scan('login');

    await page.getByLabel('Email').fill(ADMIN_EMAIL);
    await page.getByLabel('Contraseña').fill(ADMIN_PASSWORD);
    const nextTotpStep = (Math.floor(Date.now() / 30_000) + 1) * 30_000 + 1_000;
    await page
      .getByLabel('Código 2FA (TOTP)')
      .fill(generateTotpCode(ADMIN_TOTP_SECRET, nextTotpStep));
    const adminLoginResponse = page.waitForResponse((response) =>
      response.url().endsWith('/v1/admin/auth/login'),
    );
    await page.getByRole('button', { name: 'Ingresar al panel' }).click();
    const loginResponse = await adminLoginResponse;
    if (!loginResponse.ok()) {
      throw new Error(
        `Admin login rejected (${loginResponse.status()}): ${await loginResponse.text()}`,
      );
    }
    await page.getByRole('heading', { name: 'Pulso de la comunidad' }).waitFor({ timeout: 30_000 });

    const reportsNavigation = page.getByRole('button', { name: 'Reportes', exact: true });
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    let reportsReachedByTab = false;
    for (let step = 0; step < 20; step++) {
      await page.keyboard.press('Tab');
      if (await reportsNavigation.evaluate((element) => element === document.activeElement)) {
        reportsReachedByTab = true;
        break;
      }
    }
    expect(reportsReachedByTab, 'La navegación admin debe ser alcanzable con Tab').toBe(true);
    await page.keyboard.press('Enter');
    await page.getByText('Cola de reportes', { exact: true }).waitFor();

    for (const viewport of [DESKTOP, MOBILE] as const) {
      currentViewport = viewport;
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.getByRole('button', { name: 'Dashboard', exact: true }).click();
      await page.getByRole('heading', { name: 'Pulso de la comunidad' }).waitFor();
      await scan('dashboard');

      await page.getByRole('button', { name: 'Reportes', exact: true }).click();
      await page.getByText('Cola de reportes', { exact: true }).waitFor();
      await scan('reportes');
      await page.getByRole('button', { name: 'Abrir caso' }).first().click();
      await page.getByLabel('Motivo del acceso').waitFor();
      await scan('detalle-de-reporte');
      await page.getByLabel('Motivo del acceso').fill('Auditoría WCAG del replay');
      await page.getByRole('button', { name: 'Abrir replay auditado' }).click();
      await page.getByRole('heading', { name: 'Replay de la partida' }).waitFor();
      await scan('replay-de-partida');

      await page.getByRole('button', { name: 'Usuarios', exact: true }).click();
      await page.getByText('Búsqueda por apodo o email.', { exact: false }).waitFor();
      await scan('usuarios');
      const userDetails = page.getByRole('button', { name: 'Ver ficha' }).first();
      if (await userDetails.isVisible().catch(() => false)) {
        await userDetails.click();
        await page.getByRole('button', { name: /Volver a usuarios/i }).waitFor();
        await scan('ficha-de-usuario');
      }

      for (const [label, route] of [
        ['fair-play', 'Fair play'],
        ['gamificacion', 'Gamificación'],
        ['auditoria', 'Auditoría'],
      ] as const) {
        await page.getByRole('button', { name: route, exact: true }).click();
        await scan(label);
      }
    }

    const responsiveWidths = [320, 360, 390, 768, 1024, 1200, 1440] as const;
    const responsiveSections = [
      ['Dashboard', /Pulso de la comunidad/],
      ['Reportes', /Cola de reportes/],
      ['Usuarios', /Usuarios/],
      ['Fair play', /Integridad competitiva/],
      ['Gamificación', /Progresión simbólica/],
      ['Auditoría', /Auditoría/],
    ] as const;
    let responsiveCombinationCount = 0;
    for (const width of responsiveWidths) {
      currentViewport = {
        label: `layout-${width}`,
        width,
        height: 900,
        isMobile: width < 768,
      };
      await page.setViewportSize({ width, height: 900 });
      for (const [buttonName, expectedHeading] of responsiveSections) {
        await page.getByRole('button', { name: buttonName, exact: true }).click();
        await page.getByRole('heading', { name: expectedHeading }).first().waitFor();
        const dimensions = await page.evaluate(() => ({
          pageWidth: document.documentElement.scrollWidth,
          viewportWidth: document.documentElement.clientWidth,
        }));
        expect(
          dimensions.pageWidth,
          `${buttonName} desborda a ${width}px (documento ${dimensions.pageWidth}px, viewport ${dimensions.viewportWidth}px)`,
        ).toBeLessThanOrEqual(dimensions.viewportWidth + 1);
        responsiveCombinationCount += 1;
      }
    }
    console.log(
      `Responsive admin layout audit: ${responsiveCombinationCount} section/viewport combinations, 0 overflow.`,
    );

    await context.close();
  } finally {
    await reporter.dispose();
    await browser?.close();
  }

  console.log(`\nWCAG admin findings (${findings.length} total):`);
  console.log(JSON.stringify(findings, null, 2));
  expect(
    findings,
    'El panel admin no debe tener infracciones WCAG A/AA ni overflow en 360 px.',
  ).toEqual([]);
});

async function loginPlayer(ctx: APIRequestContext, email: string): Promise<void> {
  const response = await ctx.post(`${API_BASE}/v1/auth/login`, {
    data: { email, password: PLAYER_PASSWORD },
  });
  expect(response.status(), await response.text()).toBe(200);
}
