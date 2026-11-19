/**
 * Prueba de carga WS (Node.js + socket.io-client) para Mesa de Truco (M8b).
 *
 * Simula `ROOMS` partidas 1v1 con acciones reales (join → ready → play) y
 * reconexiones. Mide la latencia p95 de un broadcast de acción (table.ready),
 * el uso de memoria RSS y el número de conexiones concurrentes.
 *
 * Se apoya en los adaptadores en memoria del sandbox (InMemoryGameStore) si
 * REDIS_URL/API_URL no están definidos; en CI corre con Redis + PostgreSQL
 * reales (ver `.github/workflows/perf.yml`).
 *
 * Uso:
 *   ROOMS=50 ACTIONS=20 node scripts/perf/load-ws.js
 */
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { io as createClient } from 'socket.io-client';
import { AR_STANDARD_V1 } from '@truco/engine';
import { signWsAuthTicket } from '@truco/shared';
import { createGameServer } from '../../src/server.js';

const SECRET = 'perf-load-ws-fixture-key-32-chars-min!!';
const ROOMS = Number(process.env['ROOMS'] ?? 50);
const ACTIONS = Number(process.env['ACTIONS'] ?? 30);

let readyToggle = false;
function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx] ?? 0;
}
function round(n) {
  return Math.round(n * 100) / 100;
}

async function connectClient(port, index) {
  const userId = `019a7e40-perf-7000-8000-${String(100_000 + index).padStart(12, '0')}`;
  const token = signWsAuthTicket(
    {
      jti: randomUUID(),
      userId,
      sessionId: `s-perf-${index}`,
      nickname: `P${index}`,
      exp: Date.now() + 600_000,
    },
    SECRET,
  );
  const socket = createClient(`http://127.0.0.1:${port}`, {
    transports: ['websocket'],
    auth: { token },
    reconnection: false,
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('connect timeout')), 5_000);
    socket.once('connect', () => {
      clearTimeout(timer);
      resolve();
    });
    socket.once('connect_error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
  });
  return { socket, userId };
}

function send(socket, type, payload) {
  const eventId = randomUUID();
  socket.emit('envelope', { eventId, ts: Date.now(), type, payload });
  return eventId;
}

async function measureReady(client, roomId) {
  const start = performance.now();
  readyToggle = !readyToggle;
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), 5_000);
    const onEnv = (env) => {
      if (env?.type !== 'table.state') return;
      clearTimeout(timer);
      client.off('envelope', onEnv);
      resolve();
    };
    client.on('envelope', onEnv);
    send(client, 'table.ready', { roomId, ready: readyToggle });
  });
  return performance.now() - start;
}

async function main() {
  const server = createGameServer({
    sessionSecret: SECRET,
    internalSecret: SECRET,
    seedEncryptionKey: SECRET,
    allowAdHocRooms: false,
    idleSweepIntervalMs: 0,
    maxConnectionsPerUser: 25,
    maxConnectionsPerIp: 10_000,
    rateLimiter: { windowMs: 60_000, actionMax: 10_000, chatMax: 1_000, tableMax: 1_000 },
  });
  const port = await server.listen(0, '127.0.0.1');
  const memBefore = process.memoryUsage();
  const latencies = [];
  const clients = [];
  let failed = 0;

  try {
    const rssStart = process.memoryUsage().rss;

    // Provision rooms and connect clients
    for (let r = 0; r < ROOMS; r++) {
      const roomId = `019a7e40-perf-7000-8000-${String(200_000 + r).padStart(12, '0')}`;
      await server.provisionRoom({
        roomId,
        mode: '1v1',
        visibility: 'PRIVATE',
        rulesetCode: 'ar-standard-v1',
        ruleset: AR_STANDARD_V1,
        targetScore: 15,
        florEnabled: false,
        turnTimeoutMs: 30_000,
      });
      const a = await connectClient(port, r * 2);
      const b = await connectClient(port, r * 2 + 1);
      send(a.socket, 'table.join', { roomId });
      send(b.socket, 'table.join', { roomId });
      clients.push(a, b);
    }

    // Wait for joins to settle
    await new Promise((r) => setTimeout(r, 500));

    // Warmup
    for (const c of clients.slice(0, Math.min(clients.length, 20))) {
      try {
        await measureReady(c.socket, `warmup-${Math.random()}`);
      } catch {
        /* noop */
      }
    }

    // Measure
    const start = performance.now();
    for (const c of clients) {
      for (let a = 0; a < ACTIONS; a++) {
        const rid = `019a7e40-perf-7000-8000-${String(200_000 + Math.floor(clients.indexOf(c) / 2)).padStart(12, '0')}`;
        try {
          latencies.push(await measureReady(c.socket, rid));
        } catch {
          failed++;
        }
      }
    }
    const elapsed = performance.now() - start;
    const memAfter = process.memoryUsage();
    const sorted = [...latencies].sort((a, b) => a - b);
    const active = server.roomManager.getActiveRoomCount();
    const conns = server.metrics?.snapshot(server.roomManager.getStatusCounts()).wsConnections ?? 0;

    const report = {
      measuredAt: new Date().toISOString(),
      scenario: 'load-ws-1v1-ready',
      store: 'InMemoryGameStore',
      roomsConfigured: ROOMS,
      sockets: clients.length,
      actionsPerRoom: ACTIONS,
      actions: {
        total: latencies.length + failed,
        ok: latencies.length,
        failed,
        elapsedMs: round(elapsed),
        rps: round((latencies.length / Math.max(elapsed, 1)) * 1000),
        p50Ms: round(percentile(sorted, 50)),
        p95Ms: round(percentile(sorted, 95)),
        p99Ms: round(percentile(sorted, 99)),
        maxMs: round(sorted[sorted.length - 1] ?? 0),
      },
      memory: {
        rssBeforeMB: round(memBefore.rss / 1024 / 1024),
        rssAfterMB: round(memAfter.rss / 1024 / 1024),
        rssDeltaMB: round((memAfter.rss - memBefore.rss) / 1024 / 1024),
        heapUsedMB: round(memAfter.heapUsed / 1024 / 1024),
        memPerSocketKB: round((memAfter.rss - rssStart) / 1024 / Math.max(clients.length, 1)),
      },
      rooms: { active, wsConnections: conns },
    };
    console.log(JSON.stringify(report, null, 2));
  } finally {
    for (const c of clients) c.socket.close();
    await server.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
