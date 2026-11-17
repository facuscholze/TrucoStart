import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import {
  createGameServer,
  type GameServerInstance,
  InMemoryMatchLifecycleBus,
} from '@truco/game-server';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApiApp } from '../../../bootstrap.js';
import {
  createAdaptiveTestDatabase,
  type DatabaseConnectionHandle,
} from '../../../db/database.provider.js';
import { tablesTable } from '../../../db/schema/index.js';
import { buildCookieHeader, extractAuthCookies } from '../../auth/tests/test-cookie-jar.js';
import { HttpGameRoomProvisioner } from '../ports/game-room-provisioner.js';
import { InMemoryMatchLifecycleConsumer } from '../ports/match-lifecycle-consumer.js';

const SHARED_SECRET = 'm6-practice-secret-minimo-32-chars!!!!!!';

describe('M6 — mesas de práctica contra la máquina y progreso del tutorial', () => {
  let dbHandle: DatabaseConnectionHandle;
  let apiApp: NestFastifyApplication;
  let gameServer: GameServerInstance;

  beforeAll(async () => {
    dbHandle = await createAdaptiveTestDatabase();
    const bus = new InMemoryMatchLifecycleBus();
    gameServer = createGameServer({
      sessionSecret: SHARED_SECRET,
      internalSecret: SHARED_SECRET,
      seedEncryptionKey: SHARED_SECRET,
      allowAdHocRooms: false,
      lifecyclePublisher: bus,
      idleSweepIntervalMs: 0,
      botDecisionMinDelayMs: 0,
      botDecisionMaxDelayMs: 1,
      rateLimiter: {
        windowMs: 10_000,
        actionMax: 5_000,
        chatMax: 500,
        tableMax: 500,
        connectionTotalMax: 900,
      },
    });
    const gamePort = await gameServer.listen(0, '127.0.0.1');

    apiApp = await createApiApp({
      dbHandle,
      authOptions: { runtimeConfig: { sessionSecret: SHARED_SECRET } },
      lobbyOptions: {
        gameRoomProvisioner: new HttpGameRoomProvisioner({
          baseUrl: `http://127.0.0.1:${gamePort}`,
          internalSecret: SHARED_SECRET,
        }),
        matchLifecycleConsumer: new InMemoryMatchLifecycleConsumer(bus),
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
    await dbHandle.close();
  });

  async function guestCookie(device: string): Promise<string> {
    const auth = await apiApp.inject({
      method: 'POST',
      url: '/v1/auth/guest',
      payload: { deviceName: device },
    });
    expect(auth.statusCode).toBe(201);
    return buildCookieHeader(extractAuthCookies(auth.headers['set-cookie']).map);
  }

  it('crea una mesa de práctica privada con bots y la devuelve marcada como práctica', async () => {
    const cookie = await guestCookie('Practicante-1');
    const res = await apiApp.inject({
      method: 'POST',
      url: '/v1/tables',
      headers: { cookie },
      payload: {
        mode: '1v1',
        visibility: 'PUBLIC',
        targetScore: 15,
        flor: false,
        turnTimeoutMs: 25_000,
        practice: { difficulty: 'EASY' },
      },
    });
    expect(res.statusCode).toBe(201);
    const table = res.json<{
      id: string;
      roomId: string;
      isPractice: boolean;
      visibility: string;
    }>();
    expect(table.isPractice).toBe(true);
    // Las mesas de práctica nunca son públicas.
    expect(table.visibility).toBe('PRIVATE');

    const row = await dbHandle.db.select().from(tablesTable).where(eq(tablesTable.id, table.id));
    expect(row[0]?.isPractice).toBe(true);
    expect(row[0]?.visibility).toBe('PRIVATE');

    // No aparece en el lobby público.
    const lobby = await apiApp.inject({ method: 'GET', url: '/v1/tables?status=WAITING' });
    expect(lobby.statusCode).toBe(200);
    expect(
      lobby.json<{ tables: Array<{ id: string }> }>().tables.some((t) => t.id === table.id),
    ).toBe(false);

    // El game-server provisionó la sala con los bots listos.
    const snapshot = await gameServer.store.loadRoomSnapshot(table.roomId);
    expect(snapshot?.practice).toEqual({ difficulty: 'EASY' });
    expect(snapshot?.seats.filter((seat) => seat.isBot)).toHaveLength(1);
    expect(snapshot?.seats.find((seat) => seat.isBot)?.ready).toBe(true);

    await gameServer.deleteRoom(table.roomId);
  });

  it('guarda el progreso del tutorial en la cuenta y rechaza lecciones inexistentes', async () => {
    const cookie = await guestCookie('Tutorial-1');

    const initial = await apiApp.inject({
      method: 'GET',
      url: '/v1/me/tutorial',
      headers: { cookie },
    });
    expect(initial.statusCode).toBe(200);
    expect(initial.json<{ completedLessons: string[]; totalLessons: number }>()).toMatchObject({
      completedLessons: [],
      totalLessons: 6,
    });

    const put = await apiApp.inject({
      method: 'PUT',
      url: '/v1/me/tutorial',
      headers: { cookie },
      payload: { completedLessons: ['jerarquia-cartas', 'envido'] },
    });
    expect(put.statusCode).toBe(200);
    expect(put.json<{ completedLessons: string[] }>().completedLessons).toEqual([
      'jerarquia-cartas',
      'envido',
    ]);

    // Persistido: una segunda lectura lo devuelve igual.
    const reread = await apiApp.inject({
      method: 'GET',
      url: '/v1/me/tutorial',
      headers: { cookie },
    });
    expect(reread.json<{ completedLessons: string[] }>().completedLessons).toEqual([
      'jerarquia-cartas',
      'envido',
    ]);

    // Otra cuenta no hereda el progreso ajeno.
    const otherCookie = await guestCookie('Tutorial-2');
    const other = await apiApp.inject({
      method: 'GET',
      url: '/v1/me/tutorial',
      headers: { cookie: otherCookie },
    });
    expect(other.json<{ completedLessons: string[] }>().completedLessons).toEqual([]);

    const invalid = await apiApp.inject({
      method: 'PUT',
      url: '/v1/me/tutorial',
      headers: { cookie },
      payload: { completedLessons: ['leccion-inventada'] },
    });
    expect(invalid.statusCode).toBe(400);

    const anonymous = await apiApp.inject({ method: 'GET', url: '/v1/me/tutorial' });
    expect(anonymous.statusCode).toBe(401);
  });
});
