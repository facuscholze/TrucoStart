import { type RoomProvisionSpec, signInternalServicePayload } from '@truco/shared';

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
 * Adaptador HTTP firmado con HMAC-SHA256 (`internal-rpc-v1:<secret>`) hacia `apps/game-server`.
 */
export class HttpGameRoomProvisioner implements GameRoomProvisioner {
  private readonly baseUrl: string;
  private readonly internalSecret: string;

  constructor(options: { readonly baseUrl: string; readonly internalSecret: string }) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.internalSecret = options.internalSecret;
  }

  async provisionRoom(spec: RoomProvisionSpec): Promise<void> {
    const rawBody = JSON.stringify(spec);
    const sig = signInternalServicePayload(rawBody, this.internalSecret);
    const res = await fetch(`${this.baseUrl}/internal/rooms`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-internal-signature': sig,
      },
      body: rawBody,
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Fallo aprovisionando sala en game-server (${res.status}): ${text}`);
    }
  }

  async deleteRoom(roomId: string): Promise<void> {
    const canonical = `DELETE:${roomId}`;
    const sig = signInternalServicePayload(canonical, this.internalSecret);
    const res = await fetch(`${this.baseUrl}/internal/rooms/${encodeURIComponent(roomId)}`, {
      method: 'DELETE',
      headers: {
        'x-internal-signature': sig,
      },
    });
    if (!res.ok && res.status !== 404) {
      const text = await res.text();
      throw new Error(`Fallo eliminando sala en game-server (${res.status}): ${text}`);
    }
  }
}
