import { randomUUID } from 'node:crypto';
import type { ClientMessage, ErrorCode, WsAuthTicketClaims, WsEnvelope } from '@truco/shared';
import type { Socket } from 'socket.io';
import type { GameStore } from '../store/game-store.interface.js';
import { RoomActor, type RoomActorDeps } from './room-actor.js';

const DEFAULT_OWNER_LEASE_TTL_MS = 60_000;

export interface RoomManagerOptions extends RoomActorDeps {
  readonly serverId?: string;
  readonly ownerLeaseTtlMs?: number;
}

export class RoomManager {
  readonly serverId: string;
  private readonly store: GameStore;
  private readonly actorDeps: RoomActorDeps;
  private readonly ownerLeaseTtlMs: number;
  private readonly rooms = new Map<string, RoomActor>();
  private readonly recovering = new Map<string, Promise<RoomActor | null>>();
  private readonly socketToRooms = new Map<string, { userId: string; rooms: Set<string> }>();
  private draining = false;

  constructor(options: RoomManagerOptions) {
    this.serverId = options.serverId ?? `gs-${randomUUID().slice(0, 8)}`;
    this.store = options.store;
    this.ownerLeaseTtlMs = options.ownerLeaseTtlMs ?? DEFAULT_OWNER_LEASE_TTL_MS;
    this.actorDeps = options;
  }

  private sendError(socket: Socket, code: ErrorCode, message: string, refEventId?: string): void {
    const wire: WsEnvelope = {
      eventId: randomUUID(),
      ts: (this.actorDeps.nowFn ?? Date.now)(),
      type: 'error',
      payload: { code, message, ...(refEventId ? { refEventId } : {}) },
    };
    socket.emit('envelope', wire);
  }

  private trackSocketRoom(socket: Socket, userId: string, roomId: string): void {
    const entry = this.socketToRooms.get(socket.id) ?? { userId, rooms: new Set<string>() };
    entry.rooms.add(roomId);
    this.socketToRooms.set(socket.id, entry);
  }

  async getOrRecoverRoom(
    roomId: string,
    createIfMissing?: Extract<ClientMessage, { type: 'table.join' }>['payload'],
  ): Promise<RoomActor | 'OWNED_ELSEWHERE' | null> {
    const existing = this.rooms.get(roomId);
    if (existing) {
      await this.store.claimRoomOwner(roomId, this.serverId, this.ownerLeaseTtlMs);
      return existing;
    }

    const inflight = this.recovering.get(roomId);
    if (inflight) {
      return inflight;
    }

    const loadPromise = (async (): Promise<RoomActor | null> => {
      const claimed = await this.store.claimRoomOwner(roomId, this.serverId, this.ownerLeaseTtlMs);
      if (!claimed) {
        return null;
      }

      const snap = await this.store.loadRoomSnapshot(roomId);
      if (snap) {
        const recovered = RoomActor.recoverFromSnapshot(snap, this.actorDeps);
        this.rooms.set(roomId, recovered);
        return recovered;
      }

      if (createIfMissing) {
        const fresh = RoomActor.createFresh(
          {
            roomId,
            mode: createIfMissing.mode ?? '1v1',
            rulesetCode: createIfMissing.rulesetCode ?? 'ar-standard-v1',
            ...(createIfMissing.turnTimeoutMs !== undefined
              ? { turnTimeoutMs: createIfMissing.turnTimeoutMs }
              : {}),
          },
          this.actorDeps,
        );
        this.rooms.set(roomId, fresh);
        return fresh;
      }

      await this.store.releaseRoomOwner(roomId, this.serverId);
      return null;
    })();

    this.recovering.set(roomId, loadPromise);
    try {
      const result = await loadPromise;
      if (result === null) {
        const currentOwner = await this.store.getRoomOwner(roomId);
        if (currentOwner && currentOwner !== this.serverId) {
          return 'OWNED_ELSEWHERE';
        }
      }
      return result;
    } finally {
      this.recovering.delete(roomId);
    }
  }

  async dispatchClientMessage(
    socket: Socket,
    claims: WsAuthTicketClaims,
    msg: ClientMessage,
  ): Promise<void> {
    const roomId = msg.payload.roomId;

    if (this.draining && msg.type === 'table.join' && !this.rooms.has(roomId)) {
      this.sendError(
        socket,
        'INVALID_STATE',
        'Servidor en proceso de drenaje; intentá en otra instancia',
        msg.eventId,
      );
      return;
    }

    const roomResult = await this.getOrRecoverRoom(
      roomId,
      msg.type === 'table.join' ? msg.payload : undefined,
    );

    if (roomResult === 'OWNED_ELSEWHERE') {
      this.sendError(
        socket,
        'CONFLICT',
        'La sala está asignada a otra instancia activa del servidor',
        msg.eventId,
      );
      return;
    }

    if (!roomResult) {
      this.sendError(socket, 'NOT_FOUND', `Sala inexistente: ${roomId}`, msg.eventId);
      return;
    }

    this.trackSocketRoom(socket, claims.userId, roomId);
    await roomResult.handleMessage(socket, claims, msg);
  }

  async handleSocketDisconnect(socket: Socket): Promise<void> {
    const tracked = this.socketToRooms.get(socket.id);
    this.socketToRooms.delete(socket.id);
    if (!tracked) return;

    for (const roomId of tracked.rooms) {
      const actor = this.rooms.get(roomId);
      if (actor) {
        await actor.handleDisconnect(socket, tracked.userId);
      }
    }
  }

  setDraining(enabled = true): void {
    this.draining = enabled;
  }

  getActiveRoomCount(): number {
    return this.rooms.size;
  }

  disposeLocalTimersOnly(): void {
    for (const actor of this.rooms.values()) {
      actor.dispose();
    }
    this.rooms.clear();
    this.socketToRooms.clear();
  }

  async shutdown(): Promise<void> {
    for (const [roomId, actor] of this.rooms.entries()) {
      actor.dispose();
      await this.store.releaseRoomOwner(roomId, this.serverId);
    }
    this.rooms.clear();
    this.socketToRooms.clear();
  }
}
