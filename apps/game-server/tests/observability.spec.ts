import { AR_STANDARD_V1 } from '@truco/engine';
import type { RoomProvisionSpec } from '@truco/shared';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createGameServer,
  type GameServerInstance,
  type GameServerLoggerLike,
} from '../src/server.js';

const SECRET = 'secreto-m8a-observabilidad-minimo-32-chars!!';
const ROOM_ID = '019a7e40-0000-7000-8000-000000000ab1';

function buildSpec(roomId = ROOM_ID): RoomProvisionSpec {
  return {
    roomId,
    mode: '1v1',
    visibility: 'PRIVATE',
    rulesetCode: 'ar-standard-v1',
    ruleset: AR_STANDARD_V1 as unknown as Record<string, unknown>,
    targetScore: 15,
    florEnabled: false,
    turnTimeoutMs: 15_000,
  };
}

interface CapturedLine {
  readonly fields: Record<string, unknown>;
  readonly message: string;
}

function buildLogger(lines: CapturedLine[]): GameServerLoggerLike {
  const push = (fields: Record<string, unknown>, message: string) => {
    lines.push({ fields, message });
  };
  return { info: push, warn: push, error: push };
}

describe('M8a — métricas internas y cabeceras del game-server', () => {
  let server: GameServerInstance | null = null;

  afterEach(async () => {
    if (server) {
      await server.close();
      server = null;
    }
  });

  it('protege /internal/metrics y devuelve el snapshot con salas por estado', async () => {
    const lines: CapturedLine[] = [];
    server = createGameServer({
      sessionSecret: SECRET,
      internalSecret: SECRET,
      seedEncryptionKey: SECRET,
      allowAdHocRooms: false,
      idleSweepIntervalMs: 0,
      logger: buildLogger(lines),
      rateLimiter: { windowMs: 10_000, actionMax: 500, chatMax: 50, tableMax: 50 },
    });
    const port = await server.listen(0, '127.0.0.1');
    const base = `http://127.0.0.1:${port}`;

    const unauthorized = await fetch(`${base}/internal/metrics`);
    expect(unauthorized.status).toBe(401);
    const wrongToken = await fetch(`${base}/internal/metrics`, {
      headers: { authorization: 'Bearer token-incorrecto' },
    });
    expect(wrongToken.status).toBe(401);

    await server.provisionRoom(buildSpec());

    const response = await fetch(`${base}/internal/metrics`, {
      headers: { authorization: `Bearer ${SECRET}`, 'x-correlation-id': 'corr-gs-0001' },
    });
    expect(response.status).toBe(200);
    const snapshot = (await response.json()) as {
      wsConnections: number;
      roomsByStatus: Record<string, number>;
      reconnections: number;
      wsErrors: number;
      actionLatencyMs: unknown[];
    };
    expect(snapshot.wsConnections).toBe(0);
    expect(Object.values(snapshot.roomsByStatus).reduce((a, b) => a + b, 0)).toBe(1);
    expect(snapshot.reconnections).toBe(0);
    expect(snapshot.wsErrors).toBe(0);
    expect(Array.isArray(snapshot.actionLatencyMs)).toBe(true);

    const requestLog = lines.find((line) => line.message === 'http_request');
    expect(requestLog).toBeDefined();
    expect(requestLog?.fields['service']).toBe('game-server');
    expect(requestLog?.fields['path']).toBe('/internal/metrics');
    expect(JSON.stringify(lines)).not.toContain(SECRET);
  });

  it('agrega cabeceras de seguridad y correlación a las respuestas HTTP', async () => {
    server = createGameServer({
      sessionSecret: SECRET,
      internalSecret: SECRET,
      seedEncryptionKey: SECRET,
      allowAdHocRooms: false,
      idleSweepIntervalMs: 0,
    });
    const port = await server.listen(0, '127.0.0.1');
    const base = `http://127.0.0.1:${port}`;

    const health = await fetch(`${base}/health`, {
      headers: { 'x-correlation-id': 'corr-gs-0002' },
    });
    expect(health.status).toBe(200);
    expect(health.headers.get('content-security-policy')).toContain("default-src 'none'");
    expect(health.headers.get('x-content-type-options')).toBe('nosniff');
    expect(health.headers.get('referrer-policy')).toBe('no-referrer');
    expect(health.headers.get('x-correlation-id')).toBe('corr-gs-0002');

    const missing = await fetch(`${base}/ruta-inexistente`);
    expect(missing.status).toBe(404);
    expect(missing.headers.get('x-frame-options')).toBe('DENY');
    expect(missing.headers.get('x-correlation-id')).toMatch(/^[0-9a-f]{24}$/);
  });

  it('cuenta conexiones y reconexiones en el snapshot de métricas', () => {
    server = createGameServer({
      sessionSecret: SECRET,
      internalSecret: SECRET,
      seedEncryptionKey: SECRET,
      allowAdHocRooms: false,
      idleSweepIntervalMs: 0,
    });

    server.metrics.onConnectionOpened();
    server.metrics.onConnectionOpened();
    server.metrics.onReconnection();
    server.metrics.onAction('game.play', 42);

    const snapshot = server.metrics.snapshot({ WAITING: 2 });
    expect(snapshot.wsConnections).toBe(2);
    expect(snapshot.reconnections).toBe(1);
    expect(snapshot.roomsByStatus).toEqual({ WAITING: 2 });
    expect(snapshot.actionLatencyMs).toEqual([{ action: 'game.play', p95: 42 }]);

    server.metrics.onConnectionClosed();
    expect(server.metrics.snapshot({}).wsConnections).toBe(1);
    expect(server.metrics.registry.render()).toContain('truco_ws_connections 1');
  });
});
