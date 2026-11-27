import type { GameMode, RulesetCode } from '@truco/shared';

export const MATCHMAKING_STORE = Symbol('MATCHMAKING_STORE');

export interface QueuedPlayerEntry {
  readonly userId: string;
  readonly nickname: string;
  readonly mode: GameMode;
  readonly rulesetCode: RulesetCode;
  readonly enqueuedAtMs: number;
  readonly expiresAtMs: number;
  readonly competitive?: boolean;
  readonly rating?: number;
  readonly ratingDeviation?: number;
  readonly blockedOpponentIds?: readonly string[];
  /** Sólo se fija tras un emparejamiento competitivo 2v2. */
  /** Equipo asignado al emparejar; en 3v3 puede ser 0, 1 o 2. */
  readonly team?: number;
}

export interface CompetitiveMatchingOptions {
  readonly baseRatingWindow: number;
  readonly waitGrowthPerTenSeconds: number;
  readonly maximumRatingWindow: number;
  readonly candidateScanLimit: number;
}

export type EnqueueAttemptOutcome =
  | {
      readonly kind: 'QUEUED';
      readonly entry: QueuedPlayerEntry;
      readonly position: number;
    }
  | {
      readonly kind: 'MATCHED';
      readonly players: readonly QueuedPlayerEntry[];
    };

export type UserQueueLookup =
  | { readonly status: 'IDLE' }
  | {
      readonly status: 'QUEUED';
      readonly entry: QueuedPlayerEntry;
      readonly position: number;
    };

export interface MatchmakingStore {
  enqueueAndTryMatch(
    entry: QueuedPlayerEntry,
    quota: number,
    nowMs: number,
    competitiveOptions?: CompetitiveMatchingOptions,
  ): Promise<EnqueueAttemptOutcome>;

  getUserQueue(userId: string, nowMs: number): Promise<UserQueueLookup>;

  cancelUserQueue(userId: string): Promise<boolean>;

  close(): Promise<void>;
}
