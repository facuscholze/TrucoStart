import { randomUUID } from 'node:crypto';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createGameServer, type GameServerInstance } from '@truco/game-server';
import { ACCESS_COOKIE_NAME, signWsAuthTicket, type WsEnvelope } from '@truco/shared';
import { io as createSocketClient, type Socket as ClientSocket } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApiApp } from '../../../bootstrap.js';
import {
  createAdaptiveTestDatabase,
  type DatabaseConnectionHandle,
} from '../../../db/database.provider.js';
import { buildCookieHeader, extractAuthCookies } from './test-cookie-jar.js';

const SHARED_SESSION_SECRET = 'shared-m3-api-and-gameserver-secret-32chars!!';

function connectExpectingError(url: string, token?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const client = createSocketClient(url, {
      transports: ['websocket'],
      reconnection: false,
      ...(token !== undefined ? { auth: { token } } : {}),
    });
    const timer = setTimeout(() => {
      client.close();
      reject(new Error('Timeout esperando rechazo de handshake Socket.IO'));
    }, 5_000);

    client.on('connect', () => {
      clearTimeout(timer);
      client.close();
      reject(new Error('El socket conectó cuando debía ser rechazado'));
    });

    client.on('connect_error', (err) => {
      clearTimeout(timer);
      client.close();
      resolve(err.message);
    });
  });
}

function connectExpectingSuccess(url: string, token: string): Promise<ClientSocket> {
  return new Promise((resolve, reject) => {
    const socket = createSocketClient(url, {
      transports: ['websocket'],
      reconnection: false,
      auth: { token },
    });
    const timer = setTimeout(() => {
      socket.close();
      reject(new Error('Timeout esperando conexión Socket.IO con ticket válido'));
    }, 5_000);

    socket.once('connect', () => {
      clearTimeout(timer);
      resolve(socket);
    });

    socket.once('connect_error', (err) => {
      clearTimeout(timer);
      socket.close();
      reject(err);
    });
  });
}

describe('M3 Cross-Service Integration: apps/api POST /v1/auth/ws-ticket <-> apps/game-server Socket.IO', () => {
  let dbHandle: DatabaseConnectionHandle;
  let apiApp: NestFastifyApplication;
  let gameServer: GameServerInstance;
  let gameServerUrl: string;

  beforeAll(async () => {
    dbHandle = await createAdaptiveTestDatabase();
    apiApp = await createApiApp({
      dbHandle,
      authOptions: {
        runtimeConfig: {
          sessionSecret: SHARED_SESSION_SECRET,
        },
      },
    });
    await apiApp.init();

    gameServer = createGameServer({
      sessionSecret: SHARED_SESSION_SECRET,
      seedEncryptionKey: 'seed-encryption-key-for-m3-integration-32!!',
    });
    const port = await gameServer.listen(0, '127.0.0.1');
    gameServerUrl = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    await gameServer.close();
    await apiApp.close();
    await dbHandle.close();
  });

  it('rejects unauthenticated, forged, raw-cookie, and expired tickets, and accepts valid API-issued ws-ticket', async () => {
    // 1. Sin ticket -> rechazado en handshake
    expect(await connectExpectingError(gameServerUrl)).toBe('UNAUTHORIZED');

    // 2. Ticket falsificado -> rechazado
    expect(await connectExpectingError(gameServerUrl, 'forged.invalid-signature')).toBe(
      'UNAUTHORIZED',
    );

    // 3. Registrar usuario en apps/api y obtener cookies HttpOnly
    const reg = await apiApp.inject({
      method: 'POST',
      url: '/v1/auth/register',
      payload: {
        email: 'socket.player@truco.ar',
        password: 'ClaveSocket123',
        nickname: 'ManoDeHierro',
      },
    });
    expect(reg.statusCode).toBe(201);
    const registeredUser = reg.json().user;
    const jar = extractAuthCookies(reg.headers['set-cookie']).map;

    // 4. Reutilizar directamente la cookie truco_access como WS ticket debe fallar (separación criptográfica de dominios)
    expect(await connectExpectingError(gameServerUrl, jar[ACCESS_COOKIE_NAME]!)).toBe(
      'UNAUTHORIZED',
    );

    // 5. Ticket expirado -> rechazado
    const expiredTicket = signWsAuthTicket(
      {
        userId: registeredUser.id,
        sessionId: reg.json().sessionId,
        nickname: registeredUser.nickname,
        isGuest: false,
        exp: Date.now() - 1_000,
      },
      SHARED_SESSION_SECRET,
    );
    expect(await connectExpectingError(gameServerUrl, expiredTicket)).toBe('UNAUTHORIZED');

    // 6. Solicitar ticket efímero real vía POST /v1/auth/ws-ticket y conectar a apps/game-server
    const ticketRes = await apiApp.inject({
      method: 'POST',
      url: '/v1/auth/ws-ticket',
      headers: { cookie: buildCookieHeader(jar) },
    });
    expect(ticketRes.statusCode).toBe(200);
    const { ticket, expiresAt } = ticketRes.json() as { ticket: string; expiresAt: number };
    expect(expiresAt).toBeGreaterThan(Date.now());

    const socket = await connectExpectingSuccess(gameServerUrl, ticket);
    try {
      const tableStatePromise = new Promise<WsEnvelope>((resolve) => {
        socket.once('envelope', (env: WsEnvelope) => resolve(env));
      });
      socket.emit('envelope', {
        eventId: randomUUID(),
        ts: Date.now(),
        type: 'table.join',
        payload: {
          roomId: 'mesa-m3-ticket',
          mode: '1v1',
          rulesetCode: 'ar-standard-v1',
        },
      });
      const tableEnv = await tableStatePromise;
      expect(tableEnv.type).toBe('table.state');
      const seats = tableEnv.payload['seats'] as Array<{
        userId: string | null;
        nickname: string | null;
      }>;
      expect(seats[0]).toMatchObject({
        userId: registeredUser.id,
        nickname: 'ManoDeHierro',
      });
    } finally {
      socket.close();
    }
  });
});
