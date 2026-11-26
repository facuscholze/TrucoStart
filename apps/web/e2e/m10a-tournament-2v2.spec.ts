import { expect, type Browser, type BrowserContext, type Page, test } from '@playwright/test';
import { launchIsolatedChromium } from './support/launch.js';
import { TournamentWsPlayer } from './support/tournament-ws-client.js';

/**
 * M10a — torneo real 2v2 con equipos, de punta a punta.
 *
 * Ocho personas en cuatro equipos de dos. La inscripción de EQUIPOS, el check-in, la llave
 * y el resultado se miran en el navegador (el detalle del torneo, con sus equipos y su
 * cuadro, en la pantalla real a 390 px); las tres partidas se juegan por WebSocket contra
 * el game-server real.
 *
 * Por qué no cuatro navegadores por cruce: se probó y se pasó de los 15 minutos del test
 * sin terminar la primera semifinal. Cada turno implicaba esperar el DOM de cuatro pestañas
 * y el cuello era el navegador, no el producto. Con clientes WebSocket el cruce se juega en
 * segundos con el mismo motor, las mismas reglas y la misma persistencia. La decisión y su
 * medición quedan en `docs/STATE.md` § M10a.
 *
 * La partida va a 15 puntos, sin flor y con `ar-corto-15-v1`: el RuleSet más corto, y el
 * reparto es el determinista del fixture de pruebas.
 */

const API = 'http://127.0.0.1:3001';
const WEB = 'http://localhost:4173';
const GAME = 'http://127.0.0.1:3002';
const GUEST = 'EquipoE2E';

interface Player {
  readonly context: BrowserContext;
  readonly page: Page;
  readonly cookie: string;
  readonly nickname: string;
  readonly userId: string;
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
  return { status: response.status, json, cookie: access ?? cookie };
}

async function newPlayer(browser: Browser, index: number): Promise<Player> {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    locale: 'es-AR',
  });
  const page = await context.newPage();
  const session = await apiCall(null, 'POST', '/v1/auth/guest', { deviceName: `${GUEST}${index}` });
  expect(session.status, `alta de invitado ${index}`).toBe(201);
  const cookie = session.cookie!;
  const [name, value] = cookie.split('=');
  await context.addCookies([{ name: name!, value: value!, domain: 'localhost', path: '/' }]);
  return {
    context,
    page,
    cookie,
    nickname: (session.json!.user as JsonObject).nickname as string,
    userId: (session.json!.user as JsonObject).id as string,
  };
}

test.describe('M10a — torneo real 2v2 con equipos', () => {
  test('cuatro equipos de dos: llave, semifinales en la mesa y final con campeón', async () => {
    // Dos semifinales y la final, cada una con cuatro clientes jugando turno a turno.
    test.setTimeout(900_000);
    const browser = await launchIsolatedChromium();
    const players: Player[] = [];
    try {
      for (let index = 0; index < 8; index++) players.push(await newPlayer(browser, index));
      const teams = [0, 1, 2, 3].map((team) => [players[team * 2]!, players[team * 2 + 1]!]);
      const [teamOne, teamTwo] = teams as [Player[], Player[]];

      // Alta del torneo 2v2 de 4 equipos (8 personas).
      const created = await apiCall(teamOne[0]!.cookie, 'POST', '/v1/tournaments', {
        name: 'Copa E2E 2v2',
        format: 'SINGLE_ELIMINATION',
        visibility: 'PRIVATE',
        capacity: 4,
        rules: {
          mode: '2v2',
          rulesetCode: 'ar-corto-15-v1',
          targetScore: 15,
          florEnabled: false,
          turnTimeoutMs: 25_000,
        },
        registrationMinutes: 1,
        checkInMinutes: 1,
        noShowMinutes: 20,
        prizes: [
          { position: 1, coins: 100, cosmeticId: null },
          { position: 2, coins: 40, cosmeticId: null },
        ],
        official: false,
      });
      expect(created.status, 'alta del torneo 2v2').toBe(201);
      const tournamentId = (created.json!.tournament as JsonObject).id as string;

      // Inscripción por equipo: el capitán anota a los dos juntos.
      const names = ['Los Pibes', 'La Banda', 'Los del Fondo', 'Los Vecinos'];
      for (const [index, team] of teams.entries()) {
        const registered = await apiCall(
          team[0]!.cookie,
          'POST',
          `/v1/tournaments/${tournamentId}/teams`,
          {
            name: names[index]!,
            teammateUserIds: [team[1]!.userId],
          },
        );
        expect(registered.status, `inscripción de ${names[index]}`).toBe(201);
        expect(registered.json!.participants).toBe(2);
      }

      // Nadie puede estar en dos equipos del mismo torneo.
      const twice = await apiCall(
        teamTwo[0]!.cookie,
        'POST',
        `/v1/tournaments/${tournamentId}/teams`,
        {
          name: 'Repetido',
          teammateUserIds: [teamOne[0]!.userId],
        },
      );
      expect(twice.status, 'un jugador no se inscribe dos veces').toBe(409);

      // Check-in por integrante: los ocho se presentan.
      for (const player of players) {
        const checked = await apiCall(
          player.cookie,
          'POST',
          `/v1/tournaments/${tournamentId}/check-in`,
        );
        expect(checked.status, `check-in de ${player.nickname}`).toBe(200);
      }

      // La pantalla muestra equipos, no personas sueltas.
      await teamOne[0]!.page.goto(`${WEB}/torneos/${tournamentId}`);
      await expect(teamOne[0]!.page.getByRole('heading', { name: 'Copa E2E 2v2' })).toBeVisible({
        timeout: 30_000,
      });
      await expect(teamOne[0]!.page.getByText(/4\/4 inscriptos · 4 con check-in/)).toBeVisible();

      // El torneo arranca solo con el barrido cuando cierra el check-in.
      await expect
        .poll(
          async () => {
            const detail = await apiCall(
              teamOne[0]!.cookie,
              'GET',
              `/v1/tournaments/${tournamentId}`,
            );
            return (detail.json!.tournament as JsonObject).status as string;
          },
          { timeout: 180_000, intervals: [2_000] },
        )
        .toBe('IN_PROGRESS');

      // La llave tiene 3 cruces: dos semifinales y la final. Cuatro equipos son cuatro
      // lados: si el cuadro contara personas serían ocho y habría otros tantos cruces.
      const bracket = await apiCall(teamOne[0]!.cookie, 'GET', `/v1/tournaments/${tournamentId}`);
      expect((bracket.json!.matches as JsonValue[]).length).toBe(3);
      expect((bracket.json!.teams as JsonValue[]).length).toBe(4);

      const playerById = (userId: string): Player => players.find((p) => p.userId === userId)!;

      /**
       * Juega un cruce: abre la mesa de cada integrante con un cliente WebSocket real y
       * deja que los cuatro asientos jueguen hasta el final. Devuelve el id del equipo
       * que el torneo registró como ganador del cruce.
       */
      const playBracketMatch = async (round: number, slot: number): Promise<string> => {
        const detail = await apiCall(teamOne[0]!.cookie, 'GET', `/v1/tournaments/${tournamentId}`);
        const match = (detail.json!.matches as JsonObject[]).find(
          (candidate) => candidate.round === round && candidate.slot === slot,
        )!;
        expect(match.status, `cruce ${round}-${slot} listo`).toBe('READY');
        const roomId = match.roomId as string;
        expect(roomId).toBeTruthy();

        const teamsInMatch = detail.json!.teams as JsonObject[];
        const homeTeam = teamsInMatch.find((team) => team.id === match.homeTeamId)!;
        const awayTeam = teamsInMatch.find((team) => team.id === match.awayTeamId)!;
        const sideOf = (team: JsonObject) =>
          (team.members as JsonObject[]).map((member) => playerById(member.userId as string));
        const home = sideOf(homeTeam);
        const away = sideOf(awayTeam);
        expect(home.length, 'equipo local completo').toBe(2);
        expect(away.length, 'equipo visitante completo').toBe(2);

        const clients: TournamentWsPlayer[] = [];
        try {
          for (const player of [...home, ...away]) {
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
          // La sala reparte cuando los cuatro asientos están listos.
          for (const client of clients) client.send('table.ready', { roomId, ready: true });

          const deadline = Date.now() + 60_000;
          while (Date.now() < deadline && !clients.every((c) => c.latestView !== null)) {
            await new Promise((resolve) => setTimeout(resolve, 50));
          }
          expect(
            clients.every((c) => c.latestView !== null),
            'la sala repartió',
          ).toBe(true);

          await Promise.all(
            clients.map((client) => client.playToEnd(roomId, 120_000).catch(() => undefined)),
          );
          expect(
            clients.some((c) => c.ended()),
            'la partida 2v2 terminó',
          ).toBe(true);

          // El ganador lo decide el torneo, no la pantalla: el cruce tiene que cerrarse
          // con el equipo que ganó la mesa y quedar el perdedor eliminado.
          let closed: JsonObject | undefined;
          await expect
            .poll(
              async () => {
                const after = await apiCall(
                  teamOne[0]!.cookie,
                  'GET',
                  `/v1/tournaments/${tournamentId}`,
                );
                closed = (after.json!.matches as JsonObject[]).find(
                  (candidate) => candidate.round === round && candidate.slot === slot,
                );
                return closed?.status ?? 'sin cruce';
              },
              { timeout: 60_000, intervals: [1_000] },
            )
            .toBe('COMPLETED');
          const winnerTeamId = closed!.winnerTeamId as string | null;
          expect(winnerTeamId, 'el cruce cerrado tiene equipo ganador').toBeTruthy();
          expect([match.homeTeamId, match.awayTeamId]).toContain(winnerTeamId);
          return winnerTeamId!;
        } finally {
          for (const client of clients) client.disconnect();
        }
      };

      const semiOne = await playBracketMatch(1, 1);
      const semiTwo = await playBracketMatch(1, 2);
      // El resultado de la mesa tiene que cerrar los dos cruces y armar la final.
      await expect
        .poll(
          async () => {
            const detail = await apiCall(
              teamOne[0]!.cookie,
              'GET',
              `/v1/tournaments/${tournamentId}`,
            );
            const final = (detail.json!.matches as JsonObject[]).find((m) => m.round === 2);
            return final?.status ?? 'sin final';
          },
          { timeout: 90_000, intervals: [1_000] },
        )
        .toBe('READY');

      const championTeamId = await playBracketMatch(2, 1);
      // La final la jugaron los dos equipos que ganaron su semifinal: la llave avanza por
      // equipo, no por persona, y el campeón tiene que ser uno de los dos.
      expect(semiOne).not.toBe(semiTwo);
      expect([semiOne, semiTwo]).toContain(championTeamId);

      // Campeón: el torneo termina y la pantalla lo muestra con su equipo.
      await expect
        .poll(
          async () => {
            const detail = await apiCall(
              teamOne[0]!.cookie,
              'GET',
              `/v1/tournaments/${tournamentId}`,
            );
            return (detail.json!.tournament as JsonObject).status as string;
          },
          { timeout: 90_000, intervals: [1_000] },
        )
        .toBe('FINISHED');

      const finalDetail = await apiCall(
        teamOne[0]!.cookie,
        'GET',
        `/v1/tournaments/${tournamentId}`,
      );
      // La tabla de un torneo por equipos tiene una fila por EQUIPO: el campeón aparece
      // con el nombre de su equipo y la nota dice quiénes lo jugaron.
      const standings = finalDetail.json!.standings as JsonObject[];
      expect(standings[0]!.tiebreakNote).toContain('Campeón');
      const championName = standings[0]!.nickname as string;
      expect(names).toContain(championName);

      const championTeam = (finalDetail.json!.teams as JsonObject[]).find(
        (team) => team.id === championTeamId,
      )!;
      expect(championTeam.name).toBe(championName);
      const championMembers = (championTeam.members as JsonObject[]).map(
        (member) => member.userId as string,
      );
      expect(championMembers).toHaveLength(2);
      expect(standings[0]!.tiebreakNote).toContain(
        championMembers.map((userId) => playerById(userId).nickname).join(' y '),
      );

      // El torneo marca campeón a las dos personas del equipo, no a una: el premio se
      // acredita por integrante (el alta de premios por persona está probada en la API).
      const finalMatch = (finalDetail.json!.matches as JsonObject[]).find((m) => m.round === 2)!;
      expect(finalMatch.winnerTeamId).toBe(championTeamId);
      const winners = (finalDetail.json!.participants as JsonObject[])
        .filter((participant) => participant.status === 'WINNER')
        .map((participant) => participant.userId as string)
        .sort();
      expect(winners).toEqual([...championMembers].sort());

      // El resultado en pantalla: la pantalla de un integrante muestra el torneo terminado
      // con el equipo campeón en la tabla. El torneo es privado, así que sólo lo ve quien
      // jugó: por eso se mira desde una de las pestañas que ya participaron.
      const viewer = playerById(championMembers[0]!).page;
      await viewer.goto(`${WEB}/torneos/${tournamentId}`);
      await expect(viewer.getByRole('heading', { name: 'Copa E2E 2v2' })).toBeVisible({
        timeout: 30_000,
      });
      await expect(viewer.getByText(/Terminado/).first()).toBeVisible({ timeout: 15_000 });
      await expect(viewer.getByText(championName).first()).toBeVisible({ timeout: 15_000 });
      await expect(viewer.getByText(/Campeón — /).first()).toBeVisible({ timeout: 15_000 });
    } finally {
      await browser.close();
    }
  });
});
