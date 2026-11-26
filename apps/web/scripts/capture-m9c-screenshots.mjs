#!/usr/bin/env node
/** Captura la pantalla de progresión móvil y escritorio con fixtures locales, sin servicios externos. */
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
  { suffix: '360', width: 360, height: 800, isMobile: true, reducedMotion: 'reduce' },
  { suffix: '1200', width: 1200, height: 900, isMobile: false, reducedMotion: 'no-preference' },
];
const USER_ID = '019a7e40-0000-7000-8000-0000000000a1';
const END_TODAY = '2026-11-20T00:00:00.000Z';
const END_WEEK = '2026-11-23T00:00:00.000Z';
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
      // Vite preview is still starting.
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
    {
      id: 'tutorial_graduate',
      titleKey: 'progression.achievements.tutorialGraduate.title',
      descriptionKey: 'progression.achievements.tutorialGraduate.description',
      icon: 'book',
      condition: { kind: 'TUTORIAL_LESSONS', target: 6 },
      progress: 4,
      target: 6,
      rewardXp: 15,
      rewardCoins: 4,
      unlockedAt: null,
    },
    {
      id: 'card_slinger',
      titleKey: 'progression.achievements.cardSlinger.title',
      descriptionKey: 'progression.achievements.cardSlinger.description',
      icon: 'spade',
      condition: { kind: 'CARD_PLAYS', target: 40, eventType: 'game.cardPlayed' },
      progress: 28,
      target: 40,
      rewardXp: 20,
      rewardCoins: 5,
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
      periodEndsAt: END_TODAY,
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
      periodEndsAt: END_TODAY,
      completedAt: null,
      claimedAt: null,
    },
    {
      id: '019a7e40-0000-7000-8000-0000000000b3',
      templateId: 'daily_clean_match',
      period: 'DAILY',
      titleKey: 'progression.missions.dailyClean.title',
      descriptionKey: 'progression.missions.dailyClean.description',
      progress: 0,
      target: 1,
      rewardXp: 10,
      rewardCoins: 3,
      periodEndsAt: END_TODAY,
      completedAt: null,
      claimedAt: null,
    },
    {
      id: '019a7e40-0000-7000-8000-0000000000b4',
      templateId: 'weekly_play_three',
      period: 'WEEKLY',
      titleKey: 'progression.missions.weeklyPlay.title',
      descriptionKey: 'progression.missions.weeklyPlay.description',
      progress: 2,
      target: 3,
      rewardXp: 35,
      rewardCoins: 10,
      periodEndsAt: END_WEEK,
      completedAt: null,
      claimedAt: null,
    },
  ],
  cosmetics: [
    {
      id: 'frame_sunrise',
      nameKey: 'progression.cosmetics.sunrise.name',
      descriptionKey: 'progression.cosmetics.sunrise.description',
      category: 'AVATAR_FRAME',
      priceCoins: 20,
      icon: 'sunrise',
      owned: false,
    },
    {
      id: 'card_back_flor',
      nameKey: 'progression.cosmetics.florBack.name',
      descriptionKey: 'progression.cosmetics.florBack.description',
      category: 'CARD_BACK',
      priceCoins: 35,
      icon: 'flor',
      owned: true,
    },
  ],
  notifications: [
    {
      id: '019a7e40-0000-7000-8000-0000000000c1',
      kind: 'ACHIEVEMENT_UNLOCKED',
      payload: {
        achievementId: 'first_match',
        titleKey: 'progression.achievements.firstMatch.title',
      },
      createdAt: '2026-11-19T10:00:00.000Z',
      readAt: null,
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
    if (pathname === '/v1/me/progression') return fulfillJson(route, 200, progression);
    if (pathname === '/v1/auth/ws-ticket') {
      return fulfillJson(route, 200, {
        ticket: 'm9c-screenshot-ticket'.padEnd(32, 'x'),
        expiresAt: Date.now() + 30_000,
      });
    }
    return fulfillJson(route, 404, {
      error: { code: 'NOT_FOUND', message: 'Fixture no encontrado' },
    });
  });
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
      await page.goto(`${WEB_URL}/progreso`);
      await page.getByRole('heading', { name: 'Tu progreso' }).waitFor({ timeout: 20_000 });
      await page.getByText('Una mano más', { exact: true }).waitFor();
      if (viewport.isMobile) {
        await page.addStyleTag({
          content:
            'header { position: static !important; } footer + nav { position: static !important; }',
        });
      }
      await page.waitForTimeout(350);
      const file = path.join(OUT_DIR, `m9c-progression-${viewport.suffix}.png`);
      await page.screenshot({ path: file, fullPage: true });
      console.log(`✓ ${path.relative(REPO_ROOT, file)} (${viewport.width}px)`);
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
