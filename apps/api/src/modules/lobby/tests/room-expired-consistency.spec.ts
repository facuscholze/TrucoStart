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
import { tableSeatsTable, tablesTable } from '../../../db/schema/index.js';
import { buildCookieHeader, extractAuthCookies } from '../../auth/tests/test-cookie-jar.js';
import { HttpGameRoomProvisioner } from '../ports/game-room-provisioner.js';
import { InMemoryMatchLifecycleConsumer } from '../ports/match-lifecycle-consumer.js';

const SHARED_SECRET = 'm6-room-expired-secret-minimum-32-chars!!';

async function waitFor<T>(
  probe: () => Promise<T | null>,
  label: string,
  timeoutMs = 5_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await probe();
    if (value !== null) return value;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timeout esperando ${label}`);
}

describe('M6 — una sala inactiva se destruye sola y la fila de la mesa queda consistente', () => {
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
      // TTL y barrido cortos para el test: misma lógica que los 10 minutos por defecto.
      idleRoomTtlMs: 50,
      idleSweepIntervalMs: 20,
      rateLimiter: {
        windowMs: 10_000,
        actionMax: 600,
        chatMax: 50,
        tableMax: 50,
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

  it('destruye la sala sin conexiones tras el TTL y marca la mesa CLOSED/IDLE_TIMEOUT liberando asientos', async () => {
    const auth = await apiApp.inject({
      method: 'POST',
      url: '/v1/auth/guest',
      payload: { deviceName: 'Anfitrion-TTL' },
    });
    expect(auth.statusCode).toBe(201);
    const cookie = buildCookieHeader(extractAuthCookies(auth.headers['set-cookie']).map);

    const createRes = await apiApp.inject({
      method: 'POST',
      url: '/v1/tables',
      headers: { cookie },
      payload: {
        mode: '1v1',
        visibility: 'PUBLIC',
        targetScore: 15,
        flor: false,
        turnTimeoutMs: 25_000,
      },
    });
    expect(createRes.statusCode).toBe(201);
    const table = createRes.json<{ id: string; roomId: string }>();

    // La sala existe en el game-server y la mesa está WAITING con el asiento del anfitrión activo.
    expect(gameServer.roomManager.getActiveRoomCount()).toBe(1);
    const before = await dbHandle.db.select().from(tablesTable).where(eq(tablesTable.id, table.id));
    expect(before[0]?.status).toBe('WAITING');
    expect(before[0]?.closedReason).toBeNull();

    // Nadie se conecta: el barrido la destruye sola y notifica `room.expired` -> apps/api actualiza la fila.
    const closed = await waitFor(async () => {
      const rows = await dbHandle.db.select().from(tablesTable).where(eq(tablesTable.id, table.id));
      const row = rows[0];
      return row && row.status === 'CLOSED' ? row : null;
    }, 'mesa CLOSED tras el TTL de inactividad');

    expect(closed.status).toBe('CLOSED');
    expect(closed.closedReason).toBe('IDLE_TIMEOUT');
    expect(gameServer.roomManager.getActiveRoomCount()).toBe(0);
    expect(await gameServer.store.loadRoomSnapshot(table.roomId)).toBeNull();

    const seats = await dbHandle.db
      .select()
      .from(tableSeatsTable)
      .where(eq(tableSeatsTable.tableId, table.id));
    expect(seats.length).toBeGreaterThan(0);
    expect(seats.every((seat) => seat.isActive === false)).toBe(true);

    // La mesa ya no figura en el lobby público.
    const lobby = await apiApp.inject({ method: 'GET', url: '/v1/tables?status=WAITING' });
    expect(lobby.statusCode).toBe(200);
    const listed = lobby.json<{ tables: Array<{ id: string }> }>().tables;
    expect(listed.some((t) => t.id === table.id)).toBe(false);

    // Y la cuenta puede crear una mesa nueva (los asientos quedaron liberados).
    const recreate = await apiApp.inject({
      method: 'POST',
      url: '/v1/tables',
      headers: { cookie },
      payload: {
        mode: '1v1',
        visibility: 'PRIVATE',
        targetScore: 15,
        flor: false,
        turnTimeoutMs: 25_000,
      },
    });
    expect(recreate.statusCode).toBe(201);
    await gameServer.deleteRoom(recreate.json<{ roomId: string }>().roomId);
  });
});
