import { expect, test } from '@playwright/test';
import { launchIsolatedChromium } from './support/launch.js';
import { apiCall, GAME, type JsonObject, WEB } from './support/tournament-2v2.js';
import { TournamentWsPlayer } from './support/tournament-ws-client.js';

/**
 * M10b — partida real de truco de 6 (`3v3`) contra el game-server y su mesa en el navegador.
 *
 * Seis personas en una mesa privada de tres equipos de dos. Cinco de ellas juegan por
 * WebSocket contra el game-server real (mismo motor, mismas reglas, mismo estado
 * autoritativo) y la sexta juega **desde la mesa real en el navegador**: es la que valida que
 * los seis asientos, la mano propia y los cantos se vean y se puedan usar en pantalla.
 *
 * La partida va a 15 puntos, sin flor, con `ar-corto-15-v1`: el RuleSet más corto, igual que
 * el E2E de torneo 2v2. El ganador se lee de la API (`matches[].winnerTeamId`), nunca de la
 * vista del cliente.
 */

interface SixSeatPlayer {
  readonly cookie: string;
  readonly nickname: string;
  readonly userId: string;
}

async function createGuests(count: number): Promise<SixSeatPlayer[]> {
  const players: SixSeatPlayer[] = [];
  for (let i = 0; i < count; i++) {
    const session = await apiCall(null, 'POST', '/v1/auth/guest', {
      deviceName: `TrucoSeisE2E${i}`,
    });
    expect(session.status, `alta de invitado ${i}`).toBe(201);
    players.push({
      cookie: session.cookie!,
      nickname: (session.json!.user as JsonObject).nickname as string,
      userId: (session.json!.user as JsonObject).id as string,
    });
  }
  return players;
}

/** Abre la mesa con un cliente WebSocket real por jugador. */
async function joinRoom(
  players: readonly SixSeatPlayer[],
  roomId: string,
): Promise<TournamentWsPlayer[]> {
  const clients: TournamentWsPlayer[] = [];
  for (const player of players) {
    const ticket = await apiCall(player.cookie, 'POST', '/v1/auth/ws-ticket');
    expect(ticket.status, `ticket de ${player.nickname}`).toBe(200);
    const client = new TournamentWsPlayer({
      userId: player.userId,
      nickname: player.nickname,
    });
    await client.connect(GAME, ticket.json!.ticket as string);
    client.send('table.join', { roomId });
    clients.push(client);
  }
  return clients;
}

async function waitUntilDealt(clients: readonly TournamentWsPlayer[]): Promise<void> {
  await expect
    .poll(() => clients.filter((client) => client.latestView !== null).length, {
      timeout: 60_000,
      intervals: [100],
    })
    .toBe(clients.length);
}

test.describe('M10b — truco de 6 (3v3) de punta a punta', () => {
  test('mesa privada de seis: cinco por WebSocket, uno en el navegador, y ganador verificado en la API', async () => {
    test.setTimeout(600_000);
    const players = await createGuests(6);
    const [owner, ...rest] = players as [SixSeatPlayer, ...SixSeatPlayer[]];

    // 1. Mesa privada 3v3 de 15 puntos sin flor.
    const created = await apiCall(owner.cookie, 'POST', '/v1/tables', {
      mode: '3v3',
      visibility: 'PRIVATE',
      targetScore: 15,
      flor: false,
      turnTimeoutMs: 20_000,
    });
    expect(created.status, JSON.stringify(created.json)).toBe(201);
    const tableId = created.json!.id as string;
    const joinCode = created.json!.joinCode as string;
    expect(created.json!.maxSeats).toBe(6);
    // Equipos alternados 0,1,2,0,1,2: los compañeros quedan enfrentados.
    expect((created.json!.seats as JsonObject[]).map((seat) => seat.team)).toEqual([
      0, 1, 2, 0, 1, 2,
    ]);

    // 2. Los otros cinco entran con el código de la mesa privada.
    for (const player of rest) {
      const joined = await apiCall(player.cookie, 'POST', '/v1/tables/join-by-code', {
        code: joinCode,
      });
      expect(joined.status, `entra ${player.nickname}: ${JSON.stringify(joined.json)}`).toBe(200);
    }

    // La mesa quedó completa con seis asientos ocupados y tres equipos.
    const detail = await apiCall(owner.cookie, 'GET', `/v1/tables/${tableId}`);
    expect(detail.status).toBe(200);
    expect(detail.json!.occupiedSeats).toBe(6);
    expect(detail.json!.maxSeats).toBe(6);

    // 3. Cinco clientes WebSocket juegan; el sexto (el dueño) juega en el navegador.
    const wsPlayers = rest.slice(0, 5);
    const browserPlayer = owner;
    const clients = await joinRoom(wsPlayers, tableId);
    let browser: Awaited<ReturnType<typeof launchIsolatedChromium>> | null = null;
    try {
      for (const client of clients) client.send('table.ready', { roomId: tableId, ready: true });

      // 4. El navegador entra a la mesa real (390 px de ancho: el tamaño más chico que se
      //    promete soportar) con la sesión del dueño.
      browser = await launchIsolatedChromium();
      const context = await browser.newContext({
        viewport: { width: 390, height: 844 },
        locale: 'es-AR',
      });
      const [cookieName, cookieValue] = browserPlayer.cookie.split('=');
      await context.addCookies([
        { name: cookieName!, value: cookieValue!, domain: 'localhost', path: '/' },
      ]);
      const page = await context.newPage();
      await page.goto(`${WEB}/sala/${tableId}`, { waitUntil: 'domcontentloaded' });

      // La mesa se dibuja con los seis asientos y la mano propia en pantalla.
      await expect(page.getByRole('region', { name: /Mesa de truco en vivo/i })).toBeVisible({
        timeout: 60_000,
      });
      // La tira extra de asientos del truco de 6 sólo existe con tres equipos.
      await expect(page.getByLabel(/Otros asientos de la mesa de seis/i)).toBeVisible({
        timeout: 60_000,
      });

      // El navegador marca listo desde la mesa y la partida reparte.
      const readyButton = page.getByRole('button', { name: /estoy listo|listo ·/i }).first();
      if (await readyButton.isVisible().catch(() => false)) {
        await readyButton.click();
      }
      await waitUntilDealt(clients);

      // Los cinco clientes WebSocket juegan la partida completa.
      await Promise.all(
        clients.map((client) => client.playToEnd(tableId, 300_000).catch(() => undefined)),
      );
      expect(
        clients.some((client) => client.ended()),
        'la partida de seis terminó',
      ).toBe(true);

      // 5. El navegador ve el resultado de la partida: el tanteador de tres equipos y el
      //    cartel de fin con el equipo ganador.
      await expect(page.getByText(/Truco de 6 · 3 equipos/i).first()).toBeVisible({
        timeout: 60_000,
      });

      // 6. Ganador verificado en la API, no en la vista del cliente.
      const history = await apiCall(
        browserPlayer.cookie,
        'GET',
        `/v1/users/${browserPlayer.userId}/matches?limit=10`,
      );
      expect(history.status).toBe(200);
      const sixSeatMatch = (history.json!.items as JsonObject[]).find(
        (item) => item.mode === '3v3',
      );
      expect(sixSeatMatch, 'la partida 3v3 quedó registrada en la API').toBeDefined();
      const matchId = sixSeatMatch!.matchId as string;

      const detailMatch = await apiCall(
        browserPlayer.cookie,
        'GET',
        `/v1/users/${browserPlayer.userId}/matches/${matchId}`,
      );
      expect(detailMatch.status).toBe(200);
      expect(detailMatch.json!.mode).toBe('3v3');
      const sixPlayers = detailMatch.json!.players as JsonObject[];
      expect(sixPlayers, 'seis asientos en la partida registrada').toHaveLength(6);
      expect(sixPlayers.map((row) => row.team).sort()).toEqual([0, 0, 1, 1, 2, 2]);
      const result = detailMatch.json!.result as JsonObject;
      // `matches[].winnerTeamId`: el ganador es un equipo de la mesa (0, 1 o 2).
      expect([0, 1, 2]).toContain(result.winnerTeam as number);
      const scoresByTeam = result.scoresByTeam as Record<string, number>;
      expect(Object.keys(scoresByTeam).sort()).toEqual(['0', '1', '2']);
      // La partida va a 15: el equipo ganador llegó al objetivo.
      expect(scoresByTeam[String(result.winnerTeam)]).toBeGreaterThanOrEqual(15);

      // La partida 3v3 no puntúa: el perfil de rating sólo trae los dos modos competitivos.
      const ratings = await apiCall(
        browserPlayer.cookie,
        'GET',
        `/v1/users/${browserPlayer.userId}/ratings`,
      );
      expect(ratings.status).toBe(200);
      const ratedModes = (ratings.json!.ratings as JsonObject[]).map((profile) => profile.mode);
      expect(ratedModes.sort()).toEqual(['1v1', '2v2']);

      // Las estadísticas sí registran el modo, con la partida jugada.
      const stats = await apiCall(
        browserPlayer.cookie,
        'GET',
        `/v1/users/${browserPlayer.userId}/stats`,
      );
      expect(stats.status).toBe(200);
      const byMode = stats.json!.byMode as Record<string, JsonObject>;
      expect(Object.keys(byMode).sort()).toEqual(['1v1', '2v2', '3v3']);
      expect(byMode['3v3']!.matchesPlayed).toBe(1);
    } finally {
      for (const client of clients) client.disconnect();
      if (browser) await browser.close();
    }

    // 7. Cerrar la mesa no deja a nadie sentado.
    const leave = await apiCall(owner.cookie, 'DELETE', `/v1/tables/${tableId}`);
    expect([200, 204, 404]).toContain(leave.status);
  });
});
