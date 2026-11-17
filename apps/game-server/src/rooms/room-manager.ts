import { randomUUID } from 'node:crypto';
import { type RuleSet, validateRuleSet } from '@truco/engine';
import type {
  ClientMessage,
  ErrorCode,
  RoomProvisionSpec,
  TableStatus,
  WsAuthTicketClaims,
  WsEnvelope,
} from '@truco/shared';
import type { Socket } from 'socket.io';
import type { GameStore } from '../store/game-store.interface.js';
import { RoomActor, type RoomActorDeps } from './room-actor.js';

const DEFAULT_OWNER_LEASE_TTL_MS = 60_000;
/** TTL por defecto de una sala sin conexiones activas (10 minutos). */
export const DEFAULT_IDLE_ROOM_TTL_MS = 10 * 60_000;

export interface RoomManagerOptions extends RoomActorDeps {
  readonly serverId?: string;
  readonly ownerLeaseTtlMs?: number;
  readonly allowAdHocRooms?: boolean;
  /** TTL de inactividad (sin conexiones) tras el cual la sala se destruye. */
  readonly idleRoomTtlMs?: number;
}

export interface ExpiredRoomInfo {
  readonly roomId: string;
  readonly tableStatus: TableStatus;
  readonly reason: 'IDLE_TIMEOUT' | 'FINISHED_TTL';
  readonly expiredAtMs: number;
}

export interface RoomManagerSweepResult {
  readonly expiredRooms: readonly ExpiredRoomInfo[];
}

export class RoomManager {
  readonly serverId: string;
  private readonly store: GameStore;
  private readonly actorDeps: RoomActorDeps;
  private readonly ownerLeaseTtlMs: number;
  private readonly allowAdHocRooms: boolean;
  private readonly rooms = new Map<string, RoomActor>();
  private readonly idleSinceByRoom = new Map<string, number>();
  private readonly idleRoomTtlMs: number;
  private readonly recovering = new Map<string, Promise<RoomActor | null>>();
  private readonly socketToRooms = new Map<string, { userId: string; rooms: Set<string> }>();
  private draining = false;

  constructor(options: RoomManagerOptions) {
    this.serverId = options.serverId ?? `gs-${randomUUID().slice(0, 8)}`;
    this.store = options.store;
    this.ownerLeaseTtlMs = options.ownerLeaseTtlMs ?? DEFAULT_OWNER_LEASE_TTL_MS;
    this.allowAdHocRooms = options.allowAdHocRooms ?? true;
    this.idleRoomTtlMs = options.idleRoomTtlMs ?? DEFAULT_IDLE_ROOM_TTL_MS;
    this.actorDeps = options;
  }

  async provisionRoom(spec: RoomProvisionSpec): Promise<void> {
    if (this.draining) {
      throw new Error('Servidor en proceso de drenaje');
    }
    const candidateRuleset = spec.ruleset as unknown as RuleSet;
    const validation = validateRuleSet(candidateRuleset);
    if (!validation.ok) {
      throw new Error(`RuleSet inválido al aprovisionar sala: ${validation.error.message}`);
    }

    const claimed = await this.store.claimRoomOwner(
      spec.roomId,
      this.serverId,
      this.ownerLeaseTtlMs,
    );
    if (!claimed) {
      throw new Error(`La sala ${spec.roomId} ya está asignada a otro servidor`);
    }

    const existing = this.rooms.get(spec.roomId);
    if (existing) {
      return;
    }

    const fresh = RoomActor.createFresh(
      {
        roomId: spec.roomId,
        mode: spec.mode,
        visibility: spec.visibility,
        rulesetCode: spec.rulesetCode,
        ruleset: validation.value,
        turnTimeoutMs: spec.turnTimeoutMs,
        ...(spec.practice ? { practice: spec.practice } : {}),
      },
      this.actorDeps,
    );
    await fresh.persistInitialSnapshot();
    this.rooms.set(spec.roomId, fresh);
    this.idleSinceByRoom.set(spec.roomId, this.now());
  }

  async closeProvisionedRoom(roomId: string): Promise<void> {
    const actor = this.rooms.get(roomId);
    if (actor) {
      actor.dispose();
      await actor.clearAllSeatedUsers();
      this.rooms.delete(roomId);
    } else {
      const snap = await this.store.loadRoomSnapshot(roomId);
      if (snap) {
        for (const s of snap.seats) {
          if (s.userId) {
            await this.store.clearUserActiveRoom(s.userId, roomId);
          }
        }
      }
    }
    await this.store.deleteRoom(roomId);
    await this.store.releaseRoomOwner(roomId, this.serverId);
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
        if (!this.idleSinceByRoom.has(roomId)) {
          this.idleSinceByRoom.set(roomId, this.now());
        }
        return recovered;
      }

      if (createIfMissing && this.allowAdHocRooms) {
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
        this.idleSinceByRoom.set(roomId, this.now());
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
    this.idleSinceByRoom.delete(roomId);
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
      if (!this.hasConnectedSockets(roomId)) {
        this.idleSinceByRoom.set(roomId, this.now());
      }
    }
  }

  /**
   * Expulsa a un jugador de todas las salas de este game-server.
   * Devuelve cuántas salas y sockets se vieron afectados (para auditar/loguear).
   */
  async evictUser(
    userId: string,
    reason: string,
    disconnect: boolean,
  ): Promise<{ rooms: string[]; sockets: number }> {
    const affected: string[] = [];
    const socketIds = new Set<string>();
    for (const [socketId, tracked] of this.socketToRooms) {
      if (tracked.userId === userId) socketIds.add(socketId);
    }

    for (const [roomId, actor] of this.rooms) {
      const evicted = await actor.evictUser(userId, reason, disconnect);
      if (evicted) affected.push(roomId);
    }

    if (disconnect) {
      for (const socketId of socketIds) {
        const tracked = this.socketToRooms.get(socketId);
        this.socketToRooms.delete(socketId);
        if (tracked) {
          for (const roomId of tracked.rooms) {
            if (!this.hasConnectedSockets(roomId)) this.idleSinceByRoom.set(roomId, this.now());
          }
        }
      }
      await this.store.clearUserActiveRoom(userId, affected[0] ?? '');
    } else {
      for (const actor of this.rooms.values()) actor.invalidateModerationCache(userId);
    }

    return { rooms: affected, sockets: socketIds.size };
  }

  private now(): number {
    return (this.actorDeps.nowFn ?? Date.now)();
  }

  private hasConnectedSockets(roomId: string): boolean {
    for (const tracked of this.socketToRooms.values()) {
      if (tracked.rooms.has(roomId)) return true;
    }
    return false;
  }

  /**
   * Barrido de inactividad: destruye las salas sin conexiones activas que superaron el TTL
   * configurado (10 minutos por defecto) y devuelve la información para publicar `room.expired`.
   * Es idempotente y seguro de invocar en cada tick del servidor.
   */
  async sweepIdleRooms(nowMs = this.now()): Promise<RoomManagerSweepResult> {
    const expiredRooms: ExpiredRoomInfo[] = [];

    for (const [roomId, actor] of [...this.rooms.entries()]) {
      if (this.hasConnectedSockets(roomId) || actor.countConnectedSeats() > 0) {
        this.idleSinceByRoom.delete(roomId);
        continue;
      }

      const idleSince = this.idleSinceByRoom.get(roomId);
      if (idleSince === undefined) {
        this.idleSinceByRoom.set(roomId, nowMs);
        continue;
      }
      if (nowMs - idleSince < this.idleRoomTtlMs) {
        continue;
      }

      const tableStatus = actor.getTableStatus();
      await this.closeProvisionedRoom(roomId);
      this.idleSinceByRoom.delete(roomId);
      expiredRooms.push({
        roomId,
        tableStatus,
        reason: tableStatus === 'FINISHED' ? 'FINISHED_TTL' : 'IDLE_TIMEOUT',
        expiredAtMs: nowMs,
      });
    }

    return { expiredRooms };
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
    this.idleSinceByRoom.clear();
  }

  async shutdown(): Promise<void> {
    for (const [roomId, actor] of this.rooms.entries()) {
      actor.dispose();
      await this.store.releaseRoomOwner(roomId, this.serverId);
    }
    this.rooms.clear();
    this.socketToRooms.clear();
    this.idleSinceByRoom.clear();
  }
}
