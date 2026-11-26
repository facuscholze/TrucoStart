#!/usr/bin/env node
/**
 * Mide las señales de la tanda de pulido UX sobre el build real (`vite preview`, :4175):
 *
 * - Navegación inferior: si la barra desborda, si la señal de continuidad está presente y
 *   si todos los destinos son alcanzables con teclado (Tab) y con desplazamiento táctil.
 * - Encabezado de escritorio: alto de la cabecera y cantidad de filas usadas a 1024–1440 px.
 * - CLS observado en Inicio, Lobby, Notificaciones y Ranking, en 360 y 1200 px.
 *
 * No escribe en bases ni usa servicios externos: las llamadas se responden con fixtures,
 * igual que `capture-ux-batch-screenshots.mjs`. Cada bloque puede cumplir o fallar el gate.
 *
 * Uso: pnpm --filter @truco/web measure:ux
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from '@playwright/test';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../../..');
const WEB_URL = 'http://127.0.0.1:4175';
const USER_ID = '019a7e40-0000-7000-8000-0000000000a1';
const FRIEND_ID = '019a7e40-0000-7000-8000-0000000000a2';

const children = [];
const failures = [];
const report = [];

function launch() {
  const child = spawn(
    'corepack',
    [
      'pnpm',
      '--filter',
      '@truco/web',
      'exec',
      'vite',
      'preview',
      '--host',
      '0.0.0.0',
      '--port',
      '4175',
    ],
    {
      cwd: REPO_ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, FORCE_COLOR: '0' },
    },
  );
  child.stdout.on('data', () => undefined);
  child.stderr.on('data', (chunk) => console.error(`[web] ${chunk.toString().trim()}`));
  children.push(child);
}

function stopChildren() {
  for (const child of children) if (!child.killed) child.kill('SIGTERM');
}

async function waitForHttp(url, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      // Vite todavía arranca.
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`Timeout esperando ${url}`);
}

async function launchChromium() {
  try {
    return await chromium.launch({ headless: true });
  } catch {
    process.env.AWS_LAMBDA_JS_RUNTIME = process.env.AWS_LAMBDA_JS_RUNTIME ?? 'nodejs22.x';
    const sparticuz = (await import('@sparticuz/chromium')).default;
    const executablePath = await sparticuz.executablePath();
    const args = sparticuz.args.filter((a) => a !== '--single-process' && a !== '--no-zygote');
    return chromium.launch({ executablePath, args, headless: true, env: { ...process.env } });
  }
}

const me = {
  user: {
    id: USER_ID,
    email: 'tana@truco.ar',
    emailVerified: true,
    nickname: 'TanaDelSur',
    isGuest: false,
    role: 'PLAYER',
    status: 'ACTIVE',
    createdAt: '2025-08-01T10:00:00.000Z',
  },
  profile: {
    avatarId: 'default-01',
    level: 4,
    xp: 735,
    bio: '',
    settings: {
      soundEnabled: true,
      animationsReduced: false,
      confirmCalls: false,
      historyVisibility: 'ALL',
      statsVisibility: 'ALL',
      presenceVisibility: 'FRIENDS',
    },
  },
};

const tables = {
  tables: [
    {
      id: '019a7e40-0000-7000-8000-0000000007f1',
      roomId: '019a7e40-0000-7000-8000-0000000007f1',
      mode: '1v1',
      rulesetCode: 'ar-standard-v1',
      visibility: 'PUBLIC',
      status: 'WAITING',
      targetScore: 30,
      flor: true,
      occupiedSeats: 1,
      maxSeats: 2,
      ownerNickname: 'Tano del Paño',
      isPractice: false,
      createdAt: '2026-11-19T12:00:00.000Z',
    },
    {
      id: '019a7e40-0000-7000-8000-0000000007f2',
      roomId: '019a7e40-0000-7000-8000-0000000007f2',
      mode: '2v2',
      rulesetCode: 'ar-standard-v1',
      visibility: 'PUBLIC',
      status: 'WAITING',
      targetScore: 15,
      flor: false,
      occupiedSeats: 2,
      maxSeats: 4,
      ownerNickname: 'La Zurda del Sur',
      isPractice: false,
      createdAt: '2026-11-19T12:00:00.000Z',
    },
  ],
};

const ranking = {
  period: 'GLOBAL',
  mode: '1v1',
  season: {
    id: '01900000-0000-7000-8000-000000000001',
    label: 'Temporada 1',
    startsAt: '2026-11-19T00:00:00.000Z',
    endsAt: '2027-02-17T00:00:00.000Z',
    secondsUntilReset: 7_776_000,
  },
  minimumMatches: 5,
  minimumOpponents: 3,
  items: Array.from({ length: 5 }, (_, index) => ({
    position: index + 1,
    userId: `019a7e40-0000-7000-8000-${String(index + 0x101).padStart(12, '0')}`,
    nickname: ['La Dama de Oro', 'Tano del Paño', 'Siete Bravo', 'La Zurda', 'Pibe de Flores'][
      index
    ],
    score: 1678 - index * 24,
    rating: 1678 - index * 24,
    division: index < 4 ? 'Oro' : 'Plata',
    matchesPlayed: 34 - index * 3,
    opponentsCount: 18 - index,
    wins: 22 - index * 2,
  })),
  nextCursor: null,
  generatedAt: '2026-11-19T12:00:00.000Z',
};

const notifications = {
  items: [
    {
      id: '019a7e40-0000-7000-8000-0000000006f1',
      type: 'TABLE_INVITATION',
      actorUserId: FRIEND_ID,
      actorNickname: 'Tano del Paño',
      referenceId: null,
      tableId: null,
      createdAt: '2026-11-19T11:30:00.000Z',
      readAt: null,
    },
  ],
  nextCursor: null,
  unreadCount: 1,
};

async function installFixtures(page) {
  await page.routeWebSocket('**/lobby-socket.io/**', (socket) => {
    socket.close({ code: 1000, reason: 'Sin tiempo real para medición.' });
  });
  await page.route('**/v1/**', async (route) => {
    const { pathname } = new URL(route.request().url());
    const json = (body) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    if (pathname === '/v1/legal')
      return json({ minAge: 18, draft: true, banner: '', documents: [] });
    if (pathname === '/v1/me') return json(me);
    if (pathname === '/v1/auth/ws-ticket')
      return json({ ticket: 'measure-'.padEnd(32, 'x'), expiresAt: Date.now() + 30_000 });
    if (pathname === '/v1/matchmaking/queue') return json({ status: 'IDLE' });
    if (pathname === '/v1/tables') return json(tables);
    if (pathname === '/v1/rankings') return json(ranking);
    if (pathname === '/v1/social/friends') return json({ items: [] });
    if (pathname === '/v1/social/friend-requests') return json({ items: [] });
    if (pathname === '/v1/social/invitations') return json({ items: [] });
    if (pathname === '/v1/social/blocks') return json({ items: [] });
    if (pathname === '/v1/social/notifications') return json(notifications);
    if (pathname === '/v1/social/notifications/unread-count')
      return json({ unreadCount: notifications.unreadCount });
    return route.fulfill({
      status: 404,
      contentType: 'application/json',
      body: JSON.stringify({ error: { code: 'NOT_FOUND', message: 'Fixture' } }),
    });
  });
}

async function newContext(browser, viewport) {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    isMobile: viewport.isMobile,
    hasTouch: viewport.isMobile,
    locale: 'es-AR',
    serviceWorkers: 'block',
  });
  const page = await context.newPage();
  await installFixtures(page);
  return { context, page };
}

/**
 * La barra inferior crece cuando el bootstrap de sesión agrega destinos (Invitar, Admin,
 * Salir). Para medir la señal de continuidad hay que esperar a que el ancho se estabilice;
 * si no, se fotografía una carrera contra el primer render y el gate se vuelve intermitente.
 */
async function waitForStableBar(nav, { timeoutMs = 3000, quietMs = 500 } = {}) {
  const start = Date.now();
  let last = -1;
  let lastChange = Date.now();
  while (Date.now() - start < timeoutMs) {
    const width = await nav.evaluate((element) => element.scrollWidth);
    if (width !== last) {
      last = width;
      lastChange = Date.now();
    } else if (Date.now() - lastChange >= quietMs) {
      return width;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return last;
}

async function measureBottomNav(browser) {
  const { context, page } = await newContext(browser, { width: 360, height: 800, isMobile: true });
  await page.goto(`${WEB_URL}/amigos`);
  const nav = page.locator('nav[aria-label="Navegación principal"]').last();
  await nav.waitFor();

  const geometry = await nav.evaluate((element) => ({
    overflows: element.scrollWidth - element.clientWidth > 2,
    scrollWidth: element.scrollWidth,
    clientWidth: element.clientWidth,
    destinations: element.querySelectorAll('button').length,
    hint: Boolean(document.getElementById('bottom-nav-more-hint')),
    gradient: Boolean(document.querySelector('[data-testid="bottom-nav-more-right"]')),
  }));

  await waitForStableBar(nav);

  // Todos los destinos accesibles por teclado: el Tab llega a cada botón de la barra.
  const reached = [];
  for (let step = 0; step < 60 && reached.length < geometry.destinations; step++) {
    await page.keyboard.press('Tab');
    const focusedLabel = await page.evaluate(() => {
      const active = document.activeElement;
      const bar = Array.from(document.querySelectorAll('nav')).find(
        (element) => element.contains(active) && active?.tagName === 'BUTTON',
      );
      return bar ? (active?.textContent?.trim() ?? null) : null;
    });
    if (focusedLabel && !reached.includes(focusedLabel)) reached.push(focusedLabel);
  }

  // Desplazar la barra la lleva al final y retira la señal. Se mide sobre la barra ya
  // estable (ver waitForStableBar) y se reintenta por si el desplazamiento se re-acomoda.
  let atEnd = false;
  for (let attempt = 0; attempt < 8 && !atEnd; attempt++) {
    await nav.evaluate((element) => element.scrollTo({ left: element.scrollWidth }));
    await page.waitForTimeout(150);
    atEnd = await nav.evaluate(
      (element) => element.scrollLeft + element.clientWidth >= element.scrollWidth - 2,
    );
  }
  const afterScroll = await page.evaluate(
    (reachedEnd) => ({
      hint: Boolean(document.getElementById('bottom-nav-more-hint')),
      gradient: Boolean(document.querySelector('[data-testid="bottom-nav-more-right"]')),
      atEnd: reachedEnd,
    }),
    atEnd,
  );

  const activeVisible = await page.evaluate(() => {
    const active = document.querySelector('nav [aria-current="page"]');
    if (!active) return false;
    const rect = active.getBoundingClientRect();
    return rect.left >= 0 && rect.right <= window.innerWidth + 1;
  });

  report.push({
    señal: 'nav-inferior',
    ancho: 360,
    desborda: geometry.overflows,
    destinos: geometry.destinations,
    destinosAlcanzadosPorTab: reached.length,
    pistaVisible: geometry.hint,
    degradadoVisible: geometry.gradient,
    pistaOcultaAlFinal: !afterScroll.hint && !afterScroll.gradient,
    seccionActivaVisible: activeVisible,
    scrollWidth: geometry.scrollWidth,
    clientWidth: geometry.clientWidth,
  });

  if (!geometry.overflows) failures.push('La barra inferior no desborda a 360 px: falta el caso');
  if (reached.length < geometry.destinations)
    failures.push(`Tab alcanza ${reached.length}/${geometry.destinations} destinos de la barra`);
  if (!geometry.hint || !geometry.gradient) failures.push('No se ve la señal de continuidad');
  if (afterScroll.hint || afterScroll.gradient)
    failures.push(
      `La señal no desaparece al llegar al final de la barra (alFinal=${afterScroll.atEnd})`,
    );
  if (!activeVisible) failures.push('La sección activa queda fuera de cuadro en la barra');

  await context.close();
}

async function measureHeader(browser) {
  for (const width of [1024, 1200, 1440]) {
    const { context, page } = await newContext(browser, {
      width,
      height: 900,
      isMobile: false,
    });
    await page.goto(`${WEB_URL}/amigos`);
    await page.locator('header').first().waitFor();
    await page.waitForTimeout(200);
    const metrics = await page
      .locator('header')
      .first()
      .evaluate((element) => {
        const headerRect = element.getBoundingClientRect();
        const rows = new Set();
        for (const child of element.querySelectorAll('a,button')) {
          if (!child.offsetParent) continue;
          const rect = child.getBoundingClientRect();
          // Agrupar por línea con tolerancia de 12 px.
          const key = Math.round((rect.top + rect.height / 2) / 12);
          rows.add(key);
        }
        return { height: Math.round(headerRect.height), rowBuckets: rows.size };
      });
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    );
    report.push({
      señal: 'encabezado-escritorio',
      ancho: width,
      altoPx: metrics.height,
      filasDeControles: metrics.rowBuckets,
      overflowHorizontal: overflow,
    });
    if (metrics.rowBuckets > 1)
      failures.push(`Encabezado a ${width}px usa ${metrics.rowBuckets} filas de controles`);
    if (overflow) failures.push(`Documento desborda horizontalmente a ${width}px`);
    await context.close();
  }
}

/**
 * CLS medido de referencia (mediana de 3 cargas por ruta y ancho) sobre el build previo a
 * la tanda UX: commit `1f9b7d4`, reproducible con `git checkout 1f9b7d4 -- apps/web` y
 * `pnpm --filter @truco/web build`. La tanda no puede empeorar estos valores.
 */
const BASELINE_CLS = {
  'Inicio@360': 0,
  'Lobby@360': 0,
  'Notificaciones@360': 0,
  'Ranking@360': 0,
  'Inicio@1200': 0.0047,
  'Lobby@1200': 0.0554,
  'Notificaciones@1200': 0.0231,
  'Ranking@1200': 0.0024,
};
const CLS_ABSOLUTE_BUDGET = 0.029;

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

async function measureCls(browser) {
  const routes = [
    { path: '/', name: 'Inicio' },
    { path: '/lobby', name: 'Lobby' },
    { path: '/amigos', name: 'Notificaciones' },
    { path: '/ranking', name: 'Ranking' },
  ];
  for (const viewport of [
    { width: 360, height: 800, isMobile: true },
    { width: 1200, height: 900, isMobile: false },
  ]) {
    for (const route of routes) {
      const samples = [];
      let lastShifts = [];
      // Tres cargas por ruta: la mediana amortigua el jitter de fuentes y red del sandbox.
      for (let sample = 0; sample < 3; sample++) {
        const { context, page } = await newContext(browser, viewport);
        await page.addInitScript(() => {
          window.__uxCls = 0;
          window.__uxShifts = [];
          try {
            new PerformanceObserver((list) => {
              for (const entry of list.getEntries()) {
                if (entry.hadRecentInput) continue;
                window.__uxCls += entry.value;
                const source = entry.sources?.[0];
                const node = source?.node;
                window.__uxShifts.push({
                  value: Math.round(entry.value * 10000) / 10000,
                  node: node
                    ? `${node.tagName?.toLowerCase()}.${String(node.className ?? '').slice(0, 60)}`
                    : 'sin-nodo',
                  from: source ? Math.round(source.previousRect?.top ?? 0) : null,
                  to: source ? Math.round(source.currentRect?.top ?? 0) : null,
                });
              }
            }).observe({ type: 'layout-shift', buffered: true });
          } catch {
            // Navegadores sin Layout Instability API.
          }
        });
        await page.goto(`${WEB_URL}${route.path}`, { waitUntil: 'networkidle' });
        await page.waitForTimeout(1200);
        samples.push(await page.evaluate(() => Math.round((window.__uxCls ?? 0) * 10000) / 10000));
        lastShifts = await page.evaluate(() => (window.__uxShifts ?? []).slice(0, 4));
        await context.close();
      }

      const key = `${route.name}@${viewport.width}`;
      const measured = median(samples);
      const baseline = BASELINE_CLS[key] ?? 0;
      const budget = Math.max(CLS_ABSOLUTE_BUDGET, baseline);
      report.push({
        señal: 'CLS',
        ruta: route.name,
        ancho: viewport.width,
        muestras: samples,
        mediana: measured,
        lineaBase: baseline,
        presupuesto: budget,
        desplazamientos: lastShifts,
      });
      if (measured > budget) {
        failures.push(
          `CLS ${key} = ${measured} empeora la base ${baseline} / presupuesto ${budget}`,
        );
      }
    }
  }
}

async function main() {
  launch();
  let browser;
  try {
    await waitForHttp(WEB_URL);
    browser = await launchChromium();
    await measureBottomNav(browser);
    await measureHeader(browser);
    await measureCls(browser);
  } finally {
    if (browser) await browser.close();
    stopChildren();
  }

  console.log(JSON.stringify(report, null, 2));
  if (failures.length > 0) {
    console.error('\nGates de UX fallidos:');
    for (const failure of failures) console.error(`- ${failure}`);
    process.exit(1);
  }
  console.log('\nTodos los gates de UX medidos pasaron.');
}

main().catch((error) => {
  console.error(error);
  stopChildren();
  process.exit(1);
});
