import { AR_STANDARD_V1 } from '@truco/engine';
import type { RoomProvisionSpec } from '@truco/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { InMemoryMatchLifecycleBus } from '../src/events/match-lifecycle-publisher.js';
import { createGameServer, type GameServerInstance } from '../src/server.js';
import { TestWsClient } from './helpers/ws-test-client.js';

const SECRET = 'secreto-multisocket-mesa-de-seis-32-chars!!';
const ROOM_ID = 'mesa-multisocket-3v3';

/**
 * M10b — un asiento con más de un socket.
 *
 * Jugar en dos pestañas, o un cliente de escritorio junto al navegador, es legítimo. El actor
 * guardaba un solo socket por asiento: el segundo `join` reemplazaba al primero y ese cliente
 * dejaba de recibir eventos sin desconectarse (el jugador veía una mesa congelada). El caso se
 * encontró armando el E2E del truco de 6 con seis asientos.
 */

function buildSixSeatSpec(): RoomProvisionSpec {
  return {
    roomId: ROOM_ID,
    mode: '3v3',
    visibility: 'PRIVATE',
    rulesetCode: 'ar-standard-v1',
    ruleset: AR_STANDARD_V1 as unknown as Record<string, unknown>,
    targetScore: 15,
    florEnabled: false,
    turnTimeoutMs: 20_000,
  };
}

describe('M10b — varios sockets sobre el mismo asiento', () => {
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

  it('el primer socket del asiento sigue recibiendo eventos cuando entra el segundo', async () => {
    server = createGameServer({
      sessionSecret: SECRET,
      internalSecret: SECRET,
      seedEncryptionKey: SECRET,
      lifecyclePublisher: new InMemoryMatchLifecycleBus(),
      allowAdHocRooms: false,
      rateLimiter: {
        windowMs: 10_000,
        actionMax: 500,
        chatMax: 50,
        tableMax: 50,
        connectionTotalMax: 800,
      },
    });
    const port = await server.listen(0, '127.0.0.1');
    await server.provisionRoom(buildSixSeatSpec());

    // Dos sockets del mismo dueño (misma cuenta, misma sesión, mismo asiento).
    const first = new TestWsClient({
      port,
      secret: SECRET,
      userId: 'u-multisocket-owner',
      nickname: 'DuenioDoble',
      sessionId: 'sess-multisocket-owner',
      seat: 0,
      team: 0,
    });
    const second = new TestWsClient({
      port,
      secret: SECRET,
      userId: 'u-multisocket-owner',
      nickname: 'DuenioDoble',
      sessionId: 'sess-multisocket-owner',
      seat: 0,
      team: 0,
    });
    clients.push(first, second);

    await first.connectToPort(port);
    first.send('table.join', { roomId: ROOM_ID });
    await first.waitFor((e) => e.type === 'table.state', 'primer join');

    await second.connectToPort(port);
    second.send('table.join', { roomId: ROOM_ID });
    await second.waitFor((e) => e.type === 'table.state', 'segundo join');

    // El segundo join emite `table.state` a toda la mesa: el primer socket tiene que verlo.
    // Antes el mapa 1:1 lo dejaba sin socket y este evento nunca llegaba.
    const afterSecondJoin = await first.waitFor(
      (e) => e.type === 'table.state',
      'table.state posterior al segundo join',
      5_000,
    );
    expect(afterSecondJoin.type).toBe('table.state');

    // Y los dos siguen el estado: desconectar el segundo no expulsa al primero.
    second.disconnect();
    const readyEvent = await (async () => {
      first.send('table.ready', { roomId: ROOM_ID, ready: true });
      return first.waitFor((e) => e.type === 'table.state', 'table.state tras desconectar', 5_000);
    })();
    expect(readyEvent.payload['roomId']).toBe(ROOM_ID);
  });

  it('el asiento queda libre sólo cuando se va el último socket', async () => {
    server = createGameServer({
      sessionSecret: SECRET,
      internalSecret: SECRET,
      seedEncryptionKey: SECRET,
      lifecyclePublisher: new InMemoryMatchLifecycleBus(),
      allowAdHocRooms: false,
      rateLimiter: {
        windowMs: 10_000,
        actionMax: 500,
        chatMax: 50,
        tableMax: 50,
        connectionTotalMax: 800,
      },
    });
    const port = await server.listen(0, '127.0.0.1');
    await server.provisionRoom(buildSixSeatSpec());

    const first = new TestWsClient({
      port,
      secret: SECRET,
      userId: 'u-multisocket-two',
      nickname: 'DosPestanias',
      sessionId: 'sess-multisocket-two',
      seat: 0,
      team: 0,
    });
    const second = new TestWsClient({
      port,
      secret: SECRET,
      userId: 'u-multisocket-two',
      nickname: 'DosPestanias',
      sessionId: 'sess-multisocket-two',
      seat: 0,
      team: 0,
    });
    const rival = new TestWsClient({
      port,
      secret: SECRET,
      userId: 'u-multisocket-rival',
      nickname: 'Rival',
      sessionId: 'sess-multisocket-rival',
      seat: 1,
      team: 1,
    });
    clients.push(first, second, rival);

    for (const client of [first, rival]) {
      await client.connectToPort(port);
    }
    first.send('table.join', { roomId: ROOM_ID, preferredSeat: 0 });
    await first.waitFor((e) => e.type === 'table.state', 'join del dueño');
    rival.send('table.join', { roomId: ROOM_ID, preferredSeat: 1 });
    await rival.waitFor((e) => e.type === 'table.state', 'join del rival');

    await second.connectToPort(port);
    second.send('table.join', { roomId: ROOM_ID, preferredSeat: 0 });
    await second.waitFor((e) => e.type === 'table.state', 'segundo socket del dueño');

    // Se cierra la pestaña más nueva: el asiento sigue conectado por la primera, así que la mesa
    // no debe anunciar desconexión. Éste es el caso que rompía el mapa 1:1: al desconectarse el
    // socket registrado, el jugador quedaba como ausente aunque siguiera conectado por el otro.
    const before = rival.transcript.length;
    second.disconnect();
    // El cierre se procesa en la cola del actor: se le da tiempo a que propague lo que tenga
    // que propagar antes de mirar la mesa.
    await new Promise((resolve) => setTimeout(resolve, 500));

    const after = rival.transcript.slice(before);
    expect(
      after.filter((event) => event.type === 'player.disconnected'),
      'cerrar una pestaña no desconecta al asiento si queda otra abierta',
    ).toEqual([]);

    // Ningún estado intermedio puede mostrar el asiento como desconectado.
    const disconnectedStates = after
      .filter((event) => event.type === 'table.state')
      .map((event) => event.payload['seats'] as Array<{ seat: number; connected: boolean }>)
      .filter((seats) => seats.find((seat) => seat.seat === 0)?.connected === false);
    expect(disconnectedStates, 'cerrar una pestaña no marca el asiento como desconectado').toEqual(
      [],
    );

    // Y el estado actual confirma que el asiento sigue conectado.
    rival.send('table.ready', { roomId: ROOM_ID, ready: true });
    const state = await rival.waitFor(
      (e) => e.type === 'table.state',
      'table.state posterior al cierre de una pestaña',
      5_000,
    );
    const seats = state.payload['seats'] as Array<{ seat: number; connected: boolean }>;
    expect(seats.find((seat) => seat.seat === 0)?.connected).toBe(true);
  });
});
