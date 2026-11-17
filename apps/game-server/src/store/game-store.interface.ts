import type { GameState, RuleSet } from '@truco/engine';
import type {
  GameMode,
  PracticeConfig,
  RulesetCode,
  ServerEventType,
  TableStatus,
  TableVisibility,
} from '@truco/shared';

export interface PersistedSeatBinding {
  readonly seat: number;
  readonly team: number;
  readonly userId: string | null;
  readonly nickname: string | null;
  readonly sessionId: string | null;
  readonly ready: boolean;
  readonly connected: boolean;
  readonly disconnectedAt: number | null;
  readonly graceDeadline: number | null;
  /** `true` si el asiento lo ocupa un bot del servidor (mesas de práctica). */
  readonly isBot: boolean;
}

export type EventAudience =
  | { readonly kind: 'ALL' }
  | { readonly kind: 'SEAT'; readonly seat: number }
  | { readonly kind: 'TEAM'; readonly team: number };

export interface PersistedSequencedEvent {
  readonly eventId: string;
  readonly seq: number;
  readonly ts: number;
  readonly type: ServerEventType;
  readonly payload: Record<string, unknown>;
  readonly audience: EventAudience;
}

export interface PersistedRoomSnapshot {
  readonly roomId: string;
  readonly status: TableStatus;
  readonly mode: GameMode;
  readonly visibility?: TableVisibility;
  readonly rulesetCode: RulesetCode;
  readonly ruleset?: RuleSet;
  readonly turnTimeoutMs: number;
  readonly seats: readonly PersistedSeatBinding[];
  readonly matchId: string | null;
  readonly matchStartedAtMs?: number | null;
  readonly seedCommitment: string | null;
  readonly encryptedSeed: string | null;
  readonly revealedSeed: string | null;
  readonly gameState: GameState | null;
  readonly seq: number;
  readonly turnDeadline: number | null;
  readonly processedEventIds: readonly string[];
  readonly updatedAt: number;
  /** Presente en mesas de práctica: los asientos no humanos son bots. */
  readonly practice?: PracticeConfig;
}

export interface GameStore {
  saveRoomStateAndEvents(
    snapshot: PersistedRoomSnapshot,
    newEvents: readonly PersistedSequencedEvent[],
  ): Promise<void>;
  loadRoomSnapshot(roomId: string): Promise<PersistedRoomSnapshot | null>;
  loadRoomEventsAfter(roomId: string, afterSeq: number): Promise<PersistedSequencedEvent[]>;
  deleteRoom(roomId: string): Promise<void>;

  claimRoomOwner(roomId: string, serverId: string, ttlMs: number): Promise<boolean>;
  getRoomOwner(roomId: string): Promise<string | null>;
  releaseRoomOwner(roomId: string, serverId: string): Promise<void>;

  getUserActiveRoom(userId: string): Promise<string | null>;
  setUserActiveRoom(userId: string, roomId: string): Promise<void>;
  clearUserActiveRoom(userId: string, roomId: string): Promise<void>;

  /**
   * Consume atómicamente el identificador único (`jti`) de un ticket WS guardándolo con `ttlMs`.
   * Devuelve `true` en el primer uso y `false` si ya fue consumido dentro de su ventana de validez.
   */
  consumeWsTicket(jti: string, ttlMs: number): Promise<boolean>;

  /**
   * Consume atómicamente el `nonce` de una llamada RPC interna `api -> game-server` con `ttlMs`.
   * Devuelve `true` en el primer uso y `false` ante cualquier intento de replay dentro del TTL.
   */
  consumeInternalRpcNonce(nonce: string, ttlMs: number): Promise<boolean>;

  close(): Promise<void>;
}
