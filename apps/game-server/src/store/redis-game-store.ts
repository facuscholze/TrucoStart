import { Redis } from 'ioredis';
import type {
  GameStore,
  PersistedRoomSnapshot,
  PersistedSequencedEvent,
} from './game-store.interface.js';

const DEFAULT_ROOM_TTL_SECONDS = 86_400; // 24h TTL para snapshots y logs efímeros en Redis

const COMPARE_AND_DELETE_LUA = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
else
  return 0
end
`;

const CLAIM_OR_RENEW_LUA = `
local current = redis.call("get", KEYS[1])
if (not current) or (current == ARGV[1]) then
  redis.call("psetex", KEYS[1], tonumber(ARGV[2]), ARGV[1])
  return 1
end
return 0
`;

export interface RedisGameStoreOptions {
  readonly keyPrefix?: string;
  readonly roomTtlSeconds?: number;
}

export class RedisGameStore implements GameStore {
  private readonly redis: Redis;
  private readonly prefix: string;
  private readonly roomTtlSeconds: number;

  constructor(redisUrlOrClient: string | Redis, options: RedisGameStoreOptions = {}) {
    this.redis =
      typeof redisUrlOrClient === 'string'
        ? new Redis(redisUrlOrClient, { maxRetriesPerRequest: 2 })
        : redisUrlOrClient;
    this.prefix = options.keyPrefix ?? 'truco:gs:';
    this.roomTtlSeconds = options.roomTtlSeconds ?? DEFAULT_ROOM_TTL_SECONDS;
  }

  private snapKey(roomId: string): string {
    return `${this.prefix}room:${roomId}:snapshot`;
  }

  private eventsKey(roomId: string): string {
    return `${this.prefix}room:${roomId}:events`;
  }

  private ownerKey(roomId: string): string {
    return `${this.prefix}room:${roomId}:owner`;
  }

  private userRoomKey(userId: string): string {
    return `${this.prefix}user:${userId}:activeRoom`;
  }

  async saveRoomStateAndEvents(
    snapshot: PersistedRoomSnapshot,
    newEvents: readonly PersistedSequencedEvent[],
  ): Promise<void> {
    const pipeline = this.redis.multi();
    pipeline.set(
      this.snapKey(snapshot.roomId),
      JSON.stringify(snapshot),
      'EX',
      this.roomTtlSeconds,
    );
    if (newEvents.length > 0) {
      const serialized = newEvents.map((ev) => JSON.stringify(ev));
      pipeline.rpush(this.eventsKey(snapshot.roomId), ...serialized);
      pipeline.expire(this.eventsKey(snapshot.roomId), this.roomTtlSeconds);
    }
    const res = await pipeline.exec();
    if (!res) {
      throw new Error(`Transacción Redis nula al persistir sala ${snapshot.roomId}`);
    }
    for (const [err] of res) {
      if (err) throw err;
    }
  }

  async loadRoomSnapshot(roomId: string): Promise<PersistedRoomSnapshot | null> {
    const raw = await this.redis.get(this.snapKey(roomId));
    if (!raw) return null;
    return JSON.parse(raw) as PersistedRoomSnapshot;
  }

  async loadRoomEventsAfter(roomId: string, afterSeq: number): Promise<PersistedSequencedEvent[]> {
    const rawItems = await this.redis.lrange(this.eventsKey(roomId), 0, -1);
    const parsed: PersistedSequencedEvent[] = [];
    for (const raw of rawItems) {
      const ev = JSON.parse(raw) as PersistedSequencedEvent;
      if (ev.seq > afterSeq) {
        parsed.push(ev);
      }
    }
    return parsed;
  }

  async deleteRoom(roomId: string): Promise<void> {
    await this.redis.del(this.snapKey(roomId), this.eventsKey(roomId), this.ownerKey(roomId));
  }

  async claimRoomOwner(roomId: string, serverId: string, ttlMs: number): Promise<boolean> {
    const res = await this.redis.eval(
      CLAIM_OR_RENEW_LUA,
      1,
      this.ownerKey(roomId),
      serverId,
      String(ttlMs),
    );
    return Number(res) === 1;
  }

  async getRoomOwner(roomId: string): Promise<string | null> {
    return this.redis.get(this.ownerKey(roomId));
  }

  async releaseRoomOwner(roomId: string, serverId: string): Promise<void> {
    await this.redis.eval(COMPARE_AND_DELETE_LUA, 1, this.ownerKey(roomId), serverId);
  }

  async getUserActiveRoom(userId: string): Promise<string | null> {
    return this.redis.get(this.userRoomKey(userId));
  }

  async setUserActiveRoom(userId: string, roomId: string): Promise<void> {
    await this.redis.set(this.userRoomKey(userId), roomId, 'EX', this.roomTtlSeconds);
  }

  async clearUserActiveRoom(userId: string, roomId: string): Promise<void> {
    await this.redis.eval(COMPARE_AND_DELETE_LUA, 1, this.userRoomKey(userId), roomId);
  }

  async close(): Promise<void> {
    if (this.redis.status === 'end') return;
    try {
      await this.redis.quit();
    } catch {
      this.redis.disconnect();
    }
  }
}
