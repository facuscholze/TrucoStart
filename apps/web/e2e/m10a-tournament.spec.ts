import { expect, type Browser, type BrowserContext, type Page, test } from '@playwright/test';
import { launchIsolatedChromium } from './support/launch.js';

/**
 * M10a — torneo real de 4 jugadores, con cuatro sesiones distintas en el navegador.
 *
 * No hay atajos por SQL ni mocks: los cuatro jugadores se crean por la API de invitado,
 * se inscriben y hacen check-in por REST, el torneo arranca con el barrido del servidor y
 * la primera ronda se juega **en la mesa**, con dos clientes por partida.
 *
 * Cubre lo que sólo se puede ver con el sistema entero: que la llave aparezca sola en la
 * pantalla de cada jugador, que "mi próxima partida" lleve a una mesa real, que el
 * resultado de la mesa cierre el cruce, que la ronda siguiente se abra sola y que al
 * final haya un campeón visible en la web.
 */

const API = 'http://127.0.0.1:3001';
const WEB = 'http://localhost:4173';
const GUEST = 'TorneoE2E';

interface Player {
  readonly page: Page;
  readonly cookie: string;
  readonly nickname: string;
  readonly userId: string;
  readonly context: BrowserContext;
}

/** Valor JSON arbitrario: el spec lee respuestas de varios endpoints y sólo usa campos sueltos. */
type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
type JsonObject = { [key: string]: JsonValue };

/** Cliente HTTP mínimo con cookies propias, para preparar el torneo sin pasar por la UI. */
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
  return { status: response.status, json, cookie: access ?? cookie };
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
  // El navegador entra con la misma sesión que se usó por REST: mismo jugador, misma
  // inscripción, sin un segundo alta que rompería la unicidad del torneo.
  const [name, value] = cookie.split('=');
  await context.addCookies([{ name: name!, value: value!, domain: 'localhost', path: '/' }]);
  return {
    page,
    cookie,
    nickname: session.json.user.nickname,
    userId: session.json.user.id,
    context,
  };
}

/** Juega un turno humano en la mesa: acepta cantos pendientes o baja una carta. */
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

/** Deja que dos clientes jueguen hasta que uno gane, turno a turno y en paralelo. */
async function playMatch(home: Player, away: Player): Promise<'home' | 'away'> {
  for (let i = 0; i < 260; i++) {
    const homeDone = await home.page
      .getByRole('heading', { name: /Ganamos la partida|Se nos escapó esta vuelta/i })
      .first()
      .isVisible()
      .catch(() => false);
    const awayDone = await away.page
      .getByRole('heading', { name: /Ganamos la partida|Se nos escapó esta vuelta/i })
      .first()
      .isVisible()
      .catch(() => false);
    if (homeDone || awayDone) break;
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
  expect(homeWon || awayWon, 'la partida terminó con un ganador en la mesa').toBe(true);
  return homeWon ? 'home' : 'away';
}

test.describe('M10a — torneo real de 4 jugadores', () => {
  test('se arma la llave, se juegan las semifinales y la final deja un campeón', async () => {
    // Dos semifinales y la final, cada una jugada turno a turno por dos clientes.
    test.setTimeout(600_000);
    const browser = await launchIsolatedChromium();
    const players: Player[] = [];
    try {
      for (let index = 0; index < 4; index++) players.push(await newPlayer(browser, index));
      const [p1] = players as [Player, Player, Player, Player];

      // Alta del torneo por REST, con el organizador siendo uno de los jugadores.
      const created = await apiCall(p1.cookie, 'POST', '/v1/tournaments', {
        name: 'Copa E2E de 4',
        format: 'SINGLE_ELIMINATION',
        visibility: 'PRIVATE',
        capacity: 4,
        rules: {
          mode: '1v1',
          rulesetCode: 'ar-corto-15-flor-v1',
          targetScore: 15,
          florEnabled: true,
          turnTimeoutMs: 25_000,
        },
        // Ventanas cortas a propósito: el barrido arranca el torneo solo y la prueba no
        // depende de esperar minutos. El check-in se abre y cierra en un minuto.
        registrationMinutes: 1,
        checkInMinutes: 1,
        noShowMinutes: 20,
        prizes: [
          { position: 1, coins: 100, cosmeticId: null },
          { position: 2, coins: 40, cosmeticId: null },
        ],
        official: false,
      });
      expect(created.status, 'alta del torneo').toBe(201);
      const tournamentId: string = created.json.tournament.id;

      for (const player of players) {
        const registered = await apiCall(
          player.cookie,
          'POST',
          `/v1/tournaments/${tournamentId}/register`,
        );
        expect(registered.status, `inscripción de ${player.nickname}`).toBe(201);
        const checked = await apiCall(
          player.cookie,
          'POST',
          `/v1/tournaments/${tournamentId}/check-in`,
        );
        expect(checked.status, `check-in de ${player.nickname}`).toBe(200);
      }

      // La pantalla del jugador ya muestra el torneo con los cuatro presentes.
      await p1.page.goto(`${WEB}/torneos/${tournamentId}`);
      await expect(p1.page.getByRole('heading', { name: 'Copa E2E de 4' })).toBeVisible({
        timeout: 30_000,
      });
      await expect(p1.page.getByText(/4\/4 inscriptos · 4 con check-in/)).toBeVisible();

      // El barrido del servidor arranca el torneo; la pantalla lo refleja sin recargar a mano.
      await expect(p1.page.getByText(/En juego · 4\/4 inscriptos/)).toBeVisible({
        timeout: 180_000,
      });

      // La llave está armada: dos semifinales listas y la final esperando.
      await expect(p1.page.getByRole('heading', { name: 'Llave de ganadores' })).toBeVisible();
      await expect(p1.page.getByText('Listo para jugar').first()).toBeVisible({ timeout: 60_000 });

      // Cada jugador ve su propia próxima partida con la sala del servidor.
      const next = await apiCall(p1.cookie, 'GET', '/v1/tournaments/my-next-match');
      expect(next.status).toBe(200);
      expect(next.json.match?.roomId, 'el cruce tiene sala').toBeTruthy();

      const matches: Array<{
        id: string;
        round: number;
        slot: number;
        homeUserId: string | null;
        awayUserId: string | null;
        roomId: string | null;
        status: string;
      }> = (await apiCall(p1.cookie, 'GET', `/v1/tournaments/${tournamentId}`)).json.matches;
      /** Encuentra la sesión de navegador a partir del `userId` que devuelve la API. */
      const playerById = async (userId: string): Promise<Player> => {
        const found = players.find((player) => player.userId === userId);
        if (!found) throw new Error(`No hay sesión de navegador para ${userId}`);
        return found;
      };

      const firstRound = matches.filter((match) => match.round === 1);
      expect(firstRound).toHaveLength(2);

      /** Juega un cruce en la mesa y devuelve quién ganó. */
      const playBracketMatch = async (round: number, slot: number): Promise<Player> => {
        // Se relee el cruce: los lados y la sala cambian cuando avanza la ronda.
        const detail = (await apiCall(p1.cookie, 'GET', `/v1/tournaments/${tournamentId}`)).json;
        const match = (detail.matches as typeof matches).find(
          (candidate) => candidate.round === round && candidate.slot === slot,
        )!;
        expect(match.status, `cruce ${round}-${slot} listo`).toBe('READY');
        expect(match.roomId, `sala del cruce ${round}-${slot}`).toBeTruthy();
        const home = await playerById(match.homeUserId!);
        const away = await playerById(match.awayUserId!);
        // Los dos entran a la misma mesa desde su propia pantalla de torneo.
        for (const player of [home, away]) {
          await player.page.goto(`${WEB}/torneos/${tournamentId}`);
          const enter = player.page.getByRole('button', { name: /Entrar a la mesa/i }).first();
          await enter.waitFor({ timeout: 30_000 });
          await enter.click();
          await player.page.waitForURL(new RegExp(`/mesa/${match.roomId}`), { timeout: 45_000 });
          await player.page
            .getByRole('region', { name: /Mesa de truco en vivo/i })
            .waitFor({ timeout: 45_000 });
        }

        // La sala se reparte cuando los dos asientos marcan "¡Estoy listo!": es el mismo
        // paso que en cualquier mesa, no un atajo del torneo.
        for (const player of [home, away]) {
          const ready = player.page.getByRole('button', { name: /^¡Estoy listo!$/i }).first();
          if (await ready.isVisible().catch(() => false)) {
            await ready.click({ timeout: 10_000 }).catch(() => undefined);
          }
        }
        await home.page.locator('svg[data-card-id]').first().waitFor({ timeout: 45_000 });

        const winner = await playMatch(home, away);
        return winner === 'home' ? home : away;
      };

      const semiOneWinner = await playBracketMatch(1, 1);
      const semiTwoWinner = await playBracketMatch(1, 2);

      // El resultado de la mesa cierra el cruce y arma la final sin intervención.
      await expect
        .poll(
          async () => {
            const detail = (await apiCall(p1.cookie, 'GET', `/v1/tournaments/${tournamentId}`))
              .json;
            const final = (detail.matches as typeof matches).find((match) => match.round === 2);
            return final?.status ?? 'sin final';
          },
          { timeout: 60_000, intervals: [1_000] },
        )
        .toBe('READY');

      const champion = await playBracketMatch(2, 1);
      expect([semiOneWinner, semiTwoWinner]).toContain(champion);

      // El torneo queda terminado y el campeón se ve en la pantalla de cada jugador.
      await expect
        .poll(
          async () => {
            const detail = (await apiCall(p1.cookie, 'GET', `/v1/tournaments/${tournamentId}`))
              .json;
            return detail.tournament.status;
          },
          { timeout: 60_000, intervals: [1_000] },
        )
        .toBe('FINISHED');

      await champion.page.goto(`${WEB}/torneos/${tournamentId}`);
      await expect(champion.page.getByText(/^Campeón$/).first()).toBeVisible({ timeout: 30_000 });
      await expect(champion.page.getByText(/Terminado/).first()).toBeVisible();

      // Los premios son simbólicos y se anuncian como tales, nunca como dinero.
      await expect(champion.page.getByText(/simbólico, sin valor económico/).first()).toBeVisible();
    } finally {
      await Promise.all(players.map((player) => player.context.close().catch(() => undefined)));
      await browser.close();
    }
  });
});
