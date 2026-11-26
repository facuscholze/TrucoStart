#!/usr/bin/env node
/**
 * Captura las pantallas de torneos (M10a) a 360 y 1200 px con fixtures locales.
 *
 * No toca servicios externos: intercepta `/v1/**` y sirve respuestas con la forma del
 * contrato. El cuadro que se ve es el de un torneo de 8 en juego, con un cruce ya
 * resuelto, dos listos y la ronda siguiente a confirmar — el estado que más importa
 * explicar en una captura.
 */
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../../..');
const OUT_DIR = path.join(REPO_ROOT, 'docs/screenshots');
const WEB_URL = 'http://127.0.0.1:4174';
const VIEWPORTS = [
  { suffix: '360', width: 360, height: 900, isMobile: true, reducedMotion: 'reduce' },
  { suffix: '1200', width: 1200, height: 1000, isMobile: false, reducedMotion: 'no-preference' },
];
const USER_ID = '019a7e40-0000-7000-8000-0000000000a1';
const TOURNAMENT_ID = '019a7e40-0000-7000-8000-00000000c001';
const children = [];

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
      '4174',
    ],
    {
      cwd: REPO_ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, FORCE_COLOR: '0' },
    },
  );
  child.stdout.on('data', (data) => console.log(`[web] ${data.toString().trim()}`));
  child.stderr.on('data', (data) => console.error(`[web] ${data.toString().trim()}`));
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
      // Vite preview todavía está arrancando.
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`No inició Vite preview en ${url}`);
}

async function launchBrowser() {
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

const me = {
  user: {
    id: USER_ID,
    email: null,
    emailVerified: false,
    nickname: 'TanaDelSur',
    isGuest: false,
    role: 'PLAYER',
    status: 'ACTIVE',
    createdAt: '2025-08-01T10:00:00.000Z',
  },
  profile: {
    avatarId: 'mate-classic',
    level: 4,
    xp: 735,
    bio: '',
    settings: {
      soundEnabled: true,
      animationsReduced: false,
      confirmCalls: false,
      historyVisibility: 'FRIENDS',
      statsVisibility: 'FRIENDS',
      presenceVisibility: 'FRIENDS',
    },
  },
};

const summary = {
  id: TOURNAMENT_ID,
  name: 'Copa de Otoño',
  format: 'SINGLE_ELIMINATION',
  visibility: 'OFFICIAL',
  status: 'IN_PROGRESS',
  mode: '1v1',
  rulesetCode: 'ar-corto-15-flor-v1',
  targetScore: 15,
  florEnabled: true,
  turnTimeoutMs: 25_000,
  capacity: 8,
  registeredCount: 8,
  checkedInCount: 8,
  joinCode: null,
  registrationClosesAt: '2026-11-26T12:00:00.000Z',
  checkInClosesAt: '2026-11-26T12:30:00.000Z',
  startsAt: '2026-11-26T12:35:00.000Z',
  finishedAt: null,
  cancelledReason: null,
  createdByNickname: 'MartaModera',
  isParticipant: true,
  isOrganizer: false,
  prizes: [
    {
      position: 1,
      coins: 300,
      cosmeticId: null,
      cosmeticName: 'Copa de otoño',
    },
    { position: 2, coins: 120, cosmeticId: null, cosmeticName: null },
  ],
};

const participants = [
  { userId: USER_ID, nickname: 'TanaDelSur', seed: 1, status: 'CHECKED_IN', rating: 1580 },
  {
    userId: '019a7e40-0000-7000-8000-00000000c002',
    nickname: 'MateAmargo',
    seed: 2,
    status: 'CHECKED_IN',
    rating: 1545,
  },
  {
    userId: '019a7e40-0000-7000-8000-00000000c003',
    nickname: 'LaViejaEscuela',
    seed: 3,
    status: 'CHECKED_IN',
    rating: 1520,
  },
  {
    userId: '019a7e40-0000-7000-8000-00000000c004',
    nickname: 'CantoFirme',
    seed: 4,
    status: 'ELIMINATED',
    rating: 1490,
  },
  {
    userId: '019a7e40-0000-7000-8000-00000000c005',
    nickname: 'FlorDePalo',
    seed: 5,
    status: 'CHECKED_IN',
    rating: 1470,
  },
  {
    userId: '019a7e40-0000-7000-8000-00000000c006',
    nickname: 'EnvidoFiel',
    seed: 6,
    status: 'CHECKED_IN',
    rating: 1450,
  },
  {
    userId: '019a7e40-0000-7000-8000-00000000c007',
    nickname: 'PieCriollo',
    seed: 7,
    status: 'ELIMINATED',
    rating: 1430,
  },
  {
    userId: '019a7e40-0000-7000-8000-00000000c008',
    nickname: 'SieteOro',
    seed: 8,
    status: 'CHECKED_IN',
    rating: 1410,
  },
].map((participant) => ({
  ...participant,
  registeredAt: '2026-11-26T11:40:00.000Z',
  checkedInAt: '2026-11-26T12:20:00.000Z',
}));

const match = (overrides) => ({
  bracket: 'WINNERS',
  status: 'SCHEDULED',
  homeNickname: null,
  awayNickname: null,
  homeUserId: null,
  awayUserId: null,
  winnerUserId: null,
  roomId: null,
  deadlineAt: null,
  forfeitReason: null,
  startedAt: null,
  completedAt: null,
  ...overrides,
});

const matches = [
  match({
    id: '019a7e40-0000-7000-8000-00000000d001',
    round: 1,
    slot: 0,
    status: 'COMPLETED',
    homeUserId: USER_ID,
    homeNickname: 'TanaDelSur',
    awayUserId: '019a7e40-0000-7000-8000-00000000c004',
    awayNickname: 'CantoFirme',
    winnerUserId: USER_ID,
    completedAt: '2026-11-26T12:52:00.000Z',
  }),
  match({
    id: '019a7e40-0000-7000-8000-00000000d002',
    round: 1,
    slot: 1,
    status: 'COMPLETED',
    homeUserId: '019a7e40-0000-7000-8000-00000000c002',
    homeNickname: 'MateAmargo',
    awayUserId: '019a7e40-0000-7000-8000-00000000c007',
    awayNickname: 'PieCriollo',
    winnerUserId: '019a7e40-0000-7000-8000-00000000c002',
    completedAt: '2026-11-26T12:55:00.000Z',
  }),
  match({
    id: '019a7e40-0000-7000-8000-00000000d003',
    round: 1,
    slot: 2,
    status: 'READY',
    homeUserId: '019a7e40-0000-7000-8000-00000000c003',
    homeNickname: 'LaViejaEscuela',
    awayUserId: '019a7e40-0000-7000-8000-00000000c006',
    awayNickname: 'EnvidoFiel',
    roomId: '019a7e40-0000-7000-8000-00000000e003',
    deadlineAt: '2026-11-26T13:10:00.000Z',
  }),
  match({
    id: '019a7e40-0000-7000-8000-00000000d004',
    round: 1,
    slot: 3,
    status: 'READY',
    homeUserId: '019a7e40-0000-7000-8000-00000000c005',
    homeNickname: 'FlorDePalo',
    awayUserId: '019a7e40-0000-7000-8000-00000000c008',
    awayNickname: 'SieteOro',
    roomId: '019a7e40-0000-7000-8000-00000000e004',
    deadlineAt: '2026-11-26T13:10:00.000Z',
  }),
  match({ id: '019a7e40-0000-7000-8000-00000000d005', round: 2, slot: 0 }),
  match({ id: '019a7e40-0000-7000-8000-00000000d006', round: 2, slot: 1 }),
  match({ id: '019a7e40-0000-7000-8000-00000000d007', round: 3, slot: 0 }),
];

const detail = {
  tournament: summary,
  participants,
  matches,
  standings: [
    {
      position: 1,
      userId: USER_ID,
      nickname: 'TanaDelSur',
      seed: 1,
      eliminationRound: null,
      tiebreakNote: 'Sigue en carrera',
    },
    {
      position: 2,
      userId: '019a7e40-0000-7000-8000-00000000c002',
      nickname: 'MateAmargo',
      seed: 2,
      eliminationRound: null,
      tiebreakNote: 'Sigue en carrera',
    },
    {
      position: 3,
      userId: '019a7e40-0000-7000-8000-00000000c003',
      nickname: 'LaViejaEscuela',
      seed: 3,
      eliminationRound: null,
      tiebreakNote: 'Sigue en carrera',
    },
    {
      position: 4,
      userId: '019a7e40-0000-7000-8000-00000000c005',
      nickname: 'FlorDePalo',
      seed: 5,
      eliminationRound: null,
      tiebreakNote: 'Sigue en carrera',
    },
    {
      position: 5,
      userId: '019a7e40-0000-7000-8000-00000000c006',
      nickname: 'EnvidoFiel',
      seed: 6,
      eliminationRound: null,
      tiebreakNote: 'Sigue en carrera',
    },
    {
      position: 6,
      userId: '019a7e40-0000-7000-8000-00000000c008',
      nickname: 'SieteOro',
      seed: 8,
      eliminationRound: null,
      tiebreakNote: 'Sigue en carrera',
    },
    {
      position: 7,
      userId: '019a7e40-0000-7000-8000-00000000c004',
      nickname: 'CantoFirme',
      seed: 4,
      eliminationRound: 1,
      tiebreakNote: 'Cayó en la ronda 1',
    },
    {
      position: 8,
      userId: '019a7e40-0000-7000-8000-00000000c007',
      nickname: 'PieCriollo',
      seed: 7,
      eliminationRound: 1,
      tiebreakNote: 'Cayó en la ronda 1',
    },
  ],
  myNextMatch: null,
  canRegister: false,
  canCheckIn: false,
  registrationClosedReason: 'El torneo ya empezó.',
};

/** Listado con los tres estados que importan: abierto, en juego y terminado. */
const list = {
  nextCursor: null,
  items: [
    summary,
    {
      ...summary,
      id: '019a7e40-0000-7000-8000-00000000c010',
      name: 'Torneo del barrio',
      format: 'DOUBLE_ELIMINATION',
      visibility: 'PRIVATE',
      status: 'REGISTRATION',
      mode: '2v2',
      capacity: 16,
      registeredCount: 7,
      checkedInCount: 0,
      isParticipant: false,
      isOrganizer: false,
      prizes: [],
    },
    {
      ...summary,
      id: '019a7e40-0000-7000-8000-00000000c011',
      name: 'Copa de Invierno',
      status: 'FINISHED',
      capacity: 32,
      registeredCount: 32,
      checkedInCount: 30,
      isParticipant: false,
      prizes: [{ position: 1, coins: 500, cosmeticId: null, cosmeticName: null }],
    },
  ],
};

async function fulfillJson(route, status, body) {
  await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

async function installFixtures(page) {
  await page.routeWebSocket('**/lobby-socket.io/**', (socket) => {
    socket.close({ code: 1000, reason: 'Captura local sin tiempo real.' });
  });
  await page.route('**/v1/**', async (route) => {
    const { pathname } = new URL(route.request().url());
    if (pathname === '/v1/legal') {
      return fulfillJson(route, 200, {
        minAge: 18,
        draft: true,
        banner: 'BORRADOR, PENDIENTE DE REVISIÓN LEGAL',
        documents: [],
      });
    }
    if (pathname === '/v1/me') return fulfillJson(route, 200, me);
    if (pathname === '/v1/me/progression') {
      return fulfillJson(route, 200, {
        level: 4,
        xpTotal: 735,
        xpInLevel: 35,
        xpForNextLevel: 250,
        levelProgress: 0.14,
        wallet: {
          balance: 26,
          currencyType: 'VIRTUAL_COIN',
          hasEconomicValue: false,
          playerTransfersEnabled: false,
          moneyPurchasesEnabled: false,
        },
        achievements: [],
        missions: [],
        notifications: [],
      });
    }
    if (pathname === '/v1/tournaments') return fulfillJson(route, 200, list);
    if (pathname === `/v1/tournaments/${TOURNAMENT_ID}`) return fulfillJson(route, 200, detail);
    if (pathname === '/v1/tournaments/my-next-match') {
      return fulfillJson(route, 200, { match: null, tournament: null });
    }
    if (pathname === '/v1/auth/ws-ticket') {
      return fulfillJson(route, 200, {
        ticket: 'm10a-screenshot-ticket'.padEnd(32, 'x'),
        expiresAt: Date.now() + 30_000,
      });
    }
    return fulfillJson(route, 404, {
      error: { code: 'NOT_FOUND', message: 'Fixture no encontrado' },
    });
  });
}

async function capture(page, viewport, routePath, fileSuffix, readyText) {
  await page.goto(`${WEB_URL}${routePath}`);
  await page.getByText(readyText, { exact: false }).first().waitFor({ timeout: 20_000 });
  if (viewport.isMobile) {
    // En una captura de página completa la barra inferior fija del teléfono tapaba un
    // cruce del cuadro. Se la deja en su lugar en flujo para que la imagen muestre el
    // contenido real; sigue siendo la misma barra, con los mismos destinos.
    await page.addStyleTag({
      content:
        'header { position: static !important; } div.fixed.bottom-0 { position: static !important; }',
    });
    await page.evaluate(() => {
      const bar = document.querySelector('div.fixed.bottom-0');
      if (bar && bar.parentElement) bar.parentElement.appendChild(bar);
    });
  }
  await page.waitForTimeout(350);
  // Un desborde horizontal del documento invalida la captura: se falla en vez de
  // publicar una imagen que muestra un layout roto.
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  if (overflow > 1) {
    throw new Error(`Desborde de ${overflow}px en ${routePath} a ${viewport.width}px`);
  }
  const file = path.join(OUT_DIR, `m10a-torneos-${fileSuffix}-${viewport.suffix}.png`);
  await page.screenshot({ path: file, fullPage: true });
  console.log(`✓ ${path.relative(REPO_ROOT, file)} (${viewport.width}px)`);
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  launch();
  let browser;
  try {
    await waitForHttp(WEB_URL);
    browser = await launchBrowser();
    for (const viewport of VIEWPORTS) {
      const context = await browser.newContext({
        viewport: { width: viewport.width, height: viewport.height },
        isMobile: viewport.isMobile,
        hasTouch: viewport.isMobile,
        deviceScaleFactor: 2,
        locale: 'es-AR',
        reducedMotion: viewport.reducedMotion,
      });
      const page = await context.newPage();
      page.on('pageerror', (error) => console.error(`[pageerror] ${error.message}`));
      await installFixtures(page);

      await capture(page, viewport, '/torneos', 'lista', 'Copa de Otoño');
      await capture(page, viewport, `/torneos/${TOURNAMENT_ID}`, 'detalle', 'Llave de ganadores');
      await context.close();
    }
  } finally {
    await browser?.close();
    stopChildren();
  }
}

main().catch((error) => {
  console.error(error);
  stopChildren();
  process.exit(1);
});
