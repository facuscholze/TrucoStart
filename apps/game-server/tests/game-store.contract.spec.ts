import { AR_CORTO_15_V1, createGame, createSeededRng } from '@truco/engine';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type {
  GameStore,
  PersistedRoomSnapshot,
  PersistedSequencedEvent,
} from '../src/store/game-store.interface.js';
import { InMemoryGameStore } from '../src/store/in-memory-game-store.js';
import { RedisGameStore } from '../src/store/redis-game-store.js';

function defineGameStoreContractSuite(
  suiteName: string,
  createStore: () => Promise<{ store: GameStore; cleanup?: () => Promise<void> }>,
  shouldRun = true,
) {
  const runner = shouldRun ? describe : describe.skip;

  runner(`GameStore Contract Suite — ${suiteName}`, () => {
    let store: GameStore;
    let cleanup: (() => Promise<void>) | undefined;

    beforeEach(async () => {
      const created = await createStore();
      store = created.store;
      cleanup = created.cleanup;
    });

    afterAll(async () => {
      if (cleanup) await cleanup();
    });

    it('persists and loads room snapshots and ordered event logs without mutation leaks', async () => {
      const gameState = createGame(
        AR_CORTO_15_V1,
        [
          { seat: 0, team: 0, playerId: 'u0' },
          { seat: 1, team: 1, playerId: 'u1' },
        ],
        createSeededRng(42),
      );

      const snap1: PersistedRoomSnapshot = {
        roomId: 'room-contract-1',
        status: 'IN_GAME',
        mode: '1v1',
        rulesetCode: 'ar-corto-15-v1',
        turnTimeoutMs: 30_000,
        seats: [
          {
            seat: 0,
            team: 0,
            userId: 'u0',
            nickname: 'Ana',
            sessionId: 'sess-0',
            ready: true,
            connected: true,
            disconnectedAt: null,
            graceDeadline: null,
          },
          {
            seat: 1,
            team: 1,
            userId: 'u1',
            nickname: 'Beto',
            sessionId: 'sess-1',
            ready: true,
            connected: true,
            disconnectedAt: null,
            graceDeadline: null,
          },
        ],
        matchId: 'match-contract-1',
        seedCommitment: 'a'.repeat(64),
        encryptedSeed: 'enc-seed',
        revealedSeed: null,
        gameState,
        seq: 2,
        turnDeadline: Date.now() + 30_000,
        processedEventIds: ['evt-1', 'evt-2'],
        updatedAt: Date.now(),
      };

      const eventsBatch1: PersistedSequencedEvent[] = [
        {
          eventId: 'srv-1',
          seq: 1,
          ts: Date.now(),
          type: 'game.started',
          payload: { roomId: 'room-contract-1' },
          audience: { kind: 'ALL' },
        },
        {
          eventId: 'srv-2',
          seq: 2,
          ts: Date.now(),
          type: 'game.dealt',
          payload: { roomId: 'room-contract-1', mySeat: 0 },
          audience: { kind: 'SEAT', seat: 0 },
        },
      ];

      await store.saveRoomStateAndEvents(snap1, eventsBatch1);

      const loaded = await store.loadRoomSnapshot('room-contract-1');
      expect(loaded).toEqual(snap1);

      const snap2: PersistedRoomSnapshot = { ...snap1, seq: 3 };
      await store.saveRoomStateAndEvents(snap2, [
        {
          eventId: 'srv-3',
          seq: 3,
          ts: Date.now(),
          type: 'game.turn',
          payload: { seat: 0 },
          audience: { kind: 'ALL' },
        },
      ]);

      const after1 = await store.loadRoomEventsAfter('room-contract-1', 1);
      expect(after1.map((e) => e.seq)).toEqual([2, 3]);

      await store.deleteRoom('room-contract-1');
      expect(await store.loadRoomSnapshot('room-contract-1')).toBeNull();
      expect(await store.loadRoomEventsAfter('room-contract-1', 0)).toEqual([]);
      await store.close();
    });

    it('enforces single-writer room ownership leases and one-active-room-per-user mapping', async () => {
      const claimedA = await store.claimRoomOwner('room-lease', 'srv-A', 5_000);
      expect(claimedA).toBe(true);
      expect(await store.getRoomOwner('room-lease')).toBe('srv-A');

      // Otro proceso no puede robar el lease activo
      const claimedB = await store.claimRoomOwner('room-lease', 'srv-B', 5_000);
      expect(claimedB).toBe(false);

      // Renovación por el mismo propietario sí tiene éxito
      expect(await store.claimRoomOwner('room-lease', 'srv-A', 5_000)).toBe(true);

      // Liberación por otro servidor es ignorada; liberación por propietario funciona
      await store.releaseRoomOwner('room-lease', 'srv-B');
      expect(await store.getRoomOwner('room-lease')).toBe('srv-A');
      await store.releaseRoomOwner('room-lease', 'srv-A');
      expect(await store.getRoomOwner('room-lease')).toBeNull();

      // Mapeo userId -> activeRoom
      await store.setUserActiveRoom('user-99', 'room-lease');
      expect(await store.getUserActiveRoom('user-99')).toBe('room-lease');
      await store.clearUserActiveRoom('user-99', 'otra-sala');
      expect(await store.getUserActiveRoom('user-99')).toBe('room-lease');
      await store.clearUserActiveRoom('user-99', 'room-lease');
      expect(await store.getUserActiveRoom('user-99')).toBeNull();

      await store.close();
    });
  });
}

defineGameStoreContractSuite('InMemoryGameStore', async () => ({
  store: new InMemoryGameStore(),
}));

const redisUrl = process.env['REDIS_URL'];

describe('CI environment guard for RedisGameStore', () => {
  it('requires REDIS_URL to be defined when running in CI', () => {
    if (process.env['CI'] === 'true') {
      expect(Boolean(redisUrl)).toBe(true);
    } else {
      expect(typeof redisUrl === 'string' || redisUrl === undefined).toBe(true);
    }
  });
});

defineGameStoreContractSuite(
  'RedisGameStore (real Redis via REDIS_URL)',
  async () => {
    const prefix = `truco:test:${Date.now()}:${Math.random().toString(36).slice(2)}:`;
    const store = new RedisGameStore(redisUrl!, { keyPrefix: prefix, roomTtlSeconds: 60 });
    return {
      store,
      cleanup: async () => {
        await store.close();
      },
    };
  },
  Boolean(redisUrl),
);
