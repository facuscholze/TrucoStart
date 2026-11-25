import { Redis } from 'ioredis';
import type {
  LeaderboardChange,
  LeaderboardScore,
  LeaderboardStore,
} from './leaderboard-store.interface.js';

export interface RedisLeaderboardStoreOptions {
  readonly keyPrefix?: string;
}

export class RedisLeaderboardStore implements LeaderboardStore {
  private readonly redis: Redis;
  private readonly prefix: string;
  private closed = false;

  constructor(redisUrlOrClient: string | Redis, options: RedisLeaderboardStoreOptions = {}) {
    this.redis =
      typeof redisUrlOrClient === 'string'
        ? new Redis(redisUrlOrClient, { maxRetriesPerRequest: 2 })
        : redisUrlOrClient;
    this.prefix = options.keyPrefix ?? 'truco:ratings:';
  }

  private fullKey(key: string): string {
    return `${this.prefix}${key}`;
  }

  async replaceLeaderboard(
    key: string,
    scores: readonly LeaderboardScore[],
    ttlSeconds = 0,
  ): Promise<void> {
    const fullKey = this.fullKey(key);
    const pipeline = this.redis.pipeline().del(fullKey);
    if (scores.length > 0) {
      const args: Array<string | number> = [];
      for (const item of scores) args.push(item.score, item.userId);
      pipeline.zadd(fullKey, ...args);
      if (ttlSeconds > 0) pipeline.expire(fullKey, ttlSeconds);
    }
    const result = await pipeline.exec();
    if (result?.some(([error]) => error !== null)) {
      throw new Error('No se pudo actualizar el ranking en Redis.');
    }
  }

  async projectLeaderboard(
    key: string,
    changes: readonly LeaderboardChange[],
    ttlSeconds: number,
  ): Promise<void> {
    if (changes.length === 0) return;
    const fullKey = this.fullKey(key);
    const pipeline = this.redis.pipeline();
    for (const item of changes) {
      if (item.eligible) pipeline.zadd(fullKey, item.score, item.userId);
      else pipeline.zrem(fullKey, item.userId);
    }
    pipeline.expire(fullKey, ttlSeconds);
    const result = await pipeline.exec();
    if (result?.some(([error]) => error !== null)) {
      throw new Error('No se pudo proyectar el ranking en Redis.');
    }
  }

  async readPage(key: string, offset: number, limit: number): Promise<readonly LeaderboardScore[]> {
    const values = await this.redis.zrevrange(
      this.fullKey(key),
      offset,
      offset + limit - 1,
      'WITHSCORES',
    );
    const result: LeaderboardScore[] = [];
    for (let index = 0; index < values.length; index += 2) {
      const userId = values[index];
      const score = values[index + 1];
      if (userId !== undefined && score !== undefined) {
        result.push({ userId, score: Number(score) });
      }
    }
    return result;
  }

  async rankOf(key: string, userId: string): Promise<number | null> {
    const rank = await this.redis.zrevrank(this.fullKey(key), userId);
    return rank === null ? null : rank + 1;
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
