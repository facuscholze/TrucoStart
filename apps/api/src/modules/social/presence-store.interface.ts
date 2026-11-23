export const USER_PRESENCE_STORE = Symbol('USER_PRESENCE_STORE');

export const DEFAULT_SOCIAL_PRESENCE_TTL_MS = 45_000;
export const DEFAULT_SOCIAL_PRESENCE_HEARTBEAT_MS = 15_000;

/** Ephemeral per-socket presence lease. Production uses Redis; tests can use memory. */
export interface UserPresenceStore {
  connect(userId: string, socketId: string, nowMs: number, ttlMs: number): Promise<void>;
  heartbeat(userId: string, socketId: string, nowMs: number, ttlMs: number): Promise<void>;
  disconnect(userId: string, socketId: string, nowMs: number): Promise<void>;
  isOnline(userId: string, nowMs: number): Promise<boolean>;
  close(): Promise<void>;
}
