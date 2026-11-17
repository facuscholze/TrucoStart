import type { GameMode, RulesetCode } from '@truco/shared';

export const MATCHMAKING_STORE = Symbol('MATCHMAKING_STORE');

export interface QueuedPlayerEntry {
  readonly userId: string;
  readonly nickname: string;
  readonly mode: GameMode;
  readonly rulesetCode: RulesetCode;
  readonly enqueuedAtMs: number;
  readonly expiresAtMs: number;
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
  ): Promise<EnqueueAttemptOutcome>;

  getUserQueue(userId: string, nowMs: number): Promise<UserQueueLookup>;

  cancelUserQueue(userId: string): Promise<boolean>;

  close(): Promise<void>;
}
