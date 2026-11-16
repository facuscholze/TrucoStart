import type { EnvidoChainState, FlorChainState, TrucoTrackState } from './calls.js';
import type { EnvidoBidType, FlorBidType, RuleSet, TrucoBidType } from './rulesets.js';
import type { Card, CardId, PlayerSeat, SeatId, TeamId } from './types.js';

export type EnvidoDecision = 'QUIERO' | 'NO_QUIERO';
export type FlorDecision = 'CON_FLOR_QUIERO' | 'ACHICO';
export type TrucoDecision = 'QUIERO' | 'NO_QUIERO';

export type Action =
  | { readonly type: 'PLAY_CARD'; readonly seat: SeatId; readonly cardId: CardId }
  | { readonly type: 'CALL_ENVIDO'; readonly seat: SeatId; readonly bid: EnvidoBidType }
  | { readonly type: 'RESPOND_ENVIDO'; readonly seat: SeatId; readonly decision: EnvidoDecision }
  | { readonly type: 'CALL_FLOR'; readonly seat: SeatId; readonly bid: FlorBidType }
  | { readonly type: 'RESPOND_FLOR'; readonly seat: SeatId; readonly decision: FlorDecision }
  | { readonly type: 'CALL_TRUCO'; readonly seat: SeatId; readonly bid: TrucoBidType }
  | { readonly type: 'RESPOND_TRUCO'; readonly seat: SeatId; readonly decision: TrucoDecision }
  | { readonly type: 'FOLD_HAND'; readonly seat: SeatId }
  | { readonly type: 'SEND_SIGNAL'; readonly seat: SeatId; readonly signalId: string }
  | { readonly type: 'SYSTEM_TIMEOUT'; readonly seat: SeatId }
  | { readonly type: 'SYSTEM_ABANDON'; readonly seat: SeatId };

export type ScoreReason = 'ENVIDO' | 'FLOR' | 'TRUCO_DECLINED' | 'HAND_WON' | 'FOLD' | 'ABANDON';

export type HandEndReason = 'ROUNDS' | 'TRUCO_DECLINED' | 'FOLD' | 'TARGET_REACHED';

export type DomainEvent =
  | {
      readonly type: 'MATCH_STARTED';
      readonly rulesetCode: string;
      readonly targetScore: number;
      readonly seats: readonly PlayerSeat[];
    }
  | {
      readonly type: 'HAND_STARTED';
      readonly handNumber: number;
      readonly manoSeat: SeatId;
    }
  | {
      readonly type: 'CARD_PLAYED';
      readonly handNumber: number;
      readonly roundIndex: number;
      readonly seat: SeatId;
      readonly team: TeamId;
      readonly card: Card;
    }
  | {
      readonly type: 'ROUND_ENDED';
      readonly handNumber: number;
      readonly roundIndex: number;
      readonly winnerTeam: TeamId | null;
      readonly winningSeat: SeatId | null;
      readonly isParda: boolean;
    }
  | {
      readonly type: 'ENVIDO_CALLED';
      readonly handNumber: number;
      readonly seat: SeatId;
      readonly team: TeamId;
      readonly bid: EnvidoBidType;
      readonly cancelledPendingTruco: boolean;
    }
  | {
      readonly type: 'ENVIDO_RESOLVED';
      readonly handNumber: number;
      readonly accepted: boolean;
      readonly responderSeat: SeatId;
      readonly winningTeam: TeamId;
      readonly winningSeat: SeatId | null;
      readonly winningScore: number | null;
      readonly pointsAwarded: number;
      readonly declaredScoresBySeat?: Readonly<Record<SeatId, number>>;
    }
  | {
      readonly type: 'FLOR_CALLED';
      readonly handNumber: number;
      readonly seat: SeatId;
      readonly team: TeamId;
      readonly bid: FlorBidType;
    }
  | {
      readonly type: 'FLOR_RESOLVED';
      readonly handNumber: number;
      readonly accepted: boolean;
      readonly winningTeam: TeamId;
      readonly winningSeat: SeatId;
      readonly winningScore: number | null;
      readonly pointsAwarded: number;
    }
  | {
      readonly type: 'TRUCO_CALLED';
      readonly handNumber: number;
      readonly seat: SeatId;
      readonly team: TeamId;
      readonly bid: TrucoBidType;
    }
  | {
      readonly type: 'TRUCO_ACCEPTED';
      readonly handNumber: number;
      readonly responderSeat: SeatId;
      readonly bid: TrucoBidType;
      readonly currentPoints: number;
    }
  | {
      readonly type: 'TRUCO_DECLINED';
      readonly handNumber: number;
      readonly responderSeat: SeatId;
      readonly bid: TrucoBidType;
      readonly winningTeam: TeamId;
      readonly pointsAwarded: number;
    }
  | {
      readonly type: 'PLAYER_FOLDED';
      readonly handNumber: number;
      readonly seat: SeatId;
      readonly team: TeamId;
    }
  | {
      readonly type: 'SIGNAL_SENT';
      readonly handNumber: number;
      readonly seat: SeatId;
      readonly team: TeamId;
      readonly signalId: string;
    }
  | {
      readonly type: 'SCORE_UPDATED';
      readonly handNumber: number;
      readonly team: TeamId;
      readonly delta: number;
      readonly newScore: number;
      readonly reason: ScoreReason;
    }
  | {
      readonly type: 'HAND_ENDED';
      readonly handNumber: number;
      readonly winnerTeam: TeamId;
      readonly pointsAwarded: number;
      readonly reason: HandEndReason;
    }
  | {
      readonly type: 'SYSTEM_ACTION_APPLIED';
      readonly seat: SeatId;
      readonly actionKind: 'TIMEOUT' | 'ABANDON';
      readonly resolvedAs: string;
    }
  | {
      readonly type: 'MATCH_ENDED';
      readonly winnerTeam: TeamId;
      readonly scoresByTeam: Readonly<Record<TeamId, number>>;
      readonly reason: 'TARGET_SCORE' | 'ABANDON';
    };

export interface RoundPlay {
  readonly seat: SeatId;
  readonly team: TeamId;
  readonly card: Card;
}

export interface CompletedRound {
  readonly roundIndex: number;
  readonly plays: readonly RoundPlay[];
  readonly winnerTeam: TeamId | null;
  readonly winningSeat: SeatId | null;
  readonly isParda: boolean;
}

export interface TeamSignalRecord {
  readonly seat: SeatId;
  readonly team: TeamId;
  readonly signalId: string;
  readonly roundIndex: number;
}

export type SecondaryTrackStatus = 'OPEN' | 'PENDING' | 'RESOLVED' | 'CLOSED';

export interface HandState {
  readonly handNumber: number;
  readonly manoSeat: SeatId;
  readonly currentRoundIndex: number;
  readonly roundLeadSeat: SeatId;
  readonly turnSeat: SeatId;
  readonly initialHandsBySeat: Readonly<Record<SeatId, readonly Card[]>>;
  readonly remainingHandsBySeat: Readonly<Record<SeatId, readonly Card[]>>;
  readonly currentRoundPlays: readonly RoundPlay[];
  readonly completedRounds: readonly CompletedRound[];
  readonly foldedSeats: readonly SeatId[];
  readonly envidoStatus: SecondaryTrackStatus;
  readonly envidoChain: EnvidoChainState | null;
  readonly florStatus: SecondaryTrackStatus;
  readonly florChain: FlorChainState | null;
  readonly announcedFlorSeats: readonly SeatId[];
  readonly truco: TrucoTrackState;
  readonly responderTeam: TeamId | null;
  readonly activeSeat: SeatId;
  readonly signalsSentThisHand: readonly TeamSignalRecord[];
  readonly signalCountBySeat: Readonly<Record<SeatId, number>>;
}

export type PrngState = readonly [number, number, number, number];

export interface GameState {
  readonly status: 'IN_PROGRESS' | 'FINISHED';
  readonly ruleset: RuleSet;
  readonly seats: readonly PlayerSeat[];
  readonly teams: readonly TeamId[];
  readonly scoresByTeam: Readonly<Record<TeamId, number>>;
  readonly winnerTeam: TeamId | null;
  readonly abandonedBySeat: SeatId | null;
  readonly consecutiveTimeoutsBySeat: Readonly<Record<SeatId, number>>;
  readonly hand: HandState;
  /** Estado interno serializable para repartir manos siguientes sin I/O; jamás expuesto en viewFor */
  readonly internalPrngState: PrngState;
}
