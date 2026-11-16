import { randomBytes } from 'node:crypto';
import { buildSignedInternalRpcHeaders, type RoomProvisionSpec } from '@truco/shared';

export const GAME_ROOM_PROVISIONER = Symbol('GAME_ROOM_PROVISIONER');

export interface GameRoomProvisioner {
  provisionRoom(spec: RoomProvisionSpec): Promise<void>;
  deleteRoom(roomId: string): Promise<void>;
}

/**
 * Adaptador en memoria para tests HTTP donde no se levanta un proceso `game-server` real.
 */
export class InMemoryGameRoomProvisioner implements GameRoomProvisioner {
  private readonly rooms = new Map<string, RoomProvisionSpec>();

  async provisionRoom(spec: RoomProvisionSpec): Promise<void> {
    this.rooms.set(spec.roomId, structuredClone(spec));
  }

  async deleteRoom(roomId: string): Promise<void> {
    this.rooms.delete(roomId);
  }

  getProvisionedRoom(roomId: string): RoomProvisionSpec | undefined {
    const found = this.rooms.get(roomId);
    return found ? structuredClone(found) : undefined;
  }
}

/**
 * Adaptador HTTP con protección anti-replay (`x-internal-timestamp`, `x-internal-nonce`,
 * `x-internal-signature` con HMAC-SHA256 `internal-rpc-v2:<secret>`) hacia `apps/game-server`.
 */
export class HttpGameRoomProvisioner implements GameRoomProvisioner {
  private readonly baseUrl: string;
  private readonly internalSecret: string;
  private readonly nowFn: () => number;

  constructor(options: {
    readonly baseUrl: string;
    readonly internalSecret: string;
    readonly nowFn?: () => number;
  }) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.internalSecret = options.internalSecret;
    this.nowFn = options.nowFn ?? Date.now;
  }

  async provisionRoom(spec: RoomProvisionSpec): Promise<void> {
    const path = '/internal/rooms';
    const rawBody = JSON.stringify(spec);
    const rpcHeaders = buildSignedInternalRpcHeaders(
      {
        method: 'POST',
        path,
        timestampMs: this.nowFn(),
        nonce: randomBytes(16).toString('base64url'),
        rawBody,
      },
      this.internalSecret,
    );

    const res = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...rpcHeaders,
      },
      body: rawBody,
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Fallo aprovisionando sala en game-server (${res.status}): ${text}`);
    }
  }

  async deleteRoom(roomId: string): Promise<void> {
    const path = `/internal/rooms/${encodeURIComponent(roomId)}`;
    const rpcHeaders = buildSignedInternalRpcHeaders(
      {
        method: 'DELETE',
        path,
        timestampMs: this.nowFn(),
        nonce: randomBytes(16).toString('base64url'),
        rawBody: '',
      },
      this.internalSecret,
    );

    const res = await fetch(`${this.baseUrl}${path}`, {
      method: 'DELETE',
      headers: rpcHeaders,
    });
    if (!res.ok && res.status !== 404) {
      const text = await res.text();
      throw new Error(`Fallo eliminando sala en game-server (${res.status}): ${text}`);
    }
  }
}
