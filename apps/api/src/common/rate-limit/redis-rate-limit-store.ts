import { randomUUID } from 'node:crypto';
import { LOCKOUT_DURATIONS_MS, LOCKOUT_THRESHOLD_ATTEMPTS } from '@truco/shared';
import { Redis } from 'ioredis';
import type {
  ProgressiveLockoutState,
  RateLimitConsumeResult,
  RateLimitStore,
} from './rate-limit-store.interface.js';

const CONSUME_WINDOW_LUA = `
local key = KEYS[1]
local now = math.floor(tonumber(ARGV[1]))
local windowMs = math.floor(tonumber(ARGV[2]))
local limit = math.floor(tonumber(ARGV[3]))
local member = ARGV[4]
local cutoff = now - windowMs

redis.call("ZREMRANGEBYSCORE", key, "-inf", cutoff)
local count = redis.call("ZCARD", key)

if count >= limit then
  local oldest = redis.call("ZRANGE", key, 0, 0, "WITHSCORES")
  local oldestTs = now
  if oldest and oldest[2] then
    oldestTs = math.floor(tonumber(oldest[2]))
  end
  local retryAfter = oldestTs + windowMs - now
  if retryAfter < 100 then
    retryAfter = 100
  end
  return {0, 0, retryAfter}
end

redis.call("ZADD", key, now, member)
redis.call("PEXPIRE", key, math.max(windowMs, 1000))
local remaining = limit - (count + 1)
return {1, remaining, 0}
`;

const INCREMENT_COUNTER_LUA = `
local key = KEYS[1]
local now = math.floor(tonumber(ARGV[1]))
local windowMs = math.floor(tonumber(ARGV[2]))
local member = ARGV[3]
local cutoff = now - windowMs

redis.call("ZREMRANGEBYSCORE", key, "-inf", cutoff)
redis.call("ZADD", key, now, member)
redis.call("PEXPIRE", key, math.max(windowMs, 1000))
return redis.call("ZCARD", key)
`;

const GET_COUNTER_LUA = `
local key = KEYS[1]
local now = math.floor(tonumber(ARGV[1]))
local windowMs = math.floor(tonumber(ARGV[2]))
local cutoff = now - windowMs

redis.call("ZREMRANGEBYSCORE", key, "-inf", cutoff)
return redis.call("ZCARD", key)
`;

const RECORD_LOCKOUT_LUA = `
local key = KEYS[1]
local now = math.floor(tonumber(ARGV[1]))
local stateTtlMs = math.floor(tonumber(ARGV[2]))
local threshold = math.floor(tonumber(ARGV[3]))
local durationsCsv = ARGV[4]

local durations = {}
for token in string.gmatch(durationsCsv, "([^,]+)") do
  table.insert(durations, math.floor(tonumber(token)))
end

local prevCount = 0
local fields = redis.call("HMGET", key, "failedCount", "expiresAtMs")
if fields and fields[1] and fields[2] then
  local expMs = tonumber(fields[2])
  if expMs and expMs > now then
    prevCount = tonumber(fields[1]) or 0
  end
end

local nextCount = prevCount + 1
local lockedUntilMs = -1
if nextCount >= threshold and #durations > 0 then
  local idx = nextCount - threshold + 1
  if idx > #durations then
    idx = #durations
  end
  lockedUntilMs = now + durations[idx]
end

local expiresAtMs = now + stateTtlMs
if lockedUntilMs > 0 and lockedUntilMs > expiresAtMs then
  expiresAtMs = lockedUntilMs
end

local ttlPx = math.max(100, math.floor(expiresAtMs - now))
redis.call(
  "HSET",
  key,
  "failedCount",
  tostring(nextCount),
  "lockedUntilMs",
  tostring(lockedUntilMs),
  "expiresAtMs",
  tostring(expiresAtMs)
)
redis.call("PEXPIRE", key, ttlPx)

return {nextCount, lockedUntilMs}
`;

export interface RedisRateLimitStoreOptions {
  readonly keyPrefix?: string;
  readonly nowFn?: () => number;
}

export class RedisRateLimitStore implements RateLimitStore {
  private readonly redis: Redis;
  private readonly prefix: string;
  private readonly nowFn: () => number;
  private closed = false;

  constructor(redisUrlOrClient: string | Redis, options: RedisRateLimitStoreOptions = {}) {
    this.redis =
      typeof redisUrlOrClient === 'string'
        ? new Redis(redisUrlOrClient, { maxRetriesPerRequest: 2 })
        : redisUrlOrClient;
    this.prefix = options.keyPrefix ?? 'truco:rl:';
    this.nowFn = options.nowFn ?? Date.now;
  }

  private winKey(key: string): string {
    return `${this.prefix}win:${key}`;
  }

  private lockKey(key: string): string {
    return `${this.prefix}lock:${key}`;
  }

  private cntKey(key: string): string {
    return `${this.prefix}cnt:${key}`;
  }

  async consumeWindow(
    key: string,
    limit: number,
    windowMs: number,
  ): Promise<RateLimitConsumeResult> {
    const now = this.nowFn();
    const member = `${now}:${randomUUID()}`;
    const raw = (await this.redis.eval(
      CONSUME_WINDOW_LUA,
      1,
      this.winKey(key),
      String(now),
      String(windowMs),
      String(limit),
      member,
    )) as [number, number, number];

    return {
      allowed: Number(raw[0]) === 1,
      remaining: Math.max(0, Number(raw[1])),
      retryAfterMs: Math.max(0, Number(raw[2])),
    };
  }

  async getLockoutState(key: string): Promise<ProgressiveLockoutState> {
    const now = this.nowFn();
    const fields = await this.redis.hmget(
      this.lockKey(key),
      'failedCount',
      'lockedUntilMs',
      'expiresAtMs',
    );
    if (!fields[0] || !fields[2]) {
      return { failedCount: 0, lockedUntilMs: null };
    }
    const failedCount = Number(fields[0]);
    const rawLocked = Number(fields[1] ?? -1);
    const expiresAtMs = Number(fields[2]);

    if (expiresAtMs <= now) {
      await this.redis.del(this.lockKey(key));
      return { failedCount: 0, lockedUntilMs: null };
    }
    const activeLock = rawLocked > now ? rawLocked : null;
    return {
      failedCount,
      lockedUntilMs: activeLock,
    };
  }

  async recordLockoutFailure(
    key: string,
    computeLockedUntilMs: (nextFailedCount: number) => number | null,
    stateTtlMs: number,
  ): Promise<ProgressiveLockoutState> {
    const now = this.nowFn();
    const defaultProbe = computeLockedUntilMs(LOCKOUT_THRESHOLD_ATTEMPTS);
    const expectedStandardFirstLock = now + LOCKOUT_DURATIONS_MS[0]!;

    if (defaultProbe === expectedStandardFirstLock) {
      const durationsCsv = LOCKOUT_DURATIONS_MS.join(',');
      const res = (await this.redis.eval(
        RECORD_LOCKOUT_LUA,
        1,
        this.lockKey(key),
        String(now),
        String(stateTtlMs),
        String(LOCKOUT_THRESHOLD_ATTEMPTS),
        durationsCsv,
      )) as [number, number];
      const nextCount = Number(res[0]);
      const rawLock = Number(res[1]);
      return {
        failedCount: nextCount,
        lockedUntilMs: rawLock > 0 ? rawLock : null,
      };
    }

    const current = await this.getLockoutState(key);
    const nextCount = current.failedCount + 1;
    const lockedUntilMs = computeLockedUntilMs(nextCount);
    const expiresAtMs =
      lockedUntilMs !== null ? Math.max(lockedUntilMs, now + stateTtlMs) : now + stateTtlMs;
    const ttlPx = Math.max(100, Math.floor(expiresAtMs - now));
    await this.redis.hset(
      this.lockKey(key),
      'failedCount',
      String(nextCount),
      'lockedUntilMs',
      String(lockedUntilMs ?? -1),
      'expiresAtMs',
      String(expiresAtMs),
    );
    await this.redis.pexpire(this.lockKey(key), ttlPx);
    return { failedCount: nextCount, lockedUntilMs };
  }

  async clearLockoutState(key: string): Promise<void> {
    await this.redis.del(this.lockKey(key));
  }

  async incrementFailureCounter(key: string, windowMs: number): Promise<number> {
    const now = this.nowFn();
    const member = `${now}:${randomUUID()}`;
    const count = await this.redis.eval(
      INCREMENT_COUNTER_LUA,
      1,
      this.cntKey(key),
      String(now),
      String(windowMs),
      member,
    );
    return Number(count);
  }

  async getFailureCounter(key: string, windowMs: number): Promise<number> {
    const now = this.nowFn();
    const count = await this.redis.eval(
      GET_COUNTER_LUA,
      1,
      this.cntKey(key),
      String(now),
      String(windowMs),
    );
    return Number(count);
  }

  async clearFailureCounter(key: string): Promise<void> {
    await this.redis.del(this.cntKey(key));
  }

  async close(): Promise<void> {
    if (this.closed || this.redis.status === 'end') return;
    this.closed = true;
    try {
      await this.redis.quit();
    } catch {
      this.redis.disconnect();
    }
  }
}
