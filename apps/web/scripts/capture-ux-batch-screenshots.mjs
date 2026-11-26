#!/usr/bin/env node
/**
 * Captura las pantallas que toca la tanda de pulido UX (`docs/UX_AUDIT_M0-M9C.md`) en
 * 360 y 1200 CSS px, con fixtures HTTP locales: no escribe en bases ni usa servicios externos.
 *
 * Requisitos: `pnpm --filter @truco/web build` (sirve `dist/` con `vite preview`) y, para el
 * panel, `VITE_ADMIN_DEMO=1 corepack pnpm --filter @truco/admin build`.
 *
 * Uso:
 *   pnpm --filter @truco/web screenshots:ux -- --phase before
 *   pnpm --filter @truco/web screenshots:ux -- --phase after
 *
 * Las capturas "before" documentan el estado previo a la tanda y las "after" el posterior;
 * ambos pares se conservan en `docs/screenshots/` como evidencia de la comparación.
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
const ADMIN_URL = 'http://127.0.0.1:5174';
const VIEWPORTS = [
  { suffix: '360', width: 360, height: 800, isMobile: true },
  { suffix: '1200', width: 1200, height: 900, isMobile: false },
];
const USER_ID = '019a7e40-0000-7000-8000-0000000000a1';
const FRIEND_ID = '019a7e40-0000-7000-8000-0000000000a2';
const SEASON_ID = '01900000-0000-7000-8000-000000000001';
const NOW = new Date('2026-11-19T12:00:00.000Z');

const phaseArgumentIndex = process.argv.indexOf('--phase');
const PHASE = phaseArgumentIndex === -1 ? 'after' : process.argv[phaseArgumentIndex + 1];
if (!['before', 'after'].includes(PHASE)) {
  throw new Error('Usá --phase before o --phase after');
}

const children = [];

function launch(name, args) {
  const child = spawn('corepack', args, {
    cwd: REPO_ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, FORCE_COLOR: '0' },
  });
  child.stdout.on('data', (chunk) => {
    const line = chunk.toString().trim();
    if (line) console.log(`[${name}] ${line}`);
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
      if ((await fetch(url)).ok) return;
    } catch {
      // El servidor de preview todavía está arrancando.
    }
    await new Promise((resolve) => setTimeout(resolve, 350));
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

const friends = {
  items: [
    {
      friendshipId: '019a7e40-0000-7000-8000-0000000002f1',
      userId: FRIEND_ID,
      nickname: 'Tano del Paño',
      avatarId: 'default-01',
      level: 7,
      presence: 'ONLINE',
      friendsSince: '2026-09-01T12:00:00.000Z',
    },
    {
      friendshipId: '019a7e40-0000-7000-8000-0000000002f2',
      userId: '019a7e40-0000-7000-8000-0000000000a3',
      nickname: 'La Zurda del Sur',
      avatarId: 'default-01',
      level: 3,
      presence: 'IN_GAME',
      friendsSince: '2026-10-11T12:00:00.000Z',
    },
  ],
};

const friendRequests = {
  items: [
    {
      id: '019a7e40-0000-7000-8000-0000000003f1',
      userId: '019a7e40-0000-7000-8000-0000000000a4',
      nickname: 'Pibe de Flores',
      avatarId: 'default-01',
      direction: 'INCOMING',
      createdAt: '2026-11-18T18:00:00.000Z',
    },
  ],
};

const invitations = {
  items: [
    {
      id: '019a7e40-0000-7000-8000-0000000004f1',
      type: 'TABLE_INVITATION',
      direction: 'INCOMING',
      status: 'PENDING',
      fromNickname: 'Tano del Paño',
      toNickname: 'TanaDelSur',
      tableId: '019a7e40-0000-7000-8000-0000000005f1',
      mode: '1v1',
      rulesetCode: 'ar-standard-v1',
      competitive: false,
      createdAt: '2026-11-19T11:30:00.000Z',
      expiresAt: '2026-11-19T13:30:00.000Z',
    },
  ],
};

const notifications = {
  items: [
    {
      id: '019a7e40-0000-7000-8000-0000000006f1',
      type: 'TABLE_INVITATION',
      actorUserId: FRIEND_ID,
      actorNickname: 'Tano del Paño',
      referenceId: '019a7e40-0000-7000-8000-0000000005f1',
      tableId: '019a7e40-0000-7000-8000-0000000005f1',
      createdAt: '2026-11-19T11:30:00.000Z',
      readAt: null,
    },
    {
      id: '019a7e40-0000-7000-8000-0000000006f2',
      type: 'FRIEND_REQUEST_ACCEPTED',
      actorUserId: '019a7e40-0000-7000-8000-0000000000a3',
      actorNickname: 'La Zurda del Sur',
      referenceId: null,
      tableId: null,
      createdAt: '2026-11-19T10:05:00.000Z',
      readAt: null,
    },
    {
      id: '019a7e40-0000-7000-8000-0000000006f3',
      type: 'CHALLENGE',
      actorUserId: '019a7e40-0000-7000-8000-0000000000a4',
      actorNickname: 'Pibe de Flores',
      referenceId: null,
      tableId: null,
      createdAt: '2026-11-18T22:40:00.000Z',
      readAt: null,
    },
  ],
  nextCursor: null,
  unreadCount: 3,
};

function rankingEntries(mode) {
  const base = mode === '1v1' ? 1678 : 1592;
  const names =
    mode === '1v1'
      ? ['La Dama de Oro', 'Tano del Paño', 'Siete Bravo', 'La Zurda', 'Pibe de Flores']
      : ['Los del Centro', 'La Pareja Brava', 'Dúo del Sur', 'Flor y Truco'];
  return names.map((nickname, index) => {
    const rating = base - index * 24;
    return {
      position: index + 1,
      userId: `019a7e40-0000-7000-8000-${String(index + 0x101).padStart(12, '0')}`,
      nickname,
      score: rating,
      rating,
      division: rating >= 1600 ? 'Oro' : 'Plata',
      matchesPlayed: 34 - index * 3,
      opponentsCount: 18 - index,
      wins: 22 - index * 2,
    };
  });
}

function rankingResponse(url) {
  const params = new URL(url).searchParams;
  const mode = params.get('mode') === '2v2' ? '2v2' : '1v1';
  const period = ['GLOBAL', 'WEEKLY', 'MONTHLY'].includes(params.get('period'))
    ? params.get('period')
    : 'GLOBAL';
  return {
    period,
    mode,
    season: {
      id: SEASON_ID,
      label: 'Temporada 1',
      startsAt: '2026-11-19T00:00:00.000Z',
      endsAt: '2027-02-17T00:00:00.000Z',
      secondsUntilReset: 7_776_000,
    },
    minimumMatches: 5,
    minimumOpponents: 3,
    items: rankingEntries(mode).map((entry) => ({
      ...entry,
      score:
        period === 'GLOBAL'
          ? entry.rating
          : Math.round((entry.position % 2 === 0 ? -1 : 1) * (entry.position * 13.4)),
    })),
    nextCursor: null,
    generatedAt: NOW.toISOString(),
  };
}

function publicTable(id, ownerNickname, mode, targetScore, occupiedSeats, maxSeats) {
  return {
    id,
    roomId: id,
    mode,
    rulesetCode: 'ar-standard-v1',
    visibility: 'PUBLIC',
    status: 'WAITING',
    targetScore,
    flor: targetScore === 30,
    occupiedSeats,
    maxSeats,
    ownerNickname,
    isPractice: false,
    createdAt: NOW.toISOString(),
  };
}

const tables = {
  tables: [
    publicTable('019a7e40-0000-7000-8000-0000000007f1', 'Tano del Paño', '1v1', 30, 1, 2),
    publicTable('019a7e40-0000-7000-8000-0000000007f2', 'La Zurda del Sur', '2v2', 15, 2, 4),
    publicTable('019a7e40-0000-7000-8000-0000000007f3', 'Pibe de Flores', '1v1', 15, 1, 2),
  ],
};

const progression = {
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
  achievements: [
    {
      id: 'first_match',
      titleKey: 'progression.achievements.firstMatch.title',
      descriptionKey: 'progression.achievements.firstMatch.description',
      icon: 'cards',
      condition: { kind: 'MATCHES_COMPLETED', target: 1 },
      progress: 1,
      target: 1,
      rewardXp: 10,
      rewardCoins: 3,
      unlockedAt: '2026-11-19T10:00:00.000Z',
    },
    {
      id: 'clean_table',
      titleKey: 'progression.achievements.cleanTable.title',
      descriptionKey: 'progression.achievements.cleanTable.description',
      icon: 'shield',
      condition: { kind: 'CLEAN_MATCHES', target: 5 },
      progress: 3,
      target: 5,
      rewardXp: 30,
      rewardCoins: 8,
      unlockedAt: null,
    },
  ],
  missions: [
    {
      id: '019a7e40-0000-7000-8000-0000000000b1',
      templateId: 'daily_play_match',
      period: 'DAILY',
      titleKey: 'progression.missions.dailyPlay.title',
      descriptionKey: 'progression.missions.dailyPlay.description',
      progress: 1,
      target: 1,
      rewardXp: 10,
      rewardCoins: 3,
      periodEndsAt: '2026-11-20T00:00:00.000Z',
      completedAt: '2026-11-19T10:00:00.000Z',
      claimedAt: null,
    },
    {
      id: '019a7e40-0000-7000-8000-0000000000b2',
      templateId: 'daily_card_plays',
      period: 'DAILY',
      titleKey: 'progression.missions.dailyCards.title',
      descriptionKey: 'progression.missions.dailyCards.description',
      progress: 4,
      target: 6,
      rewardXp: 8,
      rewardCoins: 2,
      periodEndsAt: '2026-11-20T00:00:00.000Z',
      completedAt: null,
      claimedAt: null,
    },
  ],
  cosmetics: [],
  notifications: [],
};

async function fulfillJson(route, status, body) {
  await route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });
}

async function installWebFixtures(page) {
  await page.routeWebSocket('**/lobby-socket.io/**', (socket) => {
    socket.close({ code: 1000, reason: 'Sin tiempo real para capturas.' });
  });
  await page.route('**/v1/**', async (route) => {
    const url = new URL(route.request().url());
    const { pathname } = url;
    if (pathname === '/v1/legal') {
      return fulfillJson(route, 200, {
        minAge: 18,
        draft: true,
        banner: 'BORRADOR, PENDIENTE DE REVISIÓN LEGAL',
        documents: [],
      });
    }
    if (pathname === '/v1/me') return fulfillJson(route, 200, me);
    if (pathname === '/v1/me/progression') return fulfillJson(route, 200, progression);
    if (pathname === '/v1/auth/ws-ticket') {
      return fulfillJson(route, 200, {
        ticket: 'ux-demo-ticket-'.padEnd(32, 'x'),
        expiresAt: Date.now() + 30_000,
      });
    }
    if (pathname === '/v1/matchmaking/queue') {
      return fulfillJson(route, 200, { status: 'IDLE' });
    }
    if (pathname === '/v1/tables') return fulfillJson(route, 200, tables);
    if (pathname === '/v1/rankings') return fulfillJson(route, 200, rankingResponse(url));
    if (pathname === '/v1/social/friends') return fulfillJson(route, 200, friends);
    if (pathname === '/v1/social/friend-requests') return fulfillJson(route, 200, friendRequests);
    if (pathname === '/v1/social/invitations') return fulfillJson(route, 200, invitations);
    if (pathname === '/v1/social/blocks') return fulfillJson(route, 200, { items: [] });
    if (pathname === '/v1/social/notifications') return fulfillJson(route, 200, notifications);
    if (pathname === '/v1/social/notifications/unread-count') {
      return fulfillJson(route, 200, { unreadCount: notifications.unreadCount });
    }
    return fulfillJson(route, 404, { error: { code: 'NOT_FOUND', message: 'Fixture not found' } });
  });
}

/** Congela encabezado y barra inferior para que la captura de página completa no los duplique. */
async function stabilizeFixedBars(page, viewport) {
  if (!viewport.isMobile) return;
  await page.addStyleTag({
    content: `
      header { position: static !important; }
      footer + nav { position: static !important; }
    `,
  });
}

async function capture(page, name, { fullPage = true } = {}) {
  const file = path.join(OUT_DIR, `${name}-${PHASE}.png`);
  await page.screenshot({ path: file, fullPage });
  console.log(`✓ ${path.relative(REPO_ROOT, file)}`);
}

async function captureWebScreenshots(browser) {
  for (const viewport of VIEWPORTS) {
    const context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
      isMobile: viewport.isMobile,
      hasTouch: viewport.isMobile,
      deviceScaleFactor: 2,
      locale: 'es-AR',
    });
    const page = await context.newPage();
    page.on('pageerror', (error) => console.error(`[web pageerror] ${error.message}`));
    await installWebFixtures(page);

    // P1 — primer paso en móvil (Inicio) y P2 — salto de encabezado en escritorio.
    await page.goto(`${WEB_URL}/`);
    await page.locator('#app-heading').waitFor();
    await stabilizeFixedBars(page, viewport);
    await page.waitForTimeout(250);
    await capture(page, `ux-home-${viewport.suffix}`);

    // P2 — lobby: mesas con humanos primero, práctica aparte.
    await page.goto(`${WEB_URL}/lobby`);
    await page.getByRole('heading', { name: /Lobby en tiempo real/i }).waitFor();
    await page
      .getByText(/Tano del Paño/)
      .first()
      .waitFor({ timeout: 20_000 });
    await stabilizeFixedBars(page, viewport);
    await page.waitForTimeout(250);
    await capture(page, `ux-lobby-${viewport.suffix}`);

    // P2 — acciones de notificaciones que no se parten en varias líneas.
    await page.goto(`${WEB_URL}/amigos`);
    await page.getByRole('heading', { name: 'Notificaciones', exact: true }).waitFor();
    await page
      .getByText(/te invitó a una mesa/)
      .first()
      .waitFor();
    await stabilizeFixedBars(page, viewport);
    await page.waitForTimeout(250);
    await capture(page, `ux-notificaciones-${viewport.suffix}`);

    // P2 — legibilidad de metadatos del ranking móvil.
    await page.goto(`${WEB_URL}/ranking`);
    await page.getByRole('heading', { name: 'Rankings competitivos' }).waitFor();
    await page
      .locator(viewport.isMobile ? 'ol[aria-label]' : 'table')
      .first()
      .waitFor({ timeout: 20_000 });
    await page.getByText('La Dama de Oro').locator('visible=true').first().waitFor();
    await stabilizeFixedBars(page, viewport);
    await page.waitForTimeout(250);
    await capture(page, `ux-ranking-${viewport.suffix}`);

    // P1 — navegación inferior: señal de que la barra se desplaza.
    if (viewport.isMobile) {
      await page.goto(`${WEB_URL}/progreso`);
      await page.getByRole('heading', { name: 'Tu progreso' }).waitFor();
      await page.waitForTimeout(400);
      // Barra inferior fija: se captura el viewport, no la página completa.
      await page.addStyleTag({ content: 'header { position: static !important; }' });
      await capture(page, `ux-nav-${viewport.suffix}`, { fullPage: false });
    }

    await context.close();
  }
}

async function captureAdminScreenshots(browser) {
  for (const viewport of VIEWPORTS) {
    const context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
      isMobile: viewport.isMobile,
      hasTouch: viewport.isMobile,
      deviceScaleFactor: 2,
      locale: 'es-AR',
    });
    const page = await context.newPage();
    await page.goto(ADMIN_URL);
    await page.getByRole('heading', { name: 'Panel administrativo' }).waitFor();
    await page.getByRole('button', { name: 'Reportes' }).click();
    await page.getByRole('heading', { name: 'Cola de reportes' }).waitFor();
    await page.getByRole('button', { name: 'Abrir caso' }).first().click();
    await page.getByRole('heading', { name: /reportó a/ }).waitFor();
    await page.waitForTimeout(300);
    await capture(page, `ux-admin-reporte-${viewport.suffix}`);

    await page.getByRole('button', { name: 'Fair play' }).click();
    await page.getByRole('heading', { name: 'Integridad competitiva' }).waitFor();
    await page.getByText('TanoBaston', { exact: true }).waitFor();
    await page.waitForTimeout(300);
    await capture(page, `ux-admin-fair-play-${viewport.suffix}`);
    await context.close();
  }
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  launch('web', [
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
  ]);
  launch('admin', [
    'pnpm',
    '--filter',
    '@truco/admin',
    'exec',
    'vite',
    'preview',
    '--host',
    '0.0.0.0',
    '--port',
    '5174',
  ]);

  let browser;
  try {
    await Promise.all([
      waitForHttp(WEB_URL, 'web screenshots'),
      waitForHttp(ADMIN_URL, 'admin demo'),
    ]);
    browser = await launchChromium();
    await captureWebScreenshots(browser);
    await captureAdminScreenshots(browser);
  } finally {
    if (browser) await browser.close();
    shutdownChildren();
  }
}

main().catch((error) => {
  console.error(error);
  shutdownChildren();
  process.exit(1);
});
