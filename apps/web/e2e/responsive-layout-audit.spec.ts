import { expect, test, type Browser, type Page } from '@playwright/test';
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

/**
 * Mide el ancho del documento cuando dejó de cambiar. Un `waitForTimeout` fijo
 * fotografía la página mientras todavía se acomoda (bootstrap de sesión, carga de
 * datos, fuentes) y el audit se vuelve intermitente en CI. Se espera a que el ancho
 * se estabilice entre dos lecturas consecutivas.
 */
async function settleWidth(page: Page, { timeoutMs = 4_000, quietMs = 150 } = {}) {
  const start = Date.now();
  let previous = -1;
  let stableSince = Date.now();
  while (Date.now() - start < timeoutMs) {
    const width = await page.evaluate(() => document.documentElement.scrollWidth);
    if (width !== previous) {
      previous = width;
      stableSince = Date.now();
    } else if (Date.now() - stableSince >= quietMs) {
      return width;
    }
    await page.waitForTimeout(50);
  }
  return previous;
}

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
        const settledWidth = await settleWidth(page);
        const dimensions = await page.evaluate(() => ({
          pageWidth: document.documentElement.scrollWidth,
          viewportWidth: document.documentElement.clientWidth,
        }));
        // Si la medición estable no coincide con la última lectura, se reporta la estable.
        if (settledWidth > dimensions.pageWidth) dimensions.pageWidth = settledWidth;
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
      const settledWidth = await settleWidth(page);
      const dimensions = await page.evaluate(() => ({
        pageWidth: document.documentElement.scrollWidth,
        viewportWidth: document.documentElement.clientWidth,
      }));
      if (settledWidth > dimensions.pageWidth) dimensions.pageWidth = settledWidth;
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

/**
 * Regresión concreta: un apodo largo empujaba la cabecera de /perfil más allá del
 * viewport. Los apodos de invitado son aleatorios, así que el audit general sólo lo
 * encontraba a veces; acá se fuerza el caso extremo de forma determinista.
 */
test('un apodo largo no desborda la cabecera de perfil a 320 y 360 px', async () => {
  test.setTimeout(120_000);
  const LONG_NICKNAME = 'EnvidoFielDelSur_2026_XX';
  let browser: Browser | undefined;
  try {
    browser = await launchIsolatedChromium();
    const context = await browser.newContext({
      viewport: { width: 320, height: 800 },
      isMobile: true,
      hasTouch: true,
      locale: 'es-AR',
    });
    const page = await context.newPage();
    await page.goto(`${BASE_URL}/acceso`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: /Entrar como invitado/i }).click();
    await page.waitForURL(/\/lobby$/);

    // Se reemplaza el apodo por uno de 25 caracteres sin espacios al pedir el perfil.
    await page.route('**/v1/me', async (route) => {
      const response = await route.fetch();
      const body = (await response.json()) as { user?: { nickname?: string } };
      if (body.user) body.user.nickname = LONG_NICKNAME;
      await route.fulfill({ response, body: JSON.stringify(body) });
    });

    for (const width of [320, 360] as const) {
      await page.setViewportSize({ width, height: 800 });
      await page.goto(`${BASE_URL}/perfil`, { waitUntil: 'domcontentloaded' });
      await page.locator('main').first().waitFor({ state: 'visible' });
      await settleWidth(page);

      // El apodo forzado llegó a la cabecera: si no, la prueba no cubre nada.
      await expect(page.getByRole('heading', { level: 1 }).first()).toContainText(LONG_NICKNAME);

      const dimensions = await page.evaluate(() => ({
        pageWidth: document.documentElement.scrollWidth,
        viewportWidth: document.documentElement.clientWidth,
      }));
      expect(
        dimensions.pageWidth,
        `perfil con apodo largo desborda a ${width}px (documento ${dimensions.pageWidth}px, viewport ${dimensions.viewportWidth}px)`,
      ).toBeLessThanOrEqual(dimensions.viewportWidth + 1);
    }
    await context.close();
  } finally {
    await browser?.close();
  }
});
