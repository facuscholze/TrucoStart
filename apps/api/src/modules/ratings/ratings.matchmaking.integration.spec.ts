import { randomUUID } from 'node:crypto';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { MatchCompletedLifecycleEvent, MatchStartedLifecycleEvent } from '@truco/shared';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApiApp } from '../../bootstrap.js';
import {
  createAdaptiveTestDatabase,
  type DatabaseConnectionHandle,
} from '../../db/database.provider.js';
import {
  matchesTable,
  matchPlayersTable,
  profilesTable,
  ratingJobsTable,
  ratingProfilesTable,
  ratingSeasonsTable,
  tableSeatsTable,
  tablesTable,
  usersTable,
} from '../../db/schema/index.js';
import { buildCookieHeader, extractAuthCookies } from '../auth/tests/test-cookie-jar.js';
import { MATCHMAKING_STORE } from '../matchmaking/store/matchmaking-store.interface.js';
import { RedisMatchmakingStore } from '../matchmaking/store/redis-matchmaking-store.js';
import { MatchPersistenceService } from '../lobby/match-persistence.service.js';
import { InMemoryGameRoomProvisioner } from '../lobby/ports/game-room-provisioner.js';
import { NoopMatchLifecycleConsumer } from '../lobby/ports/match-lifecycle-consumer.js';
import { LEADERBOARD_STORE, type LeaderboardStore } from './leaderboard-store.interface.js';
import { RedisLeaderboardStore } from './redis-leaderboard-store.js';

const TEST_SECRET = 'm9b-competitive-integration-secret-at-least-32';
const redisUrl = process.env['REDIS_URL'];

async function createGuest(app: NestFastifyApplication, deviceName: string) {
  const response = await app.inject({
    method: 'POST',
    url: '/v1/auth/guest',
    payload: { deviceName },
  });
  expect(response.statusCode).toBe(201);
  const cookie = buildCookieHeader(extractAuthCookies(response.headers['set-cookie']).map);
  return {
    cookie,
    user: response.json<{ user: { id: string; nickname: string } }>().user,
  };
}

describe('M9b end-to-end: competitive queue, captured season, persisted rating and bots excluded', () => {
  let handle: DatabaseConnectionHandle;
  let app: NestFastifyApplication;
  let fakeNow: number;

  beforeAll(async () => {
    if (process.env['CI'] === 'true' && (!process.env['DATABASE_URL'] || !redisUrl)) {
      throw new Error('M9b integration requires real PostgreSQL and Redis services in CI.');
    }
    handle = await createAdaptiveTestDatabase();
    fakeNow = Date.now();
    const matchmakingStore = redisUrl
      ? new RedisMatchmakingStore(redisUrl, {
          keyPrefix: `truco:m9b:integration:${process.pid}:${randomUUID()}:`,
        })
      : undefined;
    app = await createApiApp({
      dbHandle: handle,
      authOptions: {
        runtimeConfig: { sessionSecret: TEST_SECRET, nowFn: () => fakeNow },
        rateLimitConfig: { maxPerIp: 200, maxPerAccount: 200, nowFn: () => fakeNow },
      },
      ratingsOptions: {
        runtimeConfig: {
          redisUrl: redisUrl ?? null,
          minimumMatches: 1,
          minimumOpponents: 1,
          queueBaseRatingWindow: 1_000,
          queueMaximumRatingWindow: 2_000,
          nowFn: () => fakeNow,
        },
      },
      lobbyOptions: {
        ...(matchmakingStore ? { matchmakingStore } : {}),
        redisUrl: redisUrl ?? '',
        gameRoomProvisioner: new InMemoryGameRoomProvisioner(),
        matchLifecycleConsumer: new NoopMatchLifecycleConsumer(),
        runtimeConfig: {
          sessionSecret: TEST_SECRET,
          internalSecret: TEST_SECRET,
          cleanupIntervalMs: 0,
          matchmakingTimeoutMs: 60_000,
          nowFn: () => fakeNow,
        },
      },
    });
    await app.init();
    if (redisUrl) {
      expect(app.get(MATCHMAKING_STORE)).toBeInstanceOf(RedisMatchmakingStore);
      expect(app.get(LEADERBOARD_STORE)).toBeInstanceOf(RedisLeaderboardStore);
    }
  });

  afterAll(async () => {
    await app.close();
    await handle.close();
  });

  it('persists match-start season, processes a completion once, exposes rankings and ignores a bot game', async () => {
    const p1 = await createGuest(app, 'M9bJugadorCompetitivoA');
    const p2 = await createGuest(app, 'M9bJugadorCompetitivoB');
    const createdAt = new Date(fakeNow - 30 * 24 * 60 * 60 * 1000);
    for (const user of [p1.user, p2.user]) {
      await handle.db
        .update(usersTable)
        .set({ createdAt, updatedAt: createdAt })
        .where(eq(usersTable.id, user.id));
      await handle.db
        .update(profilesTable)
        .set({
          settings: {
            soundEnabled: true,
            animationsReduced: false,
            confirmCalls: false,
            historyVisibility: 'ALL',
            statsVisibility: user.id === p1.user.id ? 'ALL' : 'NOBODY',
            presenceVisibility: 'FRIENDS',
          },
        })
        .where(eq(profilesTable.userId, user.id));
    }

    const [activeSeason] = await handle.db
      .select()
      .from(ratingSeasonsTable)
      .where(eq(ratingSeasonsTable.status, 'ACTIVE'))
      .limit(1);
    expect(activeSeason).toBeDefined();

    const firstQueue = await app.inject({
      method: 'POST',
      url: '/v1/matchmaking/queue',
      headers: { cookie: p1.cookie },
      payload: { mode: '1v1', rulesetCode: 'ar-standard-v1', competitive: true },
    });
    expect(firstQueue.statusCode).toBe(200);
    expect(firstQueue.json<{ status: string; competitive: boolean }>().competitive).toBe(true);
    const matched = await app.inject({
      method: 'POST',
      url: '/v1/matchmaking/queue',
      headers: { cookie: p2.cookie },
      payload: { mode: '1v1', rulesetCode: 'ar-standard-v1', competitive: true },
    });
    expect(matched.statusCode).toBe(201);
    const tableId = matched.json<{ tableId: string; competitive: boolean }>().tableId;
    expect(matched.json<{ competitive: boolean }>().competitive).toBe(true);
    expect(
      (await handle.db.select().from(tablesTable).where(eq(tablesTable.id, tableId)))[0]
        ?.isCompetitive,
    ).toBe(true);

    const firstMatchId = '019a0000-0000-7000-8000-000000000001';
    const startedAtMs = fakeNow + 1_000;
    const started: MatchStartedLifecycleEvent = {
      kind: 'match.started',
      roomId: tableId,
      matchId: firstMatchId,
      startedAtMs,
      seats: [
        { seat: 0, team: 0, userId: p1.user.id },
        { seat: 1, team: 1, userId: p2.user.id },
      ],
    };
    const persistence = app.get(MatchPersistenceService);
    await persistence.handleLifecycleEvent(started);
    const capturedTable = (
      await handle.db.select().from(tablesTable).where(eq(tablesTable.id, tableId))
    )[0];
    expect(capturedTable?.competitiveSeasonId).toBe(activeSeason!.id);
    expect(capturedTable?.status).toBe('IN_GAME');

    const firstCompleted: MatchCompletedLifecycleEvent = {
      kind: 'match.completed',
      matchId: firstMatchId,
      roomId: tableId,
      mode: '1v1',
      rulesetCode: 'ar-standard-v1',
      seedCommitment: 'a'.repeat(64),
      seedReveal: 'b'.repeat(64),
      startedAtMs,
      endedAtMs: startedAtMs + 5 * 60 * 1000,
      winnerTeam: 0,
      scoresByTeam: { '0': 30, '1': 10 },
      reason: 'TARGET_SCORE',
      players: [
        {
          seat: 0,
          userId: p1.user.id,
          nickname: p1.user.nickname,
          team: 0,
          score: 30,
          outcome: 'WIN',
        },
        {
          seat: 1,
          userId: p2.user.id,
          nickname: p2.user.nickname,
          team: 1,
          score: 10,
          outcome: 'LOSS',
        },
      ],
      events: [{ seq: 1, type: 'game.started', ts: startedAtMs, payload: {} }],
    };
    await persistence.handleLifecycleEvent(firstCompleted);
    await persistence.handleLifecycleEvent(firstCompleted);

    // A delayed/retried start event must not resurrect a table after its match completed.
    await persistence.handleLifecycleEvent(started);
    const tableAfterLateStart = (
      await handle.db.select().from(tablesTable).where(eq(tablesTable.id, tableId))
    )[0];
    expect(tableAfterLateStart?.status).toBe('FINISHED');
    expect(
      await handle.db
        .select()
        .from(tableSeatsTable)
        .where(and(eq(tableSeatsTable.tableId, tableId), eq(tableSeatsTable.isActive, true))),
    ).toHaveLength(0);

    const storedMatch = (
      await handle.db.select().from(matchesTable).where(eq(matchesTable.id, firstMatchId))
    )[0];
    expect(storedMatch).toMatchObject({
      isCompetitive: true,
      hasBots: false,
      seasonId: activeSeason!.id,
    });
    expect(
      await handle.db
        .select()
        .from(ratingJobsTable)
        .where(eq(ratingJobsTable.matchId, firstMatchId)),
    ).toHaveLength(1);
    const profilesAfterMatch = await handle.db
      .select()
      .from(ratingProfilesTable)
      .where(eq(ratingProfilesTable.seasonId, activeSeason!.id));
    expect(profilesAfterMatch).toHaveLength(2);
    expect(profilesAfterMatch.every((profile) => profile.matchesPlayed === 1)).toBe(true);

    const leaderboardStore = app.get<LeaderboardStore>(LEADERBOARD_STORE);
    let cacheReadSucceeded = false;
    const readPage = leaderboardStore.readPage.bind(leaderboardStore);
    leaderboardStore.readPage = async (key, offset, limit) => {
      const page = await readPage(key, offset, limit);
      cacheReadSucceeded = true;
      return page;
    };
    const rankings = await app.inject({
      method: 'GET',
      url: '/v1/rankings?period=GLOBAL&mode=1v1&limit=10',
    });
    expect(rankings.statusCode).toBe(200);
    expect(cacheReadSucceeded).toBe(true);
    const rankedUserIds = rankings
      .json<{ items: Array<{ userId: string }> }>()
      .items.map((item) => item.userId);
    expect(rankedUserIds).toContain(p1.user.id);
    expect(rankedUserIds).not.toContain(p2.user.id);
    const playerRatings = await app.inject({
      method: 'GET',
      url: `/v1/users/${p1.user.id}/ratings`,
      headers: { cookie: p1.cookie },
    });
    expect(playerRatings.statusCode).toBe(200);
    expect(
      playerRatings.json<{ ratings: Array<{ mode: string; matchesPlayed: number }> }>().ratings,
    ).toContainEqual(expect.objectContaining({ mode: '1v1', matchesPlayed: 1 }));
    const hiddenPlayerRatings = await app.inject({
      method: 'GET',
      url: `/v1/users/${p2.user.id}/ratings`,
      headers: { cookie: p1.cookie },
    });
    expect(hiddenPlayerRatings.statusCode).toBe(404);

    // Same competitive table rematch acquired a replacement bot: row is durable, rating stays unchanged.
    const secondMatchId = '019a0000-0000-7000-8000-000000000002';
    const secondStartedAt = startedAtMs + 10 * 60 * 1000;
    await persistence.handleLifecycleEvent({
      ...started,
      matchId: secondMatchId,
      startedAtMs: secondStartedAt,
    });
    await persistence.handleLifecycleEvent({
      ...firstCompleted,
      matchId: secondMatchId,
      startedAtMs: secondStartedAt,
      endedAtMs: secondStartedAt + 5 * 60 * 1000,
      hasBots: true,
    });
    const profilesAfterBotMatch = await handle.db
      .select()
      .from(ratingProfilesTable)
      .where(
        and(
          eq(ratingProfilesTable.seasonId, activeSeason!.id),
          eq(ratingProfilesTable.mode, '1v1'),
        ),
      );
    expect(profilesAfterBotMatch.every((profile) => profile.matchesPlayed === 1)).toBe(true);
    expect(
      await handle.db
        .select()
        .from(ratingJobsTable)
        .where(eq(ratingJobsTable.matchId, secondMatchId)),
    ).toHaveLength(1);
    const botRows = await handle.db
      .select({ ratingDelta: matchPlayersTable.ratingDelta })
      .from(matchPlayersTable)
      .where(eq(matchPlayersTable.matchId, secondMatchId));
    expect(botRows.every((row) => row.ratingDelta === 0)).toBe(true);

    // BullMQ workers may process the completion before a delayed start event. The completion
    // path must capture the season before commit, and a late start must not reopen the table.
    const queuedAgain = await app.inject({
      method: 'POST',
      url: '/v1/matchmaking/queue',
      headers: { cookie: p1.cookie },
      payload: { mode: '1v1', rulesetCode: 'ar-standard-v1', competitive: true },
    });
    expect(queuedAgain.statusCode).toBe(200);
    const matchedAgain = await app.inject({
      method: 'POST',
      url: '/v1/matchmaking/queue',
      headers: { cookie: p2.cookie },
      payload: { mode: '1v1', rulesetCode: 'ar-standard-v1', competitive: true },
    });
    expect(matchedAgain.statusCode).toBe(201);
    const outOfOrderTableId = matchedAgain.json<{ tableId: string }>().tableId;
    const thirdMatchId = '019a0000-0000-7000-8000-000000000003';
    const thirdStartedAt = secondStartedAt + 10 * 60 * 1000;
    const thirdStarted: MatchStartedLifecycleEvent = {
      ...started,
      roomId: outOfOrderTableId,
      matchId: thirdMatchId,
      startedAtMs: thirdStartedAt,
    };
    await persistence.handleLifecycleEvent({
      ...firstCompleted,
      roomId: outOfOrderTableId,
      matchId: thirdMatchId,
      startedAtMs: thirdStartedAt,
      endedAtMs: thirdStartedAt + 5 * 60 * 1000,
    });
    const completedFirstTable = (
      await handle.db.select().from(tablesTable).where(eq(tablesTable.id, outOfOrderTableId))
    )[0];
    const completedFirstMatch = (
      await handle.db.select().from(matchesTable).where(eq(matchesTable.id, thirdMatchId))
    )[0];
    expect(completedFirstTable).toMatchObject({
      status: 'FINISHED',
      competitiveSeasonId: activeSeason!.id,
    });
    expect(completedFirstMatch?.seasonId).toBe(activeSeason!.id);

    await persistence.handleLifecycleEvent(thirdStarted);
    const tableAfterOutOfOrderStart = (
      await handle.db.select().from(tablesTable).where(eq(tablesTable.id, outOfOrderTableId))
    )[0];
    expect(tableAfterOutOfOrderStart?.status).toBe('FINISHED');
    expect(
      await handle.db
        .select()
        .from(tableSeatsTable)
        .where(
          and(eq(tableSeatsTable.tableId, outOfOrderTableId), eq(tableSeatsTable.isActive, true)),
        ),
    ).toHaveLength(0);
  });
});
