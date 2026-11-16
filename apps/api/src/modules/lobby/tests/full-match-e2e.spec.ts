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
import { asc, eq } from 'drizzle-orm';
import { io as createSocketClient, type Socket as ClientSocket } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApiApp } from '../../../bootstrap.js';
import {
  createAdaptiveTestDatabase,
  type DatabaseConnectionHandle,
} from '../../../db/database.provider.js';
import {
  matchEventsTable,
  matchesTable,
  matchPlayersTable,
  tableSeatsTable,
  tablesTable,
} from '../../../db/schema/index.js';
import { buildCookieHeader, extractAuthCookies } from '../../auth/tests/test-cookie-jar.js';
import { HttpGameRoomProvisioner } from '../ports/game-room-provisioner.js';
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
    const action = chooseBotAction(actor.latestView!);
    if (action.type === 'PLAY_CARD') {
      actor.send('game.playCard', { roomId, cardId: action.cardId });
    } else if (action.type === 'FOLD_HAND') {
      actor.send('game.foldHand', { roomId });
    } else if (
      action.type === 'CALL_TRUCO' ||
      action.type === 'CALL_ENVIDO' ||
      action.type === 'CALL_FLOR'
    ) {
      actor.send('game.call', { roomId, type: action.bid });
    } else if (action.type === 'RESPOND_TRUCO') {
      actor.send('game.respond', { roomId, call: 'TRUCO', answer: action.decision });
    } else if (action.type === 'RESPOND_ENVIDO') {
      actor.send('game.respond', { roomId, call: 'ENVIDO', answer: action.decision });
    } else if (action.type === 'RESPOND_FLOR') {
      actor.send('game.respond', { roomId, call: 'FLOR', answer: action.decision });
    } else {
      actor.send('game.foldHand', { roomId });
    }

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
      lobbyOptions: {
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

  it('creates private table in apps/api, joins by 6-char code, plays full match on real apps/game-server, and persists matches + match_players + match_events atomically in PostgreSQL', async () => {
    // 1. Autenticar dos clientes reales en apps/api
    const p1Auth = await apiApp.inject({
      method: 'POST',
      url: '/v1/auth/guest',
      payload: { deviceName: 'Cliente1-E2E' },
    });
    expect(p1Auth.statusCode).toBe(201);
    const p1Cookie = buildCookieHeader(extractAuthCookies(p1Auth.headers['set-cookie']).map);
    const p1User = p1Auth.json<{ user: { id: string; nickname: string } }>().user;

    const p2Auth = await apiApp.inject({
      method: 'POST',
      url: '/v1/auth/guest',
      payload: { deviceName: 'Cliente2-E2E' },
    });
    expect(p2Auth.statusCode).toBe(201);
    const p2Cookie = buildCookieHeader(extractAuthCookies(p2Auth.headers['set-cookie']).map);
    const p2User = p2Auth.json<{ user: { id: string; nickname: string } }>().user;

    // 2. P1 crea mesa privada a 15 puntos sin flor -> apps/api aprovisiona sala en apps/game-server vía HTTP HMAC firmado
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

    // 3. P2 se une usando el código de 6 caracteres (POST /v1/tables/join-by-code)
    const joinRes = await apiApp.inject({
      method: 'POST',
      url: '/v1/tables/join-by-code',
      headers: { cookie: p2Cookie },
      payload: { code: createdTable.joinCode },
    });
    expect(joinRes.statusCode).toBe(200);
    const joinedTable = joinRes.json<{ id: string; roomId: string; mySeat: number }>();
    expect(joinedTable.id).toBe(createdTable.id);
    expect(joinedTable.mySeat).toBe(1);

    // 4. Ambos emiten ws-ticket efímero en apps/api y conectan a apps/game-server real
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

      const deleteAfterStart = await apiApp.inject({
        method: 'DELETE',
        url: `/v1/tables/${createdTable.id}`,
        headers: { cookie: p1Cookie },
      });
      expect(deleteAfterStart.statusCode).toBe(409);

      // 5. Jugar la partida completa hasta llegar a 15 puntos
      await playCompleteMatch(createdTable.roomId, [wsP1, wsP2]);
      const endedEnv = await wsP1.waitFor((e) => e.type === 'game.ended', 'game.ended');
      const winnerTeam = endedEnv.payload['winnerTeam'] as 0 | 1;
      expect([0, 1]).toContain(winnerTeam);

      // 6. Esperar consumo asíncrono de match.completed (BullMQ en CI / InMemory localmente) y verificar persistencia transaccional en PostgreSQL
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

      const remainingActiveSeats = await dbHandle.db
        .select()
        .from(tableSeatsTable)
        .where(eq(tableSeatsTable.tableId, createdTable.id));
      expect(remainingActiveSeats.every((s) => s.isActive === false)).toBe(true);

      // Las estadísticas públicas y el historial de partidas reflejan la partida persistida
      const winnerUserId = winnerTeam === 0 ? p1User.id : p2User.id;
      const statsRes = await apiApp.inject({
        method: 'GET',
        url: `/v1/users/${winnerUserId}/stats`,
      });
      expect(statsRes.statusCode).toBe(200);
      expect(statsRes.json<{ matchesPlayed: number; wins: number }>()).toMatchObject({
        matchesPlayed: 1,
        wins: 1,
      });
    } finally {
      wsP1.disconnect();
      wsP2.disconnect();
    }
  }, 25_000);
});
