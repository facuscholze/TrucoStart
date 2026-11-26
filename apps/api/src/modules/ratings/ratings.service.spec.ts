import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';
import { DomainApiException } from '../../common/api-exception.js';
import { generateUuidV7 } from '../../common/uuidv7.js';
import {
  createAdaptiveTestDatabase,
  type DatabaseConnectionHandle,
} from '../../db/database.provider.js';
import {
  competitiveReviewCasesTable,
  matchesTable,
  matchPlayersTable,
  profilesTable,
  ratingJobsTable,
  ratingPeriodStatsTable,
  ratingProfilesTable,
  ratingRedisOutboxTable,
  ratingRivalriesTable,
  ratingSeasonAuditsTable,
  ratingSeasonSnapshotsTable,
  ratingSeasonsTable,
  rulesetsTable,
  sanctionsTable,
  tablesTable,
  usersTable,
} from '../../db/schema/index.js';
import { UsersRepository } from '../users/users.repository.js';
import { InMemoryLeaderboardStore } from './in-memory-leaderboard-store.js';
import type { LeaderboardStore } from './leaderboard-store.interface.js';
import { buildRatingRuntimeConfig } from './ratings.config.js';
import { RatingsService } from './ratings.service.js';

const DAY_MS = 24 * 60 * 60 * 1000;

interface TestContext {
  readonly handle: DatabaseConnectionHandle;
  readonly service: RatingsService;
  readonly now: number;
  readonly seasonId: string;
}

async function createContext(
  config: Parameters<typeof buildRatingRuntimeConfig>[0] = {},
  leaderboardStore: LeaderboardStore = new InMemoryLeaderboardStore(),
): Promise<TestContext> {
  const handle = await createAdaptiveTestDatabase();
  const now = Date.now();
  const [season] = await handle.db
    .select({ id: ratingSeasonsTable.id })
    .from(ratingSeasonsTable)
    .where(eq(ratingSeasonsTable.status, 'ACTIVE'))
    .limit(1);
  if (!season) throw new Error('La migración debe sembrar una temporada activa.');
  const service = new RatingsService(
    handle.db,
    leaderboardStore,
    buildRatingRuntimeConfig({
      redisUrl: null,
      minimumMatches: 1,
      minimumOpponents: 1,
      repeatRivalLimit: 2,
      repeatedPairSignalCount: 2,
      shortMatchThresholdMs: 0,
      coordinatedAbandonSignalCount: 2,
      newAccountAgeMs: 7 * DAY_MS,
      newAccountFeedLossCount: 3,
      seasonDurationDays: 90,
      nowFn: () => now,
      ...config,
    }),
    new UsersRepository(handle.db),
  );
  return { handle, service, now, seasonId: season.id };
}

async function createPlayers(
  handle: DatabaseConnectionHandle,
  now: number,
  suffix: string,
  count = 2,
) {
  const players = Array.from({ length: count }, (_, index) => ({
    id: generateUuidV7(now + index),
    nickname: `${suffix}${index}`,
    nicknameLower: `${suffix}${index}`.toLowerCase(),
  }));
  await handle.db.insert(usersTable).values(
    players.map((player) => ({
      id: player.id,
      nickname: player.nickname,
      nicknameLower: player.nicknameLower,
      status: 'ACTIVE' as const,
      createdAt: new Date(now - 30 * DAY_MS),
      updatedAt: new Date(now - 30 * DAY_MS),
    })),
  );
  await handle.db.insert(profilesTable).values(
    players.map((player) => ({
      userId: player.id,
      settings: {
        soundEnabled: true,
        animationsReduced: false,
        confirmCalls: false,
        historyVisibility: 'ALL' as const,
        statsVisibility: 'ALL' as const,
        presenceVisibility: 'FRIENDS' as const,
      },
    })),
  );
  return players;
}

async function insertMatch(input: {
  readonly handle: DatabaseConnectionHandle;
  readonly now: number;
  readonly seasonId: string;
  readonly players: readonly { readonly id: string }[];
  readonly mode?: '1v1' | '2v2';
  readonly competitive?: boolean;
  readonly hasBots?: boolean;
  readonly reason?: 'TARGET_SCORE' | 'ABANDON';
}) {
  const mode = input.mode ?? '1v1';
  const matchId = generateUuidV7(input.now + Math.floor(Math.random() * 1000));
  const endedAt = new Date(input.now);
  const startedAt = new Date(input.now - 5 * 60 * 1000);
  await input.handle.db.insert(matchesTable).values({
    id: matchId,
    tableId: null,
    mode,
    rulesetId: null,
    rulesetCode: 'ar-standard-v1',
    seedCommitment: 'a'.repeat(64),
    startedAt,
    endedAt,
    result: {
      winnerTeam: 0,
      team0Score: 30,
      team1Score: 10,
      reason: input.reason ?? 'TARGET_SCORE',
    },
    hasBots: input.hasBots ?? false,
    isCompetitive: input.competitive ?? true,
    seasonId: input.seasonId,
  });
  const playerValues = input.players.map((player, index) => ({
    matchId,
    seat: index,
    userId: player.id,
    team: index % 2,
    score: index % 2 === 0 ? 30 : 10,
    outcome: (index % 2 === 0 ? 'WIN' : input.reason === 'ABANDON' ? 'ABANDON' : 'LOSS') as
      'WIN' | 'LOSS' | 'ABANDON',
  }));
  await input.handle.db.insert(matchPlayersTable).values(playerValues);
  return matchId;
}

describe('RatingsService — durable competitive rating lifecycle', () => {
  it('keeps the repeat-opponent signal threshold reachable before matchmaking blocks rematches', () => {
    const variables = ['COMPETITIVE_REPEAT_RIVAL_LIMIT', 'ANTI_ABUSE_REPEAT_PAIR_COUNT'] as const;
    const previous = variables.map((name) => process.env[name]);
    try {
      for (const name of variables) delete process.env[name];
      const config = buildRatingRuntimeConfig({ redisUrl: null });
      expect(config.repeatRivalLimit).toBeGreaterThanOrEqual(config.repeatedPairSignalCount);
    } finally {
      variables.forEach((name, index) => {
        const value = previous[index];
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      });
    }
  });

  it('processes only human competitive games, is idempotent, and rebuilds global/week/month rankings', async () => {
    const context = await createContext();
    try {
      const players = await createPlayers(context.handle, context.now, 'rated-');
      const matchId = await insertMatch({
        handle: context.handle,
        now: context.now,
        seasonId: context.seasonId,
        players,
      });

      await context.service.processMatch(matchId);
      const afterFirst = await context.handle.db
        .select()
        .from(ratingProfilesTable)
        .where(eq(ratingProfilesTable.seasonId, context.seasonId));
      expect(afterFirst).toHaveLength(2);
      expect(afterFirst.every((profile) => profile.matchesPlayed === 1)).toBe(true);
      expect(
        afterFirst.find((profile) => profile.userId === players[0]!.id)!.rating,
      ).toBeGreaterThan(1500);
      expect(afterFirst.find((profile) => profile.userId === players[1]!.id)!.rating).toBeLessThan(
        1500,
      );
      expect(await context.handle.db.select().from(ratingJobsTable)).toHaveLength(1);
      expect(await context.handle.db.select().from(ratingRedisOutboxTable)).toHaveLength(1);
      expect((await context.handle.db.select().from(ratingRivalriesTable))[0]?.matchesPlayed).toBe(
        1,
      );

      const deltasBeforeRetry = await context.handle.db
        .select({ ratingDelta: matchPlayersTable.ratingDelta })
        .from(matchPlayersTable)
        .where(eq(matchPlayersTable.matchId, matchId));
      await context.service.processMatch(matchId);
      const afterRetry = await context.handle.db
        .select()
        .from(ratingProfilesTable)
        .where(eq(ratingProfilesTable.seasonId, context.seasonId));
      expect(afterRetry.map((profile) => profile.matchesPlayed)).toEqual([1, 1]);
      expect(
        (
          await context.handle.db
            .select()
            .from(ratingRivalriesTable)
            .where(eq(ratingRivalriesTable.seasonId, context.seasonId))
        )[0]?.matchesPlayed,
      ).toBe(1);
      expect(
        (
          await context.handle.db
            .select({ ratingDelta: matchPlayersTable.ratingDelta })
            .from(matchPlayersTable)
            .where(eq(matchPlayersTable.matchId, matchId))
        ).map((row) => row.ratingDelta),
      ).toEqual(deltasBeforeRetry.map((row) => row.ratingDelta));

      const casualPlayers = await createPlayers(context.handle, context.now + 2_000, 'casual-');
      const casualMatch = await insertMatch({
        handle: context.handle,
        now: context.now + 2_000,
        seasonId: context.seasonId,
        players: casualPlayers,
        competitive: false,
      });
      await context.service.processMatch(casualMatch);
      const botPlayers = await createPlayers(context.handle, context.now + 4_000, 'bot-');
      const botMatch = await insertMatch({
        handle: context.handle,
        now: context.now + 4_000,
        seasonId: context.seasonId,
        players: botPlayers,
        hasBots: true,
      });
      await context.service.processMatch(botMatch);
      expect(
        await context.handle.db
          .select()
          .from(ratingProfilesTable)
          .where(eq(ratingProfilesTable.userId, casualPlayers[0]!.id)),
      ).toHaveLength(0);
      expect(
        await context.handle.db
          .select()
          .from(ratingProfilesTable)
          .where(eq(ratingProfilesTable.userId, botPlayers[0]!.id)),
      ).toHaveLength(0);
      expect(
        await context.handle.db
          .select()
          .from(ratingJobsTable)
          .where(eq(ratingJobsTable.matchId, botMatch)),
      ).toHaveLength(1);

      const global = await context.service.getLeaderboard({
        period: 'GLOBAL',
        mode: '1v1',
        limit: 10,
      });
      const weekly = await context.service.getLeaderboard({
        period: 'WEEKLY',
        mode: '1v1',
        limit: 10,
      });
      const monthly = await context.service.getLeaderboard({
        period: 'MONTHLY',
        mode: '1v1',
        limit: 10,
      });
      expect(global.items).toHaveLength(2);
      expect(global.items[0]?.userId).toBe(players[0]!.id);
      expect(weekly.items).toHaveLength(2);
      expect(monthly.items).toHaveLength(2);
      expect(weekly.items[0]?.score).toBeGreaterThan(0);
    } finally {
      await context.service.onApplicationShutdown();
      await context.handle.close();
    }
  });

  it('keeps 1v1 and 2v2 profiles separate in one season and rates each 2v2 player against both opponents', async () => {
    const context = await createContext();
    try {
      const players = await createPlayers(context.handle, context.now, 'mode-season-', 4);
      const twoVTwoMatch = await insertMatch({
        handle: context.handle,
        now: context.now,
        seasonId: context.seasonId,
        players,
        mode: '2v2',
      });
      await context.service.processMatch(twoVTwoMatch);

      const deltas = await context.handle.db
        .select({
          userId: matchPlayersTable.userId,
          team: matchPlayersTable.team,
          ratingDelta: matchPlayersTable.ratingDelta,
        })
        .from(matchPlayersTable)
        .where(eq(matchPlayersTable.matchId, twoVTwoMatch));
      expect(deltas).toHaveLength(4);
      expect(
        deltas.filter((player) => player.team === 0).every((player) => player.ratingDelta > 0),
      ).toBe(true);
      expect(
        deltas.filter((player) => player.team === 1).every((player) => player.ratingDelta < 0),
      ).toBe(true);

      const oneVOneMatch = await insertMatch({
        handle: context.handle,
        now: context.now + 2_000,
        seasonId: context.seasonId,
        players: players.slice(0, 2),
        mode: '1v1',
      });
      await context.service.processMatch(oneVOneMatch);

      const profiles = await context.handle.db
        .select()
        .from(ratingProfilesTable)
        .where(eq(ratingProfilesTable.seasonId, context.seasonId));
      expect(profiles.filter((profile) => profile.mode === '2v2')).toHaveLength(4);
      expect(profiles.filter((profile) => profile.mode === '1v1')).toHaveLength(2);
      expect(profiles.every((profile) => profile.seasonId === context.seasonId)).toBe(true);
      expect(
        profiles.find((profile) => profile.userId === players[0]!.id && profile.mode === '2v2')
          ?.matchesPlayed,
      ).toBe(1);
      expect(
        profiles.find((profile) => profile.userId === players[0]!.id && profile.mode === '1v1')
          ?.matchesPlayed,
      ).toBe(1);
    } finally {
      await context.service.onApplicationShutdown();
      await context.handle.close();
    }
  });

  it('counts an abandoning player as a loss and applies a losing rating result', async () => {
    const context = await createContext();
    try {
      const players = await createPlayers(context.handle, context.now, 'abandon-');
      const matchId = await insertMatch({
        handle: context.handle,
        now: context.now,
        seasonId: context.seasonId,
        players,
        reason: 'ABANDON',
      });
      await context.service.processMatch(matchId);

      const profiles = await context.handle.db
        .select()
        .from(ratingProfilesTable)
        .where(eq(ratingProfilesTable.seasonId, context.seasonId));
      const winner = profiles.find((profile) => profile.userId === players[0]!.id);
      const abandoner = profiles.find((profile) => profile.userId === players[1]!.id);
      expect(winner).toMatchObject({ matchesPlayed: 1, wins: 1, losses: 0, abandons: 0 });
      expect(abandoner).toMatchObject({ matchesPlayed: 1, wins: 0, losses: 1, abandons: 1 });
      expect(abandoner?.rating).toBeLessThan(1500);
      expect(
        (
          await context.handle.db
            .select({ ratingDelta: matchPlayersTable.ratingDelta })
            .from(matchPlayersTable)
            .where(
              and(
                eq(matchPlayersTable.matchId, matchId),
                eq(matchPlayersTable.userId, players[1]!.id),
              ),
            )
        )[0]?.ratingDelta,
      ).toBeLessThan(0);
    } finally {
      await context.service.onApplicationShutdown();
      await context.handle.close();
    }
  });

  it('does not use bot-match results as evidence for new-account feeding signals', async () => {
    const context = await createContext({
      repeatRivalLimit: 100,
      repeatedPairSignalCount: 100,
      coordinatedAbandonSignalCount: 100,
      newAccountAgeMs: 90 * DAY_MS,
      newAccountFeedLossCount: 2,
    });
    try {
      const players = await createPlayers(context.handle, context.now, 'feed-');
      const botMatch = await insertMatch({
        handle: context.handle,
        now: context.now,
        seasonId: context.seasonId,
        players,
        hasBots: true,
      });
      await context.service.processMatch(botMatch);

      const humanMatch = await insertMatch({
        handle: context.handle,
        now: context.now + 10_000,
        seasonId: context.seasonId,
        players,
      });
      await context.service.processMatch(humanMatch);

      expect(await context.handle.db.select().from(competitiveReviewCasesTable)).toHaveLength(0);
      const profiles = await context.handle.db
        .select()
        .from(ratingProfilesTable)
        .where(eq(ratingProfilesTable.seasonId, context.seasonId));
      expect(profiles).toHaveLength(2);
      expect(profiles.every((profile) => profile.matchesPlayed === 1)).toBe(true);
    } finally {
      await context.service.onApplicationShutdown();
      await context.handle.close();
    }
  });

  it('falls back to PostgreSQL when leaderboard writes fail and when Redis rankOf throws or returns null', async () => {
    const failingStore = new InMemoryLeaderboardStore();
    failingStore.replaceLeaderboard = async () => {
      throw new Error('Redis unavailable');
    };
    const fallbackContext = await createContext({}, failingStore);
    try {
      const players = await createPlayers(fallbackContext.handle, fallbackContext.now, 'fallback-');
      const matchId = await insertMatch({
        handle: fallbackContext.handle,
        now: fallbackContext.now,
        seasonId: fallbackContext.seasonId,
        players,
      });
      await fallbackContext.service.processMatch(matchId);
      const leaderboard = await fallbackContext.service.getLeaderboard({
        period: 'GLOBAL',
        mode: '1v1',
        limit: 10,
      });
      expect(leaderboard.items.map((item) => item.userId)).toEqual([
        players[0]!.id,
        players[1]!.id,
      ]);
    } finally {
      await fallbackContext.service.onApplicationShutdown();
      await fallbackContext.handle.close();
    }

    for (const rankResult of ['NULL', 'ERROR'] as const) {
      const store = new InMemoryLeaderboardStore();
      const context = await createContext({}, store);
      try {
        const players = await createPlayers(context.handle, context.now, `rank-${rankResult}-`);
        const matchId = await insertMatch({
          handle: context.handle,
          now: context.now,
          seasonId: context.seasonId,
          players,
        });
        await context.service.processMatch(matchId);
        store.rankOf = async () => {
          if (rankResult === 'ERROR') throw new Error('Redis rank lookup failed');
          return null;
        };

        const response = await context.service.getPlayerRatingProfiles(
          players[0]!.id,
          players[0]!.id,
        );
        expect(response.ratings.find((rating) => rating.mode === '1v1')?.position).toBe(1);
      } finally {
        await context.service.onApplicationShutdown();
        await context.handle.close();
      }
    }
  });

  it('creates human-review evidence for repeat opponents and closes a season once with soft reset and frozen eligible ranks', async () => {
    const context = await createContext({ repeatedPairSignalCount: 2, repeatRivalLimit: 2 });
    try {
      const players = await createPlayers(context.handle, context.now, 'review-');
      const firstMatch = await insertMatch({
        handle: context.handle,
        now: context.now,
        seasonId: context.seasonId,
        players,
      });
      await context.service.processMatch(firstMatch);
      const secondMatch = await insertMatch({
        handle: context.handle,
        now: context.now + 10_000,
        seasonId: context.seasonId,
        players,
      });
      await context.service.processMatch(secondMatch);

      const reviewCases = await context.handle.db.select().from(competitiveReviewCasesTable);
      expect(reviewCases).toHaveLength(1);
      expect(reviewCases[0]?.signals).toContain('REPEATED_OPPONENTS');
      expect(reviewCases[0]?.signals).not.toContain('AUTO_SANCTION');
      expect(await context.handle.db.select().from(sanctionsTable)).toHaveLength(0);

      const profile = await context.service.getCompetitiveMatchmakingProfile(players[0]!.id, '1v1');
      expect(profile.blockedOpponentIds).toContain(players[1]!.id);
      const listed = await context.service.listCompetitiveReviewCases({
        cursor: 0,
        limit: 25,
        status: 'OPEN',
      });
      expect(listed.items[0]?.users).toHaveLength(2);
      expect(listed.items[0]?.version).toBe(0);

      const actorId = players[0]!.id;
      const adminSessionId = randomUUID();
      const claimed = await context.service.claimCompetitiveReviewCase({
        caseId: reviewCases[0]!.id,
        expectedVersion: 0,
        actorId,
        adminSessionId,
        ip: '127.0.0.1',
      });
      expect(claimed).toMatchObject({ status: 'IN_REVIEW', version: 1 });
      await expect(
        context.service.claimCompetitiveReviewCase({
          caseId: reviewCases[0]!.id,
          expectedVersion: 0,
          actorId: players[1]!.id,
          adminSessionId: randomUUID(),
          ip: null,
        }),
      ).rejects.toBeInstanceOf(DomainApiException);
      const resolved = await context.service.resolveCompetitiveReviewCase({
        caseId: reviewCases[0]!.id,
        expectedVersion: 1,
        resolutionNote: 'Se revisó la evidencia y no se observó un patrón concluyente.',
        actorId,
        adminSessionId,
        ip: '127.0.0.1',
      });
      expect(resolved).toMatchObject({ status: 'RESOLVED', version: 2 });
      expect(await context.handle.db.select().from(sanctionsTable)).toHaveLength(0);

      // New evidence for the same pattern reopens the human-review case and invalidates stale UI versions.
      const thirdMatch = await insertMatch({
        handle: context.handle,
        now: context.now + 20_000,
        seasonId: context.seasonId,
        players,
      });
      await context.service.processMatch(thirdMatch);
      const reopenedCase = (await context.handle.db.select().from(competitiveReviewCasesTable))[0];
      expect(reopenedCase).toMatchObject({ status: 'OPEN', version: 3 });
      expect(reopenedCase?.claimedBy).toBeNull();
      expect(reopenedCase?.resolvedBy).toBeNull();
      expect(reopenedCase?.resolutionNote).toBeNull();
      expect(reopenedCase?.matchIds).toContain(thirdMatch);

      const oldSeason = await context.handle.db
        .select()
        .from(ratingSeasonsTable)
        .where(eq(ratingSeasonsTable.id, context.seasonId));
      const firstClose = await context.service.closeSeason(context.seasonId);
      expect(firstClose.closed).toBe(true);
      expect(firstClose.nextSeasonId).not.toBeNull();
      const secondClose = await context.service.closeSeason(context.seasonId);
      expect(secondClose).toEqual(firstClose);
      expect(oldSeason[0]?.status).toBe('ACTIVE');
      expect(
        (
          await context.handle.db
            .select()
            .from(ratingSeasonsTable)
            .where(eq(ratingSeasonsTable.id, context.seasonId))
        )[0]?.status,
      ).toBe('CLOSED');
      expect(
        await context.handle.db
          .select()
          .from(ratingSeasonAuditsTable)
          .where(eq(ratingSeasonAuditsTable.seasonId, context.seasonId)),
      ).toHaveLength(1);
      expect(
        await context.handle.db
          .select()
          .from(ratingSeasonSnapshotsTable)
          .where(eq(ratingSeasonSnapshotsTable.seasonId, context.seasonId)),
      ).toHaveLength(2);
      const newProfiles = await context.handle.db
        .select()
        .from(ratingProfilesTable)
        .where(eq(ratingProfilesTable.seasonId, firstClose.nextSeasonId!));
      expect(newProfiles).toHaveLength(2);
      expect(
        newProfiles.every((item) => item.matchesPlayed === 0 && item.opponentsCount === 0),
      ).toBe(true);
      expect(newProfiles.every((item) => item.deviation >= 30 && item.deviation <= 350)).toBe(true);
      expect(newProfiles.some((item) => item.rating > 1500)).toBe(true);

      const audits = await context.handle.db.select().from(ratingSeasonAuditsTable);
      expect(audits[0]?.nextSeasonId).toBe(firstClose.nextSeasonId);
      expect(await context.handle.db.select().from(sanctionsTable)).toHaveLength(0);
      expect(
        await context.handle.db
          .select()
          .from(ratingPeriodStatsTable)
          .where(eq(ratingPeriodStatsTable.seasonId, context.seasonId)),
      ).toHaveLength(4);
    } finally {
      await context.service.onApplicationShutdown();
      await context.handle.close();
    }
  });

  it('rolls back a mid-close failure completely and retries season rotation atomically', async () => {
    const context = await createContext();
    const injectedConstraint = 'm9b_test_injected_season_close_failure';
    try {
      const players = await createPlayers(context.handle, context.now, 'atomic-close-');
      const matchId = await insertMatch({
        handle: context.handle,
        now: context.now,
        seasonId: context.seasonId,
        players,
      });
      await context.service.processMatch(matchId);

      await context.handle.db.execute(
        sql`ALTER TABLE "rating_season_audits" ADD CONSTRAINT "m9b_test_injected_season_close_failure" CHECK ("snapshot_count" < 0)`,
      );
      try {
        await expect(context.service.closeSeason(context.seasonId)).rejects.toThrow();
      } finally {
        await context.handle.db.execute(
          sql`ALTER TABLE "rating_season_audits" DROP CONSTRAINT "m9b_test_injected_season_close_failure"`,
        );
      }

      expect(
        (
          await context.handle.db
            .select()
            .from(ratingSeasonsTable)
            .where(eq(ratingSeasonsTable.id, context.seasonId))
        )[0]?.status,
      ).toBe('ACTIVE');
      expect(
        await context.handle.db
          .select()
          .from(ratingSeasonsTable)
          .where(eq(ratingSeasonsTable.status, 'ACTIVE')),
      ).toHaveLength(1);
      expect(
        await context.handle.db
          .select()
          .from(ratingSeasonSnapshotsTable)
          .where(eq(ratingSeasonSnapshotsTable.seasonId, context.seasonId)),
      ).toHaveLength(0);
      expect(
        await context.handle.db
          .select()
          .from(ratingSeasonAuditsTable)
          .where(eq(ratingSeasonAuditsTable.seasonId, context.seasonId)),
      ).toHaveLength(0);
      expect(await context.handle.db.select().from(ratingSeasonsTable)).toHaveLength(1);
      expect(await context.handle.db.select().from(ratingProfilesTable)).toHaveLength(2);

      const retriedClose = await context.service.closeSeason(context.seasonId);
      expect(retriedClose).toMatchObject({ closed: true, deferred: false });
      expect(retriedClose.nextSeasonId).not.toBeNull();
      expect(
        await context.handle.db
          .select()
          .from(ratingSeasonSnapshotsTable)
          .where(eq(ratingSeasonSnapshotsTable.seasonId, context.seasonId)),
      ).toHaveLength(2);
      expect(
        await context.handle.db
          .select()
          .from(ratingSeasonAuditsTable)
          .where(eq(ratingSeasonAuditsTable.seasonId, context.seasonId)),
      ).toHaveLength(1);
      expect(
        await context.handle.db
          .select()
          .from(ratingSeasonsTable)
          .where(eq(ratingSeasonsTable.status, 'ACTIVE')),
      ).toHaveLength(1);
      expect(
        await context.handle.db
          .select()
          .from(ratingProfilesTable)
          .where(eq(ratingProfilesTable.seasonId, retriedClose.nextSeasonId!)),
      ).toHaveLength(2);
      expect(await context.service.closeSeason(context.seasonId)).toEqual(retriedClose);
      expect(
        await context.handle.db
          .select()
          .from(ratingSeasonSnapshotsTable)
          .where(eq(ratingSeasonSnapshotsTable.seasonId, context.seasonId)),
      ).toHaveLength(2);
    } finally {
      // The test is isolated, but remove the fault if an assertion failed before the first drop.
      await context.handle.db
        .execute(
          sql.raw(
            `ALTER TABLE "rating_season_audits" DROP CONSTRAINT IF EXISTS "${injectedConstraint}"`,
          ),
        )
        .catch(() => undefined);
      await context.service.onApplicationShutdown();
      await context.handle.close();
    }
  });

  it('leaves season close deferred while an in-game competitive table captures that season', async () => {
    const context = await createContext();
    try {
      const players = await createPlayers(context.handle, context.now, 'live-');
      const [ruleset] = await context.handle.db.select().from(rulesetsTable).limit(1);
      if (!ruleset) throw new Error('Falta ruleset sembrado.');
      const tableId = generateUuidV7(context.now + 99);
      await context.handle.db.insert(tablesTable).values({
        id: tableId,
        ownerId: players[0]!.id,
        mode: '1v1',
        rulesetId: ruleset.id,
        rulesetCode: 'ar-standard-v1',
        targetScore: 30,
        florEnabled: true,
        turnTimeoutMs: 25_000,
        visibility: 'PRIVATE',
        status: 'IN_GAME',
        isCompetitive: true,
        competitiveSeasonId: context.seasonId,
        expiresAt: new Date(context.now + DAY_MS),
      });
      const deferred = await context.service.closeSeason(context.seasonId);
      expect(deferred).toEqual({ closed: false, deferred: true, nextSeasonId: null });
      await context.handle.db
        .update(tablesTable)
        .set({ status: 'FINISHED' })
        .where(eq(tablesTable.id, tableId));
      const closed = await context.service.closeSeason(context.seasonId);
      expect(closed.closed).toBe(true);
    } finally {
      await context.service.onApplicationShutdown();
      await context.handle.close();
    }
  });
});
