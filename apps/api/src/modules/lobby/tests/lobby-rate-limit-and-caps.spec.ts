import type { AddressInfo } from 'node:net';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { LOBBY_WS_NAMESPACE, MAX_PUBLIC_TABLES_RESULTS } from '@truco/shared';
import { io as createSocketClient, type Socket as ClientSocket } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApiApp } from '../../../bootstrap.js';
import {
  createAdaptiveTestDatabase,
  type DatabaseConnectionHandle,
} from '../../../db/database.provider.js';
import { buildCookieHeader, extractAuthCookies } from '../../auth/tests/test-cookie-jar.js';
import { InMemoryGameRoomProvisioner } from '../ports/game-room-provisioner.js';

const SECRET = 'pre-m5-rate-limit-and-caps-secret-32chars!!';

describe('Pre-M5 Item 3: Per-IP Rate Limiting and Max Result Caps on GET /v1/tables and /lobby WS', () => {
  let dbHandle: DatabaseConnectionHandle;
  let app: NestFastifyApplication;
  let baseUrl: string;

  beforeAll(async () => {
    dbHandle = await createAdaptiveTestDatabase();
    app = await createApiApp({
      dbHandle,
      authOptions: { runtimeConfig: { sessionSecret: SECRET } },
      lobbyOptions: {
        gameRoomProvisioner: new InMemoryGameRoomProvisioner(),
        runtimeConfig: {
          sessionSecret: SECRET,
          internalSecret: SECRET,
          cleanupIntervalMs: 0,
          listTablesIpMax: 4,
          listTablesWindowMs: 60_000,
          listTablesMaxResults: 2,
          lobbyWsConnectIpMax: 2,
          lobbyWsConnectWindowMs: 60_000,
          lobbyWsEventIpMax: 2,
          lobbyWsMaxSnapshotResults: 2,
        },
      },
    });
    await app.listen(0, '127.0.0.1');
    const addr = app.getHttpServer().address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  afterAll(async () => {
    await app.close();
    await dbHandle.close();
  });

  async function createGuestCookie(name: string, remoteAddress = '10.10.0.1'): Promise<string> {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/auth/guest',
      remoteAddress,
      payload: { deviceName: name },
    });
    expect(res.statusCode).toBe(201);
    return buildCookieHeader(extractAuthCookies(res.headers['set-cookie']).map);
  }

  it('rejects limit > MAX_PUBLIC_TABLES_RESULTS and enforces hard result caps on GET /v1/tables', async () => {
    const c1 = await createGuestCookie('CapOwner1', '10.20.0.1');
    const c2 = await createGuestCookie('CapOwner2', '10.20.0.2');
    const c3 = await createGuestCookie('CapOwner3', '10.20.0.3');

    for (const cookie of [c1, c2, c3]) {
      const createRes = await app.inject({
        method: 'POST',
        url: '/v1/tables',
        headers: { cookie },
        payload: { mode: '1v1', visibility: 'PUBLIC', targetScore: 30, flor: true },
      });
      expect(createRes.statusCode).toBe(201);
    }

    // limit por encima del tope máximo absoluto (50) -> 400 VALIDATION_ERROR
    const overMaxRes = await app.inject({
      method: 'GET',
      url: `/v1/tables?limit=${MAX_PUBLIC_TABLES_RESULTS + 1}`,
      remoteAddress: '10.30.0.1',
    });
    expect(overMaxRes.statusCode).toBe(400);
    expect(overMaxRes.json<{ error: { code: string } }>().error.code).toBe('VALIDATION_ERROR');

    // Aun pidiendo limit=50 cuando hay 3 mesas activas, el tope configurado (2) acota la respuesta
    const cappedRes = await app.inject({
      method: 'GET',
      url: '/v1/tables?limit=50',
      remoteAddress: '10.30.0.2',
    });
    expect(cappedRes.statusCode).toBe(200);
    expect(cappedRes.json<{ tables: unknown[] }>().tables).toHaveLength(2);
  });

  it('enforces per-IP rate limiting on GET /v1/tables (429 RATE_LIMITED) without blocking other IPs', async () => {
    const ipA = '198.51.100.44';
    const ipB = '198.51.100.45';

    for (let i = 0; i < 4; i++) {
      const ok = await app.inject({
        method: 'GET',
        url: '/v1/tables',
        remoteAddress: ipA,
      });
      expect(ok.statusCode).toBe(200);
    }

    // 5ta consulta desde ipA supera listTablesIpMax=4 -> 429 RATE_LIMITED
    const blocked = await app.inject({
      method: 'GET',
      url: '/v1/tables',
      remoteAddress: ipA,
    });
    expect(blocked.statusCode).toBe(429);
    expect(blocked.json<{ error: { code: string } }>().error.code).toBe('RATE_LIMITED');

    // ipB independiente sigue operando con normalidad -> 200 OK
    const otherIpOk = await app.inject({
      method: 'GET',
      url: '/v1/tables',
      remoteAddress: ipB,
    });
    expect(otherIpOk.statusCode).toBe(200);
  });

  it('enforces snapshot result cap and per-IP connection + event rate limits on /lobby WebSocket namespace', async () => {
    const cookie1 = await createGuestCookie('WsCap1', '10.40.0.1');
    const cookie2 = await createGuestCookie('WsCap2', '10.40.0.2');
    const cookie3 = await createGuestCookie('WsCap3', '10.40.0.3');

    const sockets: ClientSocket[] = [];
    try {
      // Conexión 1 desde loopback -> permitida, snapshot acotado a lobbyWsMaxSnapshotResults=2
      const s1 = createSocketClient(`${baseUrl}${LOBBY_WS_NAMESPACE}`, {
        transports: ['websocket'],
        reconnection: false,
        extraHeaders: { cookie: cookie1 },
      });
      sockets.push(s1);

      const initialSnapshot = await new Promise<{ tables: unknown[] }>((resolve, reject) => {
        s1.once('lobby.snapshot', resolve);
        s1.once('connect_error', reject);
      });
      expect(initialSnapshot.tables).toHaveLength(2);

      // Rate limit de eventos por IP en lobby.requestSnapshot (lobbyWsEventIpMax=2)
      s1.emit('lobby.requestSnapshot');
      await new Promise((resolve) => s1.once('lobby.snapshot', resolve));
      s1.emit('lobby.requestSnapshot');
      await new Promise((resolve) => s1.once('lobby.snapshot', resolve));

      const rateErrPromise = new Promise<{ code: string }>((resolve) => {
        s1.once('lobby.error', resolve);
      });
      s1.emit('lobby.requestSnapshot');
      const rateErr = await rateErrPromise;
      expect(rateErr.code).toBe('RATE_LIMITED');

      // Conexión 2 desde la misma IP -> permitida (2/2)
      const s2 = createSocketClient(`${baseUrl}${LOBBY_WS_NAMESPACE}`, {
        transports: ['websocket'],
        reconnection: false,
        extraHeaders: { cookie: cookie2 },
      });
      sockets.push(s2);
      await new Promise<void>((resolve, reject) => {
        s2.once('connect', () => resolve());
        s2.once('connect_error', reject);
      });

      // Conexión 3 desde la misma IP supera lobbyWsConnectIpMax=2 -> rechazada con RATE_LIMITED
      const s3 = createSocketClient(`${baseUrl}${LOBBY_WS_NAMESPACE}`, {
        transports: ['websocket'],
        reconnection: false,
        extraHeaders: { cookie: cookie3 },
      });
      sockets.push(s3);

      const connectErr = await new Promise<Error>((resolve, reject) => {
        s3.once('connect_error', resolve);
        s3.once('connect', () => reject(new Error('No debía permitir 3ra conexión por IP')));
      });
      expect(connectErr.message).toBe('RATE_LIMITED');
    } finally {
      for (const s of sockets) {
        s.disconnect();
      }
    }
  });
});
