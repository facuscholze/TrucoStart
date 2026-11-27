import { expect, type Browser, type BrowserContext, type Page } from '@playwright/test';

export const API = 'http://127.0.0.1:3001';
export const WEB = 'http://localhost:4173';
export const GAME = 'http://127.0.0.1:3002';

export type JsonValue =
  string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

export interface Player {
  readonly context: BrowserContext;
  readonly page: Page;
  readonly cookie: string;
  readonly nickname: string;
  readonly userId: string;
}

export interface ApiResponse {
  readonly status: number;
  readonly json: JsonObject | null;
  readonly cookie: string | null;
}

export async function apiCall(
  cookie: string | null,
  method: string,
  path: string,
  body?: unknown,
): Promise<ApiResponse> {
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

export async function newPlayer(browser: Browser, index: number): Promise<Player> {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    locale: 'es-AR',
  });
  const page = await context.newPage();
  const session = await apiCall(null, 'POST', '/v1/auth/guest', {
    deviceName: `EquipoE2E${index}`,
  });
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

/** Nombres de los cuatro equipos del E2E, en orden de inscripción. */
export const TEAM_NAMES = ['Los Pibes', 'La Banda', 'Los del Fondo', 'Los Vecinos'] as const;

export interface TeamTournament {
  readonly tournamentId: string;
  /** Los ocho jugadores: `teams[i]` son los dos integrantes del equipo `i`. */
  readonly teams: readonly (readonly Player[])[];
  readonly players: readonly Player[];
}

/**
 * Deja un torneo 2v2 listo para jugarse: ocho invitados, cuatro equipos inscriptos por
 * equipo, check-in de los ocho y torneo arrancado por el barrido con la llave armada.
 *
 * Es el mismo camino que hace un jugador por la API real, sin atajos: lo único que se
 * saltea es esperar los minutos de las ventanas (el barrido se dispara desde la prueba).
 */
export async function setupTeamTournament(
  browser: Browser,
  input: {
    readonly name: string;
    /** Minutos de inscripción; el check-in dura lo mismo que la inscripción. */
    readonly registrationMinutes?: number;
    readonly noShowMinutes?: number;
  },
): Promise<TeamTournament> {
  const players: Player[] = [];
  for (let index = 0; index < 8; index++) players.push(await newPlayer(browser, index));
  const teams = [0, 1, 2, 3].map((team) => [players[team * 2]!, players[team * 2 + 1]!]);

  const created = await apiCall(players[0]!.cookie, 'POST', '/v1/tournaments', {
    name: input.name,
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
    registrationMinutes: input.registrationMinutes ?? 1,
    checkInMinutes: input.registrationMinutes ?? 1,
    noShowMinutes: input.noShowMinutes ?? 20,
    prizes: [
      { position: 1, coins: 100, cosmeticId: null },
      { position: 2, coins: 40, cosmeticId: null },
    ],
    official: false,
  });
  expect(created.status, 'alta del torneo 2v2').toBe(201);
  const tournamentId = (created.json!.tournament as JsonObject).id as string;

  // Inscripción por equipo: el capitán anota a los dos juntos.
  for (const [index, team] of teams.entries()) {
    const registered = await apiCall(
      team[0]!.cookie,
      'POST',
      `/v1/tournaments/${tournamentId}/teams`,
      { name: TEAM_NAMES[index]!, teammateUserIds: [team[1]!.userId] },
    );
    expect(registered.status, `inscripción de ${TEAM_NAMES[index]}`).toBe(201);
    expect(registered.json!.participants).toBe(2);
  }

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
  await players[0]!.page.goto(`${WEB}/torneos/${tournamentId}`);
  await expect(players[0]!.page.getByRole('heading', { name: input.name })).toBeVisible({
    timeout: 30_000,
  });
  await expect(players[0]!.page.getByText(/4\/4 inscriptos · 4 con check-in/)).toBeVisible();

  // El torneo arranca solo con el barrido cuando cierra el check-in.
  await expect
    .poll(
      async () => {
        const detail = await apiCall(players[0]!.cookie, 'GET', `/v1/tournaments/${tournamentId}`);
        return (detail.json!.tournament as JsonObject).status as string;
      },
      { timeout: 180_000, intervals: [2_000] },
    )
    .toBe('IN_PROGRESS');

  // Cuatro equipos son cuatro lados: si el cuadro contara personas serían ocho y habría
  // otros tantos cruces.
  const bracket = await apiCall(players[0]!.cookie, 'GET', `/v1/tournaments/${tournamentId}`);
  expect((bracket.json!.matches as JsonValue[]).length).toBe(3);
  expect((bracket.json!.teams as JsonValue[]).length).toBe(4);

  return { tournamentId, teams, players };
}

export interface BracketSide {
  readonly teamId: string;
  readonly teamName: string;
  readonly members: readonly Player[];
}

/** Lee un cruce del cuadro con sus equipos y los jugadores de cada lado. */
export async function readBracketMatch(
  cookie: string,
  tournamentId: string,
  round: number,
  slot: number,
  players: readonly Player[],
): Promise<{
  roomId: string;
  status: string;
  homeTeamId: string;
  awayTeamId: string;
  home: BracketSide;
  away: BracketSide;
}> {
  const detail = await apiCall(cookie, 'GET', `/v1/tournaments/${tournamentId}`);
  const matches = detail.json!.matches as JsonObject[];
  const match = matches.find((candidate) => candidate.round === round && candidate.slot === slot);
  expect(match, `el cuadro tiene el cruce ${round}-${slot}`).toBeTruthy();

  const teamsInMatch = detail.json!.teams as JsonObject[];
  const sideOf = (teamId: string): BracketSide => {
    const team = teamsInMatch.find((candidate) => candidate.id === teamId)!;
    return {
      teamId,
      teamName: team.name as string,
      members: (team.members as JsonObject[]).map((member) =>
        players.find((player) => player.userId === member.userId)!,
      ),
    };
  };

  return {
    roomId: (match!.roomId ?? '') as string,
    status: match!.status as string,
    homeTeamId: match!.homeTeamId as string,
    awayTeamId: match!.awayTeamId as string,
    home: sideOf(match!.homeTeamId as string),
    away: sideOf(match!.awayTeamId as string),
  };
}
