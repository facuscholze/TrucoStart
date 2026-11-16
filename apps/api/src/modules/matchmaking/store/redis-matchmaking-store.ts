import { Redis } from 'ioredis';
import type {
  EnqueueAttemptOutcome,
  MatchmakingStore,
  QueuedPlayerEntry,
  UserQueueLookup,
} from './matchmaking-store.interface.js';

const ENQUEUE_AND_MATCH_LUA = `
local userIndexKey = KEYS[1]
local bucketKey = KEYS[2]
local userId = ARGV[1]
local entryJson = ARGV[2]
local quota = math.floor(tonumber(ARGV[3]))
local nowMs = math.floor(tonumber(ARGV[4]))
local bucketName = ARGV[5]

local function purgeBucket(bKey)
  local items = redis.call("LRANGE", bKey, 0, -1)
  redis.call("DEL", bKey)
  local active = {}
  for i = 1, #items do
    local parsed = cjson.decode(items[i])
    local mappedBucket = redis.call("HGET", userIndexKey, parsed.userId)
    if parsed.expiresAtMs > nowMs and mappedBucket == bKey then
      table.insert(active, items[i])
      redis.call("RPUSH", bKey, items[i])
    elseif mappedBucket == bKey then
      redis.call("HDEL", userIndexKey, parsed.userId)
    end
  end
  if #active > 0 then
    redis.call("EXPIRE", bKey, 3600)
  end
  return active
end

local existingBucket = redis.call("HGET", userIndexKey, userId)
if existingBucket then
  local existingItems = purgeBucket(existingBucket)
  for idx = 1, #existingItems do
    local p = cjson.decode(existingItems[idx])
    if p.userId == userId then
      return {"QUEUED", existingItems[idx], idx}
    end
  end
end

local active = purgeBucket(bucketKey)
redis.call("RPUSH", bucketKey, entryJson)
redis.call("EXPIRE", bucketKey, 3600)
redis.call("HSET", userIndexKey, userId, bucketKey)
redis.call("EXPIRE", userIndexKey, 3600)
table.insert(active, entryJson)

if #active >= quota then
  local matched = {}
  for i = 1, quota do
    local popped = redis.call("LPOP", bucketKey)
    if popped then
      local p = cjson.decode(popped)
      redis.call("HDEL", userIndexKey, p.userId)
      table.insert(matched, popped)
    end
  end
  return {"MATCHED", matched}
end

return {"QUEUED", entryJson, #active}
`;

const GET_USER_QUEUE_LUA = `
local userIndexKey = KEYS[1]
local userId = ARGV[1]
local nowMs = math.floor(tonumber(ARGV[2]))

local bKey = redis.call("HGET", userIndexKey, userId)
if not bKey then
  return {"IDLE"}
end

local items = redis.call("LRANGE", bKey, 0, -1)
redis.call("DEL", bKey)
local pos = 0
local foundJson = nil
local activeCount = 0

for i = 1, #items do
  local parsed = cjson.decode(items[i])
  local mapped = redis.call("HGET", userIndexKey, parsed.userId)
  if parsed.expiresAtMs > nowMs and mapped == bKey then
    activeCount = activeCount + 1
    redis.call("RPUSH", bKey, items[i])
    if parsed.userId == userId then
      pos = activeCount
      foundJson = items[i]
    end
  elseif mapped == bKey then
    redis.call("HDEL", userIndexKey, parsed.userId)
  end
end

if activeCount > 0 then
  redis.call("EXPIRE", bKey, 3600)
end

if foundJson then
  return {"QUEUED", foundJson, pos}
end
return {"IDLE"}
`;

const CANCEL_QUEUE_LUA = `
local userIndexKey = KEYS[1]
local userId = ARGV[1]

local bKey = redis.call("HGET", userIndexKey, userId)
if not bKey then
  return 0
end
redis.call("HDEL", userIndexKey, userId)

local items = redis.call("LRANGE", bKey, 0, -1)
redis.call("DEL", bKey)
local removed = 0
local kept = 0
for i = 1, #items do
  local parsed = cjson.decode(items[i])
  if parsed.userId == userId then
    removed = 1
  else
    kept = kept + 1
    redis.call("RPUSH", bKey, items[i])
  end
end
if kept > 0 then
  redis.call("EXPIRE", bKey, 3600)
end
return removed
`;

export interface RedisMatchmakingStoreOptions {
  readonly keyPrefix?: string;
}

export class RedisMatchmakingStore implements MatchmakingStore {
  private readonly redis: Redis;
  private readonly prefix: string;
  private closed = false;

  constructor(redisUrlOrClient: string | Redis, options: RedisMatchmakingStoreOptions = {}) {
    this.redis =
      typeof redisUrlOrClient === 'string'
        ? new Redis(redisUrlOrClient, { maxRetriesPerRequest: 2 })
        : redisUrlOrClient;
    this.prefix = options.keyPrefix ?? 'truco:mm:';
  }

  private userIndexKey(): string {
    return `${this.prefix}users`;
  }

  private bucketKey(mode: string, rulesetCode: string): string {
    return `${this.prefix}q:${mode}:${rulesetCode}`;
  }

  async enqueueAndTryMatch(
    entry: QueuedPlayerEntry,
    quota: number,
    nowMs: number,
  ): Promise<EnqueueAttemptOutcome> {
    const bKey = this.bucketKey(entry.mode, entry.rulesetCode);
    const raw = (await this.redis.eval(
      ENQUEUE_AND_MATCH_LUA,
      2,
      this.userIndexKey(),
      bKey,
      entry.userId,
      JSON.stringify(entry),
      String(quota),
      String(nowMs),
      `${entry.mode}:${entry.rulesetCode}`,
    )) as [string, string | string[], number?];

    if (raw[0] === 'MATCHED') {
      const jsonList = raw[1] as string[];
      return {
        kind: 'MATCHED',
        players: jsonList.map((item) => JSON.parse(item) as QueuedPlayerEntry),
      };
    }

    return {
      kind: 'QUEUED',
      entry: JSON.parse(raw[1] as string) as QueuedPlayerEntry,
      position: Number(raw[2] ?? 1),
    };
  }

  async getUserQueue(userId: string, nowMs: number): Promise<UserQueueLookup> {
    const raw = (await this.redis.eval(
      GET_USER_QUEUE_LUA,
      1,
      this.userIndexKey(),
      userId,
      String(nowMs),
    )) as [string, string?, number?];

    if (raw[0] !== 'QUEUED' || !raw[1]) {
      return { status: 'IDLE' };
    }
    return {
      status: 'QUEUED',
      entry: JSON.parse(raw[1]) as QueuedPlayerEntry,
      position: Number(raw[2] ?? 1),
    };
  }

  async cancelUserQueue(userId: string): Promise<boolean> {
    const res = await this.redis.eval(CANCEL_QUEUE_LUA, 1, this.userIndexKey(), userId);
    return Number(res) === 1;
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
