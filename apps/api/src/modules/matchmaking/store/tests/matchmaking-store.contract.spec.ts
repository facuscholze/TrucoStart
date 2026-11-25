import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { InMemoryMatchmakingStore } from '../in-memory-matchmaking-store.js';
import type { MatchmakingStore } from '../matchmaking-store.interface.js';
import { RedisMatchmakingStore } from '../redis-matchmaking-store.js';

function defineMatchmakingStoreContractSuite(
  suiteName: string,
  factory: () => Promise<MatchmakingStore>,
  enabled = true,
): void {
  const describeBlock = enabled ? describe : describe.skip;

  describeBlock(`MatchmakingStore Contract — ${suiteName}`, () => {
    let store: MatchmakingStore;

    beforeEach(async () => {
      store = await factory();
    });

    afterEach(async () => {
      await store.close();
    });

    it('queues FIFO entries by (mode + rulesetCode), handles idempotent re-enqueue, and pops exact quota on match', async () => {
      const now = 1_800_000_000_000;
      const q1 = await store.enqueueAndTryMatch(
        {
          userId: 'u1',
          nickname: 'Alfa',
          mode: '1v1',
          rulesetCode: 'ar-standard-v1',
          enqueuedAtMs: now,
          expiresAtMs: now + 60_000,
        },
        2,
        now,
      );
      expect(q1.kind).toBe('QUEUED');
      if (q1.kind === 'QUEUED') expect(q1.position).toBe(1);

      // Re-encolar al mismo usuario es idempotente
      const q1Dup = await store.enqueueAndTryMatch(
        {
          userId: 'u1',
          nickname: 'Alfa',
          mode: '1v1',
          rulesetCode: 'ar-standard-v1',
          enqueuedAtMs: now + 100,
          expiresAtMs: now + 60_100,
        },
        2,
        now + 100,
      );
      expect(q1Dup.kind).toBe('QUEUED');

      // Jugador en otro modo (2v2) no se mezcla con 1v1
      const qOther = await store.enqueueAndTryMatch(
        {
          userId: 'u-2v2',
          nickname: 'Cuarteto1',
          mode: '2v2',
          rulesetCode: 'ar-standard-v1',
          enqueuedAtMs: now,
          expiresAtMs: now + 60_000,
        },
        4,
        now,
      );
      expect(qOther.kind).toBe('QUEUED');

      // Segundo jugador en 1v1 completa el cupo -> MATCHED con [u1, u2]
      const matched = await store.enqueueAndTryMatch(
        {
          userId: 'u2',
          nickname: 'Beta',
          mode: '1v1',
          rulesetCode: 'ar-standard-v1',
          enqueuedAtMs: now + 200,
          expiresAtMs: now + 60_200,
        },
        2,
        now + 200,
      );
      expect(matched.kind).toBe('MATCHED');
      if (matched.kind === 'MATCHED') {
        expect(matched.players.map((p) => p.userId)).toEqual(['u1', 'u2']);
      }

      expect((await store.getUserQueue('u1', now + 300)).status).toBe('IDLE');
      expect((await store.getUserQueue('u2', now + 300)).status).toBe('IDLE');
    });

    it('keeps competitive 1v1 from rematching blocked rivals and selects valid 2v2 teams', async () => {
      const now = 1_800_000_000_000;
      const options = {
        baseRatingWindow: 200,
        waitGrowthPerTenSeconds: 50,
        maximumRatingWindow: 800,
        candidateScanLimit: 24,
      } as const;
      const competitiveEntry = (
        userId: string,
        mode: '1v1' | '2v2',
        rating: number,
        blockedOpponentIds: readonly string[] = [],
      ) => ({
        userId,
        nickname: userId,
        mode,
        rulesetCode: 'ar-standard-v1' as const,
        enqueuedAtMs: now,
        expiresAtMs: now + 60_000,
        competitive: true,
        rating,
        ratingDeviation: 100,
        blockedOpponentIds,
      });

      const blockedPlayer = await store.enqueueAndTryMatch(
        competitiveEntry('blocked-a', '1v1', 1500, ['blocked-b']),
        2,
        now,
        options,
      );
      expect(blockedPlayer.kind).toBe('QUEUED');
      const sameRival = await store.enqueueAndTryMatch(
        competitiveEntry('blocked-b', '1v1', 1500),
        2,
        now,
        options,
      );
      expect(sameRival.kind).toBe('QUEUED');
      expect((await store.getUserQueue('blocked-a', now)).status).toBe('QUEUED');

      const quartet = [
        competitiveEntry('team-a', '2v2', 1500, ['team-d']),
        competitiveEntry('team-b', '2v2', 1500),
        competitiveEntry('team-c', '2v2', 1500),
        competitiveEntry('team-d', '2v2', 1500),
      ];
      let result: Awaited<ReturnType<MatchmakingStore['enqueueAndTryMatch']>> | undefined;
      for (const player of quartet) {
        result = await store.enqueueAndTryMatch(player, 4, now, options);
      }
      expect(result?.kind).toBe('MATCHED');
      if (result?.kind === 'MATCHED') {
        const teamA = result.players.find((player) => player.userId === 'team-a')?.team;
        const teamD = result.players.find((player) => player.userId === 'team-d')?.team;
        expect(teamA).toBeDefined();
        expect(teamA).toBe(teamD);
        expect(result.players.filter((player) => player.team === 0)).toHaveLength(2);
        expect(result.players.filter((player) => player.team === 1)).toHaveLength(2);
      }
    });

    it('purges expired waiters on timeout and supports safe cancellation', async () => {
      const now = 1_800_000_000_000;
      await store.enqueueAndTryMatch(
        {
          userId: 'u-exp',
          nickname: 'Expirado',
          mode: '1v1',
          rulesetCode: 'ar-standard-v1',
          enqueuedAtMs: now,
          expiresAtMs: now + 5_000,
        },
        2,
        now,
      );

      // Avanzar más allá del timeout de espera -> u-exp expira y u-fresh queda en posición 1 (no se empareja con expirado)
      const afterTimeout = await store.enqueueAndTryMatch(
        {
          userId: 'u-fresh',
          nickname: 'Vigente',
          mode: '1v1',
          rulesetCode: 'ar-standard-v1',
          enqueuedAtMs: now + 6_000,
          expiresAtMs: now + 66_000,
        },
        2,
        now + 6_000,
      );
      expect(afterTimeout.kind).toBe('QUEUED');
      if (afterTimeout.kind === 'QUEUED') expect(afterTimeout.position).toBe(1);
      expect((await store.getUserQueue('u-exp', now + 6_000)).status).toBe('IDLE');

      // Cancelación segura e idempotente
      expect(await store.cancelUserQueue('u-fresh')).toBe(true);
      expect(await store.cancelUserQueue('u-fresh')).toBe(false);
      expect((await store.getUserQueue('u-fresh', now + 6_500)).status).toBe('IDLE');
    });
  });
}

defineMatchmakingStoreContractSuite('InMemoryMatchmakingStore', async () => {
  return new InMemoryMatchmakingStore();
});

const redisUrl = process.env['REDIS_URL'];

describe('CI environment guard for RedisMatchmakingStore', () => {
  it('requires REDIS_URL to be defined when running in CI', () => {
    if (process.env['CI'] === 'true') {
      expect(Boolean(redisUrl)).toBe(true);
    } else {
      expect(typeof redisUrl === 'string' || redisUrl === undefined).toBe(true);
    }
  });
});

defineMatchmakingStoreContractSuite(
  'RedisMatchmakingStore (real Redis via REDIS_URL)',
  async () => {
    const prefix = `truco:mm:contract:${Date.now()}:${Math.random().toString(36).slice(2)}:`;
    return new RedisMatchmakingStore(redisUrl!, { keyPrefix: prefix });
  },
  Boolean(redisUrl),
);
