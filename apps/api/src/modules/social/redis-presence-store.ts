import { Redis } from 'ioredis';
import type { UserPresenceStore } from './presence-store.interface.js';

const UPDATE_LEASE_SCRIPT = `
  redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', ARGV[1])
  redis.call('ZADD', KEYS[1], ARGV[2], ARGV[3])
  redis.call('PEXPIRE', KEYS[1], ARGV[4])
  return 1
`;

const REMOVE_LEASE_SCRIPT = `
  redis.call('ZREM', KEYS[1], ARGV[1])
  redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', ARGV[2])
  if redis.call('ZCARD', KEYS[1]) == 0 then
    redis.call('DEL', KEYS[1])
  end
  return 1
`;

const CHECK_ONLINE_SCRIPT = `
  redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', ARGV[1])
  local count = redis.call('ZCARD', KEYS[1])
  if count == 0 then redis.call('DEL', KEYS[1]) end
  return count
`;

/** Redis ZSET leases allow stale sockets to expire without hiding another live device. */
export class RedisUserPresenceStore implements UserPresenceStore {
  private readonly redis: Redis;
  private closed = false;

  constructor(
    redisUrl: string,
    private readonly keyPrefix = 'truco:social:presence:',
  ) {
    this.redis = new Redis(redisUrl, { maxRetriesPerRequest: 2 });
  }

  async connect(userId: string, socketId: string, nowMs: number, ttlMs: number): Promise<void> {
    await this.writeLease(userId, socketId, nowMs, ttlMs);
  }

  async heartbeat(userId: string, socketId: string, nowMs: number, ttlMs: number): Promise<void> {
    await this.writeLease(userId, socketId, nowMs, ttlMs);
  }

  private async writeLease(
    userId: string,
    socketId: string,
    nowMs: number,
    ttlMs: number,
  ): Promise<void> {
    await this.redis.eval(
      UPDATE_LEASE_SCRIPT,
      1,
      this.key(userId),
      nowMs,
      nowMs + ttlMs,
      socketId,
      Math.max(ttlMs * 2, 1_000),
    );
  }

  async disconnect(userId: string, socketId: string, nowMs: number): Promise<void> {
    await this.redis.eval(REMOVE_LEASE_SCRIPT, 1, this.key(userId), socketId, nowMs);
  }

  async isOnline(userId: string, nowMs: number): Promise<boolean> {
    const count = await this.redis.eval(CHECK_ONLINE_SCRIPT, 1, this.key(userId), nowMs);
    return Number(count) > 0;
  }

  private key(userId: string): string {
    return `${this.keyPrefix}${userId}`;
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    if (this.redis.status !== 'end') {
      try {
        await this.redis.quit();
      } catch {
        this.redis.disconnect();
      }
    }
  }
}
