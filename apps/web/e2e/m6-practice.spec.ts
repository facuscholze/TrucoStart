import { expect, type Page, test } from '@playwright/test';
import { launchIsolatedChromium } from './support/launch.js';

const BASE_URL = 'http://localhost:4173';

/**
 * M6 — Práctica contra la máquina:
 *  - el jugador entra desde Home, la mesa arranca sola con bots y etiqueta de bot visible;
 *  - la pista de entrenamiento aparece solo en mesas de práctica;
 *  - una partida 1v1 completa contra el bot llega al resultado sin intervención del rival.
 */
async function ensureGuest(page: Page): Promise<void> {
  await page.goto(`${BASE_URL}/acceso`);
  const guestCta = page.getByRole('button', { name: /Entrar como invitado/i });
  if (await guestCta.isVisible().catch(() => false)) {
    await guestCta.click();
    await page.waitForURL(/\/lobby$/, { timeout: 30_000 });
  }
}

async function isResultModalOpen(page: Page): Promise<boolean> {
  const win = page.getByRole('heading', { name: /Ganamos la partida/i });
  const loss = page.getByRole('heading', { name: /Se nos escapó esta vuelta/i });
  return (await win.isVisible().catch(() => false)) || (await loss.isVisible().catch(() => false));
}

/** Resuelve un turno humano: acepta cantos pendientes y juega la primera carta habilitada. */
async function stepOneTurn(page: Page, isMobile: boolean): Promise<boolean> {
  if (await isResultModalOpen(page)) return false;

  if (isMobile) {
    const openTrayBtn = page.getByRole('button', { name: /^Cantos \(/i });
    const trayVisible = await openTrayBtn.isVisible().catch(() => false);
    const hasPlayableCard =
      (await page.locator('button:not([disabled]):has(svg[data-card-id])').count()) > 0;
    if (trayVisible && !hasPlayableCard) {
      await openTrayBtn.click({ timeout: 3_000 }).catch(() => undefined);
    }
  }

  const quieroBtn = page.getByRole('button', { name: /^¡Quiero!/i }).first();
  if (await quieroBtn.isVisible().catch(() => false)) {
    await quieroBtn.click({ timeout: 3_000 }).catch(() => undefined);
    return true;
  }

  const card = page.locator('button:not([disabled]):has(svg[data-card-id])').first();
  if ((await card.count()) > 0 && (await card.isVisible().catch(() => false))) {
    await card.click({ timeout: 3_000 }).catch(() => undefined);
    return true;
  }

  const foldBtn = page.getByRole('button', { name: /Irse al mazo/i });
  if (await foldBtn.isVisible().catch(() => false)) {
    await foldBtn.click({ timeout: 3_000 }).catch(() => undefined);
    return true;
  }
  return false;
}

async function startPractice(
  page: Page,
  options: { mode: 1 | 2; difficulty: RegExp; points: 15 | 30 },
): Promise<void> {
  await page.goto(`${BASE_URL}/`);
  await page
    .getByRole('heading', { name: /Jugar contra la máquina/i })
    .first()
    .waitFor();
  if (options.mode === 2) {
    await page.getByRole('button', { name: /Modo 2 contra 2/i }).click({ timeout: 15_000 });
  }
  await page.getByRole('button', { name: options.difficulty }).click({ timeout: 15_000 });
  await page
    .getByRole('button', { name: new RegExp(`Partida a ${options.points} puntos`, 'i') })
    .click({ timeout: 15_000 });
  await page
    .getByRole('button', { name: /Jugar contra la máquina/i })
    .first()
    .click({ timeout: 15_000 });
  await page.waitForURL(/\/mesa\/.*practice=1/, { timeout: 45_000 });
  await page.getByRole('region', { name: /Mesa de truco en vivo/i }).waitFor({ timeout: 45_000 });
}

test.describe('M6 — práctica contra la máquina', () => {
  test('Desktop (1280x800): práctica 1v1 contra bot, pista de entrenamiento y partida completa', async () => {
    test.setTimeout(240_000);
    const browser = await launchIsolatedChromium();
    try {
      const context = await browser.newContext({
        viewport: { width: 1280, height: 800 },
        locale: 'es-AR',
      });
      const page = await context.newPage();

      await ensureGuest(page);
      await startPractice(page, { mode: 1, difficulty: /Dificultad Difícil/i, points: 15 });

      // El rival es un bot: se anuncia en la mesa y el humano tiene sus 3 cartas.
      await expect(page.getByText(/^Bot$/).first()).toBeVisible({ timeout: 30_000 });
      await expect(page.locator('svg[data-card-id]').first()).toBeVisible({ timeout: 30_000 });

      // La pista de entrenamiento está disponible solo en práctica.
      const hintButton = page.getByTestId('practice-hint-button');
      await expect(hintButton).toBeVisible({ timeout: 30_000 });
      await hintButton.click();
      const hintText = page.getByTestId('practice-hint-text');
      await expect(hintText).toBeVisible({ timeout: 20_000 });
      expect(((await hintText.textContent()) ?? '').trim().length).toBeGreaterThan(10);

      // Se juega la partida completa contra el bot hasta el modal de resultado.
      for (let i = 0; i < 160; i++) {
        if (await isResultModalOpen(page)) break;
        if (await stepOneTurn(page, false)) {
          await page.waitForTimeout(120);
          continue;
        }
        await page.waitForTimeout(180);
      }
      await expect(
        page
          .getByRole('heading', { name: /Ganamos la partida|Se nos escapó esta vuelta/i })
          .first(),
      ).toBeVisible({ timeout: 30_000 });

      await context.close();
    } finally {
      await browser.close();
    }
  });

  test('Mobile (360x800): práctica 2v2 con compañero bot y pista visible', async () => {
    test.setTimeout(240_000);
    const browser = await launchIsolatedChromium();
    try {
      const context = await browser.newContext({
        viewport: { width: 360, height: 800 },
        isMobile: true,
        hasTouch: true,
        locale: 'es-AR',
      });
      const page = await context.newPage();

      await ensureGuest(page);
      await startPractice(page, { mode: 2, difficulty: /Dificultad Medio/i, points: 30 });

      // 2v2: hay tres bots en la mesa (compañero + dos rivales).
      await expect(page.getByText(/^Bot$/)).toHaveCount(3, { timeout: 30_000 });

      const hintButton = page.getByTestId('practice-hint-button');
      await expect(hintButton).toBeVisible({ timeout: 30_000 });
      await hintButton.click();
      await expect(page.getByTestId('practice-hint-text')).toBeVisible({ timeout: 20_000 });

      // Jugar unos turnos: el compañero bot responde por su cuenta.
      for (let i = 0; i < 40; i++) {
        if (await isResultModalOpen(page)) break;
        if (await stepOneTurn(page, true)) {
          await page.waitForTimeout(140);
          continue;
        }
        await page.waitForTimeout(200);
      }
      await expect(page.locator('svg[data-card-id]').first()).toBeVisible();

      await context.close();
    } finally {
      await browser.close();
    }
  });
});
