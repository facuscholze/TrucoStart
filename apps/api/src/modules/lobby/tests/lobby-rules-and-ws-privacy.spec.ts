import { randomUUID } from 'node:crypto';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { LOBBY_WS_NAMESPACE, type PublicLobbyTableSummary } from '@truco/shared';
import { io as createSocketClient, type Socket as ClientSocket } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApiApp } from '../../../bootstrap.js';
import {
  createAdaptiveTestDatabase,
  type DatabaseConnectionHandle,
} from '../../../db/database.provider.js';
import { buildCookieHeader, extractAuthCookies } from '../../auth/tests/test-cookie-jar.js';
import { LobbyRealtimeGateway } from '../lobby-realtime.gateway.js';
import { USER_PRESENCE_STORE } from '../../social/presence-store.interface.js';
import { LobbyService } from '../lobby.service.js';
import { InMemoryGameRoomProvisioner } from '../ports/game-room-provisioner.js';

const TEST_SECRET = 'm4-lobby-test-secret-minimum-32-characters!!';

async function createGuestSession(app: NestFastifyApplication, deviceName: string) {
  const res = await app.inject({
    method: 'POST',
    url: '/v1/auth/guest',
    payload: { deviceName },
  });
  expect(res.statusCode).toBe(201);
  const cookieHeader = buildCookieHeader(extractAuthCookies(res.headers['set-cookie']).map);
  const body = res.json<{ user: { id: string; nickname: string } }>();
  return { cookieHeader, user: body.user };
}

async function issueWsTicket(app: NestFastifyApplication, cookieHeader: string): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/v1/auth/ws-ticket',
    headers: { cookie: cookieHeader },
  });
  expect(res.statusCode).toBe(200);
  return res.json<{ ticket: string }>().ticket;
}

describe('M4 Lobby REST, Concurrency, Integrity Rules & /lobby WS Zero-Leakage', () => {
  let dbHandle: DatabaseConnectionHandle;
  let app: NestFastifyApplication;
  let provisioner: InMemoryGameRoomProvisioner;
  let baseUrl: string;
  let fakeNowMs = 1_800_000_000_000;

  beforeAll(async () => {
    dbHandle = await createAdaptiveTestDatabase();
    provisioner = new InMemoryGameRoomProvisioner();
    app = await createApiApp({
      dbHandle,
      authOptions: {
        runtimeConfig: {
          sessionSecret: TEST_SECRET,
          nowFn: () => fakeNowMs,
        },
        rateLimitConfig: {
          maxPerIp: 200,
          maxPerAccount: 200,
          nowFn: () => fakeNowMs,
        },
      },
      lobbyOptions: {
        gameRoomProvisioner: provisioner,
        runtimeConfig: {
          sessionSecret: TEST_SECRET,
          internalSecret: TEST_SECRET,
          tableTtlMs: 30_000,
          inviteTtlMs: 10_000,
          cleanupIntervalMs: 0,
          joinCodeAccountMax: 3,
          joinCodeIpMax: 50,
          joinCodeWindowMs: 60_000,
          nowFn: () => fakeNowMs,
        },
      },
    });
    await app.listen(0, '127.0.0.1');
    const addr = app.getHttpServer().address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    await app.close();
    await dbHandle.close();
  });

  it('guarantees private tables are invisible on REST and /lobby WS, and /lobby WS emits zero private player fields', async () => {
    const observer = await createGuestSession(app, 'ObservadorWS');
    const privOwner = await createGuestSession(app, 'DuenoPrivado');
    const privGuest = await createGuestSession(app, 'InvitadoPriv');
    const pubOwner = await createGuestSession(app, 'DuenoPublico');

    // Conexión sin credenciales a /lobby debe ser rechazada
    await expect(
      new Promise<void>((resolve, reject) => {
        const unauth = createSocketClient(`${baseUrl}${LOBBY_WS_NAMESPACE}`, {
          transports: ['websocket'],
          reconnection: false,
        });
        unauth.on('connect', () => {
          unauth.disconnect();
          resolve();
        });
        unauth.on('connect_error', (err) => {
          unauth.disconnect();
          reject(err);
        });
      }),
    ).rejects.toThrow(/UNAUTHORIZED/);

    // Conectar observador autenticado a /lobby con ws-ticket single-use
    const ticket = await issueWsTicket(app, observer.cookieHeader);
    const upserts: Array<{ table: PublicLobbyTableSummary }> = [];
    const removals: Array<{ tableId: string }> = [];

    const wsObserver: ClientSocket = createSocketClient(`${baseUrl}${LOBBY_WS_NAMESPACE}`, {
      auth: { token: ticket },
      transports: ['websocket'],
      reconnection: false,
    });

    const initialSnapshot = await new Promise<{ tables: PublicLobbyTableSummary[] }>(
      (resolve, reject) => {
        wsObserver.once('lobby.snapshot', (snap: { tables: PublicLobbyTableSummary[] }) =>
          resolve(snap),
        );
        wsObserver.once('connect_error', reject);
      },
    );
    expect(Array.isArray(initialSnapshot.tables)).toBe(true);

    wsObserver.on('lobby.tableUpsert', (ev: { table: PublicLobbyTableSummary }) =>
      upserts.push(ev),
    );
    wsObserver.on('lobby.tableRemoved', (ev: { tableId: string }) => removals.push(ev));

    try {
      // 1. Crear mesa PRIVADA (15 pts con flor -> ar-corto-15-flor-v1)
      const createPrivRes = await app.inject({
        method: 'POST',
        url: '/v1/tables',
        headers: { cookie: privOwner.cookieHeader },
        payload: {
          mode: '1v1',
          visibility: 'PRIVATE',
          targetScore: 15,
          flor: true,
          turnTimeoutMs: 20_000,
        },
      });
      expect(createPrivRes.statusCode).toBe(201);
      const privTable = createPrivRes.json<{
        id: string;
        joinCode: string;
        rulesetCode: string;
      }>();
      expect(privTable.rulesetCode).toBe('ar-corto-15-flor-v1');
      expect(privTable.joinCode).toHaveLength(6);

      // Contrato con game-server: sala aprovisionada con idénticos parámetros
      expect(provisioner.getProvisionedRoom(privTable.id)).toMatchObject({
        roomId: privTable.id,
        mode: '1v1',
        rulesetCode: 'ar-corto-15-flor-v1',
        targetScore: 15,
        florEnabled: true,
        visibility: 'PRIVATE',
        turnTimeoutMs: 20_000,
      });

      // GET /v1/tables jamás incluye la mesa privada
      const listRes = await app.inject({ method: 'GET', url: '/v1/tables' });
      expect(listRes.statusCode).toBe(200);
      const listedIds = listRes.json<{ tables: Array<{ id: string }> }>().tables.map((t) => t.id);
      expect(listedIds).not.toContain(privTable.id);

      // Tercero ajeno recibe 404 en GET /v1/tables/:id y 403 en POST /v1/tables/:id/join
      const snooperGet = await app.inject({
        method: 'GET',
        url: `/v1/tables/${privTable.id}`,
        headers: { cookie: observer.cookieHeader },
      });
      expect(snooperGet.statusCode).toBe(404);

      const snooperJoin = await app.inject({
        method: 'POST',
        url: `/v1/tables/${privTable.id}/join`,
        headers: { cookie: observer.cookieHeader },
        payload: {},
      });
      expect(snooperJoin.statusCode).toBe(403);

      // Enlace firmado de invitación con expiración funciona antes de vencer
      const inviteRes = await app.inject({
        method: 'POST',
        url: `/v1/tables/${privTable.id}/invite`,
        headers: { cookie: privOwner.cookieHeader },
      });
      expect(inviteRes.statusCode).toBe(201);
      const { inviteToken } = inviteRes.json<{ inviteToken: string }>();

      const joinInviteRes = await app.inject({
        method: 'POST',
        url: '/v1/tables/join-by-code',
        headers: { cookie: privGuest.cookieHeader },
        payload: { inviteToken },
      });
      expect(joinInviteRes.statusCode).toBe(200);

      // Cerrar mesa privada (solo dueño puede cerrar)
      const nonOwnerDel = await app.inject({
        method: 'DELETE',
        url: `/v1/tables/${privTable.id}`,
        headers: { cookie: privGuest.cookieHeader },
      });
      expect(nonOwnerDel.statusCode).toBe(403);

      const ownerDel = await app.inject({
        method: 'DELETE',
        url: `/v1/tables/${privTable.id}`,
        headers: { cookie: privOwner.cookieHeader },
      });
      expect(ownerDel.statusCode).toBe(200);

      // 2. Crear mesa PÚBLICA para comprobar que /lobby WS SÍ recibe la pública sin ningún dato privado
      const upsertPromise = new Promise<{ table: PublicLobbyTableSummary }>((resolve) => {
        wsObserver.once('lobby.tableUpsert', (ev: { table: PublicLobbyTableSummary }) =>
          resolve(ev),
        );
      });

      const createPubRes = await app.inject({
        method: 'POST',
        url: '/v1/tables',
        headers: { cookie: pubOwner.cookieHeader },
        payload: {
          mode: '2v2',
          visibility: 'PUBLIC',
          targetScore: 30,
          flor: false,
        },
      });
      expect(createPubRes.statusCode).toBe(201);
      const pubTable = createPubRes.json<{ id: string }>();

      const pubUpsert = await upsertPromise;
      expect(pubUpsert.table.id).toBe(pubTable.id);

      // Ningún evento emitido en /lobby perteneció jamás a la mesa privada
      expect(upserts.some((e) => e.table.id === privTable.id)).toBe(false);
      expect(removals.some((e) => e.tableId === privTable.id)).toBe(false);

      // Cero filtración de userId, ownerId, email, sessionId, joinCode o inviteToken en el payload WS público
      const serialized = JSON.stringify(pubUpsert);
      expect(serialized).not.toContain(pubOwner.user.id);
      expect(serialized).not.toContain('joinCode');
      expect(serialized).not.toContain('inviteToken');
      expect(serialized).not.toContain('ownerId');

      // Filtrado en GET /v1/tables por mode, targetScore y flor
      const filteredMatch = await app.inject({
        method: 'GET',
        url: '/v1/tables?mode=2v2&targetScore=30&flor=false&status=WAITING',
      });
      expect(filteredMatch.statusCode).toBe(200);
      expect(
        filteredMatch
          .json<{ tables: Array<{ id: string }> }>()
          .tables.some((t) => t.id === pubTable.id),
      ).toBe(true);

      const filteredMiss = await app.inject({
        method: 'GET',
        url: '/v1/tables?mode=2v2&flor=true',
      });
      expect(
        filteredMiss
          .json<{ tables: Array<{ id: string }> }>()
          .tables.some((t) => t.id === pubTable.id),
      ).toBe(false);

      await app.inject({
        method: 'DELETE',
        url: `/v1/tables/${pubTable.id}`,
        headers: { cookie: pubOwner.cookieHeader },
      });
    } finally {
      wsObserver.disconnect();
    }
  });

  it('serializes concurrent joins on a table with 1 remaining seat and enforces max 1 active table per account', async () => {
    const owner = await createGuestSession(app, 'HostConcurrencia');
    const contenders = await Promise.all(
      Array.from({ length: 5 }, (_, i) => createGuestSession(app, `Competidor${i + 1}`)),
    );

    const createRes = await app.inject({
      method: 'POST',
      url: '/v1/tables',
      headers: { cookie: owner.cookieHeader },
      payload: { mode: '1v1', visibility: 'PUBLIC' },
    });
    expect(createRes.statusCode).toBe(201);
    const tableId = createRes.json<{ id: string }>().id;

    // Límite de 1 mesa activa por cuenta
    const secondTableRes = await app.inject({
      method: 'POST',
      url: '/v1/tables',
      headers: { cookie: owner.cookieHeader },
      payload: { mode: '1v1', visibility: 'PRIVATE' },
    });
    expect(secondTableRes.statusCode).toBe(409);
    expect(secondTableRes.json<{ error: { code: string } }>().error.code).toBe('CONFLICT');

    // 5 clientes intentan ocupar simultáneamente el ÚNICO asiento restante (asiento 1)
    const results = await Promise.all(
      contenders.map((c) =>
        app.inject({
          method: 'POST',
          url: `/v1/tables/${tableId}/join`,
          headers: { cookie: c.cookieHeader },
          payload: {},
        }),
      ),
    );

    const winners = results.filter((r) => r.statusCode === 200);
    const losers = results.filter((r) => r.statusCode === 409);
    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(4);
    for (const loser of losers) {
      expect(loser.json<{ error: { code: string } }>().error.code).toBe('ROOM_FULL');
    }

    const detail = winners[0]!.json<{ occupiedSeats: number; maxSeats: number }>();
    expect(detail.occupiedSeats).toBe(2);
    expect(detail.maxSeats).toBe(2);

    await app.inject({
      method: 'DELETE',
      url: `/v1/tables/${tableId}`,
      headers: { cookie: owner.cookieHeader },
    });
  });

  it('transfers ownership deterministically on owner leave, expires inactive tables by TTL, and rate-limits join-by-code guessing', async () => {
    const owner = await createGuestSession(app, 'HostTransfer');
    const second = await createGuestSession(app, 'SegundoEnMesa');
    const guesser = await createGuestSession(app, 'AdivinadorCod');

    const createRes = await app.inject({
      method: 'POST',
      url: '/v1/tables',
      headers: { cookie: owner.cookieHeader },
      payload: { mode: '2v2', visibility: 'PUBLIC' },
    });
    const tableId = createRes.json<{ id: string }>().id;

    await app.inject({
      method: 'POST',
      url: `/v1/tables/${tableId}/join`,
      headers: { cookie: second.cookieHeader },
      payload: {},
    });

    // El dueño sale -> la propiedad pasa determinísticamente a `second`
    const leaveOwnerRes = await app.inject({
      method: 'POST',
      url: `/v1/tables/${tableId}/leave`,
      headers: { cookie: owner.cookieHeader },
    });
    expect(leaveOwnerRes.statusCode).toBe(200);
    const leavePayload = leaveOwnerRes.json<{
      left: boolean;
      tableStatus: string;
      newOwnerNickname: string;
    }>();
    expect(leavePayload.left).toBe(true);
    expect(leavePayload.tableStatus).toBe('WAITING');
    expect(leavePayload.newOwnerNickname).toBe(second.user.nickname);

    // Avanzar reloj más allá del TTL (30s) -> la mesa expira y libera asientos + sala en game-server
    fakeNowMs += 35_000;
    const lobbyService = app.get(LobbyService);
    const expiredCount = await lobbyService.sweepExpiredTables();
    expect(expiredCount).toBeGreaterThanOrEqual(1);
    expect(provisioner.getProvisionedRoom(tableId)).toBeUndefined();

    // `second` quedó liberado tras expirar la mesa y puede abrir una nueva
    const freshRes = await app.inject({
      method: 'POST',
      url: '/v1/tables',
      headers: { cookie: second.cookieHeader },
      payload: { mode: '1v1', visibility: 'PRIVATE' },
    });
    expect(freshRes.statusCode).toBe(201);
    const freshId = freshRes.json<{ id: string }>().id;
    const inviteRes = await app.inject({
      method: 'POST',
      url: `/v1/tables/${freshId}/invite`,
      headers: { cookie: second.cookieHeader },
    });
    const expiredTokenCandidate = inviteRes.json<{ inviteToken: string }>().inviteToken;

    // Avanzar 12s (inviteTtlMs=10s < tableTtlMs=30s) -> invitación firmada vence aunque la mesa siga activa
    fakeNowMs += 12_000;
    const expiredInviteJoin = await app.inject({
      method: 'POST',
      url: '/v1/tables/join-by-code',
      headers: { cookie: owner.cookieHeader },
      payload: { inviteToken: expiredTokenCandidate },
    });
    expect(expiredInviteJoin.statusCode).toBe(400);

    // Fuerza bruta sobre join-by-code (límite configurado: 3 intentos por cuenta; alfabeto válido sin 0/O/1/I)
    for (let i = 0; i < 3; i++) {
      const miss = await app.inject({
        method: 'POST',
        url: '/v1/tables/join-by-code',
        headers: { cookie: guesser.cookieHeader },
        payload: { code: 'ZZZZZZ' },
      });
      expect(miss.statusCode).toBe(404);
    }
    const throttled = await app.inject({
      method: 'POST',
      url: '/v1/tables/join-by-code',
      headers: { cookie: guesser.cookieHeader },
      payload: { code: 'ZZZZZZ' },
    });
    expect(throttled.statusCode).toBe(429);
    expect(throttled.json<{ error: { code: string } }>().error.code).toBe('RATE_LIMITED');

    await app.inject({
      method: 'DELETE',
      url: `/v1/tables/${freshId}`,
      headers: { cookie: second.cookieHeader },
    });
  });

  it('keeps social-only realtime sockets out of public snapshots and targets notifications to one user', async () => {
    const player = await createGuestSession(app, 'SocialRealtimeOnly');
    const otherPlayer = await createGuestSession(app, 'OtherSocialSocket');
    const publicObserver = await createGuestSession(app, 'PublicPresenceObserver');
    const ticket = await issueWsTicket(app, player.cookieHeader);
    const otherTicket = await issueWsTicket(app, otherPlayer.cookieHeader);
    const observerTicket = await issueWsTicket(app, publicObserver.cookieHeader);
    const socialSocket: ClientSocket = createSocketClient(`${baseUrl}${LOBBY_WS_NAMESPACE}`, {
      auth: { token: ticket, purpose: 'social' },
      transports: ['websocket'],
      reconnection: false,
    });
    const otherSocialSocket: ClientSocket = createSocketClient(`${baseUrl}${LOBBY_WS_NAMESPACE}`, {
      auth: { token: otherTicket, purpose: 'social' },
      transports: ['websocket'],
      reconnection: false,
    });
    const observerSocialSocket: ClientSocket = createSocketClient(
      `${baseUrl}${LOBBY_WS_NAMESPACE}`,
      {
        auth: { token: observerTicket, purpose: 'social' },
        transports: ['websocket'],
        reconnection: false,
      },
    );
    let receivedSnapshot = false;
    let receivedTableUpsert = false;
    let otherUserReceivedNotification = false;
    const blockedPresenceEvents: Array<{ userId: string; status: string; visible: boolean }> = [];
    const observerPresenceEvents: Array<{ userId: string; status: string; visible: boolean }> = [];
    socialSocket.on('lobby.snapshot', () => {
      receivedSnapshot = true;
    });
    socialSocket.on('lobby.tableUpsert', () => {
      receivedTableUpsert = true;
    });
    otherSocialSocket.on('social.notification', () => {
      otherUserReceivedNotification = true;
    });
    otherSocialSocket.on(
      'social.presence',
      (event: { userId: string; status: string; visible: boolean }) =>
        blockedPresenceEvents.push(event),
    );
    observerSocialSocket.on(
      'social.presence',
      (event: { userId: string; status: string; visible: boolean }) =>
        observerPresenceEvents.push(event),
    );

    try {
      await Promise.all(
        [socialSocket, otherSocialSocket, observerSocialSocket].map(
          (socket) =>
            new Promise<void>((resolve, reject) => {
              socket.once('connect', resolve);
              socket.once('connect_error', reject);
            }),
        ),
      );
      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(receivedSnapshot).toBe(false);

      const publicTable = await app.inject({
        method: 'POST',
        url: '/v1/tables',
        headers: { cookie: player.cookieHeader },
        payload: { mode: '1v1', visibility: 'PUBLIC' },
      });
      expect(publicTable.statusCode).toBe(201);
      expect(receivedTableUpsert).toBe(false);

      const notificationReceived = new Promise<unknown>((resolve) => {
        socialSocket.once('social.notification', resolve);
      });
      app.get(LobbyRealtimeGateway).emitSocialNotification(player.user.id, {
        id: randomUUID(),
        type: 'FRIEND_REQUEST',
        actorUserId: null,
        actorNickname: null,
        referenceId: null,
        tableId: null,
        createdAt: new Date().toISOString(),
        readAt: null,
      });
      expect(await notificationReceived).toMatchObject({ type: 'FRIEND_REQUEST' });
      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(otherUserReceivedNotification).toBe(false);

      const showPresenceToAll = await app.inject({
        method: 'PATCH',
        url: '/v1/me',
        headers: { cookie: player.cookieHeader },
        payload: { settings: { presenceVisibility: 'ALL' } },
      });
      expect(showPresenceToAll.statusCode).toBe(200);
      const blockPresence = await app.inject({
        method: 'POST',
        url: `/v1/social/blocks/${player.user.id}`,
        headers: { cookie: otherPlayer.cookieHeader },
      });
      expect(blockPresence.statusCode).toBe(200);
      const presenceStore = app.get(USER_PRESENCE_STORE);
      const presenceSocketId = 'social-presence-block-test';
      await presenceStore.connect(player.user.id, presenceSocketId, fakeNowMs, 45_000);
      blockedPresenceEvents.length = 0;
      observerPresenceEvents.length = 0;
      await app.get(LobbyRealtimeGateway).refreshSocialPresence([player.user.id]);
      await new Promise((resolve) => setTimeout(resolve, 30));
      // La limpieza puede enviar OFFLINE/visible:false para borrar una caché previa,
      // pero nunca un estado ONLINE/IN_GAME al bloqueador.
      expect(
        blockedPresenceEvents.every((event) => !event.visible && event.status === 'OFFLINE'),
      ).toBe(true);
      expect(observerPresenceEvents).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ userId: player.user.id, status: 'ONLINE', visible: true }),
        ]),
      );
    } finally {
      socialSocket.disconnect();
      otherSocialSocket.disconnect();
      observerSocialSocket.disconnect();
      await app
        .get(USER_PRESENCE_STORE)
        .disconnect(player.user.id, 'social-presence-block-test', fakeNowMs);
    }
  });
});
