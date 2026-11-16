import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { BullMqMatchLifecyclePublisher, InMemoryMatchLifecycleBus } from '@truco/game-server';
import {
  MATCH_LIFECYCLE_DLQ_NAME,
  MATCH_LIFECYCLE_QUEUE_NAME,
  type MatchCompletedLifecycleEvent,
} from '@truco/shared';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApiApp } from '../../../bootstrap.js';
import { generateUuidV7 } from '../../../common/uuidv7.js';
import {
  createAdaptiveTestDatabase,
  type DatabaseConnectionHandle,
} from '../../../db/database.provider.js';
import { matchEventsTable, matchesTable, matchPlayersTable } from '../../../db/schema/index.js';
import { buildCookieHeader, extractAuthCookies } from '../../auth/tests/test-cookie-jar.js';
import { MatchPersistenceService } from '../match-persistence.service.js';
import { InMemoryGameRoomProvisioner } from '../ports/game-room-provisioner.js';
import {
  BullMqMatchLifecycleConsumer,
  InMemoryMatchLifecycleConsumer,
} from '../ports/match-lifecycle-consumer.js';

const SECRET = 'pre-m5-idempotency-dlq-secret-min-32-chars!!';

describe('Pre-M5 Item 1: Match Result Consumer Idempotency (matchId), Backoff Retries & Dead-Letter Queue', () => {
  let dbHandle: DatabaseConnectionHandle;
  let app: NestFastifyApplication;

  beforeAll(async () => {
    dbHandle = await createAdaptiveTestDatabase();
    app = await createApiApp({
      dbHandle,
      authOptions: { runtimeConfig: { sessionSecret: SECRET } },
      lobbyOptions: {
        gameRoomProvisioner: new InMemoryGameRoomProvisioner(),
        runtimeConfig: {
          sessionSecret: SECRET,
          internalSecret: SECRET,
          cleanupIntervalMs: 0,
        },
      },
    });
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    await dbHandle.close();
  });

  it('processes duplicate match.completed events (sequential and concurrent) leaving exactly 1 match and accurate stats', async () => {
    const p1Res = await app.inject({
      method: 'POST',
      url: '/v1/auth/guest',
      payload: { deviceName: 'IdemP1' },
    });
    const p2Res = await app.inject({
      method: 'POST',
      url: '/v1/auth/guest',
      payload: { deviceName: 'IdemP2' },
    });
    const p1Cookie = buildCookieHeader(extractAuthCookies(p1Res.headers['set-cookie']).map);
    const p2Cookie = buildCookieHeader(extractAuthCookies(p2Res.headers['set-cookie']).map);
    const p1User = p1Res.json<{ user: { id: string; nickname: string } }>().user;
    const p2User = p2Res.json<{ user: { id: string; nickname: string } }>().user;

    const createTableRes = await app.inject({
      method: 'POST',
      url: '/v1/tables',
      headers: { cookie: p1Cookie },
      payload: { mode: '1v1', visibility: 'PRIVATE', targetScore: 15, flor: false },
    });
    const created = createTableRes.json<{ id: string; joinCode: string }>();

    await app.inject({
      method: 'POST',
      url: '/v1/tables/join-by-code',
      headers: { cookie: p2Cookie },
      payload: { code: created.joinCode },
    });

    const matchId = generateUuidV7();
    const completedEvent: MatchCompletedLifecycleEvent = {
      kind: 'match.completed',
      matchId,
      roomId: created.id,
      mode: '1v1',
      rulesetCode: 'ar-corto-15-v1',
      seedCommitment: 'a'.repeat(64),
      seedReveal: 'b'.repeat(64),
      startedAtMs: 1_800_000_000_000,
      endedAtMs: 1_800_000_120_000,
      winnerTeam: 0,
      scoresByTeam: { '0': 15, '1': 9 },
      reason: 'TARGET_SCORE_REACHED',
      players: [
        {
          seat: 0,
          userId: p1User.id,
          nickname: p1User.nickname,
          team: 0,
          score: 15,
          outcome: 'WIN',
        },
        {
          seat: 1,
          userId: p2User.id,
          nickname: p2User.nickname,
          team: 1,
          score: 9,
          outcome: 'LOSS',
        },
      ],
      events: [
        { seq: 1, type: 'game.started', ts: 1_800_000_000_000, payload: { targetScore: 15 } },
        { seq: 2, type: 'game.ended', ts: 1_800_000_120_000, payload: { winnerTeam: 0 } },
      ],
    };

    const persistence = app.get(MatchPersistenceService);

    // Entrega 1 y 2 en paralelo + Entrega 3 secuencial del MISMO matchId
    await Promise.all([
      persistence.handleLifecycleEvent(completedEvent),
      persistence.handleLifecycleEvent(completedEvent),
    ]);
    await persistence.handleLifecycleEvent(completedEvent);

    const matchesRows = await dbHandle.db
      .select()
      .from(matchesTable)
      .where(eq(matchesTable.id, matchId));
    expect(matchesRows).toHaveLength(1);

    const playerRows = await dbHandle.db
      .select()
      .from(matchPlayersTable)
      .where(eq(matchPlayersTable.matchId, matchId));
    expect(playerRows).toHaveLength(2);

    const eventRows = await dbHandle.db
      .select()
      .from(matchEventsTable)
      .where(eq(matchEventsTable.matchId, matchId));
    expect(eventRows).toHaveLength(2);

    // Estadísticas públicas exactas (1 victoria para P1, 1 derrota para P2; jamás duplicadas)
    const statsP1 = await app.inject({ method: 'GET', url: `/v1/users/${p1User.id}/stats` });
    expect(statsP1.json()).toMatchObject({
      userId: p1User.id,
      matchesPlayed: 1,
      wins: 1,
      losses: 0,
      abandons: 0,
      winRate: 1,
    });

    const statsP2 = await app.inject({ method: 'GET', url: `/v1/users/${p2User.id}/stats` });
    expect(statsP2.json()).toMatchObject({
      userId: p2User.id,
      matchesPlayed: 1,
      wins: 0,
      losses: 1,
      abandons: 0,
      winRate: 0,
    });
  });

  it('retries transient errors with exponential backoff and moves permanently failing jobs to Dead-Letter Queue (InMemory)', async () => {
    const bus = new InMemoryMatchLifecycleBus();
    const consumer = new InMemoryMatchLifecycleConsumer(bus, {
      maxAttempts: 3,
      initialBackoffMs: 10,
    });

    let transientAttempts = 0;
    const processedMatchIds: string[] = [];

    await consumer.start(async (ev) => {
      if (ev.kind === 'match.started' && ev.matchId === '019a7e40-0000-7000-8000-000000000111') {
        transientAttempts += 1;
        if (transientAttempts < 2) {
          throw new Error('FALLO_TRANSITORIO_DB');
        }
        processedMatchIds.push(ev.matchId);
        return;
      }
      throw new Error('FALLO_PERMANENTE_IRRECUPERABLE');
    });

    try {
      // 1. Fallo transitorio en intento 1 -> reintenta con backoff y triunfa en intento 2
      await bus.publish({
        kind: 'match.started',
        roomId: '019a7e40-0000-7000-8000-000000000110',
        matchId: '019a7e40-0000-7000-8000-000000000111',
        startedAtMs: Date.now(),
        seats: [
          { seat: 0, team: 0, userId: 'u1' },
          { seat: 1, team: 1, userId: 'u2' },
        ],
      });
      expect(transientAttempts).toBe(2);
      expect(processedMatchIds).toEqual(['019a7e40-0000-7000-8000-000000000111']);
      expect(await consumer.listDeadLetterMessages()).toHaveLength(0);

      // 2. Fallo permanente -> agota los 3 intentos con backoff y aterriza en la DLQ
      await bus.publish({
        kind: 'match.started',
        roomId: '019a7e40-0000-7000-8000-000000000220',
        matchId: '019a7e40-0000-7000-8000-000000000222',
        startedAtMs: Date.now(),
        seats: [
          { seat: 0, team: 0, userId: 'u1' },
          { seat: 1, team: 1, userId: 'u2' },
        ],
      });

      const dlqItems = await consumer.listDeadLetterMessages();
      expect(dlqItems).toHaveLength(1);
      expect(dlqItems[0]).toMatchObject({
        idempotencyKey: 'match.started:019a7e40-0000-7000-8000-000000000222',
        errorMessage: 'FALLO_PERMANENTE_IRRECUPERABLE',
        attemptsMade: 3,
      });
    } finally {
      await consumer.close();
      await bus.close();
    }
  });

  const redisUrl = process.env['REDIS_URL'];
  const bullIt = redisUrl ? it : it.skip;

  bullIt(
    'routes terminally failed jobs after backoff retries to BullMQ Dead-Letter Queue in Redis',
    async () => {
      const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const queueName = `${MATCH_LIFECYCLE_QUEUE_NAME}-dlqtest-${suffix}`;
      const dlqQueueName = `${MATCH_LIFECYCLE_DLQ_NAME}-dlqtest-${suffix}`;

      const publisher = new BullMqMatchLifecyclePublisher(redisUrl!, {
        queueName,
        attempts: 3,
        backoffDelayMs: 25,
      });
      const consumer = new BullMqMatchLifecycleConsumer(redisUrl!, {
        queueName,
        dlqQueueName,
      });

      let attemptsObserved = 0;
      await consumer.start(async () => {
        attemptsObserved += 1;
        throw new Error('BULLMQ_PERMANENT_FAILURE');
      });

      try {
        await publisher.publish({
          kind: 'match.started',
          roomId: '019a7e40-0000-7000-8000-000000000330',
          matchId: '019a7e40-0000-7000-8000-000000000333',
          startedAtMs: Date.now(),
          seats: [
            { seat: 0, team: 0, userId: 'u1' },
            { seat: 1, team: 1, userId: 'u2' },
          ],
        });

        const deadline = Date.now() + 5_000;
        let dlq = await consumer.listDeadLetterMessages();
        while (dlq.length === 0 && Date.now() < deadline) {
          await new Promise((r) => setTimeout(r, 40));
          dlq = await consumer.listDeadLetterMessages();
        }

        expect(attemptsObserved).toBe(3);
        expect(dlq).toHaveLength(1);
        expect(dlq[0]).toMatchObject({
          idempotencyKey: 'match.started:019a7e40-0000-7000-8000-000000000333',
          attemptsMade: 3,
        });
      } finally {
        await consumer.close();
        await publisher.close();
      }
    },
  );
});
