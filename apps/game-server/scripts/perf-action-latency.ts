/**
 * Benchmark de latencia de acción del game-server (M8b).
 *
 * Mide, en el sandbox y sin Docker, el camino real: cliente socket.io → autenticación de
 * ticket WS → `RoomActor` → broadcast de la acción al otro asiento. **No** mide red real
 * (todo corre en loopback) ni PostgreSQL/Redis (usa `InMemoryGameStore`): sirve como cota
 * inferior de CPU y para detectar regresiones, no como número de producción.
 *
 * Uso:
 *   PERF_ROOMS=25 PERF_ACTIONS=40 pnpm --filter @truco/game-server perf:actions
 */

import { randomUUID } from 'node:crypto';
import { AR_STANDARD_V1 } from '@truco/engine';
import { signWsAuthTicket, type RoomProvisionSpec } from '@truco/shared';
import { io as createClient, type Socket as ClientSocket } from 'socket.io-client';
import { GameMetrics } from '../src/observability/game-metrics.js';
import { createGameServer, type GameServerInstance } from '../src/server.js';

// Secreto ficticio del bench local (no se usa en ningún entorno real).
const SECRET = 'perf-bench-local-fixture-32-caracteres!!';
const ROOMS = Number(process.env['PERF_ROOMS'] ?? 25);
const ACTIONS_PER_ROOM = Number(process.env['PERF_ACTIONS'] ?? 40);

/** Alterna `ready` para que cada acción provoque un broadcast nuevo. */
let readyToggle = false;

interface ClientHandle {
  readonly socket: ClientSocket;
  readonly roomId: string;
  readonly userId: string;
}

function buildSpec(roomId: string): RoomProvisionSpec {
  return {
    roomId,
    mode: '1v1',
    visibility: 'PRIVATE',
    rulesetCode: 'ar-standard-v1',
    ruleset: AR_STANDARD_V1 as unknown as Record<string, unknown>,
    targetScore: 15,
    florEnabled: false,
    turnTimeoutMs: 30_000,
  };
}

async function connectClient(port: number, roomId: string, index: number): Promise<ClientHandle> {
  const userId = `019a7e40-0000-7000-8000-${String(100_000 + index).padStart(12, '0')}`;
  const token = signWsAuthTicket(
    {
      jti: randomUUID(),
      userId,
      sessionId: `sess-perf-${index}-0001`,
      nickname: `Perf${index}`,
      exp: Date.now() + 300_000,
    },
    SECRET,
  );
  const socket = createClient(`http://127.0.0.1:${port}`, {
    transports: ['websocket'],
    auth: { token },
    reconnection: false,
  });
  await new Promise<void>((resolve, reject) => {
    socket.once('connect', () => resolve());
    socket.once('connect_error', (error) => reject(error));
  });
  return { socket, roomId, userId };
}

function send(socket: ClientSocket, type: string, payload: Record<string, unknown>): string {
  const eventId = randomUUID();
  socket.emit('envelope', { eventId, ts: Date.now(), type, payload });
  return eventId;
}

/**
 * Acción medida: `table.ready` (toggle). Es la acción idempotente y siempre válida en
 * `WAITING` que recorre el camino completo dispatch → `RoomActor` → proyección →
 * broadcast a los dos asientos. Las acciones de juego (`game.playCard`, etc.) requieren
 * turno y estado `IN_GAME`; su latencia se mide en producción con
 * `truco_action_duration_seconds` (ver `docs/PERF.md`).
 */
async function measureAction(client: ClientHandle): Promise<number> {
  const started = performance.now();
  readyToggle = !readyToggle;
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('timeout esperando table.state')), 5_000);
    const onEnvelope = (envelope: { type?: string }) => {
      if (envelope?.type !== 'table.state') return;
      clearTimeout(timeout);
      client.socket.off('envelope', onEnvelope);
      resolve();
    };
    client.socket.on('envelope', onEnvelope);
    send(client.socket, 'table.ready', { roomId: client.roomId, ready: readyToggle });
  });
  return performance.now() - started;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index] ?? 0;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

async function main(): Promise<void> {
  const server: GameServerInstance = createGameServer({
    sessionSecret: SECRET,
    internalSecret: SECRET,
    seedEncryptionKey: SECRET,
    allowAdHocRooms: false,
    idleSweepIntervalMs: 0,
    maxConnectionsPerUser: 1_000,
    maxConnectionsPerIp: 10_000,
    rateLimiter: { windowMs: 1_000, actionMax: 1_000_000, chatMax: 1_000_000, tableMax: 1_000_000 },
  });

  const port = await server.listen(0, '127.0.0.1');
  const latencies: number[] = [];
  const clients: ClientHandle[] = [];
  const memoryBefore = process.memoryUsage().heapUsed;

  try {
    for (let room = 0; room < ROOMS; room += 1) {
      const roomId = `019a7e40-0000-7000-8000-${String(200_000 + room).padStart(12, '0')}`;
      await server.provisionRoom(buildSpec(roomId));
      const first = await connectClient(port, roomId, room * 2);
      const second = await connectClient(port, roomId, room * 2 + 1);
      clients.push(first, second);
      send(first.socket, 'table.join', { roomId });
      send(second.socket, 'table.join', { roomId });
      await new Promise((resolve) => setTimeout(resolve, 25));
    }

    // Calentamiento: 5 acciones por sala antes de medir.
    for (const client of clients.slice(0, Math.min(clients.length, 10))) {
      await measureAction(client).catch(() => 0);
    }

    const startedAt = performance.now();
    for (const client of clients) {
      for (let action = 0; action < ACTIONS_PER_ROOM; action += 1) {
        try {
          latencies.push(await measureAction(client));
        } catch {
          // Acción rechazada (p. ej. sala en estado inesperado): no cuenta para la latencia.
        }
      }
    }
    const elapsedMs = performance.now() - startedAt;
    const memoryAfter = process.memoryUsage().heapUsed;

    const sorted = [...latencies].sort((a, b) => a - b);
    const metrics = server.metrics ?? new GameMetrics();
    const snapshot = metrics.snapshot(server.roomManager.getStatusCounts());

    const report = {
      measuredAt: new Date().toISOString(),
      environment: {
        node: process.version,
        platform: `${process.platform}/${process.arch}`,
        transport: 'loopback websocket (socket.io-client)',
        store: 'InMemoryGameStore (sin Redis ni PostgreSQL)',
        rooms: ROOMS,
        actionsPerRoom: ACTIONS_PER_ROOM,
      },
      actions: {
        measured: sorted.length,
        failed: ROOMS * 2 * ACTIONS_PER_ROOM - sorted.length,
        elapsedMs: round(elapsedMs),
        rps: round((sorted.length / Math.max(elapsedMs, 1)) * 1000),
        p50Ms: round(percentile(sorted, 50)),
        p95Ms: round(percentile(sorted, 95)),
        p99Ms: round(percentile(sorted, 99)),
        maxMs: round(sorted[sorted.length - 1] ?? 0),
        minMs: round(sorted[0] ?? 0),
      },
      memory: {
        heapBeforeMB: round(memoryBefore / 1024 / 1024),
        heapAfterMB: round(memoryAfter / 1024 / 1024),
        // El delta incluye GC y estructuras de socket.io: es orientativo, no una fuga medida.
        heapDeltaKb: round((memoryAfter - memoryBefore) / 1024),
      },
      rooms: {
        active: server.roomManager.getActiveRoomCount(),
        byStatus: snapshot.roomsByStatus,
        wsConnections: snapshot.wsConnections,
      },
    };

    console.log(JSON.stringify(report, null, 2));
  } finally {
    for (const client of clients) client.socket.close();
    await server.close();
  }
}

main().catch((error: unknown) => {
  console.error('Benchmark falló:', error);
  process.exitCode = 1;
});
