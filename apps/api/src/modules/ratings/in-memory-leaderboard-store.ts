import type {
  LeaderboardChange,
  LeaderboardScore,
  LeaderboardStore,
} from './leaderboard-store.interface.js';

function compareScores(left: LeaderboardScore, right: LeaderboardScore): number {
  if (left.score !== right.score) return right.score - left.score;
  return right.userId.localeCompare(left.userId);
}

export class InMemoryLeaderboardStore implements LeaderboardStore {
  private readonly leaderboards = new Map<string, Map<string, number>>();

  async replaceLeaderboard(key: string, scores: readonly LeaderboardScore[]): Promise<void> {
    const next = new Map<string, number>();
    for (const item of scores) next.set(item.userId, item.score);
    this.leaderboards.set(key, next);
  }

  async projectLeaderboard(
    key: string,
    changes: readonly LeaderboardChange[],
    _ttlSeconds: number,
  ): Promise<void> {
    const scores = this.leaderboards.get(key) ?? new Map<string, number>();
    for (const item of changes) {
      if (item.eligible) scores.set(item.userId, item.score);
      else scores.delete(item.userId);
    }
    this.leaderboards.set(key, scores);
  }

  async readPage(key: string, offset: number, limit: number): Promise<readonly LeaderboardScore[]> {
    const scores = this.leaderboards.get(key) ?? new Map<string, number>();
    return [...scores]
      .map(([userId, score]) => ({ userId, score }))
      .sort(compareScores)
      .slice(offset, offset + limit);
  }

  async rankOf(key: string, userId: string): Promise<number | null> {
    const scores = this.leaderboards.get(key) ?? new Map<string, number>();
    const ordered = [...scores]
      .map(([candidateId, score]) => ({ userId: candidateId, score }))
      .sort(compareScores);
    const rank = ordered.findIndex((item) => item.userId === userId);
    return rank < 0 ? null : rank + 1;
  }

  async close(): Promise<void> {
    this.leaderboards.clear();
  }
}
