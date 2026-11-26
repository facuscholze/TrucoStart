import { expect, test, type Browser } from '@playwright/test';
import { launchIsolatedChromium } from './support/launch.js';

const BASE_URL = 'http://localhost:4173';
const WIDTHS = [320, 360, 390, 430, 768, 1024, 1200, 1440] as const;
const ROUTES = [
  '/',
  '/lobby',
  '/ranking',
  '/aprender',
  '/anotador',
  '/amigos',
  '/progreso',
  '/perfil',
  '/legal',
] as const;

test('barre overflow horizontal en pantallas representativas y puntos de quiebre responsive', async () => {
  test.setTimeout(300_000);
  let browser: Browser | undefined;

  try {
    browser = await launchIsolatedChromium();
    const context = await browser.newContext({
      viewport: { width: 360, height: 800 },
      isMobile: true,
      hasTouch: true,
      locale: 'es-AR',
    });
    const page = await context.newPage();

    await page.goto(`${BASE_URL}/acceso`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: /Entrar como invitado/i }).click();
    await page.waitForURL(/\/lobby$/);

    const checked: Array<{ width: number; route: string; pageWidth: number }> = [];
    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: 800 });
      for (const route of ROUTES) {
        await page.goto(`${BASE_URL}${route}`, { waitUntil: 'domcontentloaded' });
        await page.locator('main').first().waitFor({ state: 'visible' });
        await page.waitForTimeout(80);
        const dimensions = await page.evaluate(() => ({
          pageWidth: document.documentElement.scrollWidth,
          viewportWidth: document.documentElement.clientWidth,
        }));
        checked.push({ width, route, pageWidth: dimensions.pageWidth });
        expect(
          dimensions.pageWidth,
          `${route} desborda a ${width}px (documento ${dimensions.pageWidth}px, viewport ${dimensions.viewportWidth}px)`,
        ).toBeLessThanOrEqual(dimensions.viewportWidth + 1);
      }
    }

    // Una sola sesión de práctica se conserva mientras se cambia el ancho, para cubrir
    // mesa/hand sin depender de una captura estática ni de estados sintéticos.
    await page.setViewportSize({ width: 360, height: 800 });
    await page.goto(`${BASE_URL}/`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('heading', { name: /Jugar contra la máquina/i }).waitFor();
    await page
      .getByRole('button', { name: /Jugar contra la máquina/i })
      .last()
      .click();
    await page.waitForURL(/\/mesa\/.*practice=1/, { timeout: 45_000 });
    await page.getByRole('region', { name: /Mesa de truco en vivo/i }).waitFor({ timeout: 45_000 });

    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: 800 });
      await page.waitForTimeout(100);
      const dimensions = await page.evaluate(() => ({
        pageWidth: document.documentElement.scrollWidth,
        viewportWidth: document.documentElement.clientWidth,
      }));
      checked.push({ width, route: 'mesa-practica', pageWidth: dimensions.pageWidth });
      expect(
        dimensions.pageWidth,
        `mesa-practica desborda a ${width}px (documento ${dimensions.pageWidth}px, viewport ${dimensions.viewportWidth}px)`,
      ).toBeLessThanOrEqual(dimensions.viewportWidth + 1);
    }

    console.log(
      `Responsive overflow audit: ${checked.length} route/viewport combinations, 0 overflow.`,
    );
    await context.close();
  } finally {
    await browser?.close();
  }
});
