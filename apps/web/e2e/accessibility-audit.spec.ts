import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Browser } from '@playwright/test';
import { launchIsolatedChromium } from './support/launch.js';

const BASE_URL = 'http://localhost:4173';
const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22a', 'wcag22aa'];
const VIEWPORTS = [
  { label: 'mobile-360', width: 360, height: 800, isMobile: true },
  { label: 'desktop-1200', width: 1200, height: 900, isMobile: false },
] as const;
const PUBLIC_ROUTES = [
  '/',
  '/acceso',
  '/registro',
  '/recuperar',
  '/legal',
  '/legal/terminos',
  '/legal/privacidad',
  '/legal/cookies',
  '/legal/reglas-de-conducta',
  '/aprender',
  '/anotador',
  '/ranking',
] as const;
const AUTHENTICATED_ROUTES = ['/lobby', '/progreso', '/perfil', '/amigos'] as const;

test('audita WCAG 2.2 A/AA en rutas públicas, estados autenticados y mesa de práctica', async () => {
  test.setTimeout(240_000);
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
    browser = await launchIsolatedChromium();
    for (const viewport of VIEWPORTS) {
      const context = await browser.newContext({
        viewport: { width: viewport.width, height: viewport.height },
        isMobile: viewport.isMobile,
        hasTouch: viewport.isMobile,
        locale: 'es-AR',
      });
      const page = await context.newPage();

      const analyzeCurrentPage = async (route: string) => {
        await page.waitForTimeout(200);
        const result = await new AxeBuilder({ page }).withTags([...WCAG_TAGS]).analyze();
        for (const violation of result.violations) {
          findings.push({
            viewport: viewport.label,
            route,
            id: violation.id,
            impact: violation.impact,
            description: violation.help,
            count: violation.nodes.length,
            examples: violation.nodes
              .slice(0, 3)
              .map((node) =>
                [
                  node.target.join(' '),
                  node.html,
                  JSON.stringify(node.any.map((check) => check.data)),
                  node.failureSummary ?? '',
                ].join(' — '),
              ),
          });
        }
        if (viewport.isMobile) {
          const overflow = await page.evaluate(() => {
            const viewportWidth = document.documentElement.clientWidth;
            const pageWidth = document.documentElement.scrollWidth;
            const offenders = Array.from(document.querySelectorAll<HTMLElement>('body *'))
              .filter((element) => {
                const rect = element.getBoundingClientRect();
                return rect.left < -1 || rect.right > viewportWidth + 1;
              })
              .slice(0, 3)
              .map((element) => `${element.tagName.toLowerCase()}.${element.className.toString()}`);
            return { viewportWidth, pageWidth, offenders };
          });
          if (overflow.pageWidth > overflow.viewportWidth + 1) {
            findings.push({
              viewport: viewport.label,
              route,
              id: 'horizontal-overflow',
              impact: 'serious',
              description: `Document width ${overflow.pageWidth}px exceeds viewport ${overflow.viewportWidth}px`,
              count: 1,
              examples: overflow.offenders,
            });
          }
        }
      };
      const scan = async (route: string) => {
        await page.goto(`${BASE_URL}${route}`, { waitUntil: 'domcontentloaded' });
        await analyzeCurrentPage(route);
      };

      for (const route of PUBLIC_ROUTES) await scan(route);

      await page.goto(`${BASE_URL}/acceso`, { waitUntil: 'domcontentloaded' });
      await page.getByRole('button', { name: /Entrar como invitado/i }).waitFor();
      const focusableCount = await page.evaluate(
        () =>
          Array.from(
            document.querySelectorAll<HTMLElement>(
              'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
            ),
          ).filter((element) => element.getClientRects().length > 0).length,
      );
      expect(focusableCount).toBeGreaterThan(0);
      // El primer Tab de Chromium sin origen de foco cae en BODY: se establece el origen
      // enfocando un punto neutro de la página antes de recorrer los controles.
      await page.getByRole('heading', { level: 1 }).first().click();
      for (let step = 0; step < Math.min(8, focusableCount); step++) {
        await page.keyboard.press('Tab');
        const focused = await page.evaluate(() => {
          const element = document.activeElement as HTMLElement | null;
          if (!element) return null;
          const rect = element.getBoundingClientRect();
          return {
            tag: element.tagName,
            width: rect.width,
            height: rect.height,
            visible: getComputedStyle(element).visibility !== 'hidden',
          };
        });
        expect(focused, `Tab ${step + 1} debe mover el foco a un control`).not.toBeNull();
        expect(focused?.tag).not.toBe('BODY');
        expect(focused?.width).toBeGreaterThan(0);
        expect(focused?.height).toBeGreaterThan(0);
        expect(focused?.visible).toBe(true);
      }

      const guestEntry = page.getByRole('button', { name: /Entrar como invitado/i });
      await guestEntry.click();
      await page.waitForURL(/\/lobby$/);

      await scan('/acceso?tab=promote');
      for (const route of AUTHENTICATED_ROUTES) await scan(route);

      await page.goto(`${BASE_URL}/`, { waitUntil: 'domcontentloaded' });
      await page.getByRole('heading', { name: /Jugar contra la máquina/i }).waitFor();
      const onboardingTrigger = page.getByRole('button', {
        name: 'Bienvenido a la Mesa de Truco',
      });
      let onboardingReachedByTab = false;
      for (let step = 0; step < 50; step++) {
        await page.keyboard.press('Tab');
        if (await onboardingTrigger.evaluate((element) => element === document.activeElement)) {
          onboardingReachedByTab = true;
          break;
        }
      }
      expect(onboardingReachedByTab, 'El CTA de ayuda debe ser alcanzable con Tab').toBe(true);
      await page.keyboard.press('Enter');

      const onboardingDialog = page.getByRole('dialog', {
        name: 'Bienvenido a la Mesa de Truco',
      });
      await expect(onboardingDialog).toBeVisible();
      await expect(onboardingDialog).toHaveAttribute('aria-modal', 'true');
      await page.keyboard.press('Tab');
      await expect(page.getByRole('button', { name: 'Empezar a recorrer' })).toBeFocused();
      await page.keyboard.press('Tab');
      await expect(
        page.getByRole('button', { name: 'Ya tengo cuenta / Registrarme' }),
      ).toBeFocused();
      await page.keyboard.press('Tab');
      await expect(page.getByRole('button', { name: 'Entrar como invitado ahora' })).toBeFocused();
      await page.keyboard.press('Tab');
      await expect(page.getByRole('button', { name: 'Empezar a recorrer' })).toBeFocused();
      await page.keyboard.press('Shift+Tab');
      await expect(page.getByRole('button', { name: 'Entrar como invitado ahora' })).toBeFocused();
      await page.keyboard.press('Escape');
      await expect(onboardingDialog).toBeHidden();
      await expect(onboardingTrigger).toBeFocused();

      await page.goto(`${BASE_URL}/`, { waitUntil: 'domcontentloaded' });
      await page.getByRole('heading', { name: /Jugar contra la máquina/i }).waitFor();
      await page
        .getByRole('button', { name: /Jugar contra la máquina/i })
        .last()
        .click();
      await page.waitForURL(/\/mesa\/.*practice=1/, { timeout: 45_000 });
      await page
        .getByRole('region', { name: /Mesa de truco en vivo/i })
        .waitFor({ timeout: 45_000 });
      await analyzeCurrentPage('mesa-practica');
      await page.getByTestId('practice-hint-button').click();
      await page.getByTestId('practice-hint-text').waitFor({ timeout: 20_000 });
      await analyzeCurrentPage('mesa-practica-con-pista');

      await context.close();
    }
  } finally {
    await browser?.close();
  }

  const unique = new Map<string, typeof findings>();
  for (const finding of findings) {
    const key = `${finding.id}|${finding.route}|${finding.viewport}`;
    const bucket = unique.get(key) ?? [];
    bucket.push(finding);
    unique.set(key, bucket);
  }
  const summary = [...unique.values()].map((bucket) => bucket[0]!);
  console.log(`\nWCAG axe findings (${summary.length} rule/route/viewport combinations):`);
  console.log(JSON.stringify(summary, null, 2));

  expect(
    findings,
    'No deberían quedar infracciones WCAG A/AA ni overflow horizontal a 360 px.',
  ).toEqual([]);
});
