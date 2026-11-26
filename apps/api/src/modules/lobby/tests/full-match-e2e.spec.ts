import { randomUUID } from 'node:crypto';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { chooseBotAction, type PlayerView } from '@truco/engine';
import {
  BullMqMatchLifecyclePublisher,
  createGameServer,
  type GameServerInstance,
  InMemoryMatchLifecycleBus,
} from '@truco/game-server';
import { MATCH_LIFECYCLE_QUEUE_NAME, type WsEnvelope, WsEnvelopeSchema } from '@truco/shared';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { io as createSocketClient, type Socket as ClientSocket } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createApiApp } from '../../../bootstrap.js';
import { TEST_LEGAL_ACCEPTANCE } from '../../../common/testing/legal-acceptance.fixture.js';
import {
  createAdaptiveTestDatabase,
  type DatabaseConnectionHandle,
} from '../../../db/database.provider.js';
import {
  matchEventsTable,
  matchesTable,
  matchPlayersTable,
  profilesTable,
  ratingJobsTable,
  ratingProfilesTable,
  ratingSeasonsTable,
  tableSeatsTable,
  tablesTable,
} from '../../../db/schema/index.js';
import { buildCookieHeader, extractAuthCookies } from '../../auth/tests/test-cookie-jar.js';
import { MATCHMAKING_STORE } from '../../matchmaking/store/matchmaking-store.interface.js';
import { RedisMatchmakingStore } from '../../matchmaking/store/redis-matchmaking-store.js';
import { LEADERBOARD_STORE } from '../../ratings/leaderboard-store.interface.js';
import { RedisLeaderboardStore } from '../../ratings/redis-leaderboard-store.js';
import { HttpGameRoomProvisioner } from '../ports/game-room-provisioner.js';
import { LobbyRealtimeGateway } from '../lobby-realtime.gateway.js';
import { USER_PRESENCE_STORE } from '../../social/presence-store.interface.js';
import {
  BullMqMatchLifecycleConsumer,
  InMemoryMatchLifecycleConsumer,
  type MatchLifecycleConsumer,
} from '../ports/match-lifecycle-consumer.js';

const SHARED_SECRET = 'm4-full-e2e-shared-secret-minimum-32-chars!!';

class RealGameWsPlayer {
  readonly seat: number;
  socket!: ClientSocket;
  readonly transcript: WsEnvelope[] = [];
  lastSeq = 0;
  latestView: PlayerView | null = null;
  private cursor = 0;
  private readonly waiters: Array<() => void> = [];

  constructor(seat: number) {
    this.seat = seat;
  }

  async connect(gameServerUrl: string, wsTicket: string): Promise<void> {
    this.socket = createSocketClient(gameServerUrl, {
      transports: ['websocket'],
      forceNew: true,
      reconnection: false,
      auth: { token: wsTicket },
    });

    this.socket.on('envelope', (raw: unknown) => {
      const parsed = WsEnvelopeSchema.parse(raw);
      this.transcript.push(parsed);
      if (typeof parsed.seq === 'number' && parsed.seq > this.lastSeq) {
        this.lastSeq = parsed.seq;
      }
      if (parsed.payload['view'] && typeof parsed.payload['view'] === 'object') {
        this.latestView = parsed.payload['view'] as unknown as PlayerView;
      }
      const pending = this.waiters.splice(0, this.waiters.length);
      for (const wake of pending) wake();
    });

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Timeout conectando WS game-server')), 5_000);
      this.socket.once('connect', () => {
        clearTimeout(timer);
        resolve();
      });
      this.socket.once('connect_error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });
  }

  send(type: string, payload: Record<string, unknown>): void {
    this.socket.emit('envelope', {
      eventId: randomUUID(),
      ts: Date.now(),
      type,
      payload,
    });
  }

  async waitFor(
    predicate: (env: WsEnvelope) => boolean,
    label: string,
    timeoutMs = 5_000,
  ): Promise<WsEnvelope> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      while (this.cursor < this.transcript.length) {
        const ev = this.transcript[this.cursor]!;
        this.cursor += 1;
        if (predicate(ev)) return ev;
      }
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 25);
        this.waiters.push(() => {
          clearTimeout(timer);
          resolve();
        });
      });
    }
    throw new Error(`Timeout esperando '${label}' en seat=${this.seat}`);
  }

  disconnect(): void {
    this.socket?.disconnect();
  }
}

function sendBotDecision(roomId: string, player: RealGameWsPlayer): void {
  const view = player.latestView;
  if (!view) throw new Error(`No hay vista de juego para seat=${player.seat}.`);
  const action = chooseBotAction(view);
  if (action.type === 'PLAY_CARD') {
    player.send('game.playCard', { roomId, cardId: action.cardId });
  } else if (action.type === 'FOLD_HAND') {
    player.send('game.foldHand', { roomId });
  } else if (
    action.type === 'CALL_TRUCO' ||
    action.type === 'CALL_ENVIDO' ||
    action.type === 'CALL_FLOR'
  ) {
    player.send('game.call', { roomId, type: action.bid });
  } else if (action.type === 'RESPOND_TRUCO') {
    player.send('game.respond', { roomId, call: 'TRUCO', answer: action.decision });
  } else if (action.type === 'RESPOND_ENVIDO') {
    player.send('game.respond', { roomId, call: 'ENVIDO', answer: action.decision });
  } else if (action.type === 'RESPOND_FLOR') {
    player.send('game.respond', { roomId, call: 'FLOR', answer: action.decision });
  } else {
    player.send('game.foldHand', { roomId });
  }
}

async function playPracticeMatch(roomId: string, player: RealGameWsPlayer): Promise<void> {
  for (let step = 0; step < 160; step++) {
    if (player.transcript.some((event) => event.type === 'game.ended')) return;
    const view = player.latestView;
    if (!view) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      continue;
    }

    const previousSeq = player.lastSeq;
    if (view.hand.activeSeat === player.seat) sendBotDecision(roomId, player);
    await player.waitFor(
      (event) => event.type === 'game.ended' || (event.seq ?? 0) > previousSeq,
      `avance de práctica ${step}`,
      5_000,
    );
  }
  throw new Error('La partida de práctica no terminó dentro de 160 acciones.');
}

async function playCompleteMatch(roomId: string, players: readonly RealGameWsPlayer[]) {
  for (let step = 0; step < 350; step++) {
    if (players[0]!.transcript.some((e) => e.type === 'game.ended')) return;
    const views = players.map((p) => p.latestView).filter((v): v is PlayerView => v !== null);
    if (views.length === 0) {
      await new Promise((r) => setTimeout(r, 10));
      continue;
    }

    const activeSeat = views.sort((a, b) => b.hand.handNumber - a.hand.handNumber)[0]!.hand
      .activeSeat;
    const actor = players[activeSeat]!;

    const deadline = Date.now() + 2_500;
    while (
      Date.now() < deadline &&
      (!actor.latestView ||
        actor.latestView.hand.activeSeat !== actor.seat ||
        actor.latestView.legalActions.length === 0)
    ) {
      if (players[0]!.transcript.some((e) => e.type === 'game.ended')) return;
      await new Promise((r) => setTimeout(r, 10));
    }

    if (players[0]!.transcript.some((e) => e.type === 'game.ended')) return;

    const prevSeq = actor.lastSeq;
    sendBotDecision(roomId, actor);
    await actor.waitFor((ev) => (ev.seq ?? 0) > prevSeq, `avance jugada ${step}`);
  }
}

describe('M4 Full Distributed E2E: real apps/api + real apps/game-server + PostgreSQL persistence', () => {
  let dbHandle: DatabaseConnectionHandle;
  let apiApp: NestFastifyApplication;
  let gameServer: GameServerInstance;
  let gameServerUrl: string;
  let bullPublisher: BullMqMatchLifecyclePublisher | null = null;

  beforeAll(async () => {
    dbHandle = await createAdaptiveTestDatabase();

    const redisUrl = process.env['REDIS_URL'];
    const queueName = `${MATCH_LIFECYCLE_QUEUE_NAME}-e2e-${Date.now()}`;
    const matchmakingStore = redisUrl
      ? new RedisMatchmakingStore(redisUrl, {
          keyPrefix: `truco:mm:full-e2e:${process.pid}:${randomUUID()}:`,
        })
      : undefined;
    const inMemoryBus = new InMemoryMatchLifecycleBus();

    if (redisUrl) {
      bullPublisher = new BullMqMatchLifecyclePublisher(redisUrl, { queueName });
    }

    gameServer = createGameServer({
      sessionSecret: SHARED_SECRET,
      internalSecret: SHARED_SECRET,
      seedEncryptionKey: SHARED_SECRET,
      allowAdHocRooms: false,
      lifecyclePublisher: bullPublisher ?? inMemoryBus,
      rateLimiter: {
        windowMs: 10_000,
        actionMax: 600,
        chatMax: 50,
        tableMax: 50,
        connectionTotalMax: 900,
      },
    });
    const gamePort = await gameServer.listen(0, '127.0.0.1');
    gameServerUrl = `http://127.0.0.1:${gamePort}`;

    const lifecycleConsumer: MatchLifecycleConsumer = redisUrl
      ? new BullMqMatchLifecycleConsumer(redisUrl, { queueName })
      : new InMemoryMatchLifecycleConsumer(inMemoryBus);

    apiApp = await createApiApp({
      dbHandle,
      authOptions: {
        runtimeConfig: { sessionSecret: SHARED_SECRET },
      },
      ratingsOptions: {
        runtimeConfig: { minimumMatches: 1, minimumOpponents: 1 },
      },
      lobbyOptions: {
        ...(matchmakingStore ? { matchmakingStore } : {}),
        gameRoomProvisioner: new HttpGameRoomProvisioner({
          baseUrl: gameServerUrl,
          internalSecret: SHARED_SECRET,
        }),
        matchLifecycleConsumer: lifecycleConsumer,
        runtimeConfig: {
          sessionSecret: SHARED_SECRET,
          internalSecret: SHARED_SECRET,
          cleanupIntervalMs: 0,
        },
      },
    });
    await apiApp.init();
  });

  afterAll(async () => {
    await apiApp.close();
    await gameServer.close();
    if (bullPublisher) {
      await bullPublisher.close();
    }
    await dbHandle.close();
  });

  async function createGuest(deviceName: string) {
    const response = await apiApp.inject({
      method: 'POST',
      url: '/v1/auth/guest',
      payload: { deviceName },
    });
    expect(response.statusCode).toBe(201);
    return {
      cookie: buildCookieHeader(extractAuthCookies(response.headers['set-cookie']).map),
      user: response.json<{ user: { id: string; nickname: string } }>().user,
    };
  }

  async function playCompetitiveMatch(
    sessions: ReadonlyArray<{ userId: string; cookie: string }>,
  ): Promise<void> {
    expect(sessions).toHaveLength(2);
    const redisUrl = process.env['REDIS_URL'];
    if (redisUrl) {
      expect(apiApp.get(MATCHMAKING_STORE)).toBeInstanceOf(RedisMatchmakingStore);
      expect(apiApp.get(LEADERBOARD_STORE)).toBeInstanceOf(RedisLeaderboardStore);
    }

    const userIds = sessions.map((session) => session.userId);
    const cookieByUserId = new Map(
      sessions.map((session) => [session.userId, session.cookie] as const),
    );
    const publicSettings = {
      soundEnabled: true,
      animationsReduced: false,
      confirmCalls: false,
      historyVisibility: 'ALL' as const,
      statsVisibility: 'ALL' as const,
      presenceVisibility: 'FRIENDS' as const,
    };
    for (const userId of userIds) {
      await dbHandle.db
        .update(profilesTable)
        .set({ settings: publicSettings })
        .where(eq(profilesTable.userId, userId));
    }

    const [activeSeason] = await dbHandle.db
      .select()
      .from(ratingSeasonsTable)
      .where(eq(ratingSeasonsTable.status, 'ACTIVE'))
      .limit(1);
    expect(activeSeason).toBeDefined();

    const firstQueued = await apiApp.inject({
      method: 'POST',
      url: '/v1/matchmaking/queue',
      headers: { cookie: sessions[0]!.cookie },
      payload: { mode: '1v1', rulesetCode: 'ar-corto-15-v1', competitive: true },
    });
    expect(firstQueued.statusCode).toBe(200);
    expect(firstQueued.json<{ status: string; competitive: boolean }>()).toMatchObject({
      status: 'QUEUED',
      competitive: true,
    });

    const matched = await apiApp.inject({
      method: 'POST',
      url: '/v1/matchmaking/queue',
      headers: { cookie: sessions[1]!.cookie },
      payload: { mode: '1v1', rulesetCode: 'ar-corto-15-v1', competitive: true },
    });
    expect(matched.statusCode).toBe(201);
    const room = matched.json<{ tableId: string; roomId: string; competitive: boolean }>();
    expect(room.competitive).toBe(true);
    const table = (
      await dbHandle.db.select().from(tablesTable).where(eq(tablesTable.id, room.tableId))
    )[0];
    expect(table).toMatchObject({ isCompetitive: true, status: 'WAITING' });

    const seats = await dbHandle.db
      .select()
      .from(tableSeatsTable)
      .where(eq(tableSeatsTable.tableId, room.tableId))
      .orderBy(asc(tableSeatsTable.seat));
    expect(seats).toHaveLength(2);
    const wsPlayers: RealGameWsPlayer[] = [];
    try {
      for (const seat of seats) {
        const cookie = cookieByUserId.get(seat.userId);
        if (!cookie) throw new Error(`No se encontró la sesión E2E para el asiento ${seat.seat}.`);
        const ticketResponse = await apiApp.inject({
          method: 'POST',
          url: '/v1/auth/ws-ticket',
          headers: { cookie },
        });
        expect(ticketResponse.statusCode).toBe(200);
        const wsPlayer = new RealGameWsPlayer(seat.seat);
        await wsPlayer.connect(gameServerUrl, ticketResponse.json<{ ticket: string }>().ticket);
        wsPlayers.push(wsPlayer);
      }

      for (const player of wsPlayers) {
        player.send('table.join', { roomId: room.roomId, preferredSeat: player.seat });
        await player.waitFor(
          (event) => event.type === 'table.state',
          `table.state seat ${player.seat}`,
        );
      }
      for (const player of wsPlayers) {
        player.send('table.ready', { roomId: room.roomId, ready: true });
      }
      await wsPlayers[0]!.waitFor(
        (event) => event.type === 'game.started',
        'game.started competitivo',
      );
      await playCompleteMatch(room.roomId, wsPlayers);
      await wsPlayers[0]!.waitFor((event) => event.type === 'game.ended', 'game.ended competitivo');

      const persistenceDeadline = Date.now() + 30_000;
      let persistedMatch = (
        await dbHandle.db.select().from(matchesTable).where(eq(matchesTable.tableId, room.tableId))
      )[0];
      while (
        (!persistedMatch?.endedAt || !persistedMatch.isCompetitive) &&
        Date.now() < persistenceDeadline
      ) {
        await new Promise((resolve) => setTimeout(resolve, 50));
        persistedMatch = (
          await dbHandle.db
            .select()
            .from(matchesTable)
            .where(eq(matchesTable.tableId, room.tableId))
        )[0];
      }
      expect(persistedMatch).toMatchObject({
        isCompetitive: true,
        hasBots: false,
        seasonId: activeSeason!.id,
      });
      expect(persistedMatch?.endedAt).not.toBeNull();

      const ratingDeadline = Date.now() + 30_000;
      let jobs = await dbHandle.db
        .select()
        .from(ratingJobsTable)
        .where(eq(ratingJobsTable.matchId, persistedMatch!.id));
      while (jobs.length === 0 && Date.now() < ratingDeadline) {
        await new Promise((resolve) => setTimeout(resolve, 50));
        jobs = await dbHandle.db
          .select()
          .from(ratingJobsTable)
          .where(eq(ratingJobsTable.matchId, persistedMatch!.id));
      }
      expect(jobs).toHaveLength(1);

      const ratedProfiles = await dbHandle.db
        .select()
        .from(ratingProfilesTable)
        .where(
          and(
            eq(ratingProfilesTable.seasonId, activeSeason!.id),
            eq(ratingProfilesTable.mode, '1v1'),
            inArray(ratingProfilesTable.userId, userIds),
          ),
        );
      expect(ratedProfiles).toHaveLength(2);
      expect(ratedProfiles.every((profile) => profile.matchesPlayed === 1)).toBe(true);
      const ratingDeltas = await dbHandle.db
        .select({ ratingDelta: matchPlayersTable.ratingDelta })
        .from(matchPlayersTable)
        .where(eq(matchPlayersTable.matchId, persistedMatch!.id));
      expect(ratingDeltas).toHaveLength(2);
      expect(ratingDeltas.some((row) => row.ratingDelta !== 0)).toBe(true);

      const rankings = await apiApp.inject({
        method: 'GET',
        url: '/v1/rankings?period=GLOBAL&mode=1v1&limit=10',
      });
      expect(rankings.statusCode).toBe(200);
      const rankedUserIds = rankings
        .json<{ items: Array<{ userId: string }> }>()
        .items.map((item) => item.userId);
      expect(rankedUserIds).toEqual(expect.arrayContaining(userIds));
    } finally {
      wsPlayers.forEach((player) => player.disconnect());
    }
  }

  it('requires real PostgreSQL and Redis services for CI integration runs', () => {
    if (process.env['CI'] === 'true') {
      expect(process.env['DATABASE_URL']).toBeTruthy();
      expect(process.env['REDIS_URL']).toBeTruthy();
    }
  });

  it('integra invitado, promoción, práctica con bot, amistad, partida, reporte y ranking competitivo', async () => {
    // 1. Dos clientes reales entran como invitados; P1 conserva su identidad al promoverse.
    const p1Guest = await createGuest('Auditoria-Cliente1');
    const p2 = await createGuest('Auditoria-Cliente2');
    const p1GuestCookie = p1Guest.cookie;
    const promotion = await apiApp.inject({
      method: 'POST',
      url: '/v1/auth/promote-guest',
      headers: { cookie: p1GuestCookie },
      payload: {
        email: `auditoria-${randomUUID()}@truco.ar`,
        password: 'ClaveAuditoria2026',
        nickname: `Auditoria${randomUUID().slice(0, 6)}`,
        legal: TEST_LEGAL_ACCEPTANCE,
      },
    });
    expect(promotion.statusCode).toBe(200);
    const p1User = promotion.json<{
      user: { id: string; nickname: string; isGuest: boolean };
    }>().user;
    expect(p1User).toMatchObject({ id: p1Guest.user.id, isGuest: false });
    const p1Cookie = buildCookieHeader(extractAuthCookies(promotion.headers['set-cookie']).map);
    const p2Cookie = p2.cookie;
    const p2User = p2.user;

    // 2. P1 completa una partida real de práctica contra un bot en el game-server.
    const practiceCreate = await apiApp.inject({
      method: 'POST',
      url: '/v1/tables',
      headers: { cookie: p1Cookie },
      payload: {
        mode: '1v1',
        visibility: 'PUBLIC',
        targetScore: 15,
        flor: false,
        turnTimeoutMs: 25_000,
        practice: { difficulty: 'EASY' },
      },
    });
    expect(practiceCreate.statusCode).toBe(201);
    const practiceTable = practiceCreate.json<{
      id: string;
      roomId: string;
      isPractice: boolean;
      visibility: string;
      mySeat: number;
    }>();
    expect(practiceTable).toMatchObject({ isPractice: true, visibility: 'PRIVATE', mySeat: 0 });
    const publicLobby = await apiApp.inject({ method: 'GET', url: '/v1/tables?status=WAITING' });
    expect(
      publicLobby
        .json<{ tables: Array<{ id: string }> }>()
        .tables.some((table) => table.id === practiceTable.id),
    ).toBe(false);

    const practiceTicket = await apiApp.inject({
      method: 'POST',
      url: '/v1/auth/ws-ticket',
      headers: { cookie: p1Cookie },
    });
    expect(practiceTicket.statusCode).toBe(200);
    const practicePlayer = new RealGameWsPlayer(0);
    try {
      await practicePlayer.connect(gameServerUrl, practiceTicket.json<{ ticket: string }>().ticket);
      practicePlayer.send('table.join', { roomId: practiceTable.roomId, preferredSeat: 0 });
      await practicePlayer.waitFor((event) => event.type === 'table.state', 'practice table.state');
      practicePlayer.send('table.ready', { roomId: practiceTable.roomId, ready: true });
      await practicePlayer.waitFor(
        (event) => event.type === 'game.started',
        'practice game.started',
      );
      await playPracticeMatch(practiceTable.roomId, practicePlayer);
      await practicePlayer.waitFor((event) => event.type === 'game.ended', 'practice game.ended');
    } finally {
      practicePlayer.disconnect();
    }

    const practicePersistenceDeadline = Date.now() + 10_000;
    let persistedPractice = (
      await dbHandle.db
        .select()
        .from(matchesTable)
        .where(eq(matchesTable.tableId, practiceTable.id))
    )[0];
    while (!persistedPractice?.endedAt && Date.now() < practicePersistenceDeadline) {
      await new Promise((resolve) => setTimeout(resolve, 30));
      persistedPractice = (
        await dbHandle.db
          .select()
          .from(matchesTable)
          .where(eq(matchesTable.tableId, practiceTable.id))
      )[0];
    }
    expect(persistedPractice).toMatchObject({ isPractice: true, hasBots: true });

    const practiceProgressionDeadline = Date.now() + 10_000;
    let practiceProgression:
      { xpTotal: number; missions: Array<{ templateId: string; progress: number }> } | undefined;
    while (Date.now() < practiceProgressionDeadline) {
      const progressionResponse = await apiApp.inject({
        method: 'GET',
        url: '/v1/me/progression',
        headers: { cookie: p1Cookie },
      });
      expect(progressionResponse.statusCode).toBe(200);
      practiceProgression = progressionResponse.json<{
        xpTotal: number;
        missions: Array<{ templateId: string; progress: number }>;
      }>();
      if (
        practiceProgression.xpTotal > 0 &&
        practiceProgression.missions.some(
          (mission) => mission.templateId === 'daily_play_match' && mission.progress >= 1,
        )
      ) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 30));
    }
    expect(practiceProgression?.xpTotal).toBeGreaterThan(0);
    expect(
      practiceProgression?.missions.some(
        (mission) => mission.templateId === 'daily_play_match' && mission.progress >= 1,
      ),
    ).toBe(true);

    const practiceSeatReleaseDeadline = Date.now() + 5_000;
    let practiceSeats = await dbHandle.db
      .select({ isActive: tableSeatsTable.isActive })
      .from(tableSeatsTable)
      .where(
        and(eq(tableSeatsTable.tableId, practiceTable.id), eq(tableSeatsTable.userId, p1User.id)),
      );
    while (
      practiceSeats.some((seat) => seat.isActive) &&
      Date.now() < practiceSeatReleaseDeadline
    ) {
      await new Promise((resolve) => setTimeout(resolve, 30));
      practiceSeats = await dbHandle.db
        .select({ isActive: tableSeatsTable.isActive })
        .from(tableSeatsTable)
        .where(
          and(eq(tableSeatsTable.tableId, practiceTable.id), eq(tableSeatsTable.userId, p1User.id)),
        );
    }
    expect(practiceSeats.every((seat) => !seat.isActive)).toBe(true);

    // 3. P1 y P2 completan el flujo social real de solicitud y aceptación de amistad.
    const friendRequest = await apiApp.inject({
      method: 'POST',
      url: '/v1/social/friend-requests',
      headers: { cookie: p1Cookie },
      payload: { targetUserId: p2User.id },
    });
    expect(friendRequest.statusCode).toBe(201);
    const friendAccepted = await apiApp.inject({
      method: 'POST',
      url: `/v1/social/friend-requests/${friendRequest.json<{ requestId: string }>().requestId}/accept`,
      headers: { cookie: p2Cookie },
    });
    expect(friendAccepted.statusCode).toBe(200);
    expect(friendAccepted.json<{ status: string }>().status).toBe('ACCEPTED');

    // 4. P1 crea mesa privada a 15 puntos sin flor -> apps/api aprovisiona sala en apps/game-server vía HTTP HMAC firmado
    const createRes = await apiApp.inject({
      method: 'POST',
      url: '/v1/tables',
      headers: { cookie: p1Cookie },
      payload: {
        mode: '1v1',
        visibility: 'PRIVATE',
        targetScore: 15,
        flor: false,
        turnTimeoutMs: 25_000,
      },
    });
    expect(createRes.statusCode).toBe(201);
    const createdTable = createRes.json<{
      id: string;
      roomId: string;
      joinCode: string;
      mySeat: number;
      rulesetCode: string;
    }>();
    expect(createdTable.rulesetCode).toBe('ar-corto-15-v1');
    expect(createdTable.joinCode).toHaveLength(6);
    expect(createdTable.mySeat).toBe(0);

    // 5. P1 invita a su amigo a la mesa privada y P2 acepta una única invitación.
    const tableInvitation = await apiApp.inject({
      method: 'POST',
      url: '/v1/social/table-invitations',
      headers: { cookie: p1Cookie },
      payload: { recipientUserId: p2User.id, tableId: createdTable.id },
    });
    expect(tableInvitation.statusCode).toBe(201);
    const joinRes = await apiApp.inject({
      method: 'POST',
      url: `/v1/social/invitations/${tableInvitation.json<{ invitationId: string }>().invitationId}/accept`,
      headers: { cookie: p2Cookie },
    });
    expect(joinRes.statusCode).toBe(200);
    expect(joinRes.json<{ kind: string }>().kind).toBe('TABLE');
    const joinedTable = joinRes.json<{ table: { id: string; roomId: string; mySeat: number } }>()
      .table;
    expect(joinedTable.id).toBe(createdTable.id);
    expect(joinedTable.mySeat).toBe(1);

    // 6. Ambos emiten ws-ticket efímero en apps/api y conectan a apps/game-server real
    const t1Res = await apiApp.inject({
      method: 'POST',
      url: '/v1/auth/ws-ticket',
      headers: { cookie: p1Cookie },
    });
    const t2Res = await apiApp.inject({
      method: 'POST',
      url: '/v1/auth/ws-ticket',
      headers: { cookie: p2Cookie },
    });
    const ticket1 = t1Res.json<{ ticket: string }>().ticket;
    const ticket2 = t2Res.json<{ ticket: string }>().ticket;

    const wsP1 = new RealGameWsPlayer(0);
    const wsP2 = new RealGameWsPlayer(1);
    await wsP1.connect(gameServerUrl, ticket1);
    await wsP2.connect(gameServerUrl, ticket2);

    const presenceStore = apiApp.get(USER_PRESENCE_STORE);
    const presenceSocketId = 'full-match-e2e-social-p2';
    await presenceStore.connect(p2User.id, presenceSocketId, Date.now(), 45_000);
    const presenceSpy = vi
      .spyOn(apiApp.get(LobbyRealtimeGateway), 'emitSocialPresence')
      .mockImplementation(() => undefined);
    const sawPresenceForP1 = (status: 'IN_GAME' | 'ONLINE') =>
      presenceSpy.mock.calls.some(
        ([recipientId, event]) =>
          recipientId === p1User.id &&
          event.userId === p2User.id &&
          event.status === status &&
          event.visible,
      );

    try {
      wsP1.send('table.join', { roomId: createdTable.roomId, preferredSeat: 0 });
      await wsP1.waitFor((e) => e.type === 'table.state', 'table.state P1');

      wsP2.send('table.join', { roomId: createdTable.roomId, preferredSeat: 1 });
      await wsP2.waitFor((e) => e.type === 'table.state', 'table.state P2');

      wsP1.send('table.ready', { roomId: createdTable.roomId, ready: true });
      wsP2.send('table.ready', { roomId: createdTable.roomId, ready: true });

      const gameStarted = await wsP1.waitFor((e) => e.type === 'game.started', 'game.started');
      expect(gameStarted.payload['targetScore']).toBe(15);

      // Esperar propagación de match.started -> DELETE /v1/tables/:id debe rechazarse una vez iniciada la partida
      const startDeadline = Date.now() + 3_000;
      while (Date.now() < startDeadline) {
        const row = await dbHandle.db
          .select({ status: tablesTable.status })
          .from(tablesTable)
          .where(eq(tablesTable.id, createdTable.id));
        if (row[0]?.status === 'IN_GAME') break;
        await new Promise((r) => setTimeout(r, 25));
      }

      const presenceStartDeadline = Date.now() + 3_000;
      while (!sawPresenceForP1('IN_GAME') && Date.now() < presenceStartDeadline) {
        await new Promise((r) => setTimeout(r, 25));
      }
      expect(sawPresenceForP1('IN_GAME')).toBe(true);
      const friendsDuringMatch = await apiApp.inject({
        method: 'GET',
        url: '/v1/social/friends',
        headers: { cookie: p1Cookie },
      });
      expect(
        friendsDuringMatch
          .json<{ items: Array<{ userId: string; presence: string | null }> }>()
          .items.find((friend) => friend.userId === p2User.id)?.presence,
      ).toBe('IN_GAME');

      const deleteAfterStart = await apiApp.inject({
        method: 'DELETE',
        url: `/v1/tables/${createdTable.id}`,
        headers: { cookie: p1Cookie },
      });
      expect(deleteAfterStart.statusCode).toBe(409);

      // 7. Jugar la partida humana completa hasta llegar a 15 puntos
      await playCompleteMatch(createdTable.roomId, [wsP1, wsP2]);
      const endedEnv = await wsP1.waitFor((e) => e.type === 'game.ended', 'game.ended');
      const winnerTeam = endedEnv.payload['winnerTeam'] as 0 | 1;
      expect([0, 1]).toContain(winnerTeam);

      // 8. Verificar persistencia, XP, logro y misión tras match.completed (BullMQ en CI).
      const persistDeadline = Date.now() + 5_000;
      let persistedMatches = await dbHandle.db
        .select()
        .from(matchesTable)
        .where(eq(matchesTable.tableId, createdTable.id));

      while (persistedMatches.length === 0 && Date.now() < persistDeadline) {
        await new Promise((r) => setTimeout(r, 30));
        persistedMatches = await dbHandle.db
          .select()
          .from(matchesTable)
          .where(eq(matchesTable.tableId, createdTable.id));
      }

      expect(persistedMatches).toHaveLength(1);
      const matchRow = persistedMatches[0]!;
      expect(matchRow.rulesetCode).toBe('ar-corto-15-v1');
      expect(matchRow.endedAt).not.toBeNull();
      expect(matchRow.seedCommitment).toMatch(/^[a-f0-9]{64}$/);
      expect(matchRow.result).toMatchObject({
        winnerTeam,
      });

      const persistedPlayers = await dbHandle.db
        .select()
        .from(matchPlayersTable)
        .where(eq(matchPlayersTable.matchId, matchRow.id))
        .orderBy(asc(matchPlayersTable.seat));
      expect(persistedPlayers).toHaveLength(2);
      expect(
        Math.max(persistedPlayers[0]!.score, persistedPlayers[1]!.score),
      ).toBeGreaterThanOrEqual(15);
      expect(persistedPlayers[0]).toMatchObject({
        userId: p1User.id,
        seat: 0,
        team: 0,
        outcome: winnerTeam === 0 ? 'WIN' : 'LOSS',
      });
      expect(persistedPlayers[1]).toMatchObject({
        userId: p2User.id,
        seat: 1,
        team: 1,
        outcome: winnerTeam === 1 ? 'WIN' : 'LOSS',
      });

      const persistedEvents = await dbHandle.db
        .select()
        .from(matchEventsTable)
        .where(eq(matchEventsTable.matchId, matchRow.id))
        .orderBy(asc(matchEventsTable.seq));
      expect(persistedEvents.length).toBeGreaterThan(3);
      expect(persistedEvents[0]!.type).toBe('game.started');
      for (let i = 1; i < persistedEvents.length; i++) {
        expect(persistedEvents[i]!.seq).toBeGreaterThan(persistedEvents[i - 1]!.seq);
      }
      expect(persistedEvents[persistedEvents.length - 1]!.type).toBe('game.ended');

      // La mesa pasa a FINISHED y libera el candado de 1 mesa activa por cuenta
      const finalTable = await dbHandle.db
        .select()
        .from(tablesTable)
        .where(eq(tablesTable.id, createdTable.id));
      expect(finalTable[0]!.status).toBe('FINISHED');
      const presenceEndDeadline = Date.now() + 3_000;
      while (!sawPresenceForP1('ONLINE') && Date.now() < presenceEndDeadline) {
        await new Promise((r) => setTimeout(r, 25));
      }
      expect(sawPresenceForP1('ONLINE')).toBe(true);

      const remainingActiveSeats = await dbHandle.db
        .select()
        .from(tableSeatsTable)
        .where(eq(tableSeatsTable.tableId, createdTable.id));
      expect(remainingActiveSeats.every((s) => s.isActive === false)).toBe(true);

      // Las estadísticas públicas y el historial de partidas reflejan la partida persistida
      const winnerUserId = winnerTeam === 0 ? p1User.id : p2User.id;
      const winnerCookie = winnerUserId === p1User.id ? p1Cookie : p2Cookie;
      const statsRes = await apiApp.inject({
        method: 'GET',
        url: `/v1/users/${winnerUserId}/stats`,
        headers: { cookie: winnerCookie },
      });
      expect(statsRes.statusCode).toBe(200);
      expect(statsRes.json<{ matchesPlayed: number; wins: number }>()).toMatchObject({
        matchesPlayed: 1,
        wins: 1,
      });

      // La partida real atravesó match.completed y la progresión server-side: XP, logro y misión.
      const progressionDeadline = Date.now() + 5_000;
      let winnerProgression:
        | {
            xpTotal: number;
            achievements: Array<{ id: string; unlockedAt: string | null }>;
            missions: Array<{ templateId: string; progress: number }>;
          }
        | undefined;
      while (Date.now() < progressionDeadline) {
        const progressionResponse = await apiApp.inject({
          method: 'GET',
          url: '/v1/me/progression',
          headers: { cookie: winnerCookie },
        });
        expect(progressionResponse.statusCode).toBe(200);
        winnerProgression = progressionResponse.json<{
          xpTotal: number;
          achievements: Array<{ id: string; unlockedAt: string | null }>;
          missions: Array<{ templateId: string; progress: number }>;
        }>();
        const firstMatchUnlocked = winnerProgression.achievements.some(
          (achievement) => achievement.id === 'first_match' && achievement.unlockedAt !== null,
        );
        const dailyMatchAdvanced = winnerProgression.missions.some(
          (mission) => mission.templateId === 'daily_play_match' && mission.progress >= 1,
        );
        if (winnerProgression.xpTotal > 0 && firstMatchUnlocked && dailyMatchAdvanced) break;
        await new Promise((resolve) => setTimeout(resolve, 30));
      }
      expect(winnerProgression?.xpTotal).toBeGreaterThan(0);
      expect(
        winnerProgression?.achievements.some(
          (achievement) => achievement.id === 'first_match' && achievement.unlockedAt !== null,
        ),
      ).toBe(true);
      expect(
        winnerProgression?.missions.some(
          (mission) => mission.templateId === 'daily_play_match' && mission.progress >= 1,
        ),
      ).toBe(true);

      const reportResponse = await apiApp.inject({
        method: 'POST',
        url: '/v1/me/reports',
        headers: { cookie: p1Cookie },
        payload: {
          targetUserId: p2User.id,
          reasonCode: 'ABUSIVE_BEHAVIOR',
          details: 'Reporte de verificación del flujo integrado.',
          matchId: matchRow.id,
        },
      });
      expect(reportResponse.statusCode).toBe(201);
      const report = reportResponse.json<{
        status: string;
        mergedWithExisting: boolean;
        eventLogRef: {
          matchId: string;
          eventCount: number;
          lastSeq: number;
          digest: string;
        } | null;
      }>();
      expect(report).toMatchObject({ status: 'OPEN', mergedWithExisting: false });
      expect(report.eventLogRef).toMatchObject({
        matchId: matchRow.id,
        eventCount: persistedEvents.length,
        lastSeq: persistedEvents[persistedEvents.length - 1]!.seq,
      });
      expect(report.eventLogRef?.digest).toMatch(/^[a-f0-9]{64}$/);
    } finally {
      presenceSpy.mockRestore();
      await presenceStore.disconnect(p2User.id, presenceSocketId, Date.now());
      wsP1.disconnect();
      wsP2.disconnect();
    }

    // 10. La misma pareja termina una partida competitiva y aparece en el ranking público.
    await playCompetitiveMatch([
      { userId: p1User.id, cookie: p1Cookie },
      { userId: p2User.id, cookie: p2Cookie },
    ]);
  }, 180_000);

  it('matches competitively, plays a complete real game, and updates both player ratings and the public Redis-backed leaderboard', async () => {
    const p1 = await createGuest('M9b-Cola-Competitiva-A');
    const p2 = await createGuest('M9b-Cola-Competitiva-B');
    await playCompetitiveMatch([
      { userId: p1.user.id, cookie: p1.cookie },
      { userId: p2.user.id, cookie: p2.cookie },
    ]);
  }, 180_000);
});
