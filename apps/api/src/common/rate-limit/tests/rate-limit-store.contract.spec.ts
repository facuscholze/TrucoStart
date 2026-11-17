import { LOCKOUT_DURATIONS_MS, LOCKOUT_THRESHOLD_ATTEMPTS } from '@truco/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { InMemoryRateLimitStore } from '../in-memory-rate-limit-store.js';
import type { RateLimitStore } from '../rate-limit-store.interface.js';
import { RedisRateLimitStore } from '../redis-rate-limit-store.js';

interface ContractContext {
  readonly store: RateLimitStore;
  readonly advanceClock: (deltaMs: number) => void;
  readonly getNow: () => number;
  readonly cleanup?: () => Promise<void>;
}

function defineRateLimitStoreContractSuite(
  suiteName: string,
  factory: () => Promise<ContractContext>,
  enabled = true,
): void {
  const describeBlock = enabled ? describe : describe.skip;

  describeBlock(`RateLimitStore Contract — ${suiteName}`, () => {
    let ctx: ContractContext;

    beforeEach(async () => {
      ctx = await factory();
    });

    afterEach(async () => {
      await ctx.store.close();
      if (ctx.cleanup) {
        await ctx.cleanup();
      }
    });

    it('enforces sliding-window quotas independently per key and recovers once window expires', async () => {
      const r1 = await ctx.store.consumeWindow('auth:guest:ip:203.0.113.1', 3, 60_000);
      const r2 = await ctx.store.consumeWindow('auth:guest:ip:203.0.113.1', 3, 60_000);
      const r3 = await ctx.store.consumeWindow('auth:guest:ip:203.0.113.1', 3, 60_000);
      expect(r1).toEqual({ allowed: true, remaining: 2, retryAfterMs: 0 });
      expect(r2).toEqual({ allowed: true, remaining: 1, retryAfterMs: 0 });
      expect(r3).toEqual({ allowed: true, remaining: 0, retryAfterMs: 0 });

      // 4to consumo en la misma ventana -> bloqueado
      const blocked = await ctx.store.consumeWindow('auth:guest:ip:203.0.113.1', 3, 60_000);
      expect(blocked.allowed).toBe(false);
      expect(blocked.retryAfterMs).toBeGreaterThanOrEqual(59_000);

      // Otra IP no se ve afectada
      const otherIp = await ctx.store.consumeWindow('auth:guest:ip:203.0.113.2', 3, 60_000);
      expect(otherIp.allowed).toBe(true);

      // Avanzar más allá de la ventana deslizante libera capacidad
      ctx.advanceClock(61_000);
      const recovered = await ctx.store.consumeWindow('auth:guest:ip:203.0.113.1', 3, 60_000);
      expect(recovered).toEqual({ allowed: true, remaining: 2, retryAfterMs: 0 });
    });

    it('tracks progressive (account + IP) lockout tiers and resets cleanly on clear or state TTL expiry', async () => {
      const compositeKey = 'login:acct_ip:lucia@truco.ar:203.0.114.10';
      const computeLock = (nextCount: number): number | null => {
        if (nextCount < LOCKOUT_THRESHOLD_ATTEMPTS) return null;
        const idx = Math.min(
          nextCount - LOCKOUT_THRESHOLD_ATTEMPTS,
          LOCKOUT_DURATIONS_MS.length - 1,
        );
        return ctx.getNow() + LOCKOUT_DURATIONS_MS[idx]!;
      };

      for (let i = 1; i < LOCKOUT_THRESHOLD_ATTEMPTS; i++) {
        const st = await ctx.store.recordLockoutFailure(compositeKey, computeLock, 900_000);
        expect(st.failedCount).toBe(i);
        expect(st.lockedUntilMs).toBeNull();
      }

      // 5to fallo -> 60s de bloqueo únicamente sobre (lucia@truco.ar + 203.0.114.10)
      const fifth = await ctx.store.recordLockoutFailure(compositeKey, computeLock, 900_000);
      expect(fifth.failedCount).toBe(5);
      expect(fifth.lockedUntilMs).toBe(ctx.getNow() + 60_000);

      // Otra IP para la misma cuenta permanece libre de lockout
      const otherIpState = await ctx.store.getLockoutState(
        'login:acct_ip:lucia@truco.ar:198.51.100.77',
      );
      expect(otherIpState).toEqual({ failedCount: 0, lockedUntilMs: null });

      // Tras vencer el primer bloqueo (65s), un 6to fallo escala a 300s
      ctx.advanceClock(65_000);
      const expiredLockView = await ctx.store.getLockoutState(compositeKey);
      expect(expiredLockView.failedCount).toBe(5);
      expect(expiredLockView.lockedUntilMs).toBeNull();

      const sixth = await ctx.store.recordLockoutFailure(compositeKey, computeLock, 900_000);
      expect(sixth.failedCount).toBe(6);
      expect(sixth.lockedUntilMs).toBe(ctx.getNow() + 300_000);

      // Limpieza explícita tras login exitoso
      await ctx.store.clearLockoutState(compositeKey);
      expect(await ctx.store.getLockoutState(compositeKey)).toEqual({
        failedCount: 0,
        lockedUntilMs: null,
      });
    });

    it('counts per-account failures for Captcha escalation and expires entries outside window', async () => {
      const acctKey = 'login:acct_failures:lucia@truco.ar';
      expect(await ctx.store.getFailureCounter(acctKey, 900_000)).toBe(0);

      expect(await ctx.store.incrementFailureCounter(acctKey, 900_000)).toBe(1);
      expect(await ctx.store.incrementFailureCounter(acctKey, 900_000)).toBe(2);
      expect(await ctx.store.incrementFailureCounter(acctKey, 900_000)).toBe(3);
      expect(await ctx.store.getFailureCounter(acctKey, 900_000)).toBe(3);

      ctx.advanceClock(901_000);
      expect(await ctx.store.getFailureCounter(acctKey, 900_000)).toBe(0);

      await ctx.store.incrementFailureCounter(acctKey, 900_000);
      await ctx.store.clearFailureCounter(acctKey);
      expect(await ctx.store.getFailureCounter(acctKey, 900_000)).toBe(0);
    });
  });
}

defineRateLimitStoreContractSuite('InMemoryRateLimitStore', async () => {
  let clock = 1_800_000_000_000;
  return {
    store: new InMemoryRateLimitStore(() => clock),
    advanceClock: (d) => {
      clock += d;
    },
    getNow: () => clock,
  };
});

const redisUrl = process.env['REDIS_URL'];

describe('CI environment guard for RedisRateLimitStore', () => {
  it('requires REDIS_URL to be defined when running in CI', () => {
    if (process.env['CI'] === 'true') {
      expect(Boolean(redisUrl)).toBe(true);
    } else {
      expect(typeof redisUrl === 'string' || redisUrl === undefined).toBe(true);
    }
  });
});

defineRateLimitStoreContractSuite(
  'RedisRateLimitStore (real Redis via REDIS_URL)',
  async () => {
    let clock = 1_800_000_000_000;
    const prefix = `truco:rl:contract:${Date.now()}:${Math.random().toString(36).slice(2)}:`;
    const store = new RedisRateLimitStore(redisUrl!, {
      keyPrefix: prefix,
      nowFn: () => clock,
    });
    return {
      store,
      advanceClock: (d) => {
        clock += d;
      },
      getNow: () => clock,
    };
  },
  Boolean(redisUrl),
);
