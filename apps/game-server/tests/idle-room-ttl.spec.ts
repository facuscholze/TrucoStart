import { AR_STANDARD_V1 } from '@truco/engine';
import type { RoomProvisionSpec } from '@truco/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { InMemoryMatchLifecycleBus } from '../src/events/match-lifecycle-publisher.js';
import { createGameServer, type GameServerInstance } from '../src/server.js';
import type { RoomExpiredLifecycleEvent } from '@truco/shared';

const SECRET = 'secreto-idle-ttl-m6-minimo-32-chars!!';
const ROOM_ID = '019a7e40-0000-7000-8000-0000000009f1';

function buildSpec(roomId = ROOM_ID): RoomProvisionSpec {
  return {
    roomId,
    mode: '1v1',
    visibility: 'PRIVATE',
    rulesetCode: 'ar-standard-v1',
    ruleset: AR_STANDARD_V1 as unknown as Record<string, unknown>,
    targetScore: 15,
    florEnabled: false,
    turnTimeoutMs: 15_000,
  };
}

function expiredEvents(bus: InMemoryMatchLifecycleBus): RoomExpiredLifecycleEvent[] {
  return bus
    .getPublishedEvents()
    .filter((e): e is RoomExpiredLifecycleEvent => e.kind === 'room.expired');
}

describe('M6 — limpieza de salas inactivas por TTL (game-server)', () => {
  let server: GameServerInstance | null = null;

  afterEach(async () => {
    if (server) {
      await server.close();
      server = null;
    }
  });

  it('destruye una sala sin conexiones recién al superar el TTL por defecto de 10 minutos', async () => {
    let nowMs = 1_700_000_000_000;
    const bus = new InMemoryMatchLifecycleBus();
    server = createGameServer({
      sessionSecret: SECRET,
      internalSecret: SECRET,
      seedEncryptionKey: SECRET,
      lifecyclePublisher: bus,
      allowAdHocRooms: false,
      idleSweepIntervalMs: 0, // barrido manual y determinístico en este test
      idleRoomTtlMs: 10 * 60_000,
      rateLimiter: {
        windowMs: 10_000,
        actionMax: 500,
        chatMax: 50,
        tableMax: 50,
        connectionTotalMax: 800,
      },
      nowFn: () => nowMs,
    });
    await server.listen(0, '127.0.0.1');
    await server.provisionRoom(buildSpec());
    expect(server.roomManager.getActiveRoomCount()).toBe(1);

    // 9 minutos 59 s: sigue viva
    nowMs += 10 * 60_000 - 1_000;
    let sweep = await server.roomManager.sweepIdleRooms(nowMs);
    expect(sweep.expiredRooms).toHaveLength(0);
    expect(server.roomManager.getActiveRoomCount()).toBe(1);

    // 10 minutos: se destruye sola
    nowMs += 1_000;
    sweep = await server.roomManager.sweepIdleRooms(nowMs);
    expect(sweep.expiredRooms).toEqual([
      {
        roomId: ROOM_ID,
        tableStatus: 'WAITING',
        reason: 'IDLE_TIMEOUT',
        expiredAtMs: nowMs,
      },
    ]);
    expect(server.roomManager.getActiveRoomCount()).toBe(0);
    expect(await server.store.loadRoomSnapshot(ROOM_ID)).toBeNull();
  });

  it('el barrido periódico publica room.expired con el estado previo de la mesa', async () => {
    const bus = new InMemoryMatchLifecycleBus();
    server = createGameServer({
      sessionSecret: SECRET,
      internalSecret: SECRET,
      seedEncryptionKey: SECRET,
      lifecyclePublisher: bus,
      allowAdHocRooms: false,
      idleRoomTtlMs: 40,
      idleSweepIntervalMs: 20,
      rateLimiter: {
        windowMs: 10_000,
        actionMax: 500,
        chatMax: 50,
        tableMax: 50,
        connectionTotalMax: 800,
      },
    });
    await server.listen(0, '127.0.0.1');
    await server.provisionRoom(buildSpec());

    const deadline = Date.now() + 5_000;
    while (expiredEvents(bus).length === 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    const events = expiredEvents(bus);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      kind: 'room.expired',
      roomId: ROOM_ID,
      tableStatus: 'WAITING',
      reason: 'IDLE_TIMEOUT',
    });
    expect(server.roomManager.getActiveRoomCount()).toBe(0);
  });

  it('una sala con un socket conectado nunca se barre, aunque pase el TTL', async () => {
    let nowMs = 1_700_000_000_000;
    const bus = new InMemoryMatchLifecycleBus();
    server = createGameServer({
      sessionSecret: SECRET,
      internalSecret: SECRET,
      seedEncryptionKey: SECRET,
      lifecyclePublisher: bus,
      allowAdHocRooms: false,
      idleSweepIntervalMs: 0,
      idleRoomTtlMs: 30_000,
      rateLimiter: {
        windowMs: 10_000,
        actionMax: 500,
        chatMax: 50,
        tableMax: 50,
        connectionTotalMax: 800,
      },
      nowFn: () => nowMs,
    });
    await server.listen(0, '127.0.0.1');
    await server.provisionRoom(buildSpec());

    // Simulamos actividad registrando un socket contra la sala mediante el mapa interno.
    const manager = server.roomManager as unknown as {
      socketToRooms: Map<string, { userId: string; rooms: Set<string> }>;
    };
    manager.socketToRooms.set('socket-1', { userId: 'user-1', rooms: new Set([ROOM_ID]) });

    nowMs += 5 * 60_000;
    const sweep = await server.roomManager.sweepIdleRooms(nowMs);
    expect(sweep.expiredRooms).toHaveLength(0);
    expect(server.roomManager.getActiveRoomCount()).toBe(1);
  });
});
