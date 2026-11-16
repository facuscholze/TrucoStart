import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { LOBBY_WS_NAMESPACE } from '@truco/shared';
import { io as createSocketClient, type Socket as ClientSocket } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApiApp } from '../../../bootstrap.js';
import {
  createAdaptiveTestDatabase,
  type DatabaseConnectionHandle,
} from '../../../db/database.provider.js';
import { buildCookieHeader, extractAuthCookies } from '../../auth/tests/test-cookie-jar.js';
import type { LobbyWsMatchFoundEvent } from '../../lobby/lobby-realtime.gateway.js';
import { InMemoryGameRoomProvisioner } from '../../lobby/ports/game-room-provisioner.js';

const TEST_SECRET = 'm4-matchmaking-secret-minimum-32-characters!!';

async function createGuest(app: NestFastifyApplication, deviceName: string) {
  const res = await app.inject({
    method: 'POST',
    url: '/v1/auth/guest',
    payload: { deviceName },
  });
  expect(res.statusCode).toBe(201);
  const cookieHeader = buildCookieHeader(extractAuthCookies(res.headers['set-cookie']).map);
  return { cookieHeader, user: res.json<{ user: { id: string; nickname: string } }>().user };
}

describe('M4 Matchmaking Queue (1v1, 2v2, WS Notification, Timeout & Cancellation)', () => {
  let dbHandle: DatabaseConnectionHandle;
  let app: NestFastifyApplication;
  let provisioner: InMemoryGameRoomProvisioner;
  let baseUrl: string;
  let fakeNowMs = 1_800_100_000_000;

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
          matchmakingTimeoutMs: 15_000,
          cleanupIntervalMs: 0,
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

  it('pairs 2 players in 1v1, provisions game-server room, and pushes matchmaking.matched to waiting client', async () => {
    const p1 = await createGuest(app, 'ColaUnoA');
    const p2 = await createGuest(app, 'ColaUnoB');

    const ticketRes = await app.inject({
      method: 'POST',
      url: '/v1/auth/ws-ticket',
      headers: { cookie: p1.cookieHeader },
    });
    const p1Ticket = ticketRes.json<{ ticket: string }>().ticket;

    const p1Socket: ClientSocket = createSocketClient(`${baseUrl}${LOBBY_WS_NAMESPACE}`, {
      auth: { token: p1Ticket },
      transports: ['websocket'],
      reconnection: false,
    });

    await new Promise<void>((resolve, reject) => {
      p1Socket.once('connect', () => resolve());
      p1Socket.once('connect_error', reject);
    });

    const p1MatchedNotification = new Promise<LobbyWsMatchFoundEvent>((resolve) => {
      p1Socket.once('matchmaking.matched', (ev: LobbyWsMatchFoundEvent) => resolve(ev));
    });

    try {
      const q1 = await app.inject({
        method: 'POST',
        url: '/v1/matchmaking/queue',
        headers: { cookie: p1.cookieHeader },
        payload: { mode: '1v1', rulesetCode: 'ar-corto-15-v1' },
      });
      expect(q1.statusCode).toBe(200);
      expect(q1.json<{ status: string; position: number }>()).toMatchObject({
        status: 'QUEUED',
        position: 1,
      });

      const q2 = await app.inject({
        method: 'POST',
        url: '/v1/matchmaking/queue',
        headers: { cookie: p2.cookieHeader },
        payload: { mode: '1v1', rulesetCode: 'ar-corto-15-v1' },
      });
      expect(q2.statusCode).toBe(201);
      const matchedBody = q2.json<{
        status: string;
        tableId: string;
        mySeat: number;
        myTeam: number;
      }>();
      expect(matchedBody.status).toBe('MATCHED');
      expect(matchedBody.mySeat).toBe(1);
      expect(matchedBody.myTeam).toBe(1);

      const pushed = await p1MatchedNotification;
      expect(pushed.tableId).toBe(matchedBody.tableId);
      expect(pushed.seat).toBe(0);
      expect(pushed.team).toBe(0);

      const pollP1 = await app.inject({
        method: 'GET',
        url: '/v1/matchmaking/queue',
        headers: { cookie: p1.cookieHeader },
      });
      expect(pollP1.json<{ status: string; tableId: string }>()).toMatchObject({
        status: 'MATCHED',
        tableId: matchedBody.tableId,
      });

      expect(provisioner.getProvisionedRoom(matchedBody.tableId)).toMatchObject({
        roomId: matchedBody.tableId,
        mode: '1v1',
        rulesetCode: 'ar-corto-15-v1',
        targetScore: 15,
      });
    } finally {
      p1Socket.disconnect();
    }
  });

  it('pairs 4 players in 2v2 with alternating teams, handles timeout expiration, and cancels safely', async () => {
    const stalePlayer = await createGuest(app, 'ColaExpirada');
    const canceller = await createGuest(app, 'ColaCancela');
    const quartet = await Promise.all(
      Array.from({ length: 4 }, (_, i) => createGuest(app, `CuartetoMM${i + 1}`)),
    );

    const staleRes = await app.inject({
      method: 'POST',
      url: '/v1/matchmaking/queue',
      headers: { cookie: stalePlayer.cookieHeader },
      payload: { mode: '1v1' },
    });
    expect(staleRes.statusCode).toBe(200);

    fakeNowMs += 20_000;
    const staleStatus = await app.inject({
      method: 'GET',
      url: '/v1/matchmaking/queue',
      headers: { cookie: stalePlayer.cookieHeader },
    });
    expect(staleStatus.json<{ status: string }>().status).toBe('IDLE');

    await app.inject({
      method: 'POST',
      url: '/v1/matchmaking/queue',
      headers: { cookie: canceller.cookieHeader },
      payload: { mode: '1v1' },
    });
    const del1 = await app.inject({
      method: 'DELETE',
      url: '/v1/matchmaking/queue',
      headers: { cookie: canceller.cookieHeader },
    });
    expect(del1.json<{ cancelled: boolean }>().cancelled).toBe(true);

    const del2 = await app.inject({
      method: 'DELETE',
      url: '/v1/matchmaking/queue',
      headers: { cookie: canceller.cookieHeader },
    });
    expect(del2.json<{ cancelled: boolean }>().cancelled).toBe(false);

    for (let i = 0; i < 3; i++) {
      const r = await app.inject({
        method: 'POST',
        url: '/v1/matchmaking/queue',
        headers: { cookie: quartet[i]!.cookieHeader },
        payload: { mode: '2v2', rulesetCode: 'ar-standard-v1' },
      });
      expect(r.statusCode).toBe(200);
      expect(r.json<{ position: number }>().position).toBe(i + 1);
    }

    const fourthRes = await app.inject({
      method: 'POST',
      url: '/v1/matchmaking/queue',
      headers: { cookie: quartet[3]!.cookieHeader },
      payload: { mode: '2v2', rulesetCode: 'ar-standard-v1' },
    });
    expect(fourthRes.statusCode).toBe(201);
    const match2v2 = fourthRes.json<{ tableId: string; mySeat: number; myTeam: number }>();
    expect(match2v2.mySeat).toBe(3);
    expect(match2v2.myTeam).toBe(1);

    const tableDetailRes = await app.inject({
      method: 'GET',
      url: `/v1/tables/${match2v2.tableId}`,
      headers: { cookie: quartet[0]!.cookieHeader },
    });
    expect(tableDetailRes.statusCode).toBe(200);
    const seats = tableDetailRes.json<{
      seats: Array<{ seat: number; team: number; occupied: boolean }>;
    }>().seats;
    expect(seats).toEqual([
      expect.objectContaining({ seat: 0, team: 0, occupied: true }),
      expect.objectContaining({ seat: 1, team: 1, occupied: true }),
      expect.objectContaining({ seat: 2, team: 0, occupied: true }),
      expect.objectContaining({ seat: 3, team: 1, occupied: true }),
    ]);
  });
});
