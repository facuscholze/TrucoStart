import { AR_STANDARD_V1 } from '@truco/engine';
import type { RoomProvisionSpec } from '@truco/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { InMemoryMatchLifecycleBus } from '../src/events/match-lifecycle-publisher.js';
import { createGameServer, type GameServerInstance } from '../src/server.js';
import { TestWsClient } from './helpers/ws-test-client.js';

const SECRET = 'secreto-reparto-determinista-m6-32-chars!!';
const DEAL_SEED = 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90';

function buildSpec(roomId: string): RoomProvisionSpec {
  return {
    roomId,
    mode: '1v1',
    visibility: 'PRIVATE',
    rulesetCode: 'ar-standard-v1',
    ruleset: AR_STANDARD_V1 as unknown as Record<string, unknown>,
    targetScore: 15,
    florEnabled: false,
    turnTimeoutMs: 20_000,
  };
}

function makeClients(port: number, suffix: string): [TestWsClient, TestWsClient] {
  return [
    new TestWsClient({
      port,
      secret: SECRET,
      userId: `u-deal-${suffix}-0`,
      nickname: `Deal${suffix}A`,
      sessionId: `sess-deal-${suffix}-000`,
      seat: 0,
      team: 0,
    }),
    new TestWsClient({
      port,
      secret: SECRET,
      userId: `u-deal-${suffix}-1`,
      nickname: `Deal${suffix}B`,
      sessionId: `sess-deal-${suffix}-001`,
      seat: 1,
      team: 1,
    }),
  ];
}

async function dealFirstHand(
  server: GameServerInstance,
  port: number,
  roomId: string,
  clients: readonly TestWsClient[],
): Promise<{ seat0: string[]; seat1: string[]; seedCommitment: string }> {
  await server.provisionRoom(buildSpec(roomId));

  for (const [idx, client] of clients.entries()) {
    await client.connectToPort(port);
    client.send('table.join', { roomId, preferredSeat: idx });
    await client.waitFor((e) => e.type === 'table.state', `table.state seat ${idx}`);
  }
  for (const client of clients) {
    client.send('table.ready', { roomId, ready: true });
  }

  const started = await clients[0]!.waitFor((e) => e.type === 'game.started', 'game.started');
  for (const [idx, client] of clients.entries()) {
    await client.waitFor((e) => e.type === 'game.dealt', `game.dealt seat ${idx}`);
  }
  const firstView = clients[0]!.latestView;
  const secondView = clients[1]!.latestView;
  expect(firstView).not.toBeNull();
  expect(secondView).not.toBeNull();

  return {
    seat0: firstView!.hand.myInitialCards.map((c) => c.id),
    seat1: secondView!.hand.myInitialCards.map((c) => c.id),
    seedCommitment: String(started.payload['seedCommitment']),
  };
}

describe('M6 — reparto determinístico para E2E reproducibles', () => {
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

  it('con dealSeedHex fijo dos salas distintas reparten exactamente las mismas cartas', async () => {
    server = createGameServer({
      sessionSecret: SECRET,
      internalSecret: SECRET,
      seedEncryptionKey: SECRET,
      lifecyclePublisher: new InMemoryMatchLifecycleBus(),
      allowAdHocRooms: false,
      dealSeedHex: DEAL_SEED,
      rateLimiter: {
        windowMs: 10_000,
        actionMax: 500,
        chatMax: 50,
        tableMax: 50,
        connectionTotalMax: 800,
      },
    });
    const port = await server.listen(0, '127.0.0.1');

    const firstClients = makeClients(port, 'aaa');
    clients.push(...firstClients);
    const firstDeal = await dealFirstHand(server, port, 'mesa-deal-a', firstClients);

    for (const client of firstClients) client.disconnect();
    clients.length = 0;

    const secondClients = makeClients(port, 'bbb');
    clients.push(...secondClients);
    const secondDeal = await dealFirstHand(server, port, 'mesa-deal-b', secondClients);

    expect(firstDeal.seat0).toHaveLength(3);
    expect(firstDeal.seat0).toEqual(secondDeal.seat0);
    expect(firstDeal.seat1).toEqual(secondDeal.seat1);
    // Commit-reveal sigue vigente: la semilla fija se compromete con SHA-256 igual en ambos casos.
    expect(firstDeal.seedCommitment).toBe(secondDeal.seedCommitment);
    expect(firstDeal.seedCommitment).toMatch(/^[a-f0-9]{64}$/);
  });
});
