import type {
  CompetitiveMatchingOptions,
  EnqueueAttemptOutcome,
  MatchmakingStore,
  QueuedPlayerEntry,
  UserQueueLookup,
} from './matchmaking-store.interface.js';
import { findCompetitiveMatch } from './competitive-matching.js';

function bucketKey(mode: string, rulesetCode: string, competitive = false): string {
  return `${mode}:${rulesetCode}:${competitive ? 'competitive' : 'casual'}`;
}

export class InMemoryMatchmakingStore implements MatchmakingStore {
  private readonly buckets = new Map<string, QueuedPlayerEntry[]>();
  private readonly userToBucket = new Map<string, string>();

  private purgeExpiredInBucket(bKey: string, nowMs: number): QueuedPlayerEntry[] {
    const raw = this.buckets.get(bKey) ?? [];
    const active: QueuedPlayerEntry[] = [];
    for (const item of raw) {
      if (item.expiresAtMs > nowMs && this.userToBucket.get(item.userId) === bKey) {
        active.push(item);
      } else if (this.userToBucket.get(item.userId) === bKey) {
        this.userToBucket.delete(item.userId);
      }
    }
    if (active.length === 0) {
      this.buckets.delete(bKey);
    } else {
      this.buckets.set(bKey, active);
    }
    return active;
  }

  async enqueueAndTryMatch(
    entry: QueuedPlayerEntry,
    quota: number,
    nowMs: number,
    competitiveOptions?: CompetitiveMatchingOptions,
  ): Promise<EnqueueAttemptOutcome> {
    const existingBucket = this.userToBucket.get(entry.userId);
    if (existingBucket) {
      const existingList = this.purgeExpiredInBucket(existingBucket, nowMs);
      const existingIdx = existingList.findIndex((p) => p.userId === entry.userId);
      if (existingIdx !== -1) {
        return {
          kind: 'QUEUED',
          entry: existingList[existingIdx]!,
          position: existingIdx + 1,
        };
      }
    }

    const bKey = bucketKey(entry.mode, entry.rulesetCode, entry.competitive ?? false);
    const active = this.purgeExpiredInBucket(bKey, nowMs);
    const cloned = structuredClone(entry);
    active.push(cloned);
    this.buckets.set(bKey, active);
    this.userToBucket.set(entry.userId, bKey);

    if (entry.competitive) {
      const match = findCompetitiveMatch(
        active,
        quota,
        nowMs,
        competitiveOptions ?? {
          baseRatingWindow: 150,
          waitGrowthPerTenSeconds: 25,
          maximumRatingWindow: 800,
          candidateScanLimit: 24,
        },
        entry.userId,
      );
      if (match) {
        const matchedIds = new Set(match.map((player) => player.userId));
        const remaining = active.filter((player) => !matchedIds.has(player.userId));
        if (remaining.length === 0) this.buckets.delete(bKey);
        else this.buckets.set(bKey, remaining);
        for (const player of match) this.userToBucket.delete(player.userId);
        return { kind: 'MATCHED', players: match.map((player) => structuredClone(player)) };
      }
      return {
        kind: 'QUEUED',
        entry: structuredClone(cloned),
        position: active.findIndex((player) => player.userId === entry.userId) + 1,
      };
    }

    if (active.length >= quota) {
      const matched = active.splice(0, quota);
      if (active.length === 0) {
        this.buckets.delete(bKey);
      }
      for (const m of matched) {
        this.userToBucket.delete(m.userId);
      }
      return {
        kind: 'MATCHED',
        players: matched.map((m) => structuredClone(m)),
      };
    }

    return {
      kind: 'QUEUED',
      entry: structuredClone(cloned),
      position: active.length,
    };
  }

  async getUserQueue(userId: string, nowMs: number): Promise<UserQueueLookup> {
    const bKey = this.userToBucket.get(userId);
    if (!bKey) return { status: 'IDLE' };
    const active = this.purgeExpiredInBucket(bKey, nowMs);
    const idx = active.findIndex((p) => p.userId === userId);
    if (idx === -1) return { status: 'IDLE' };
    return {
      status: 'QUEUED',
      entry: structuredClone(active[idx]!),
      position: idx + 1,
    };
  }

  async cancelUserQueue(userId: string): Promise<boolean> {
    const bKey = this.userToBucket.get(userId);
    if (!bKey) return false;
    this.userToBucket.delete(userId);
    const current = this.buckets.get(bKey);
    if (!current) return false;
    const filtered = current.filter((p) => p.userId !== userId);
    const removed = filtered.length < current.length;
    if (filtered.length === 0) {
      this.buckets.delete(bKey);
    } else {
      this.buckets.set(bKey, filtered);
    }
    return removed;
  }

  async close(): Promise<void> {
    this.buckets.clear();
    this.userToBucket.clear();
  }
}
