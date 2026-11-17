#!/usr/bin/env node
/**
 * Captura las 14 screenshots de M5b (7 pantallas x 360px / 1200px) en docs/screenshots/.
 *
 * Requisitos: `pnpm --filter @truco/web build` ya ejecutado (usa `vite preview`).
 *
 * Uso: pnpm --filter @truco/web screenshots:m5b
 *
 * El script levanta por sí mismo el stack E2E real (PostgreSQL adaptativo + API :3001 + game-server :3002)
 * y `vite preview` :4173, juega una partida completa para poblar estadísticas/historial reales de PostgreSQL
 * y luego captura cada pantalla en viewport móvil (360x800) y escritorio (1200x900).
 */
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from '@playwright/test';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../../..');
const OUT_DIR = path.join(REPO_ROOT, 'docs/screenshots');
const BASE_URL = 'http://localhost:4173';
const API_HEALTH_URL = 'http://127.0.0.1:3001/v1/health';

const VIEWPORTS = [
  { suffix: '360', width: 360, height: 800, isMobile: true },
  { suffix: '1200', width: 1200, height: 900, isMobile: false },
];

const children = [];

function run(name, command, args, cwd) {
  const child = spawn(command, args, {
    cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, FORCE_COLOR: '0' },
  });
  child.stdout.on('data', (chunk) => {
    const line = chunk.toString().trim();
    if (line && !line.includes('vite v')) console.log(`[${name}] ${line}`);
  });
  child.stderr.on('data', (chunk) => {
    const line = chunk.toString().trim();
    if (line) console.error(`[${name}] ${line}`);
  });
  children.push(child);
  return child;
}

function shutdownChildren() {
  for (const child of children) {
    if (!child.killed) child.kill('SIGTERM');
  }
}

async function waitForHttp(url, label, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // todavía no escucha
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  throw new Error(`Timeout esperando ${label} en ${url}`);
}

async function launchChromium() {
  try {
    return await chromium.launch({ headless: true });
  } catch {
    process.env.AWS_LAMBDA_JS_RUNTIME = process.env.AWS_LAMBDA_JS_RUNTIME ?? 'nodejs22.x';
    const sparticuz = (await import('@sparticuz/chromium')).default;
    const executablePath = await sparticuz.executablePath();
    const args = sparticuz.args.filter(
      (arg) => arg !== '--single-process' && arg !== '--no-zygote',
    );
    return chromium.launch({ executablePath, args, headless: true, env: { ...process.env } });
  }
}

async function newGuestPage(browser, viewport) {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    isMobile: viewport.isMobile,
    hasTouch: viewport.isMobile,
    deviceScaleFactor: 2,
    locale: 'es-AR',
  });
  const page = await context.newPage();
  return { context, page };
}

async function ensureGuestSession(page) {
  await page.goto(`${BASE_URL}/acceso`);
  const guestCta = page.getByRole('button', { name: /Entrar como invitado/i });
  if (await guestCta.isVisible().catch(() => false)) {
    await guestCta.click();
    await page.waitForURL(/\/lobby$/, { timeout: 30_000 });
    return;
  }
  await page.goto(`${BASE_URL}/lobby`);
  await page.waitForURL(/\/lobby$/, { timeout: 30_000 });
}

async function capture(page, name, { fullPage = true, scrollTo = null } = {}) {
  if (scrollTo) {
    await page
      .locator(scrollTo)
      .first()
      .scrollIntoViewIfNeeded()
      .catch(() => undefined);
  } else {
    await page.evaluate('window.scrollTo(0, 0)').catch(() => undefined);
  }
  await page.waitForTimeout(600);
  const file = path.join(OUT_DIR, `${name}.png`);
  await page.screenshot({ path: file, fullPage });
  console.log(`✓ ${path.relative(REPO_ROOT, file)}`);
}

async function isResultModalOpen(page) {
  const win = page.getByRole('heading', { name: /Ganamos la partida/i });
  const loss = page.getByRole('heading', { name: /Se nos escapó esta vuelta/i });
  return (await win.isVisible().catch(() => false)) || (await loss.isVisible().catch(() => false));
}

async function stepOneTurn(page) {
  if (await isResultModalOpen(page)) return false;

  const quieroBtn = page.getByRole('button', { name: /^¡Quiero!/i }).first();
  if ((await quieroBtn.isVisible().catch(() => false)) && (await quieroBtn.isEnabled())) {
    await quieroBtn.click();
    return true;
  }

  const faltaBtn = page.getByRole('button', { name: /¡Falta Envido!/i }).first();
  if ((await faltaBtn.isVisible().catch(() => false)) && (await faltaBtn.isEnabled())) {
    await faltaBtn.click();
    return true;
  }

  const card = page.locator('button:not([disabled]):has(svg[data-card-id])').first();
  if ((await card.count()) > 0 && (await card.isVisible().catch(() => false))) {
    await card.click();
    return true;
  }

  const foldBtn = page.getByRole('button', { name: /Irse al mazo/i });
  if ((await foldBtn.isVisible().catch(() => false)) && (await foldBtn.isEnabled())) {
    await foldBtn.click();
    return true;
  }
  return false;
}

async function playUntilMatchEnds(pageA, pageB, maxSteps = 120) {
  for (let i = 0; i < maxSteps; i++) {
    if ((await isResultModalOpen(pageA)) && (await isResultModalOpen(pageB))) return;
    if (await stepOneTurn(pageA)) {
      await pageA.waitForTimeout(100);
      continue;
    }
    if (await stepOneTurn(pageB)) {
      await pageB.waitForTimeout(100);
      continue;
    }
    await pageA.waitForTimeout(140);
  }
  throw new Error('La partida de captura no terminó dentro del límite de pasos.');
}

/** Juega una partida 1v1 completa para poblar partidas/estadísticas reales en PostgreSQL. */
async function seedRealMatch(browser) {
  const desktop = { width: 1280, height: 800, isMobile: false };
  const { context: ctxA, page: pageA } = await newGuestPage(browser, desktop);
  const { context: ctxB, page: pageB } = await newGuestPage(browser, desktop);

  await ensureGuestSession(pageA);
  await pageA.locator('#create-score').selectOption('15');
  await pageA.locator('#create-vis').selectOption('PRIVATE');
  await pageA.getByRole('button', { name: /Crear mesa y sentarme/i }).click();
  await pageA.waitForURL(/\/sala\//, { timeout: 30_000 });

  const joinCode = ((await pageA.getByTestId('waiting-room-join-code').textContent()) ?? '').trim();

  await ensureGuestSession(pageB);
  await pageB.getByPlaceholder(/Código de 6 letras o enlace/i).fill(joinCode);
  await pageB.getByRole('button', { name: /^Unirse$/i }).click();
  await pageB.waitForURL(/\/sala\//, { timeout: 30_000 });

  const readyA = pageA.getByRole('button', { name: /¡Estoy listo para jugar!/i });
  const readyB = pageB.getByRole('button', { name: /¡Estoy listo para jugar!/i });
  await readyA.waitFor({ state: 'visible', timeout: 30_000 });
  await readyB.waitFor({ state: 'visible', timeout: 30_000 });
  await readyA.click();
  await readyB.click();

  await pageA.getByRole('region', { name: /Mesa de truco en vivo/i }).waitFor({ timeout: 45_000 });
  await playUntilMatchEnds(pageA, pageB);
  console.log('✓ Partida semilla completada (estadísticas e historial reales en PostgreSQL)');

  const storageStateA = await ctxA.storageState();
  await ctxA.close();
  await ctxB.close();
  return storageStateA;
}

/** Publica una mesa pública 2v2 para que el Lobby muestre mesas reales en la captura. */
async function seedPublicTable(browser) {
  const { context, page } = await newGuestPage(browser, {
    width: 1280,
    height: 800,
    isMobile: false,
  });
  await ensureGuestSession(page);
  await page.locator('#create-mode').selectOption('2v2');
  await page.locator('#create-score').selectOption('30');
  await page.locator('#create-vis').selectOption('PUBLIC');
  await page.getByRole('button', { name: /Crear mesa y sentarme/i }).click();
  await page.waitForURL(/\/sala\//, { timeout: 30_000 });
  console.log('✓ Mesa pública sembrada para el Lobby');
  return context;
}

/** Crea una mesa privada con 2 asientos ocupados y devuelve el par de contextos/páginas. */
async function openWaitingRoom(browser, viewport, storageState) {
  const ownerContext = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    isMobile: viewport.isMobile,
    hasTouch: viewport.isMobile,
    deviceScaleFactor: 2,
    locale: 'es-AR',
    ...(storageState ? { storageState } : {}),
  });
  const first = { context: ownerContext, page: await ownerContext.newPage() };

  await first.page.goto(`${BASE_URL}/lobby`);
  await first.page.locator('#create-score').selectOption('30');
  await first.page.locator('#create-vis').selectOption('PRIVATE');
  await first.page.getByRole('button', { name: /Crear mesa y sentarme/i }).click();
  await first.page.waitForURL(/\/sala\//, { timeout: 30_000 });
  await first.page.getByTestId('waiting-room-join-code').waitFor({ timeout: 30_000 });

  const joinCode = (
    (await first.page.getByTestId('waiting-room-join-code').textContent()) ?? ''
  ).trim();

  const second = await newGuestPage(browser, { width: 900, height: 800, isMobile: false });
  await ensureGuestSession(second.page);
  const joinInput = second.page.getByPlaceholder(/Código de 6 letras o enlace/i);
  await joinInput.waitFor({ state: 'visible', timeout: 30_000 });
  await joinInput.fill(joinCode);
  await second.page.getByRole('button', { name: /^Unirse$/i }).click();
  await second.page.waitForURL(/\/sala\//, { timeout: 30_000 });

  // Esperar a que el asiento #2 quede ocupado por el invitado B (sync por WebSocket)
  await first.page
    .getByText(/Asiento libre/i)
    .first()
    .waitFor({ state: 'detached', timeout: 30_000 });
  return { first, second };
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });

  console.log('Levantando stack E2E (API :3001 + game-server :3002) y vite preview :4173…');
  run('api', 'pnpm', ['--filter', '@truco/api', 'exec', 'tsx', 'scripts/e2e-stack.ts'], REPO_ROOT);
  await waitForHttp(API_HEALTH_URL, 'API E2E');

  run(
    'web',
    'pnpm',
    ['--filter', '@truco/web', 'exec', 'vite', 'preview', '--host', '0.0.0.0', '--port', '4173'],
    REPO_ROOT,
  );
  await waitForHttp(`${BASE_URL}/`, 'vite preview');

  const browser = await launchChromium();
  let publicTableContext = null;
  try {
    const storageState = await seedRealMatch(browser);
    publicTableContext = await seedPublicTable(browser);

    for (const viewport of VIEWPORTS) {
      const shot = (name) => `${name}-${viewport.suffix}`;
      // En móvil la barra inferior es fija: se captura solo el viewport visible.
      const shotOpts = { fullPage: !viewport.isMobile };

      // 1. Login / acceso (sin sesión)
      {
        const { context, page } = await newGuestPage(browser, viewport);
        await page.goto(`${BASE_URL}/acceso`);
        await page.getByRole('heading', { name: /Tu cuenta en el paño/i }).waitFor();
        await capture(page, shot('m5b-login'), shotOpts);

        // 1b. Registro de cuenta nueva
        await page.getByRole('tab', { name: /Crear cuenta/i }).click();
        await page.getByRole('button', { name: /Crear cuenta y entrar/i }).waitFor();
        await capture(page, shot('m5b-registro'), shotOpts);

        // 1c. Recuperación de contraseña (pedido de enlace por correo)
        await page.getByRole('tab', { name: /Recuperar clave/i }).click();
        await page.getByRole('button', { name: /Enviar enlace de recuperación/i }).waitFor();
        await capture(page, shot('m5b-recuperar'), shotOpts);

        await context.close();
      }

      // 2. Home con sesión real
      {
        const context = await browser.newContext({
          viewport: { width: viewport.width, height: viewport.height },
          isMobile: viewport.isMobile,
          hasTouch: viewport.isMobile,
          deviceScaleFactor: 2,
          locale: 'es-AR',
          storageState,
        });
        const page = await context.newPage();

        await page.goto(`${BASE_URL}/`);
        await page.locator('#app-heading').waitFor();
        await capture(page, shot('m5b-home'), shotOpts);

        // 3. Lobby en tiempo real con canal WebSocket conectado
        await page.goto(`${BASE_URL}/lobby`);
        await page.getByRole('heading', { name: /Lobby en tiempo real/i }).waitFor();
        await page
          .getByText('En vivo', { exact: true })
          .waitFor({ timeout: 30_000 })
          .catch(() => {});
        await page
          .getByText(/asientos/i)
          .first()
          .waitFor({ timeout: 20_000 })
          .catch(() => undefined);
        await capture(page, shot('m5b-lobby'), shotOpts);

        // 4. Perfil con estadísticas e historial reales de la partida semilla
        await page.goto(`${BASE_URL}/perfil`);
        await page.getByRole('heading', { name: /Estadísticas oficiales/i }).waitFor();
        await capture(page, shot('m5b-perfil'), shotOpts);

        // 4b. Ajustes: sonido/animaciones + sesiones y dispositivos + exportar/eliminar cuenta
        await capture(page, shot('m5b-ajustes'), {
          ...shotOpts,
          scrollTo: 'text=Sonido, animaciones y accesibilidad',
        });

        // 5. Aprender (reglas, jerarquía de cartas y señas)
        await page.goto(`${BASE_URL}/aprender`);
        await page.getByRole('heading', { name: /Aprender a jugar al Truco Argentino/i }).waitFor();
        await capture(page, shot('m5b-aprender'), shotOpts);

        // 6. Anotador de fósforos offline con 4 malas + 1 tanto cargados
        await page.goto(`${BASE_URL}/anotador`);
        await page.getByRole('heading', { name: /Anotador de fósforos/i }).waitFor();
        await page.getByRole('button', { name: '+4' }).first().click();
        await page
          .getByRole('button', { name: /\+1 tanto/i })
          .first()
          .click();
        await capture(page, shot('m5b-anotador'), shotOpts);

        await context.close();
      }

      // 6b. M6 — Mesa de práctica contra la máquina con pista de entrenamiento abierta
      {
        const context = await browser.newContext({
          viewport: { width: viewport.width, height: viewport.height },
          isMobile: viewport.isMobile,
          hasTouch: viewport.isMobile,
          deviceScaleFactor: 2,
          locale: 'es-AR',
        });
        const page = await context.newPage();
        await ensureGuestSession(page);
        await page.goto(`${BASE_URL}/`);
        await page
          .getByRole('heading', { name: /Jugar contra la máquina/i })
          .first()
          .waitFor({ timeout: 30_000 });
        await page.getByRole('button', { name: /Dificultad Difícil/i }).click();
        await page
          .getByRole('button', { name: /Jugar contra la máquina/i })
          .first()
          .click();
        await page.waitForURL(/\/mesa\/.*practice=1/, { timeout: 45_000 });
        await page.getByRole('region', { name: /Mesa de truco en vivo/i }).waitFor({
          timeout: 45_000,
        });
        await page.getByTestId('practice-hint-button').waitFor({ timeout: 45_000 });
        await page.getByTestId('practice-hint-button').click();
        await page.getByTestId('practice-hint-text').waitFor({ timeout: 20_000 });
        await capture(page, shot('m6-practica-pista'), shotOpts);
        await context.close();
      }

      // 6c. M6 — Tutorial interactivo (lección de Envido)
      {
        const context = await browser.newContext({
          viewport: { width: viewport.width, height: viewport.height },
          isMobile: viewport.isMobile,
          hasTouch: viewport.isMobile,
          deviceScaleFactor: 2,
          locale: 'es-AR',
        });
        const page = await context.newPage();
        await ensureGuestSession(page);
        await page.goto(`${BASE_URL}/aprender`);
        await page.getByRole('tab', { name: /Tutorial interactivo/i }).click();
        await page.getByTestId('tutorial-objective').waitFor({ timeout: 30_000 });
        await page
          .getByRole('button', { name: /3\. El envido/i })
          .click({ timeout: 10_000 })
          .catch(() => undefined);
        await page.getByTestId('tutorial-objective').waitFor({ timeout: 20_000 });
        await capture(page, shot('m6-tutorial'), {
          ...shotOpts,
          scrollTo: '[data-testid="tutorial-objective"]',
        });
        await context.close();
      }

      // 7. Sala de espera con dos asientos ocupados (invitados nuevos, sin mesa activa previa)
      {
        const { first, second } = await openWaitingRoom(browser, viewport, null);
        await first.page.getByRole('heading', { name: /Sala de espera/i }).waitFor();
        await capture(first.page, shot('m5b-sala-espera'), {
          ...shotOpts,
          // En móvil desplazamos hasta los asientos para mostrar los dos ocupados.
          scrollTo: viewport.isMobile ? 'text=Asiento #2' : null,
        });
        await first.page
          .getByRole('button', { name: /Salir de la mesa/i })
          .click()
          .catch(() => undefined);
        await first.page.waitForTimeout(400);
        await second.context.close();
        await first.context.close();
      }
    }
  } finally {
    await publicTableContext?.close().catch(() => undefined);
    await browser.close();
    shutdownChildren();
    const { readdir } = await import('node:fs/promises');
    const files = (await readdir(OUT_DIR))
      .filter((f) => f.startsWith('m5b-') || f.startsWith('m6-'))
      .sort();
    console.log(`\n${files.length} screenshots M5b/M6 en docs/screenshots/`);
    for (const file of files) console.log(` - ${file}`);
  }
}

main().catch((err) => {
  console.error(err);
  shutdownChildren();
  process.exit(1);
});
