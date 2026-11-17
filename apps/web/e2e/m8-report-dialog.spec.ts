import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { launchIsolatedChromium } from './support/launch.js';

const BASE_URL = 'http://localhost:4173';
const SCREENSHOT_DIR = fileURLToPath(new URL('../../../docs/screenshots/', import.meta.url));

/**
 * M8 — Captura del diálogo de reporte del jugador abierto desde la mesa a 360 px.
 * Usa la pila real (`e2e-stack.ts`): dos invitados en una mesa privada 1v1.
 */
test('Mobile 360: el jugador abre "Reportar" desde la mesa y ve el diálogo completo', async () => {
  const browser = await launchIsolatedChromium();
  try {
    const contextA = await browser.newContext({
      viewport: { width: 360, height: 800 },
      isMobile: true,
      hasTouch: true,
      locale: 'es-AR',
    });
    const contextB = await browser.newContext({
      viewport: { width: 360, height: 800 },
      isMobile: true,
      hasTouch: true,
      locale: 'es-AR',
    });
    const pageA = await contextA.newPage();

    // A crea la mesa privada 1v1 y obtiene el código.
    await pageA.goto(`${BASE_URL}/acceso`);
    await pageA.getByRole('button', { name: /Entrar como invitado/i }).click();
    await expect(pageA).toHaveURL(/\/lobby$/);
    await pageA.locator('#create-score').selectOption('15');
    await pageA.locator('#create-vis').selectOption('PRIVATE');
    await pageA.getByRole('button', { name: /Crear mesa y sentarme/i }).click();
    await expect(pageA).toHaveURL(/\/sala\//);
    const joinCode = (
      (await pageA.getByTestId('waiting-room-join-code').textContent()) ?? ''
    ).trim();
    expect(joinCode).toMatch(/^[A-Z0-9]{6}$/);

    // B entra como invitado y se une por código.
    const pageB = await contextB.newPage();
    await pageB.goto(`${BASE_URL}/acceso`);
    await pageB.getByRole('button', { name: /Entrar como invitado/i }).click();
    await expect(pageB).toHaveURL(/\/lobby$/);
    await pageB.getByPlaceholder(/Código de 6 letras o enlace/i).fill(joinCode);
    await pageB.getByRole('button', { name: /^Unirse$/i }).click();
    await expect(pageB).toHaveURL(/\/sala\//);

    // Ambos marcan listo: la mesa pasa a la vista de juego con los dos asientos humanos.
    const readyA = pageA.getByRole('button', { name: /¡Estoy listo para jugar!/i });
    const readyB = pageB.getByRole('button', { name: /¡Estoy listo para jugar!/i });
    if (await readyA.isVisible().catch(() => false)) await readyA.click();
    if (await readyB.isVisible().catch(() => false)) await readyB.click();

    await expect(pageA.getByRole('button', { name: 'Reportar', exact: true })).toBeVisible({
      timeout: 30_000,
    });

    // Abre el diálogo de reporte desde la mesa.
    await pageA.getByRole('button', { name: 'Reportar', exact: true }).click();
    await expect(pageA.getByRole('heading', { name: 'Reportar a un jugador' })).toBeVisible();
    await expect(
      pageA.getByText('Sospecha de colusión o señas fuera del sistema', { exact: true }),
    ).toBeVisible();

    await pageA.screenshot({
      path: path.join(SCREENSHOT_DIR, 'm8-reporte-mesa-360.png'),
      fullPage: true,
    });
  } finally {
    await browser.close();
  }
});
