#!/usr/bin/env node
/**
 * Captura rankings, ratings del perfil y la revisión humana M9b en 360 px y 1200 px.
 * Las llamadas de jugador usan fixtures HTTP de demostración; Fair Play usa el cliente
 * demo del panel (`VITE_ADMIN_DEMO=1`). No escribe en bases ni servicios externos.
 * El comando construye ambos paquetes y sirve sus bundles con `vite preview`.
 *
 * Uso: pnpm --filter @truco/web screenshots:m9b
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
const SEASON_ID = '01900000-0000-7000-8000-000000000001';
const MATCH_ID = '019a7e40-0000-7000-8000-0000000000d1';
const NOW = new Date('2026-11-19T12:00:00.000Z');
const STARTS_AT = '2026-11-19T00:00:00.000Z';
const ENDS_AT = '2027-02-17T00:00:00.000Z';

const children = [];

function launch(name, args, env = {}) {
  const child = spawn('corepack', args, {
    cwd: REPO_ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, FORCE_COLOR: '0', ...env },
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
      // The Vite process is still starting.
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

function publicRankingEntries(mode) {
  const base = mode === '1v1' ? 1678 : 1592;
  const names =
    mode === '1v1'
      ? [
          'La Dama de Oro',
          'Tano del Paño',
          'Siete Bravo',
          'La Zurda',
          'Pibe de Flores',
          'Flor Criolla',
        ]
      : ['Los del Centro', 'La Pareja Brava', 'Dúo del Sur', 'Flor y Truco', 'Los Taitas'];
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
  const items = publicRankingEntries(mode).map((entry) => ({
    ...entry,
    score:
      period === 'GLOBAL'
        ? entry.rating
        : Math.round((entry.position % 2 === 0 ? -1 : 1) * (entry.position * 13.4)),
  }));
  return {
    period,
    mode,
    season: {
      id: SEASON_ID,
      label: 'Temporada 1',
      startsAt: STARTS_AT,
      endsAt: ENDS_AT,
      secondsUntilReset: 7_776_000,
    },
    minimumMatches: 5,
    minimumOpponents: 3,
    items,
    nextCursor: null,
    generatedAt: NOW.toISOString(),
  };
}

const user = {
  id: USER_ID,
  email: null,
  emailVerified: false,
  nickname: 'TanoBaston',
  isGuest: true,
  role: 'PLAYER',
  status: 'ACTIVE',
  createdAt: '2025-08-01T10:00:00.000Z',
};
const profile = {
  avatarId: 'default-01',
  level: 1,
  xp: 0,
  bio: 'Juego con el ancho de espadas.',
  settings: {
    soundEnabled: true,
    animationsReduced: false,
    confirmCalls: false,
    historyVisibility: 'ALL',
    statsVisibility: 'ALL',
    presenceVisibility: 'FRIENDS',
  },
};
const me = { user, profile };
const modeStats = (matchesPlayed, wins, losses, abandons, currentStreak) => ({
  matchesPlayed,
  wins,
  losses,
  abandons,
  winRate: matchesPlayed ? wins / matchesPlayed : 0,
  currentStreak,
  envido: { resolved: 19, won: 12, winRate: 12 / 19 },
  truco: { resolved: 24, won: 16, winRate: 16 / 24 },
});
const stats = {
  userId: USER_ID,
  matchesPlayed: 46,
  wins: 30,
  losses: 15,
  abandons: 1,
  winRate: 30 / 46,
  byMode: {
    '1v1': modeStats(34, 22, 11, 1, 4),
    '2v2': modeStats(12, 8, 4, 0, 2),
  },
};
const matches = {
  items: [
    {
      matchId: MATCH_ID,
      mode: '1v1',
      rulesetCode: 'ar-corto-15-v1',
      seat: 0,
      team: 0,
      score: 15,
      outcome: 'WIN',
      hasBots: false,
      startedAt: '2026-11-18T20:12:00.000Z',
      endedAt: '2026-11-18T20:19:00.000Z',
    },
  ],
  nextCursor: null,
};
const ratingProfiles = {
  ratings: [
    {
      seasonId: SEASON_ID,
      seasonLabel: 'Temporada 1',
      seasonEndsAt: ENDS_AT,
      mode: '1v1',
      rating: 1678.2,
      deviation: 64.4,
      division: 'Oro',
      position: 12,
      matchesPlayed: 34,
      opponentsCount: 18,
      wins: 22,
      losses: 11,
      abandons: 1,
      qualifies: true,
    },
    {
      seasonId: SEASON_ID,
      seasonLabel: 'Temporada 1',
      seasonEndsAt: ENDS_AT,
      mode: '2v2',
      rating: 1592.7,
      deviation: 88.1,
      division: 'Plata',
      position: 27,
      matchesPlayed: 12,
      opponentsCount: 9,
      wins: 8,
      losses: 4,
      abandons: 0,
      qualifies: true,
    },
  ],
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
    socket.close({ code: 1000, reason: 'No se requiere tiempo real para capturas.' });
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
    if (pathname === '/v1/auth/ws-ticket') {
      return fulfillJson(route, 200, {
        ticket: 'm9b-demo-ticket-'.padEnd(32, 'x'),
        expiresAt: Date.now() + 30_000,
      });
    }
    if (pathname === '/v1/rankings') return fulfillJson(route, 200, rankingResponse(url));
    if (pathname === `/v1/users/${USER_ID}/stats`) return fulfillJson(route, 200, stats);
    if (pathname === `/v1/users/${USER_ID}/matches`) return fulfillJson(route, 200, matches);
    if (pathname === `/v1/users/${USER_ID}/ratings`) {
      return fulfillJson(route, 200, ratingProfiles);
    }
    if (pathname === '/v1/auth/sessions') {
      return fulfillJson(route, 200, {
        sessions: [
          {
            id: '019a7e40-0000-7000-8000-0000000000b1',
            deviceName: 'Este navegador',
            ipAddress: null,
            userAgent: 'Playwright screenshot fixture',
            createdAt: NOW.toISOString(),
            lastUsedAt: NOW.toISOString(),
            expiresAt: '2026-12-19T12:00:00.000Z',
            isCurrent: true,
          },
        ],
      });
    }
    return fulfillJson(route, 404, { error: { code: 'NOT_FOUND', message: 'Fixture not found' } });
  });
}

async function stabilizeMobileFullPage(page, viewport) {
  if (!viewport.isMobile) return;
  await page.addStyleTag({
    content: `
      header { position: static !important; }
      footer + nav { position: static !important; }
    `,
  });
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
    page.on('console', (message) => {
      if (message.type() === 'error') console.error(`[web console] ${message.text()}`);
    });
    await installWebFixtures(page);

    await page.goto(`${WEB_URL}/ranking`);
    await page.getByRole('heading', { name: 'Rankings competitivos' }).waitFor();
    await page.getByText('La Dama de Oro', { exact: true }).waitFor();
    await stabilizeMobileFullPage(page, viewport);
    await page.waitForTimeout(300);
    const rankingFile = path.join(OUT_DIR, `m9b-ranking-${viewport.suffix}.png`);
    await page.screenshot({ path: rankingFile, fullPage: true });
    console.log(`✓ ${path.relative(REPO_ROOT, rankingFile)}`);

    await page.goto(`${WEB_URL}/perfil`);
    const ratingHeading = page.getByText('Rating competitivo', { exact: true });
    await ratingHeading.waitFor({ timeout: 20_000 });
    await page.getByText('1678', { exact: true }).waitFor();
    await stabilizeMobileFullPage(page, viewport);
    await page.waitForTimeout(300);
    const profileFile = path.join(OUT_DIR, `m9b-perfil-rating-${viewport.suffix}.png`);
    await page.screenshot({ path: profileFile, fullPage: true });
    console.log(`✓ ${path.relative(REPO_ROOT, profileFile)}`);
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
    await page.getByRole('button', { name: 'Fair play' }).click();
    await page.getByRole('heading', { name: 'Integridad competitiva' }).waitFor();
    await page.getByText('TanoBaston', { exact: true }).waitFor();
    await page.waitForTimeout(300);
    const file = path.join(OUT_DIR, `m9b-admin-fair-play-${viewport.suffix}.png`);
    await page.screenshot({ path: file, fullPage: true });
    console.log(`✓ ${path.relative(REPO_ROOT, file)}`);
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
    await browser?.close();
    shutdownChildren();
  }
}

main().catch((error) => {
  console.error(error);
  shutdownChildren();
  process.exit(1);
});
