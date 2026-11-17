import { AR_STANDARD_V1 } from '@truco/engine';
import type { RoomProvisionSpec } from '@truco/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { InMemoryMatchLifecycleBus } from '../src/events/match-lifecycle-publisher.js';
import type { ModerationSnapshot } from '../src/rooms/moderation.js';
import { createGameServer, type GameServerInstance } from '../src/server.js';
import { TestWsClient } from './helpers/ws-test-client.js';

const SECRET = 'secreto-moderacion-m7-minimo-32-chars!!!';
const ROOM_ID = '019a7e40-0000-7000-8000-000000000b01';
const SUSPENDED_USER = '019a7e40-0000-7000-8000-0000000000c1';
const MUTED_USER = '019a7e40-0000-7000-8000-0000000000c2';
const CLEAN_USER = '019a7e40-0000-7000-8000-0000000000c3';

function buildSpec(): RoomProvisionSpec {
  return {
    roomId: ROOM_ID,
    mode: '1v1',
    visibility: 'PRIVATE',
    rulesetCode: 'ar-standard-v1',
    ruleset: AR_STANDARD_V1 as unknown as Record<string, unknown>,
    targetScore: 15,
    florEnabled: false,
    turnTimeoutMs: 20_000,
  };
}

describe('M7 — sanciones aplicadas en el game-server', () => {
  let server: GameServerInstance | null = null;
  let clients: TestWsClient[] = [];

  afterEach(async () => {
    for (const client of clients) client.disconnect();
    clients = [];
    if (server) {
      await server.close();
      server = null;
    }
  });

  async function startServer(lookup: (userId: string) => Promise<ModerationSnapshot | null>) {
    server = createGameServer({
      sessionSecret: SECRET,
      internalSecret: SECRET,
      seedEncryptionKey: SECRET,
      lifecyclePublisher: new InMemoryMatchLifecycleBus(),
      allowAdHocRooms: false,
      idleSweepIntervalMs: 0,
      dealSeedHex: 'ab'.repeat(32),
      moderationLookup: lookup,
      rateLimiter: {
        windowMs: 10_000,
        actionMax: 5_000,
        chatMax: 500,
        tableMax: 500,
        connectionTotalMax: 900,
      },
    });
    await server.listen(0, '127.0.0.1');
    const address = server.httpServer.address();
    if (!address || typeof address === 'string') throw new Error('Sin puerto de escucha');
    await server.provisionRoom(buildSpec());
    return address.port;
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

  it('una cuenta suspendida no puede unirse a la mesa', async () => {
    const port = await startServer(async (userId) =>
      userId === SUSPENDED_USER
        ? {
            accountStatus: 'SUSPENDED',
            mutedUntilMs: null,
            statusReason: 'Abandono reiterado',
            statusExpiresAtMs: Date.now() + 86_400_000,
          }
        : { accountStatus: 'ACTIVE', mutedUntilMs: null },
    );

    const suspended = client(port, SUSPENDED_USER, 'Suspendido', 0);
    clients.push(suspended);
    await suspended.connectToPort(port);
    suspended.send('table.join', { roomId: ROOM_ID });

    const error = await suspended.waitFor(
      (env) => env.type === 'error',
      'error de cuenta suspendida',
    );
    expect(error.payload['code']).toBe('FORBIDDEN');
    expect(String(error.payload['message'])).toMatch(/suspendida hasta/i);
    expect(String(error.payload['message'])).toContain('Abandono reiterado');

    const blocked = client(port, SUSPENDED_USER, 'Suspendido', 0);
    clients.push(blocked);
    await blocked.connectToPort(port);
    blocked.send('game.rejoin', {
      roomId: ROOM_ID,
      sessionId: `session-${SUSPENDED_USER.slice(-2)}-0001`,
      lastSeq: 0,
    });
    const rejoinError = await blocked.waitFor(
      (env) => env.type === 'error',
      'error de reconexión bloqueada',
    );
    expect(rejoinError.payload['code']).toBe('FORBIDDEN');
  });

  it('una cuenta bloqueada tampoco puede entrar', async () => {
    const port = await startServer(async () => ({
      accountStatus: 'BANNED',
      mutedUntilMs: null,
      statusReason: 'Colusión comprobada',
    }));
    const banned = client(port, CLEAN_USER, 'Bloqueado', 0);
    clients.push(banned);
    await banned.connectToPort(port);
    banned.send('table.join', { roomId: ROOM_ID });
    const error = await banned.waitFor((env) => env.type === 'error', 'error de bloqueo');
    expect(error.payload['code']).toBe('FORBIDDEN');
    expect(String(error.payload['message'])).toMatch(/bloqueada permanentemente/i);
  });

  it(
    'una cuenta silenciada no puede usar chat rápido ni señas, pero sí jugar',
    { timeout: 20_000 },
    async () => {
      const port = await startServer(async (userId) =>
        userId === MUTED_USER
          ? {
              accountStatus: 'ACTIVE',
              mutedUntilMs: Date.now() + 3_600_000,
            }
          : { accountStatus: 'ACTIVE', mutedUntilMs: null },
      );

      const muted = client(port, MUTED_USER, 'Silenciado', 0);
      const rival = client(port, CLEAN_USER, 'Rival', 1);
      clients.push(muted, rival);
      await muted.connectToPort(port);
      await rival.connectToPort(port);
      muted.send('table.join', { roomId: ROOM_ID });
      await muted.waitFor((env) => env.type === 'table.state', 'table.state del silenciado');

      // Chat rápido bloqueado con error explícito.
      muted.send('chat.quick', { roomId: ROOM_ID, phraseId: 'buenas' });
      const chatError = await muted.waitFor(
        (env) => env.type === 'error' && String(env.payload['message']).includes('silenciado'),
        'error de chat silenciado',
      );
      expect(chatError.payload['code']).toBe('FORBIDDEN');

      // Señas/emotes bloqueados igual.
      muted.send('game.signal', { roomId: ROOM_ID, signalId: 'cejas_arriba' });
      const signalError = await muted.waitFor(
        (env) => env.type === 'error' && String(env.payload['message']).includes('señas'),
        'error de seña silenciada',
      );
      expect(signalError.payload['code']).toBe('FORBIDDEN');
      expect(muted.transcript.some((env) => env.type === 'table.state')).toBe(true);

      // Puede jugar normalmente: la mesa arranca cuando ambos están listos.
      rival.send('table.join', { roomId: ROOM_ID });
      await rival.waitFor((env) => env.type === 'table.state', 'table.state del rival');
      muted.send('table.ready', { roomId: ROOM_ID, ready: true });
      rival.send('table.ready', { roomId: ROOM_ID, ready: true });
      await muted.waitFor((env) => env.type === 'game.started', 'game.started', 8_000);
    },
  );

  it('sin lookup configurado no se aplican restricciones (compatibilidad)', async () => {
    server = createGameServer({
      sessionSecret: SECRET,
      internalSecret: SECRET,
      seedEncryptionKey: SECRET,
      lifecyclePublisher: new InMemoryMatchLifecycleBus(),
      allowAdHocRooms: false,
      idleSweepIntervalMs: 0,
      rateLimiter: { actionMax: 5_000, chatMax: 500, tableMax: 500, connectionTotalMax: 900 },
    });
    await server.listen(0, '127.0.0.1');
    const address = server.httpServer.address();
    if (!address || typeof address === 'string') throw new Error('Sin puerto de escucha');
    await server.provisionRoom(buildSpec());

    const plain = client(address.port, CLEAN_USER, 'SinRestricciones', 0);
    clients.push(plain);
    await plain.connectToPort(address.port);
    plain.send('table.join', { roomId: ROOM_ID });
    const state = await plain.waitFor((env) => env.type === 'table.state', 'table.state');
    expect((state.payload['seats'] as unknown[]).length).toBeGreaterThan(0);
  });
});
