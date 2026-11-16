import type {
  ProgressiveLockoutState,
  RateLimitConsumeResult,
  RateLimitStore,
} from './rate-limit-store.interface.js';

interface StoredLockoutEntry {
  failedCount: number;
  lockedUntilMs: number | null;
  expiresAtMs: number;
}

export class InMemoryRateLimitStore implements RateLimitStore {
  private readonly windows = new Map<string, number[]>();
  private readonly lockouts = new Map<string, StoredLockoutEntry>();
  private readonly counters = new Map<string, number[]>();
  private readonly nowFn: () => number;

  constructor(nowFn: () => number = Date.now) {
    this.nowFn = nowFn;
  }

  async consumeWindow(
    key: string,
    limit: number,
    windowMs: number,
  ): Promise<RateLimitConsumeResult> {
    const now = this.nowFn();
    const cutoff = now - windowMs;
    const raw = this.windows.get(key) ?? [];
    const active = raw.filter((ts) => ts > cutoff);

    if (active.length >= limit) {
      if (active.length === 0) {
        this.windows.delete(key);
      } else {
        this.windows.set(key, active);
      }
      const oldest = active[0] ?? now;
      return {
        allowed: false,
        remaining: 0,
        retryAfterMs: Math.max(100, oldest + windowMs - now),
      };
    }

    active.push(now);
    this.windows.set(key, active);
    return {
      allowed: true,
      remaining: Math.max(0, limit - active.length),
      retryAfterMs: 0,
    };
  }

  async getLockoutState(key: string): Promise<ProgressiveLockoutState> {
    const now = this.nowFn();
    const entry = this.lockouts.get(key);
    if (!entry || entry.expiresAtMs <= now) {
      this.lockouts.delete(key);
      return { failedCount: 0, lockedUntilMs: null };
    }
    const activeLock =
      entry.lockedUntilMs !== null && entry.lockedUntilMs > now ? entry.lockedUntilMs : null;
    return {
      failedCount: entry.failedCount,
      lockedUntilMs: activeLock,
    };
  }

  async recordLockoutFailure(
    key: string,
    computeLockedUntilMs: (nextFailedCount: number) => number | null,
    stateTtlMs: number,
  ): Promise<ProgressiveLockoutState> {
    const now = this.nowFn();
    const current = this.lockouts.get(key);
    const prevCount = current && current.expiresAtMs > now ? current.failedCount : 0;
    const nextCount = prevCount + 1;
    const lockedUntilMs = computeLockedUntilMs(nextCount);
    const minExpiry =
      lockedUntilMs !== null ? Math.max(lockedUntilMs, now + stateTtlMs) : now + stateTtlMs;

    this.lockouts.set(key, {
      failedCount: nextCount,
      lockedUntilMs,
      expiresAtMs: minExpiry,
    });

    return {
      failedCount: nextCount,
      lockedUntilMs,
    };
  }

  async clearLockoutState(key: string): Promise<void> {
    this.lockouts.delete(key);
  }

  async incrementFailureCounter(key: string, windowMs: number): Promise<number> {
    const now = this.nowFn();
    const cutoff = now - windowMs;
    const active = (this.counters.get(key) ?? []).filter((ts) => ts > cutoff);
    active.push(now);
    this.counters.set(key, active);
    return active.length;
  }

  async getFailureCounter(key: string, windowMs: number): Promise<number> {
    const now = this.nowFn();
    const cutoff = now - windowMs;
    const raw = this.counters.get(key);
    if (!raw) return 0;
    const active = raw.filter((ts) => ts > cutoff);
    if (active.length === 0) {
      this.counters.delete(key);
      return 0;
    }
    this.counters.set(key, active);
    return active.length;
  }

  async clearFailureCounter(key: string): Promise<void> {
    this.counters.delete(key);
  }

  async close(): Promise<void> {
    // No-op en memoria
  }
}
