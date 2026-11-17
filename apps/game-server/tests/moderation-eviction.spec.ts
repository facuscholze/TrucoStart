import { AR_STANDARD_V1 } from '@truco/engine';
import type { RoomProvisionSpec } from '@truco/shared';
import { signInternalRequestHeaders } from '@truco/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { InMemoryMatchLifecycleBus } from '../src/events/match-lifecycle-publisher.js';
import { createGameServer, type GameServerInstance } from '../src/server.js';
import { TestWsClient } from './helpers/ws-test-client.js';

const SECRET = 'secreto-eviction-m8-minimo-32-caracteres!!';
const ROOM_ID = '019a7e40-0000-7000-8000-000000000e01';
const SANCTIONED = '019a7e40-0000-7000-8000-0000000000d1';
const RIVAL = '019a7e40-0000-7000-8000-0000000000d2';

function buildSpec(): RoomProvisionSpec {
  return {
    roomId: ROOM_ID,
    mode: '1v1',
    visibility: 'PRIVATE',
    rulesetCode: 'ar-standard-v1',
    ruleset: AR_STANDARD_V1 as unknown as Record<string, unknown>,
    targetScore: 15,
    florEnabled: false,
    turnTimeoutMs: 30_000,
  };
}

describe('M8 — expulsión inmediata de usuarios sancionados', () => {
  let server: GameServerInstance | null = null;
  const clients: TestWsClient[] = [];

  afterEach(async () => {
    for (const client of clients) client.disconnect();
    clients.length = 0;
    if (server) {
      await server.close();
      server = null;
    }
  });

  async function startServer() {
    server = createGameServer({
      sessionSecret: SECRET,
      internalSecret: SECRET,
      seedEncryptionKey: SECRET,
      lifecyclePublisher: new InMemoryMatchLifecycleBus(),
      allowAdHocRooms: false,
      idleSweepIntervalMs: 0,
      dealSeedHex: 'ab'.repeat(32),
      rateLimiter: { actionMax: 5_000, chatMax: 500, tableMax: 500, connectionTotalMax: 900 },
    });
    const port = await server.listen(0, '127.0.0.1');
    await server.provisionRoom(buildSpec());
    return port;
  }

  function client(port: number, userId: string, nickname: string, seat: number) {
    return new TestWsClient({
      port,
      secret: SECRET,
      userId,
      nickname,
      sessionId: `session-${userId.slice(-2)}-0001`,
      seat,
      team: seat % 2,
    });
  }

  async function evict(
    port: number,
    userId: string,
    body: { reason: string; disconnect: boolean },
    overrides: { secret?: string; nonce?: string } = {},
  ): Promise<Response> {
    const path = `/internal/users/${userId}/evict`;
    const rawBody = JSON.stringify(body);
    return fetch(`http://127.0.0.1:${port}${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...signInternalRequestHeaders({
          method: 'POST',
          path,
          rawBody,
          secret: overrides.secret ?? SECRET,
          ...(overrides.nonce ? { nonce: overrides.nonce } : {}),
        }),
      },
      body: rawBody,
    });
  }

  it(
    'un jugador suspendido en plena partida pierde la conexión y el asiento',
    { timeout: 25_000 },
    async () => {
      const port = await startServer();
      const sanctioned = client(port, SANCTIONED, 'Sancionado', 0);
      const rival = client(port, RIVAL, 'Rival', 1);
      clients.push(sanctioned, rival);

      await sanctioned.connectToPort(port);
      await rival.connectToPort(port);
      sanctioned.send('table.join', { roomId: ROOM_ID });
      await sanctioned.waitFor((env) => env.type === 'table.state', 'table.state propio');
      rival.send('table.join', { roomId: ROOM_ID });
      await rival.waitFor((env) => env.type === 'table.state', 'table.state rival');
      sanctioned.send('table.ready', { roomId: ROOM_ID, ready: true });
      rival.send('table.ready', { roomId: ROOM_ID, ready: true });
      await rival.waitFor((env) => env.type === 'game.started', 'game.started');

      // Suspensión aplicada en la API -> RPC firmada al game-server.
      const response = await evict(port, SANCTIONED, {
        reason: 'Tu cuenta está suspendida hasta el 2026-12-01. Motivo: abandono reiterado.',
        disconnect: true,
      });
      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        evicted: boolean;
        rooms: string[];
        sockets: number;
      };
      expect(body.evicted).toBe(true);
      expect(body.rooms).toContain(ROOM_ID);

      // El socket del sancionado recibe el motivo y se desconecta sin esperar al caché.
      const forbidden = await sanctioned.waitFor(
        (env) => env.type === 'error' && env.payload['code'] === 'FORBIDDEN',
        'error FORBIDDEN de expulsión',
      );
      expect(String(forbidden.payload['message'])).toMatch(/suspendida/i);

      await new Promise((resolve) => setTimeout(resolve, 150));
      expect(sanctioned.socket.connected).toBe(false);

      // El rival sigue conectado y la partida se define por abandono del asiento.
      const ended = await rival.waitFor(
        (env) =>
          env.type === 'game.ended' && String(env.payload['reason'] ?? '').includes('ABANDON'),
        'game.ended por abandono',
        8_000,
      );
      expect(String(ended.payload['reason'])).toContain('ABANDON');
      expect(rival.socket.connected).toBe(true);
    },
  );

  it('rechaza expulsiones sin firma válida o con nonce repetido', async () => {
    const port = await startServer();

    const unsigned = await fetch(`http://127.0.0.1:${port}/internal/users/${SANCTIONED}/evict`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ reason: 'sin firma' }),
    });
    expect(unsigned.status).toBe(401);

    const wrongSecret = await evict(
      port,
      SANCTIONED,
      { reason: 'secreto inválido', disconnect: true },
      { secret: 'secreto-equivocado-de-32-caracteres!!!!' },
    );
    expect(wrongSecret.status).toBe(401);

    const nonce = 'nonce-repetido-para-test-123456';
    const first = await evict(
      port,
      SANCTIONED,
      { reason: 'primera llamada', disconnect: true },
      { nonce },
    );
    expect(first.status).toBe(200);
    const replay = await evict(port, SANCTIONED, { reason: 'replay', disconnect: true }, { nonce });
    expect(replay.status).toBe(401);
  });

  it('un silencio invalida el caché sin cortar la conexión', async () => {
    const port = await startServer();
    // Con lookup deshabilitado aquí se valida el camino `disconnect: false`.
    const player = client(port, SANCTIONED, 'Silenciado', 0);
    clients.push(player);
    await player.connectToPort(port);
    player.send('table.join', { roomId: ROOM_ID });
    await player.waitFor((env) => env.type === 'table.state', 'table.state');

    const response = await evict(port, SANCTIONED, {
      reason: 'Silencio de 24 h por lenguaje agresivo',
      disconnect: false,
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { disconnect: boolean };
    expect(body.disconnect).toBe(false);

    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(player.socket.connected).toBe(true);
    // Sigue sentado: el silencio no lo saca de la mesa.
    const stillSeated = await player.waitFor(
      (env) =>
        env.type === 'table.state' &&
        (env.payload['seats'] as Array<{ userId: string | null }>).some(
          (seat) => seat.userId === SANCTIONED,
        ),
      'asiento conservado',
      8_000,
    );
    expect(stillSeated).toBeTruthy();
  });
});
