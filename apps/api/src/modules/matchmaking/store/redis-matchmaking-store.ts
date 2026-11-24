import { Redis } from 'ioredis';
import type {
  CompetitiveMatchingOptions,
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

const COMPETITIVE_ENQUEUE_AND_MATCH_LUA = `
local userIndexKey = KEYS[1]
local bucketKey = KEYS[2]
local userId = ARGV[1]
local entryJson = ARGV[2]
local quota = math.floor(tonumber(ARGV[3]))
local nowMs = math.floor(tonumber(ARGV[4]))
local baseWindow = tonumber(ARGV[5])
local growthPerTenSeconds = tonumber(ARGV[6])
local maximumWindow = tonumber(ARGV[7])
local scanLimit = math.floor(tonumber(ARGV[8]))

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
  if #active > 0 then redis.call("EXPIRE", bKey, 3600) end
  return active
end

local existingBucket = redis.call("HGET", userIndexKey, userId)
if existingBucket then
  local existingItems = purgeBucket(existingBucket)
  for idx = 1, #existingItems do
    local player = cjson.decode(existingItems[idx])
    if player.userId == userId then
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
local callerIndex = #active

local function rating(player)
  return tonumber(player.rating) or 1500
end

local function blocked(player, otherId)
  local ids = player.blockedOpponentIds or {}
  for i = 1, #ids do
    if ids[i] == otherId then return true end
  end
  return false
end

local function restricted(left, right)
  return blocked(left, right.userId) or blocked(right, left.userId)
end

local function ratingWindow(players)
  local oldestEnqueue = nowMs
  for i = 1, #players do
    oldestEnqueue = math.min(oldestEnqueue, tonumber(players[i].enqueuedAtMs) or nowMs)
  end
  local intervals = math.floor(math.max(0, nowMs - oldestEnqueue) / 10000)
  return math.min(maximumWindow, baseWindow + intervals * growthPerTenSeconds)
end

local bestGroup = nil
local bestTeams = nil
local bestGap = nil
local bestOldest = nil

if quota == 2 then
  local caller = cjson.decode(active[callerIndex])
  for i = 1, #active do
    if i ~= callerIndex then
      local other = cjson.decode(active[i])
      local gap = math.abs(rating(caller) - rating(other))
      if not restricted(caller, other) and gap <= ratingWindow({caller, other}) then
        local oldest = math.min(caller.enqueuedAtMs, other.enqueuedAtMs)
        if bestGap == nil or gap < bestGap or (gap == bestGap and oldest < bestOldest) then
          local callerFirst = caller.enqueuedAtMs < other.enqueuedAtMs
            or (caller.enqueuedAtMs == other.enqueuedAtMs and caller.userId < other.userId)
          local firstIndex = callerFirst and callerIndex or i
          local secondIndex = callerFirst and i or callerIndex
          bestGroup = {firstIndex, secondIndex}
          bestTeams = {[firstIndex] = 0, [secondIndex] = 1}
          bestGap = gap
          bestOldest = oldest
        end
      end
    end
  end
elseif quota == 4 then
  local scan = {}
  for i = 1, math.min(#active, scanLimit) do table.insert(scan, i) end
  local callerSeen = false
  for i = 1, #scan do if scan[i] == callerIndex then callerSeen = true end end
  if not callerSeen then table.insert(scan, callerIndex) end
  local others = {}
  for i = 1, #scan do if scan[i] ~= callerIndex then table.insert(others, scan[i]) end end
  local splitPatterns = {
    {{1, 2}, {3, 4}},
    {{1, 3}, {2, 4}},
    {{1, 4}, {2, 3}}
  }
  for a = 1, #others - 2 do
    for b = a + 1, #others - 1 do
      for c = b + 1, #others do
        local group = {callerIndex, others[a], others[b], others[c]}
        local players = {}
        local oldest = nowMs
        for n = 1, 4 do
          players[n] = cjson.decode(active[group[n]])
          oldest = math.min(oldest, players[n].enqueuedAtMs)
        end
        for p = 1, #splitPatterns do
          local pattern = splitPatterns[p]
          local teamZero = {players[pattern[1][1]], players[pattern[1][2]]}
          local teamOne = {players[pattern[2][1]], players[pattern[2][2]]}
          local allowed = true
          for z = 1, 2 do
            for o = 1, 2 do
              if restricted(teamZero[z], teamOne[o]) then allowed = false end
            end
          end
          local gap = math.abs((rating(teamZero[1]) + rating(teamZero[2])) / 2 - (rating(teamOne[1]) + rating(teamOne[2])) / 2)
          if allowed and gap <= ratingWindow(players) then
            if bestGap == nil or gap < bestGap or (gap == bestGap and oldest < bestOldest) then
              bestGroup = group
              bestTeams = {}
              for z = 1, 2 do bestTeams[group[pattern[1][z]]] = 0 end
              for o = 1, 2 do bestTeams[group[pattern[2][o]]] = 1 end
              bestGap = gap
              bestOldest = oldest
            end
          end
        end
      end
    end
  end
end

if bestGroup then
  local chosen = {}
  for i = 1, #bestGroup do chosen[bestGroup[i]] = true end
  local matched = {}
  local kept = {}
  for i = 1, #active do
    if chosen[i] then
      local player = cjson.decode(active[i])
      player.team = bestTeams[i]
      redis.call("HDEL", userIndexKey, player.userId)
      table.insert(matched, cjson.encode(player))
    else
      table.insert(kept, active[i])
    end
  end
  redis.call("DEL", bucketKey)
  for i = 1, #kept do redis.call("RPUSH", bucketKey, kept[i]) end
  if #kept > 0 then redis.call("EXPIRE", bucketKey, 3600) end
  return {"MATCHED", matched}
end

return {"QUEUED", active[callerIndex], callerIndex}
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

  private bucketKey(mode: string, rulesetCode: string, competitive = false): string {
    return `${this.prefix}q:${mode}:${rulesetCode}${competitive ? ':competitive' : ''}`;
  }

  async enqueueAndTryMatch(
    entry: QueuedPlayerEntry,
    quota: number,
    nowMs: number,
    competitiveOptions?: CompetitiveMatchingOptions,
  ): Promise<EnqueueAttemptOutcome> {
    const competitive = entry.competitive === true;
    const bKey = this.bucketKey(entry.mode, entry.rulesetCode, competitive);
    const raw = (await this.redis.eval(
      competitive ? COMPETITIVE_ENQUEUE_AND_MATCH_LUA : ENQUEUE_AND_MATCH_LUA,
      2,
      this.userIndexKey(),
      bKey,
      entry.userId,
      JSON.stringify(entry),
      String(quota),
      String(nowMs),
      ...(competitive
        ? [
            String(competitiveOptions?.baseRatingWindow ?? 150),
            String(competitiveOptions?.waitGrowthPerTenSeconds ?? 25),
            String(competitiveOptions?.maximumRatingWindow ?? 800),
            String(competitiveOptions?.candidateScanLimit ?? 24),
          ]
        : [`${entry.mode}:${entry.rulesetCode}`]),
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
