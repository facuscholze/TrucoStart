export const SUITS = ['espadas', 'bastos', 'oros', 'copas'] as const;
export type Suit = (typeof SUITS)[number];

export const RANKS = [1, 2, 3, 4, 5, 6, 7, 10, 11, 12] as const;
export type Rank = (typeof RANKS)[number];

export type CardId = `${Rank}-${Suit}`;

export interface Card {
  readonly id: CardId;
  readonly rank: Rank;
  readonly suit: Suit;
}

export type SeatId = number;
export type TeamId = number;

export interface PlayerSeat {
  readonly seat: SeatId;
  readonly team: TeamId;
  readonly playerId?: string;
}

export interface Rng {
  /** Devuelve un número en [0, 1) provisto por una fuente determinista o CSPRNG externa */
  nextFloat(): number;
}

export type OkResult<TValue> = { readonly ok: true; readonly value: TValue };
export type ErrResult<TError> = { readonly ok: false; readonly error: TError };
export type Result<TValue, TError> = OkResult<TValue> | ErrResult<TError>;

export function ok<TValue>(value: TValue): OkResult<TValue> {
  return { ok: true, value };
}

export function err<TError>(error: TError): ErrResult<TError> {
  return { ok: false, error };
}

export type RuleErrorCode =
  | 'INVALID_PLAYERS'
  | 'INVALID_RULESET'
  | 'INVALID_RNG'
  | 'MATCH_ALREADY_FINISHED'
  | 'INVALID_SEAT'
  | 'PLAYER_FOLDED'
  | 'NOT_YOUR_TURN'
  | 'CARD_NOT_IN_HAND'
  | 'PENDING_CALL_ACTIVE'
  | 'NO_PENDING_CALL'
  | 'ENVIDO_NOT_ALLOWED'
  | 'INVALID_ENVIDO_CHAIN'
  | 'FLOR_DISABLED'
  | 'FLOR_NOT_HELD'
  | 'FLOR_NOT_ALLOWED'
  | 'TRUCO_NOT_ALLOWED'
  | 'SIGNALS_DISABLED'
  | 'SIGNAL_INVALID'
  | 'SIGNAL_LIMIT_EXCEEDED';

export interface RuleError {
  readonly code: RuleErrorCode;
  readonly message: string;
}

export function ruleError(code: RuleErrorCode, message: string): ErrResult<RuleError> {
  return err({ code, message });
}
