import { randomBytes } from 'node:crypto';
import { AR_CORTO_15_FLOR_V1, chooseBotAction } from '@truco/engine';
import {
  buildSignedInternalRpcHeaders,
  MATCH_LIFECYCLE_QUEUE_NAME,
  type MatchCompletedLifecycleEvent,
  type MatchLifecycleEvent,
  MatchLifecycleEventSchema,
  type RoomProvisionSpec,
} from '@truco/shared';
import { Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { afterEach, describe, expect, it } from 'vitest';
import {
  BullMqMatchLifecyclePublisher,
  InMemoryMatchLifecycleBus,
} from '../src/events/match-lifecycle-publisher.js';
import { createGameServer, type GameServerInstance } from '../src/server.js';
import { TestWsClient } from './helpers/ws-test-client.js';

const SECRET = 'secreto-provisionamiento-m4-minimo-32-chars!!';

async function playProvisionedMatchToCompletion(
  roomId: string,
  clients: readonly TestWsClient[],
): Promise<void> {
  for (let step = 0; step < 300; step++) {
    if (clients[0]!.transcript.some((e) => e.type === 'game.ended')) return;
    const latestViews = clients
      .map((c) => c.latestView)
      .filter((v): v is NonNullable<typeof v> => v !== null);
    if (latestViews.length === 0) {
      await new Promise((r) => setTimeout(r, 10));
      continue;
    }

    const activeSeat = latestViews.sort((a, b) => b.hand.handNumber - a.hand.handNumber)[0]!.hand
      .activeSeat;
    const actor = clients[activeSeat]!;

    const deadline = Date.now() + 2_000;
    while (
      Date.now() < deadline &&
      (!actor.latestView ||
        actor.latestView.hand.activeSeat !== actor.seat ||
        actor.latestView.legalActions.length === 0)
    ) {
      if (clients[0]!.transcript.some((e) => e.type === 'game.ended')) return;
      await new Promise((r) => setTimeout(r, 10));
    }

    if (clients[0]!.transcript.some((e) => e.type === 'game.ended')) return;

    const prevSeq = actor.lastSeq;
    const action = chooseBotAction(actor.latestView!);
    if (action.type === 'PLAY_CARD') {
      actor.send('game.playCard', { roomId, cardId: action.cardId });
    } else if (action.type === 'FOLD_HAND') {
      actor.send('game.foldHand', { roomId });
    } else if (
      action.type === 'CALL_TRUCO' ||
      action.type === 'CALL_ENVIDO' ||
      action.type === 'CALL_FLOR'
    ) {
      actor.send('game.call', { roomId, type: action.bid });
    } else if (action.type === 'RESPOND_TRUCO') {
      actor.send('game.respond', { roomId, call: 'TRUCO', answer: action.decision });
    } else if (action.type === 'RESPOND_ENVIDO') {
      actor.send('game.respond', { roomId, call: 'ENVIDO', answer: action.decision });
    } else if (action.type === 'RESPOND_FLOR') {
      actor.send('game.respond', { roomId, call: 'FLOR', answer: action.decision });
    } else {
      actor.send('game.foldHand', { roomId });
    }

    await actor.waitFor((ev) => (ev.seq ?? 0) > prevSeq, `avance paso ${step}`);
  }
}

describe('M4 Room Provisioning Contract & Match Lifecycle Publisher (Memory + BullMQ)', () => {
  let server: GameServerInstance | null = null;

  afterEach(async () => {
    if (server) {
      await server.close();
      server = null;
    }
  });

  it('provisions/deletes rooms via signed /internal/rooms, enforces allowAdHocRooms=false, and publishes match.started + match.completed', async () => {
    const bus = new InMemoryMatchLifecycleBus();
    server = createGameServer({
      sessionSecret: SECRET,
      internalSecret: SECRET,
      seedEncryptionKey: SECRET,
      lifecyclePublisher: bus,
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
    const baseUrl = `http://127.0.0.1:${port}`;

    const roomId = '019a7e40-0000-7000-8000-000000000777';
    const spec: RoomProvisionSpec = {
      roomId,
      mode: '1v1',
      visibility: 'PRIVATE',
      rulesetCode: 'ar-corto-15-flor-v1',
      ruleset: AR_CORTO_15_FLOR_V1 as unknown as Record<string, unknown>,
      targetScore: 15,
      florEnabled: true,
      turnTimeoutMs: 15_000,
    };
    const rawBody = JSON.stringify(spec);

    // 1. Sin firma ni cabeceras anti-replay -> 401 UNAUTHORIZED
    const badRes = await fetch(`${baseUrl}/internal/rooms`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-internal-signature': 'firma-invalida',
      },
      body: rawBody,
    });
    expect(badRes.status).toBe(401);

    // 2. Con timestamp firmado dentro de ventana + nonce único -> 201 Created
    const validHeaders = buildSignedInternalRpcHeaders(
      {
        method: 'POST',
        path: '/internal/rooms',
        timestampMs: Date.now(),
        nonce: randomBytes(16).toString('base64url'),
        rawBody,
      },
      SECRET,
    );
    const okRes = await fetch(`${baseUrl}/internal/rooms`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...validHeaders,
      },
      body: rawBody,
    });
    expect(okRes.status).toBe(201);

    // 2b. REPLAY EXACTO (mismas cabeceras firmadas y mismo nonce dentro del TTL) -> 401 UNAUTHORIZED
    const replayRes = await fetch(`${baseUrl}/internal/rooms`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...validHeaders,
      },
      body: rawBody,
    });
    expect(replayRes.status).toBe(401);

    // 2c. TIMESTAMP EXPIRADO (fuera de ventana corta de 30 s, aun con nonce fresco y firma válida) -> 401 UNAUTHORIZED
    const expiredHeaders = buildSignedInternalRpcHeaders(
      {
        method: 'POST',
        path: '/internal/rooms',
        timestampMs: Date.now() - 45_000,
        nonce: randomBytes(16).toString('base64url'),
        rawBody,
      },
      SECRET,
    );
    const expiredRes = await fetch(`${baseUrl}/internal/rooms`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...expiredHeaders,
      },
      body: rawBody,
    });
    expect(expiredRes.status).toBe(401);

    // 2d. TIMESTAMP FUTURO DESFASADO (+45 s fuera de ventana) -> 401 UNAUTHORIZED
    const futureHeaders = buildSignedInternalRpcHeaders(
      {
        method: 'POST',
        path: '/internal/rooms',
        timestampMs: Date.now() + 45_000,
        nonce: randomBytes(16).toString('base64url'),
        rawBody,
      },
      SECRET,
    );
    const futureRes = await fetch(`${baseUrl}/internal/rooms`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...futureHeaders,
      },
      body: rawBody,
    });
    expect(futureRes.status).toBe(401);

    // 3. Probar también DELETE /internal/rooms/:id con anti-replay sobre una sala temporal
    const disposableRoomId = '019a7e40-0000-7000-8000-000000000778';
    const dispBody = JSON.stringify({ ...spec, roomId: disposableRoomId });
    await fetch(`${baseUrl}/internal/rooms`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...buildSignedInternalRpcHeaders(
          {
            method: 'POST',
            path: '/internal/rooms',
            timestampMs: Date.now(),
            nonce: randomBytes(16).toString('base64url'),
            rawBody: dispBody,
          },
          SECRET,
        ),
      },
      body: dispBody,
    });
    const delPath = `/internal/rooms/${disposableRoomId}`;
    const delHeaders = buildSignedInternalRpcHeaders(
      {
        method: 'DELETE',
        path: delPath,
        timestampMs: Date.now(),
        nonce: randomBytes(16).toString('base64url'),
        rawBody: '',
      },
      SECRET,
    );
    const delRes = await fetch(`${baseUrl}${delPath}`, {
      method: 'DELETE',
      headers: delHeaders,
    });
    expect(delRes.status).toBe(200);

    // Replay de DELETE también es rechazado con 401
    const delReplayRes = await fetch(`${baseUrl}${delPath}`, {
      method: 'DELETE',
      headers: delHeaders,
    });
    expect(delReplayRes.status).toBe(401);

    const c0 = new TestWsClient({
      port,
      secret: SECRET,
      userId: '019a7e40-0000-7000-8000-000000000001',
      nickname: 'Alfa',
      sessionId: 'sess-alfa-0001',
      seat: 0,
      team: 0,
    });
    const c1 = new TestWsClient({
      port,
      secret: SECRET,
      userId: '019a7e40-0000-7000-8000-000000000002',
      nickname: 'Beta',
      sessionId: 'sess-beta-0002',
      seat: 1,
      team: 1,
    });

    await c0.connectToPort(port);
    await c1.connectToPort(port);

    try {
      // Sala eliminada o no aprovisionada falla con NOT_FOUND cuando allowAdHocRooms=false
      c0.send('table.join', { roomId: disposableRoomId });
      const errNotFound = await c0.waitFor((e) => e.type === 'error', 'error sala eliminada');
      expect(errNotFound.payload['code']).toBe('NOT_FOUND');

      // Ambos se unen a la sala aprovisionada (respeta rulesetCode=ar-corto-15-flor-v1 y turnTimeoutMs=15000)
      c0.send('table.join', { roomId });
      const st0 = await c0.waitFor((e) => e.type === 'table.state', 'table.state c0');
      expect(st0.payload['rulesetCode']).toBe('ar-corto-15-flor-v1');
      expect(st0.payload['turnTimeoutMs']).toBe(15_000);

      c1.send('table.join', { roomId });
      await c1.waitFor((e) => e.type === 'table.state', 'table.state c1');

      c0.send('table.ready', { roomId, ready: true });
      c1.send('table.ready', { roomId, ready: true });

      const started = await c0.waitFor((e) => e.type === 'game.started', 'game.started');
      expect(started.payload['targetScore']).toBe(15);

      await playProvisionedMatchToCompletion(roomId, [c0, c1]);
      await c0.waitFor((e) => e.type === 'game.ended', 'game.ended final');

      const published = bus.getPublishedEvents();
      expect(published.some((e) => e.kind === 'match.started')).toBe(true);
      const completed = published.find(
        (e): e is MatchCompletedLifecycleEvent => e.kind === 'match.completed',
      );
      expect(completed).toBeDefined();
      expect(completed!.roomId).toBe(roomId);
      expect(completed!.rulesetCode).toBe('ar-corto-15-flor-v1');
      expect(completed!.players).toHaveLength(2);
      expect(completed!.events.length).toBeGreaterThan(3);
    } finally {
      c0.disconnect();
      c1.disconnect();
    }
  });

  const redisUrl = process.env['REDIS_URL'];
  const bullIt = redisUrl ? it : it.skip;

  bullIt(
    'publishes and consumes MatchLifecycleEvent over real BullMQ + Redis when REDIS_URL is set',
    async () => {
      const queueName = `${MATCH_LIFECYCLE_QUEUE_NAME}-test-${Date.now()}`;
      const publisher = new BullMqMatchLifecyclePublisher(redisUrl!, { queueName });
      const workerConn = new Redis(redisUrl!, { maxRetriesPerRequest: null });

      const received: MatchLifecycleEvent[] = [];
      let resolveDone!: () => void;
      const donePromise = new Promise<void>((resolve) => {
        resolveDone = resolve;
      });
      const worker = new Worker(
        queueName,
        async (job) => {
          received.push(MatchLifecycleEventSchema.parse(job.data));
          resolveDone();
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        { connection: workerConn as any },
      );
      await worker.waitUntilReady();

      try {
        await publisher.publish({
          kind: 'match.started',
          practice: false,
          roomId: '019a7e40-0000-7000-8000-000000000888',
          matchId: '019a7e40-0000-7000-8000-000000000889',
          startedAtMs: Date.now(),
          seats: [
            { seat: 0, team: 0, userId: 'u1' },
            { seat: 1, team: 1, userId: 'u2' },
          ],
        });
        await donePromise;
        expect(received).toHaveLength(1);
        expect(received[0]!.kind).toBe('match.started');
      } finally {
        await worker.close();
        await publisher.close();
        if (workerConn.status !== 'end') {
          await workerConn.quit();
        }
      }
    },
  );
});
