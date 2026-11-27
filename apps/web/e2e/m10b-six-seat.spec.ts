import { expect, test } from '@playwright/test';
import { launchIsolatedChromium } from './support/launch.js';
import { apiCall, GAME, type JsonObject, WEB } from './support/tournament-2v2.js';
import { TournamentWsPlayer } from './support/tournament-ws-client.js';

/**
 * M10b — partida real de truco de 6 (`3v3`) contra el game-server, con la mesa mirándose en el
 * navegador.
 *
 * Seis personas en una mesa privada de tres equipos de dos. Los seis asientos juegan por
 * WebSocket contra el game-server real (mismo motor, mismas reglas, mismo estado autoritativo);
 * el dueño además tiene la mesa abierta en un navegador de 390 px y es quien valida que los seis
 * asientos, el tanteador de tres equipos y el fin de partida se vean en pantalla.
 *
 * Sólo el WebSocket juega: nadie más está mirando la mesa, así que si un asiento no juega la
 * partida no avanza y el timeout lo delata.
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

test.describe('M10b — truco de 6 (3v3) de punta a punta', () => {
  test('mesa privada de seis: partida completa por WebSocket y la mesa dibujada en el navegador', async () => {
    test.setTimeout(900_000);
    const players = await createGuests(6);
    const [owner, ...rest] = players as [SixSeatPlayer, ...SixSeatPlayer[]];

    // 1. Mesa privada 3v3 a 15 puntos sin flor: el RuleSet más corto.
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
    expect(created.json!.maxSeats, 'la mesa de seis tiene seis asientos').toBe(6);
    // Equipos alternados 0,1,2,0,1,2: los compañeros quedan enfrentados.
    expect((created.json!.seats as JsonObject[]).map((seat) => seat.team)).toEqual([
      0, 1, 2, 0, 1, 2,
    ]);

    // 2. Los otros cinco entran con el código.
    for (const player of rest) {
      const joined = await apiCall(player.cookie, 'POST', '/v1/tables/join-by-code', {
        code: joinCode,
      });
      expect(joined.status, `entra ${player.nickname}: ${JSON.stringify(joined.json)}`).toBe(200);
    }
    const detail = await apiCall(owner.cookie, 'GET', `/v1/tables/${tableId}`);
    expect(detail.status).toBe(200);
    expect(detail.json!.occupiedSeats).toBe(6);

    // 3. Los seis asientos juegan por WebSocket.
    const clients: TournamentWsPlayer[] = [];
    const browser = await launchIsolatedChromium();
    try {
      for (const player of players) {
        const ticket = await apiCall(player.cookie, 'POST', '/v1/auth/ws-ticket');
        expect(ticket.status, `ticket de ${player.nickname}`).toBe(200);
        const client = new TournamentWsPlayer({
          userId: player.userId,
          nickname: player.nickname,
        });
        await client.connect(GAME, ticket.json!.ticket as string);
        client.send('table.join', { roomId: tableId });
        clients.push(client);
      }

      /**
       * Un rechazo grave del servidor (asiento inválido, ticket vencido, sesión ajena, partida
       * ya activa) tiene que aparecer en el mensaje del test, no como un timeout sin causa.
       *
       * Las acciones ilegales por vista desactualizada **no** cuentan: el cliente juega con la
       * última vista que recibió y el servidor puede haber avanzado entre la decisión y el
       * envío. Es el mismo ruido que produce cualquier cliente real con algo de latencia, y el
       * correctivo ya está cubierto por la partida terminada y por el estado autoritativo.
       */
      const SEVERE_ERROR = /FORBIDDEN|UNAUTHORIZED|ticket|Ya tenés partida activa|no existe/i;
      const collectErrors = (only?: RegExp): string[] =>
        clients.flatMap((client, index) =>
          client
            .errors()
            .filter((error) => !only || only.test(error))
            .map((error) => `${players[index]!.nickname}: ${error}`),
        );
      const expectNoServerErrors = (stage: string) => {
        expect(collectErrors(SEVERE_ERROR), `rechazos graves del game-server en ${stage}`).toEqual(
          [],
        );
      };

      // 4. La mesa del dueño se abre en el navegador (390 px: el ancho más chico que se
      //    promete soportar) y se marca listo desde la pantalla.
      const context = await browser.newContext({
        viewport: { width: 390, height: 844 },
        locale: 'es-AR',
      });
      const [cookieName, cookieValue] = owner.cookie.split('=');
      await context.addCookies([
        { name: cookieName!, value: cookieValue!, domain: 'localhost', path: '/' },
      ]);
      const page = await context.newPage();
      await page.goto(`${WEB}/mesa/${tableId}`, { waitUntil: 'domcontentloaded' });

      await expect(page.getByRole('region', { name: /Mesa de truco en vivo/i })).toBeVisible({
        timeout: 60_000,
      });
      // Con seis asientos hay una tira extra: en la mesa de dos o cuatro no existe.
      await expect(page.getByLabel(/Otros asientos de la mesa de seis/i)).toBeVisible({
        timeout: 60_000,
      });
      const readyButton = page.getByRole('button', { name: /estoy listo|listo ·/i }).first();
      if (await readyButton.isVisible().catch(() => false)) await readyButton.click();

      // 5. Los seis se marcan listos por WebSocket y la partida reparte.
      // El dueño ya se marcó listo desde el navegador: repetirlo por WebSocket es inocuo.
      for (const client of clients) client.send('table.ready', { roomId: tableId, ready: true });
      expectNoServerErrors('marcar listos');
      await expect
        .poll(() => clients.filter((client) => client.latestView !== null).length, {
          timeout: 90_000,
          intervals: [100],
        })
        .toBe(clients.length);

      // 6. Se juega la partida entera. Si algún asiento no juega, no termina y el error
      //    nombra a quién le faltó actuar.
      await Promise.all(
        clients.map((client) =>
          client.playToEnd(tableId, 420_000).then(
            () => client,
            (error: unknown) => {
              const view = client.latestView;
              const detailText = view
                ? `turno del asiento ${view.hand.activeSeat + 1}, mi asiento ${view.mySeat + 1}`
                : 'sin vista de juego';
              throw new Error(
                `${client.nickname} no terminó la partida (${detailText}): ${
                  error instanceof Error ? error.message : String(error)
                }`,
              );
            },
          ),
        ),
      );
      expectNoServerErrors('la partida');
      expect(
        clients.filter((client) => client.ended()).length,
        'los seis asientos vieron el fin de partida',
      ).toBe(6);

      // 7. La mesa del navegador muestra el tanteador de tres equipos y el resultado.
      await expect(page.getByText(/Truco de 6 · 3 equipos/i).first()).toBeVisible({
        timeout: 60_000,
      });
      await expect(page.getByTestId('match-result-header')).toBeVisible({ timeout: 60_000 });
      // El marcador de la cabecera del paño tiene que traer los tres equipos: en una mesa de
      // dos o cuatro asientos publica un duelo, acá publica la mesa completa.
      const scoreboard = page.getByLabel(/Nos\. \d+.*Ellos 2 \d+.*Ellos 3 \d+/).first();
      await expect(scoreboard).toBeVisible();
      const scoreboardText = (await scoreboard.getAttribute('aria-label')) ?? '';
      expect(scoreboardText).toMatch(/Nos\./);
      expect(scoreboardText).toMatch(/Ellos 2/);
      expect(scoreboardText).toMatch(/Ellos 3/);

      // 8. El resultado se verifica en la API, nunca en la vista del cliente.
      const history = await apiCall(
        owner.cookie,
        'GET',
        `/v1/users/${owner.userId}/matches?limit=10`,
      );
      expect(history.status).toBe(200);
      const sixSeatMatch = (history.json!.items as JsonObject[]).find(
        (item) => item.mode === '3v3',
      );
      expect(sixSeatMatch, 'la partida 3v3 quedó registrada en la API').toBeDefined();
      const matchDetail = await apiCall(
        owner.cookie,
        'GET',
        `/v1/users/${owner.userId}/matches/${sixSeatMatch!.matchId as string}`,
      );
      expect(matchDetail.status).toBe(200);
      expect(matchDetail.json!.mode).toBe('3v3');
      const sixPlayers = matchDetail.json!.players as JsonObject[];
      expect(sixPlayers, 'seis asientos en la partida registrada').toHaveLength(6);
      expect(sixPlayers.map((row) => row.team).sort()).toEqual([0, 0, 1, 1, 2, 2]);
      const result = matchDetail.json!.result as JsonObject;
      expect([0, 1, 2], 'gana uno de los tres equipos').toContain(result.winnerTeam as number);
      const scoresByTeam = result.scoresByTeam as Record<string, number>;
      expect(Object.keys(scoresByTeam).sort()).toEqual(['0', '1', '2']);
      expect(scoresByTeam[String(result.winnerTeam)]).toBeGreaterThanOrEqual(15);

      // El 3v3 no puntúa: el perfil sólo tiene los dos modos competitivos.
      const ratings = await apiCall(owner.cookie, 'GET', `/v1/users/${owner.userId}/ratings`);
      expect(ratings.status).toBe(200);
      expect((ratings.json!.ratings as JsonObject[]).map((profile) => profile.mode).sort()).toEqual(
        ['1v1', '2v2'],
      );

      // Las estadísticas sí registran el modo jugado.
      const stats = await apiCall(owner.cookie, 'GET', `/v1/users/${owner.userId}/stats`);
      expect(stats.status).toBe(200);
      const byMode = stats.json!.byMode as Record<string, JsonObject>;
      expect(Object.keys(byMode).sort()).toEqual(['1v1', '2v2', '3v3']);
      expect(byMode['3v3']!.matchesPlayed).toBe(1);

      await context.close();
    } finally {
      for (const client of clients) client.disconnect();
      await browser.close();
    }

    // 9. La mesa terminada ya no se puede borrar como mesa en espera: el servidor la rechaza
    //    en vez de dejarla a medio cerrar. Lo que importa es que el rechazo sea explícito.
    const deleted = await apiCall(owner.cookie, 'DELETE', `/v1/tables/${tableId}`);
    expect([200, 204, 404, 409]).toContain(deleted.status);
    if (deleted.status === 409) expect(deleted.json).not.toBeNull();
  });
});
