import { type Browser, chromium, expect, type Page, test } from '@playwright/test';

const BASE_URL = 'http://localhost:4173';

async function launchIsolatedChromium(): Promise<Browser> {
  try {
    return await chromium.launch({ headless: true });
  } catch {
    process.env['AWS_LAMBDA_JS_RUNTIME'] = process.env['AWS_LAMBDA_JS_RUNTIME'] ?? 'nodejs22.x';
    const sparticuz = (await import('@sparticuz/chromium')).default;
    const executablePath = await sparticuz.executablePath();
    const multiProcessSafeArgs = sparticuz.args.filter(
      (arg: string) => arg !== '--single-process' && arg !== '--no-zygote',
    );
    return chromium.launch({
      executablePath,
      args: multiProcessSafeArgs,
      headless: true,
      env: { ...process.env } as Record<string, string>,
    });
  }
}

async function isResultModalOpen(page: Page): Promise<boolean> {
  const winHeading = page.getByRole('heading', { name: /Ganamos la partida/i });
  const lossHeading = page.getByRole('heading', { name: /Se nos escapó esta vuelta/i });
  return (await winHeading.isVisible()) || (await lossHeading.isVisible());
}

/**
 * Ejecuta un paso determinístico en la mesa en vivo (desktop >= 1200px o mobile 360px).
 * Prioriza responder cantos pendientes con "¡Quiero!" y cantar "¡Falta Envido!" para definir rápido,
 * jugando cartas legales o yéndose al mazo cuando corresponde.
 */
async function stepOneTurn(page: Page, isMobile: boolean): Promise<boolean> {
  if (await isResultModalOpen(page)) return false;

  if (isMobile) {
    const openTrayBtn = page.getByRole('button', { name: /^Cantos \(/i });
    if ((await openTrayBtn.isVisible()) && (await openTrayBtn.isEnabled())) {
      const labelText = (await openTrayBtn.textContent()) ?? '';
      const countMatch = /\((\d+)\)/.exec(labelText);
      const callCount = countMatch ? Number(countMatch[1]) : 0;

      const playableCard = page.locator('button:not([disabled]):has(svg[data-card-id])').first();
      const hasPlayableCard = (await playableCard.count()) > 0;

      if (callCount > 0 && !hasPlayableCard) {
        await openTrayBtn.click();
        const quieroBtn = page.getByRole('button', { name: /^¡Quiero!/i }).first();
        if (await quieroBtn.isVisible()) {
          await quieroBtn.click();
          return true;
        }
      }

      if (callCount >= 4 && hasPlayableCard) {
        await openTrayBtn.click();
        const faltaBtn = page.getByRole('button', { name: /¡Falta Envido!/i }).first();
        if (await faltaBtn.isVisible()) {
          await faltaBtn.click();
          return true;
        }
        const closeTray = page.getByRole('button', { name: /Cerrar bandeja de cantos/i });
        if (await closeTray.isVisible()) {
          await closeTray.click();
        }
      }
    }
  } else {
    const quieroBtn = page.getByRole('button', { name: /^¡Quiero!/i }).first();
    if ((await quieroBtn.isVisible()) && (await quieroBtn.isEnabled())) {
      await quieroBtn.click();
      return true;
    }

    const faltaBtn = page.getByRole('button', { name: /¡Falta Envido!/i }).first();
    if ((await faltaBtn.isVisible()) && (await faltaBtn.isEnabled())) {
      await faltaBtn.click();
      return true;
    }
  }

  const playableCard = page.locator('button:not([disabled]):has(svg[data-card-id])').first();
  if ((await playableCard.count()) > 0 && (await playableCard.isVisible())) {
    await playableCard.click();
    return true;
  }

  const foldBtn = page.getByRole('button', { name: /Irse al mazo/i });
  if ((await foldBtn.isVisible()) && (await foldBtn.isEnabled())) {
    await foldBtn.click();
    return true;
  }

  return false;
}

async function playUntilMatchEnds(
  pageA: Page,
  pageB: Page,
  isMobile: boolean,
  maxSteps = 90,
): Promise<void> {
  for (let i = 0; i < maxSteps; i++) {
    if ((await isResultModalOpen(pageA)) && (await isResultModalOpen(pageB))) {
      return;
    }
    const actedA = await stepOneTurn(pageA, isMobile);
    if (actedA) {
      await pageA.waitForTimeout(120);
      continue;
    }
    const actedB = await stepOneTurn(pageB, isMobile);
    if (actedB) {
      await pageB.waitForTimeout(120);
      continue;
    }
    await pageA.waitForTimeout(150);
  }
  throw new Error('La partida E2E no alcanzó el modal de resultado dentro del límite de pasos.');
}

test.describe('M5b Multi-Client E2E — Desktop & Mobile + Reconexión + Revancha + PWA Offline', () => {
  test('Desktop (1280x800): invitado -> crear mesa -> unirse por código -> reconexión a mitad de mano -> partida completa -> resultado -> revancha -> perfil real', async () => {
    const browserA = await launchIsolatedChromium();
    const browserB = await launchIsolatedChromium();

    try {
      const contextA = await browserA.newContext({
        viewport: { width: 1280, height: 800 },
        locale: 'es-AR',
      });
      const contextB = await browserB.newContext({
        viewport: { width: 1280, height: 800 },
        locale: 'es-AR',
      });

      const pageA = await contextA.newPage();
      const pageB = await contextB.newPage();

      // 1. Cliente A entra como invitado desde /acceso
      await pageA.goto(`${BASE_URL}/acceso`);
      await pageA.getByRole('button', { name: /Entrar como invitado/i }).click();
      await expect(pageA).toHaveURL(/\/lobby$/);
      await expect(pageA.getByRole('heading', { name: 'Lobby en tiempo real' })).toBeVisible();
      await expect(pageA.getByText('En vivo', { exact: true })).toBeVisible();

      // 2. Cliente A crea mesa privada 1v1 a 15 tantos
      await pageA.locator('#create-score').selectOption('15');
      await pageA.locator('#create-vis').selectOption('PRIVATE');
      await pageA.getByRole('button', { name: /Crear mesa y sentarme/i }).click();

      await expect(pageA).toHaveURL(/\/sala\//);
      const codeLocator = pageA.getByTestId('waiting-room-join-code');
      await expect(codeLocator).toBeVisible();
      const joinCode = ((await codeLocator.textContent()) ?? '').trim();
      expect(joinCode).toMatch(/^[A-Z0-9]{6}$/);

      // 3. Cliente B entra como invitado y se une usando el código de 6 caracteres en el Lobby
      await pageB.goto(`${BASE_URL}/acceso`);
      await pageB.getByRole('button', { name: /Entrar como invitado/i }).click();
      await expect(pageB).toHaveURL(/\/lobby$/);

      await pageB.getByPlaceholder(/Código de 6 letras o enlace/i).fill(joinCode);
      await pageB.getByRole('button', { name: /^Unirse$/i }).click();
      await expect(pageB).toHaveURL(/\/sala\//);

      // 4. Ambos jugadores marcan "¡Estoy listo para jugar!" (Ready-check)
      const readyBtnA = pageA.getByRole('button', { name: /¡Estoy listo para jugar!/i });
      const readyBtnB = pageB.getByRole('button', { name: /¡Estoy listo para jugar!/i });
      await expect(readyBtnA).toBeEnabled();
      await expect(readyBtnB).toBeEnabled();
      await readyBtnA.click();
      await readyBtnB.click();

      // Ambos entran automáticamente al paño en vivo con cartas repartidas
      await expect(pageA.getByRole('region', { name: /Mesa de truco en vivo/i })).toBeVisible();
      await expect(pageB.getByRole('region', { name: /Mesa de truco en vivo/i })).toBeVisible();

      // 5. Jugar la primera carta de la mano y probar RECONEXIÓN A MITAD DE MANO
      const cardA = pageA.locator('button:not([disabled]):has(svg[data-card-id])').first();
      if ((await cardA.count()) > 0) {
        await cardA.click();
      } else {
        await pageB.locator('button:not([disabled]):has(svg[data-card-id])').first().click();
      }
      await pageA.waitForTimeout(250);

      // Cortar red de Cliente B a mitad de mano -> muestra banner de reconexión
      await contextB.setOffline(true);
      await expect(pageB.getByText(/Reconectando con la mesa en vivo/i)).toBeVisible({
        timeout: 12_000,
      });

      // Restaurar red de Cliente B -> pide ticket efímero nuevo, hace table.rejoin y recupera su mano
      await contextB.setOffline(false);
      await expect(pageB.getByText(/Reconectando con la mesa en vivo/i)).toHaveCount(0, {
        timeout: 15_000,
      });
      await expect(pageB.locator('svg[data-card-id]').first()).toBeVisible();

      // 6. Completar la partida hasta el modal de resultado en ambos clientes
      await playUntilMatchEnds(pageA, pageB, false);

      await expect(
        pageA
          .getByRole('heading', { name: /Ganamos la partida|Se nos escapó esta vuelta/i })
          .first(),
      ).toBeVisible();
      await expect(
        pageB
          .getByRole('heading', { name: /Ganamos la partida|Se nos escapó esta vuelta/i })
          .first(),
      ).toBeVisible();

      // 7. Ambos clientes piden REVANCHA y arranca nueva partida en Mano #1
      await pageA.getByRole('button', { name: /Pedir revancha/i }).click();
      await expect(
        pageA.getByRole('button', { name: /Revancha pedida · esperando rival/i }),
      ).toBeVisible();
      await pageB.getByRole('button', { name: /Pedir revancha/i }).click();

      await expect(
        pageA.getByRole('heading', { name: /Ganamos la partida|Se nos escapó esta vuelta/i }),
      ).toHaveCount(0);
      await expect(pageA.getByText('Mano #1').first()).toBeVisible();
      await expect(pageB.getByText('Mano #1').first()).toBeVisible();

      // 8. Verificar en /perfil que las estadísticas reales e historial de PostgreSQL se actualizaron
      await pageA.goto(`${BASE_URL}/perfil`);
      await expect(pageA.getByRole('heading', { name: /Estadísticas oficiales/i })).toBeVisible();
      await expect(pageA.getByText(/Victoria|Derrota/).first()).toBeVisible();
    } finally {
      await browserA.close();
      await browserB.close();
    }
  });

  test('Mobile (360x800): invitado -> crear mesa -> unirse por código -> partida completa -> resultado -> revancha + PWA /anotador 100% offline', async () => {
    const browserA = await launchIsolatedChromium();
    const browserB = await launchIsolatedChromium();

    try {
      const contextA = await browserA.newContext({
        viewport: { width: 360, height: 800 },
        isMobile: true,
        hasTouch: true,
        locale: 'es-AR',
      });
      const contextB = await browserB.newContext({
        viewport: { width: 360, height: 800 },
        isMobile: true,
        hasTouch: true,
        locale: 'es-AR',
      });

      const pageA = await contextA.newPage();
      const pageB = await contextB.newPage();

      // 1. Cliente A móvil entra desde Home creando mesa privada rápida 1v1 (15 tantos)
      await pageA.goto(`${BASE_URL}/`);
      await pageA.getByRole('button', { name: /Armar mesa privada 1v1/i }).click();
      await expect(pageA).toHaveURL(/\/sala\//);

      const joinCode = (
        (await pageA.getByTestId('waiting-room-join-code').textContent()) ?? ''
      ).trim();
      expect(joinCode).toMatch(/^[A-Z0-9]{6}$/);

      // 2. Cliente B móvil se une pegando el código de 6 caracteres en Home
      await pageB.goto(`${BASE_URL}/`);
      await pageB.getByLabel(/Código de mesa privada de 6 caracteres/i).fill(joinCode);
      await pageB.getByRole('button', { name: /Entrar a la mesa/i }).click();
      await expect(pageB).toHaveURL(/\/sala\//);

      // 3. Ready-check móvil en ambos teléfonos
      await expect(pageA.getByRole('button', { name: /¡Estoy listo para jugar!/i })).toBeEnabled();
      await expect(pageB.getByRole('button', { name: /¡Estoy listo para jugar!/i })).toBeEnabled();
      await pageA.getByRole('button', { name: /¡Estoy listo para jugar!/i }).click();
      await pageB.getByRole('button', { name: /¡Estoy listo para jugar!/i }).click();

      await expect(pageA.getByRole('region', { name: /Mesa de truco en vivo/i })).toBeVisible();
      await expect(pageB.getByRole('region', { name: /Mesa de truco en vivo/i })).toBeVisible();

      // 4. Jugar partida completa en viewport móvil (360px) usando el drawer de Cantos
      await playUntilMatchEnds(pageA, pageB, true);

      await expect(
        pageA
          .getByRole('heading', { name: /Ganamos la partida|Se nos escapó esta vuelta/i })
          .first(),
      ).toBeVisible();

      // 5. Pedir revancha desde ambos móviles
      await pageA.getByRole('button', { name: /Pedir revancha/i }).click();
      await pageB.getByRole('button', { name: /Pedir revancha/i }).click();
      await expect(pageA.getByText('Mano #1').first()).toBeVisible();

      // 6. Verificar PWA instalable + /anotador funcionando 100% offline tras recarga sin red
      await pageA.goto(`${BASE_URL}/anotador`);
      await expect(pageA.getByRole('heading', { name: /Anotador de fósforos/i })).toBeVisible();

      await pageA.evaluate(async () => {
        if ('serviceWorker' in navigator) {
          await navigator.serviceWorker.ready;
        }
      });

      await contextA.setOffline(true);
      await pageA.reload({ waitUntil: 'domcontentloaded' });
      await expect(pageA.getByRole('heading', { name: /Anotador de fósforos/i })).toBeVisible();

      await pageA.getByRole('button', { name: '+4' }).first().click();
      await pageA
        .getByRole('button', { name: /\+1 tanto/i })
        .first()
        .click();
      await expect(pageA.getByText('5 malas').first()).toBeVisible();
      await contextA.setOffline(false);
    } finally {
      await browserA.close();
      await browserB.close();
    }
  });
});
