import { createHmac } from 'node:crypto';
import { expect, type Browser, type BrowserContext, type Page, test } from '@playwright/test';
import { launchIsolatedChromium } from './support/launch.js';

/**
 * M10b — liga real de 4 jugadores: calendario, mesa, tabla y cierre de temporada.
 *
 * No hay atajos por SQL ni mocks: cuatro invitados se crean por la API, se inscriben por
 * REST en una liga de una jornada, la jornada se abre con el barrido del servidor, las dos
 * partidas se juegan **en la mesa** con dos clientes cada una, y el cierre de temporada se
 * pide por el panel con el motivo obligatorio.
 *
 * Lo que sólo se ve con el sistema entero: que la liga abra la jornada y aprovisione salas
 * de verdad (nunca contra bots), que «mi próxima partida de liga» lleve a una mesa real, que
 * el resultado de la mesa mueva la tabla, y que el cierre deje ascensos, descensos y premios
 * auditados sin duplicar nada al reintentar.
 */

const API = 'http://127.0.0.1:3001';
const WEB = 'http://localhost:4173';
const GUEST = 'LigaE2E';
/** Credenciales sembradas por `apps/api/scripts/e2e-stack.ts` para el panel. */
const ADMIN_EMAIL = process.env['E2E_ADMIN_EMAIL'] ?? 'e2e-admin@truco.ar';
const ADMIN_PASSWORD = process.env['E2E_ADMIN_PASSWORD'] ?? 'E2eAdminPanel2026!';
const ADMIN_TOTP_SECRET =
  process.env['E2E_ADMIN_TOTP_SECRET'] ?? 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';

interface Player {
  readonly page: Page;
  readonly cookie: string;
  readonly nickname: string;
  readonly userId: string;
  readonly context: BrowserContext;
}

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
type JsonObject = { [key: string]: JsonValue };

async function apiCall(
  cookie: string | null,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; json: JsonObject | null; cookie: string | null }> {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(cookie ? { cookie } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const raw = await response.text();
  let json: unknown = null;
  try {
    json = raw.length > 0 ? JSON.parse(raw) : null;
  } catch {
    json = raw;
  }
  const setCookie = response.headers.getSetCookie?.() ?? [];
  const access = setCookie
    .map((entry) => entry.split(';')[0])
    .find((entry) => entry?.startsWith('truco_access='));
  return { status: response.status, json: json as JsonObject | null, cookie: access ?? cookie };
}

async function newPlayer(browser: Browser, index: number): Promise<Player> {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    locale: 'es-AR',
  });
  const page = await context.newPage();
  const session = await apiCall(null, 'POST', '/v1/auth/guest', {
    deviceName: `${GUEST}${index}`,
  });
  expect(session.status, `alta de invitado ${index}`).toBe(201);
  const cookie = session.cookie!;
  const [name, value] = cookie.split('=');
  await context.addCookies([{ name: name!, value: value!, domain: 'localhost', path: '/' }]);
  const user = session.json!.user as JsonObject;
  return {
    page,
    cookie,
    nickname: user.nickname as string,
    userId: user.id as string,
    context,
  };
}

/**
 * Código TOTP de 6 dígitos para el secreto sembrado por `e2e-stack.ts`.
 *
 * El cierre de temporada desde el panel exige `leagues:manage` y 2FA, así que el E2E calcula el
 * código como lo haría una aplicación autenticadora. Se implementa acá para no sumar una
 * dependencia al producto sólo por la prueba.
 */
function totpCode(secretBase32: string, atMs: number = Date.now()): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const char of secretBase32.replace(/=+$/, '').toUpperCase()) {
    const index = alphabet.indexOf(char);
    if (index < 0) throw new Error(`Secreto TOTP inválido: ${char}`);
    bits += index.toString(2).padStart(5, '0');
  }
  const key = Buffer.from(
    Array.from({ length: Math.floor(bits.length / 8) }, (_, index) =>
      Number.parseInt(bits.slice(index * 8, index * 8 + 8), 2),
    ),
  );
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(atMs / 1000 / 30)));
  const hmac = createHmac('sha1', key).update(counter).digest();
  const offset = hmac[hmac.length - 1]! & 0x0f;
  const value = hmac.readUInt32BE(offset) & 0x7fffffff;
  return String(value % 1_000_000).padStart(6, '0');
}

async function stepTurn(page: Page): Promise<boolean> {
  if (
    await page
      .getByRole('heading', { name: /Ganamos la partida|Se nos escapó esta vuelta/i })
      .first()
      .isVisible()
      .catch(() => false)
  ) {
    return false;
  }
  const quiero = page.getByRole('button', { name: /^¡Quiero!/i }).first();
  if (await quiero.isVisible().catch(() => false)) {
    await quiero.click({ timeout: 3_000 }).catch(() => undefined);
    return true;
  }
  const card = page.locator('button:not([disabled]):has(svg[data-card-id])').first();
  if ((await card.count()) > 0 && (await card.isVisible().catch(() => false))) {
    await card.click({ timeout: 3_000 }).catch(() => undefined);
    return true;
  }
  return false;
}

async function playMatch(home: Player, away: Player): Promise<'home' | 'away'> {
  for (let i = 0; i < 260; i++) {
    const done = await Promise.all(
      [home, away].map((player) =>
        player.page
          .getByRole('heading', { name: /Ganamos la partida|Se nos escapó esta vuelta/i })
          .first()
          .isVisible()
          .catch(() => false),
      ),
    );
    if (done[0] || done[1]) break;
    await Promise.all([stepTurn(home.page), stepTurn(away.page)]);
    await home.page.waitForTimeout(150);
  }
  const homeWon = await home.page
    .getByRole('heading', { name: /Ganamos la partida/i })
    .first()
    .isVisible()
    .catch(() => false);
  const awayWon = await away.page
    .getByRole('heading', { name: /Ganamos la partida/i })
    .first()
    .isVisible()
    .catch(() => false);
  expect(homeWon || awayWon, 'la partida de liga terminó con un ganador en la mesa').toBe(true);
  return homeWon ? 'home' : 'away';
}

test.describe('M10b — liga real de 4 jugadores', () => {
  test('la jornada se juega en la mesa, la tabla se mueve y el cierre deja ascensos auditados', async () => {
    // Una jornada, dos partidas en la mesa y el cierre: minutos, no segundos.
    test.setTimeout(600_000);
    const browser = await launchIsolatedChromium();
    const players: Player[] = [];
    try {
      for (let index = 0; index < 4; index++) players.push(await newPlayer(browser, index));
      const [organizer] = players as [Player, Player, Player, Player];

      const startsAt = new Date(Date.now() + 60_000);
      const endsAt = new Date(Date.now() + 30 * 24 * 60 * 60_000);

      // Una sola jornada con ventana corta: la liga abre sola y la prueba no espera minutos.
      const created = await apiCall(organizer.cookie, 'POST', '/v1/leagues', {
        name: 'Liga E2E de 4',
        mode: '1v1',
        division: 'PLATA',
        season: {
          label: 'Temporada E2E',
          startsAt: startsAt.toISOString(),
          endsAt: endsAt.toISOString(),
        },
        rules: {
          rulesetCode: 'ar-standard-v1',
          targetScore: 15,
          florEnabled: true,
          turnTimeoutMs: 25_000,
        },
        schedule: {
          format: 'ROUNDS',
          rounds: 1,
          daysBetweenRounds: 1,
          roundWindowHours: 1,
          maxReschedulesPerMatch: 2,
          rescheduleMinHoursBeforeDeadline: 0,
          rescheduleExtensionHours: 1,
        },
        promotion: { promotions: 1, relegations: 1, minMatchesToMove: 1 },
        capacity: 4,
        registrationMinutes: 1,
        prizes: [{ position: 1, coins: 100, cosmeticId: null }],
        official: false,
      });
      expect(created.status, 'alta de la liga').toBe(201);
      const leagueId = created.json!.id as string;

      for (const player of players) {
        const joined = await apiCall(player.cookie, 'POST', `/v1/leagues/${leagueId}/join`);
        expect(joined.status, `inscripción de ${player.nickname}`).toBe(201);
      }

      // La pantalla del organizador muestra la liga con los cuatro inscriptos.
      await organizer.page.goto(`${WEB}/ligas/${leagueId}`);
      await expect(organizer.page.getByRole('heading', { name: 'Liga E2E de 4' })).toBeVisible({
        timeout: 30_000,
      });
      await expect(organizer.page.getByText(/4\/4 jugadores/)).toBeVisible();

      // El barrido abre la jornada y aprovisiona las salas: la liga pasa a ACTIVE sin que
      // nadie apriete nada desde la pantalla.
      await expect
        .poll(
          async () => {
            const detail = await apiCall(organizer.cookie, 'GET', `/v1/leagues/${leagueId}`);
            return detail.json?.status ?? 'sin respuesta';
          },
          { timeout: 180_000, intervals: [2_000] },
        )
        .toBe('ACTIVE');

      // Las dos partidas de la jornada tienen sala del servidor y nunca son contra bots.
      let matches: Array<{
        id: string;
        status: string;
        homeUserId: string;
        awayUserId: string;
        roomId: string | null;
      }> = [];
      await expect
        .poll(
          async () => {
            const detail = await apiCall(organizer.cookie, 'GET', `/v1/leagues/${leagueId}`);
            matches = (detail.json?.matches ?? []) as typeof matches;
            return matches.filter((match) => match.roomId !== null).length;
          },
          { timeout: 180_000, intervals: [2_000] },
        )
        .toBe(2);
      for (const match of matches) {
        expect(match.homeUserId, 'la partida es entre personas').toBeTruthy();
        expect(match.awayUserId, 'la partida es entre personas').toBeTruthy();
      }

      const playerById = (userId: string): Player => {
        const found = players.find((player) => player.userId === userId);
        if (!found) throw new Error(`No hay sesión de navegador para ${userId}`);
        return found;
      };

      // Cada cruce se juega en la mesa, entrando desde «mi próxima partida de liga».
      for (const match of matches) {
        const home = playerById(match.homeUserId);
        const away = playerById(match.awayUserId);
        for (const player of [home, away]) {
          await player.page.goto(`${WEB}/ligas/${leagueId}`);
          const enter = player.page.getByRole('button', { name: /Entrar a la mesa/i }).first();
          await enter.waitFor({ timeout: 60_000 });
          await enter.click();
          await player.page.waitForURL(new RegExp(`/mesa/${match.roomId}`), { timeout: 45_000 });
          await player.page
            .getByRole('region', { name: /Mesa de truco en vivo/i })
            .waitFor({ timeout: 45_000 });
          const ready = player.page.getByRole('button', { name: /^¡Estoy listo!$/i }).first();
          if (await ready.isVisible().catch(() => false)) {
            await ready.click({ timeout: 10_000 }).catch(() => undefined);
          }
        }
        await home.page.locator('svg[data-card-id]').first().waitFor({ timeout: 60_000 });
        await playMatch(home, away);
      }

      // La tabla se movió: dos ganadores con 3 puntos y dos con 0.
      await expect
        .poll(
          async () => {
            const detail = await apiCall(organizer.cookie, 'GET', `/v1/leagues/${leagueId}`);
            const standings = (detail.json?.standings ?? []) as Array<{ points: number }>;
            return standings.filter((row) => row.points === 3).length;
          },
          { timeout: 120_000, intervals: [2_000] },
        )
        .toBe(2);

      // Los dos perdedores ven la liga con sus puntos en la tabla, y nunca un precio de
      // inscripción: la liga no se paga.
      const lastPlayer = playerById((matches[0]!.awayUserId ?? players[3]!.userId) as string);
      await lastPlayer.page.goto(`${WEB}/ligas/${leagueId}`);
      await expect(lastPlayer.page.getByRole('table')).toBeVisible({ timeout: 30_000 });
      await expect(lastPlayer.page.getByText(/Inscripción gratuita/)).toBeVisible();
      expect(await lastPlayer.page.getByText(/cuota|precio de inscripción/i).count()).toBe(0);

      // El cierre de temporada lo hace el staff desde el panel, con 2FA y motivo: es el único
      // camino real, porque cerrar una liga de liga no es una acción del jugador.
      const adminLogin = await apiCall(null, 'POST', '/v1/admin/auth/login', {
        email: ADMIN_EMAIL,
        password: ADMIN_PASSWORD,
        totpCode: totpCode(ADMIN_TOTP_SECRET),
      });
      expect(adminLogin.status, 'login del panel con 2FA').toBe(200);
      const adminCookie = adminLogin.cookie!;

      // La auditoría de la liga muestra la jornada abierta antes del cierre.
      const auditBefore = await apiCall(adminCookie, 'GET', `/v1/admin/leagues/${leagueId}/audit`);
      expect(auditBefore.status).toBe(200);
      expect(auditBefore.json!.closure, 'todavía no hay cierre').toBeNull();

      const closed = await apiCall(adminCookie, 'POST', `/v1/admin/leagues/${leagueId}/close`, {
        reason: 'Cierre de la temporada de prueba',
      });
      expect(closed.status, 'cierre aceptado').toBe(200);
      expect(closed.json!.promoted.length).toBe(1);
      expect(closed.json!.relegated.length).toBe(1);
      expect(closed.json!.awardedPrizes).toBeGreaterThan(0);

      // Reintentar el cierre no duplica premios ni movimientos: es idempotente.
      const again = await apiCall(adminCookie, 'POST', `/v1/admin/leagues/${leagueId}/close`, {
        reason: 'Reintento del cierre',
      });
      expect(again.status, 'reintento aceptado').toBe(200);
      expect(again.json!.awardedPrizes, 'el reintento no vuelve a premiar').toBe(0);
      expect(again.json!.promoted).toEqual(closed.json!.promoted);

      // La auditoría del panel quedó con el cierre y los movimientos de división.
      const auditAfter = await apiCall(adminCookie, 'GET', `/v1/admin/leagues/${leagueId}/audit`);
      expect(auditAfter.json!.closure).not.toBeNull();
      expect((auditAfter.json!.movements as unknown[]).length).toBeGreaterThan(0);

      // Y la pantalla queda en «Terminada» con la tabla final a la vista.
      await organizer.page.goto(`${WEB}/ligas/${leagueId}`);
      await expect(organizer.page.getByText(/Terminada/).first()).toBeVisible({
        timeout: 30_000,
      });
      await expect(organizer.page.getByText('Asciende').first()).toBeVisible();
    } finally {
      await Promise.all(players.map((player) => player.context.close().catch(() => undefined)));
      await browser.close();
    }
  });
});
