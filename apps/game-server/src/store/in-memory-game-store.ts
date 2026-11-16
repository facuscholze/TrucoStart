import type {
  GameStore,
  PersistedRoomSnapshot,
  PersistedSequencedEvent,
} from './game-store.interface.js';

interface OwnerLease {
  readonly serverId: string;
  readonly expiresAt: number;
}

export class InMemoryGameStore implements GameStore {
  private readonly snapshots = new Map<string, PersistedRoomSnapshot>();
  private readonly eventLogs = new Map<string, PersistedSequencedEvent[]>();
  private readonly owners = new Map<string, OwnerLease>();
  private readonly userActiveRooms = new Map<string, string>();
  private readonly consumedTicketJtis = new Map<string, number>();
  private readonly nowFn: () => number;

  constructor(nowFn: () => number = Date.now) {
    this.nowFn = nowFn;
  }

  async saveRoomStateAndEvents(
    snapshot: PersistedRoomSnapshot,
    newEvents: readonly PersistedSequencedEvent[],
  ): Promise<void> {
    this.snapshots.set(snapshot.roomId, structuredClone(snapshot));
    const existing = this.eventLogs.get(snapshot.roomId) ?? [];
    for (const ev of newEvents) {
      existing.push(structuredClone(ev));
    }
    this.eventLogs.set(snapshot.roomId, existing);
  }

  async loadRoomSnapshot(roomId: string): Promise<PersistedRoomSnapshot | null> {
    const snap = this.snapshots.get(roomId);
    return snap ? structuredClone(snap) : null;
  }

  async loadRoomEventsAfter(roomId: string, afterSeq: number): Promise<PersistedSequencedEvent[]> {
    const events = this.eventLogs.get(roomId) ?? [];
    return events.filter((ev) => ev.seq > afterSeq).map((ev) => structuredClone(ev));
  }

  async deleteRoom(roomId: string): Promise<void> {
    this.snapshots.delete(roomId);
    this.eventLogs.delete(roomId);
    this.owners.delete(roomId);
  }

  async claimRoomOwner(roomId: string, serverId: string, ttlMs: number): Promise<boolean> {
    const now = this.nowFn();
    const current = this.owners.get(roomId);
    if (current && current.expiresAt > now && current.serverId !== serverId) {
      return false;
    }
    this.owners.set(roomId, { serverId, expiresAt: now + ttlMs });
    return true;
  }

  async getRoomOwner(roomId: string): Promise<string | null> {
    const now = this.nowFn();
    const current = this.owners.get(roomId);
    if (!current || current.expiresAt <= now) {
      this.owners.delete(roomId);
      return null;
    }
    return current.serverId;
  }

  async releaseRoomOwner(roomId: string, serverId: string): Promise<void> {
    const current = this.owners.get(roomId);
    if (current && current.serverId === serverId) {
      this.owners.delete(roomId);
    }
  }

  async getUserActiveRoom(userId: string): Promise<string | null> {
    return this.userActiveRooms.get(userId) ?? null;
  }

  async setUserActiveRoom(userId: string, roomId: string): Promise<void> {
    this.userActiveRooms.set(userId, roomId);
  }

  async clearUserActiveRoom(userId: string, roomId: string): Promise<void> {
    if (this.userActiveRooms.get(userId) === roomId) {
      this.userActiveRooms.delete(userId);
    }
  }

  async consumeWsTicket(jti: string, ttlMs: number): Promise<boolean> {
    const now = this.nowFn();
    for (const [key, exp] of this.consumedTicketJtis.entries()) {
      if (exp <= now) this.consumedTicketJtis.delete(key);
    }
    const existingExp = this.consumedTicketJtis.get(jti);
    if (existingExp !== undefined && existingExp > now) {
      return false;
    }
    this.consumedTicketJtis.set(jti, now + Math.max(1, ttlMs));
    return true;
  }

  async close(): Promise<void> {
    // No-op para almacenamiento en memoria
  }
}
