export const LEADERBOARD_STORE = Symbol('LEADERBOARD_STORE');

export interface LeaderboardScore {
  readonly userId: string;
  readonly score: number;
}

export interface LeaderboardChange extends LeaderboardScore {
  readonly eligible: boolean;
}

export interface LeaderboardStore {
  replaceLeaderboard(
    key: string,
    scores: readonly LeaderboardScore[],
    ttlSeconds?: number,
  ): Promise<void>;
  projectLeaderboard(
    key: string,
    changes: readonly LeaderboardChange[],
    ttlSeconds: number,
  ): Promise<void>;
  readPage(key: string, offset: number, limit: number): Promise<readonly LeaderboardScore[]>;
  rankOf(key: string, userId: string): Promise<number | null>;
  close(): Promise<void>;
}
