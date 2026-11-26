import type { UserPresenceStore } from './presence-store.interface.js';

export class InMemoryUserPresenceStore implements UserPresenceStore {
  private readonly socketsByUser = new Map<string, Map<string, number>>();

  async connect(userId: string, socketId: string, nowMs: number, ttlMs: number): Promise<void> {
    this.lease(userId, socketId, nowMs + ttlMs);
  }

  async heartbeat(userId: string, socketId: string, nowMs: number, ttlMs: number): Promise<void> {
    this.lease(userId, socketId, nowMs + ttlMs);
  }

  async disconnect(userId: string, socketId: string, nowMs: number): Promise<void> {
    const sockets = this.socketsByUser.get(userId);
    sockets?.delete(socketId);
    this.prune(userId, nowMs);
  }

  async isOnline(userId: string, nowMs: number): Promise<boolean> {
    this.prune(userId, nowMs);
    return (this.socketsByUser.get(userId)?.size ?? 0) > 0;
  }

  private lease(userId: string, socketId: string, expiresAt: number): void {
    const sockets = this.socketsByUser.get(userId) ?? new Map<string, number>();
    sockets.set(socketId, expiresAt);
    this.socketsByUser.set(userId, sockets);
  }

  private prune(userId: string, nowMs: number): void {
    const sockets = this.socketsByUser.get(userId);
    if (!sockets) return;
    for (const [socketId, expiresAt] of sockets) {
      if (expiresAt <= nowMs) sockets.delete(socketId);
    }
    if (sockets.size === 0) this.socketsByUser.delete(userId);
  }

  async close(): Promise<void> {
    this.socketsByUser.clear();
  }
}
