import { createHash } from 'node:crypto';
import {
  Inject,
  Injectable,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { and, asc, desc, eq, gte, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import {
  COMPETITIVE_MODES,
  CompetitiveReviewListResponseSchema,
  isCompetitiveMode,
  LeaderboardResponseSchema,
  PlayerRatingResponseSchema,
  type GameMode,
  type LeaderboardQuery,
  type LeaderboardResponse,
  type PlayerRatingResponse,
} from '@truco/shared';
import { DomainApiException } from '../../common/api-exception.js';
import { generateUuidV7 } from '../../common/uuidv7.js';
import { type AppDatabase, type AppTransaction, DRIZZLE_DB } from '../../db/database.provider.js';
import {
  auditLogsTable,
  competitiveReviewCasesTable,
  matchesTable,
  matchPlayersTable,
  profilesTable,
  ratingJobsTable,
  ratingPeriodStatsTable,
  ratingProfilesTable,
  ratingRedisOutboxTable,
  ratingRivalriesTable,
  ratingSeasonsTable,
  ratingSeasonAuditsTable,
  ratingSeasonSnapshotsTable,
  tablesTable,
  usersTable,
} from '../../db/schema/index.js';
import {
  GLICKO2_DEFAULTS,
  initialGlickoRating,
  ratingDivision,
  softResetGlickoRating,
  updateGlicko2,
  type GlickoRating,
} from './glicko-2.js';
import {
  LEADERBOARD_STORE,
  type LeaderboardChange,
  type LeaderboardScore,
  type LeaderboardStore,
} from './leaderboard-store.interface.js';
import { RATING_RUNTIME_CONFIG, type RatingRuntimeConfig } from './ratings.config.js';
import { UsersRepository } from '../users/users.repository.js';

const GAME_MODES = COMPETITIVE_MODES;
type ReviewSignal =
  'REPEATED_OPPONENTS' | 'SHORT_MATCH' | 'COORDINATED_ABANDONS' | 'NEW_ACCOUNT_FEEDING';

interface RatedPlayer {
  readonly seat: number;
  readonly userId: string;
  readonly team: number;
  readonly outcome: 'WIN' | 'LOSS' | 'ABANDON';
  readonly accountCreatedAt: Date;
}

interface RatingProjectionPlayer {
  readonly userId: string;
  readonly rating: number;
  readonly globalEligible: boolean;
  readonly weekScore: number;
  readonly weekEligible: boolean;
  readonly monthScore: number;
  readonly monthEligible: boolean;
}

interface RatingProjectionPayload {
  readonly mode: GameMode;
  readonly weekStart: string;
  readonly monthStart: string;
  readonly players: readonly RatingProjectionPlayer[];
}

interface ProjectionPlayerScore {
  readonly userId: string;
  readonly rating: number;
  readonly ratingDelta: number;
  readonly matchesPlayed: number;
  readonly opponentsCount: number;
  readonly wins: number;
}

interface ReviewCaseListQuery {
  readonly cursor: number;
  readonly limit: number;
  readonly status: 'OPEN' | 'IN_REVIEW' | 'RESOLVED' | null;
}

function startOfWeek(date: Date): Date {
  const utcDay = date.getUTCDay() || 7;
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - utcDay + 1),
  );
}

function startOfMonth(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

function sortedPair(left: string, right: string): readonly [string, string] {
  return left < right ? [left, right] : [right, left];
}

function rankingKey(input: {
  readonly seasonId: string;
  readonly mode: GameMode;
  readonly period: 'GLOBAL' | 'WEEKLY' | 'MONTHLY';
  readonly periodStart?: Date;
  readonly minimumMatches: number;
  readonly minimumOpponents: number;
}): string {
  const date = input.periodStart ? `:${input.periodStart.toISOString()}` : '';
  return `leaderboard:${input.seasonId}:${input.period.toLowerCase()}:${input.mode}${date}:m${input.minimumMatches}:o${input.minimumOpponents}`;
}

function normalizeCursor(cursor: string | undefined): number {
  const offset = Number(cursor ?? '0');
  return Number.isSafeInteger(offset) && offset >= 0 ? Math.min(offset, 1_000_000) : 0;
}

@Injectable()
export class RatingsService implements OnApplicationBootstrap, OnApplicationShutdown {
  private maintenanceTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    @Inject(DRIZZLE_DB) private readonly db: AppDatabase,
    @Inject(LEADERBOARD_STORE) private readonly leaderboardStore: LeaderboardStore,
    @Inject(RATING_RUNTIME_CONFIG) private readonly config: RatingRuntimeConfig,
    @Inject(UsersRepository) private readonly usersRepository: UsersRepository,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    this.maintenanceTimer = setInterval(() => {
      void this.runMaintenance().catch(() => undefined);
    }, 30_000);
    this.maintenanceTimer.unref?.();
    void this.runMaintenance().catch(() => undefined);
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.maintenanceTimer) clearInterval(this.maintenanceTimer);
    this.maintenanceTimer = null;
    await this.leaderboardStore.close();
  }

  private async activeSeason() {
    const [season] = await this.db
      .select()
      .from(ratingSeasonsTable)
      .where(eq(ratingSeasonsTable.status, 'ACTIVE'))
      .limit(1);
    if (!season) throw new Error('No hay una temporada de rating activa.');
    return season;
  }

  getCompetitiveMatchmakingOptions(): {
    readonly baseRatingWindow: number;
    readonly waitGrowthPerTenSeconds: number;
    readonly maximumRatingWindow: number;
    readonly candidateScanLimit: number;
  } {
    return {
      baseRatingWindow: this.config.queueBaseRatingWindow,
      waitGrowthPerTenSeconds: this.config.queueWindowGrowthPerTenSeconds,
      maximumRatingWindow: this.config.queueMaximumRatingWindow,
      candidateScanLimit: this.config.queueCandidateScanLimit,
    };
  }

  getCompetitiveReviewPageSize(): number {
    return this.config.reviewPageSize;
  }

  async getCompetitiveMatchmakingProfile(
    userId: string,
    mode: GameMode,
  ): Promise<{
    seasonId: string;
    rating: number;
    deviation: number;
    blockedOpponentIds: string[];
  }> {
    const season = await this.activeSeason();
    const [profile] = await this.db
      .select({ rating: ratingProfilesTable.rating, deviation: ratingProfilesTable.deviation })
      .from(ratingProfilesTable)
      .where(
        and(
          eq(ratingProfilesTable.seasonId, season.id),
          eq(ratingProfilesTable.userId, userId),
          eq(ratingProfilesTable.mode, mode),
        ),
      )
      .limit(1);
    const rivalries = await this.db
      .select({
        playerLow: ratingRivalriesTable.playerLow,
        playerHigh: ratingRivalriesTable.playerHigh,
      })
      .from(ratingRivalriesTable)
      .where(
        and(
          eq(ratingRivalriesTable.seasonId, season.id),
          eq(ratingRivalriesTable.mode, mode),
          gte(ratingRivalriesTable.matchesPlayed, this.config.repeatRivalLimit),
          or(
            eq(ratingRivalriesTable.playerLow, userId),
            eq(ratingRivalriesTable.playerHigh, userId),
          ),
        ),
      );
    const blockedOpponentIds = rivalries.map((rivalry) =>
      rivalry.playerLow === userId ? rivalry.playerHigh : rivalry.playerLow,
    );
    return {
      seasonId: season.id,
      rating: profile?.rating ?? GLICKO2_DEFAULTS.rating,
      deviation: profile?.deviation ?? GLICKO2_DEFAULTS.maximumDeviation,
      blockedOpponentIds,
    };
  }

  /**
   * Idempotent post-match job. Rating updates, rivalry counters, anti-abuse evidence, period
   * aggregates, rating_delta, the idempotency marker and Redis outbox commit atomically.
   */
  async processMatch(matchId: string): Promise<void> {
    const processed = await this.db.transaction(async (tx) => {
      const [match] = await tx
        .select()
        .from(matchesTable)
        .where(eq(matchesTable.id, matchId))
        .for('update')
        .limit(1);
      if (!match || !match.isCompetitive || !match.endedAt) return false;
      // El truco de 6 (3v3) queda fuera del ranking aunque llegue marcado como competitivo
      // (ADR-033): el marcador de "competitivo" lo puede fijar el cliente al crear la mesa.
      if (!isCompetitiveMode(match.mode)) return false;

      const [existingJob] = await tx
        .select({ matchId: ratingJobsTable.matchId })
        .from(ratingJobsTable)
        .where(eq(ratingJobsTable.matchId, matchId))
        .limit(1);
      if (existingJob) return true;

      let seasonId = match.seasonId;
      let season = seasonId
        ? (
            await tx
              .select()
              .from(ratingSeasonsTable)
              .where(eq(ratingSeasonsTable.id, seasonId))
              .for('share')
              .limit(1)
          )[0]
        : undefined;
      if (!season) {
        season = (
          await tx
            .select()
            .from(ratingSeasonsTable)
            .where(eq(ratingSeasonsTable.status, 'ACTIVE'))
            .for('share')
            .limit(1)
        )[0];
        if (!season) return false;
        seasonId = season.id;
        await tx.update(matchesTable).set({ seasonId }).where(eq(matchesTable.id, match.id));
      }
      if (!seasonId) return false;

      const matchTime = match.endedAt ?? new Date(this.config.nowFn());
      const matchResult = match.result ?? {};
      const playerRows = await tx
        .select({
          seat: matchPlayersTable.seat,
          userId: matchPlayersTable.userId,
          team: matchPlayersTable.team,
          outcome: matchPlayersTable.outcome,
          accountCreatedAt: usersTable.createdAt,
        })
        .from(matchPlayersTable)
        .innerJoin(usersTable, eq(usersTable.id, matchPlayersTable.userId))
        .where(eq(matchPlayersTable.matchId, matchId))
        .orderBy(asc(matchPlayersTable.seat));
      const expectedPlayers = match.mode === '1v1' ? 2 : 4;
      const teamZero = playerRows.filter((player) => player.team === 0);
      const teamOne = playerRows.filter((player) => player.team === 1);
      const validComposition =
        playerRows.length === expectedPlayers &&
        new Set(playerRows.map((player) => player.userId)).size === expectedPlayers &&
        teamZero.length === expectedPlayers / 2 &&
        teamOne.length === expectedPlayers / 2;

      // A competitive table can acquire a replacement bot after a disconnect. Mark the job
      // complete but deliberately leave all deltas at zero so it cannot block season closure.
      if (match.hasBots || !validComposition) {
        await tx.insert(ratingJobsTable).values({ matchId, seasonId, processedAt: matchTime });
        return false;
      }

      const players: RatedPlayer[] = playerRows.map((player) => ({
        ...player,
        outcome: player.outcome,
      }));
      const reason =
        typeof matchResult['reason'] === 'string' ? matchResult['reason'] : 'TARGET_SCORE';
      const abandonTeams = new Set(
        players.filter((player) => player.outcome === 'ABANDON').map((player) => player.team),
      );
      if (abandonTeams.size > 1) {
        await tx.insert(ratingJobsTable).values({ matchId, seasonId, processedAt: matchTime });
        return false;
      }
      const abandonTeam = [...abandonTeams][0] ?? null;
      const startedAt = match.startedAt;
      const durationMs = Math.max(0, matchTime.getTime() - startedAt.getTime());
      const isShort = durationMs <= this.config.shortMatchThresholdMs;
      const weekStart = startOfWeek(matchTime);
      const monthStart = startOfMonth(matchTime);
      // Insert/lock participants in a canonical order to avoid cross-match deadlocks when
      // concurrent rating jobs first-create overlapping profiles.
      const userIds = players.map((player) => player.userId).sort();

      await tx
        .insert(ratingProfilesTable)
        .values(userIds.map((userId) => ({ seasonId: seasonId!, userId, mode: match.mode })))
        .onConflictDoNothing();
      const currentProfiles = await tx
        .select()
        .from(ratingProfilesTable)
        .where(
          and(
            eq(ratingProfilesTable.seasonId, seasonId),
            eq(ratingProfilesTable.mode, match.mode),
            inArray(ratingProfilesTable.userId, userIds),
          ),
        )
        .orderBy(asc(ratingProfilesTable.userId))
        .for('update');
      const profileByUserId = new Map(currentProfiles.map((profile) => [profile.userId, profile]));
      const deltas = new Map<string, { readonly next: GlickoRating; readonly delta: number }>();
      const scoreByUserId = new Map<string, 0 | 1>();

      for (const player of players) {
        const current = profileByUserId.get(player.userId);
        const currentRating: GlickoRating = current
          ? { rating: current.rating, deviation: current.deviation, volatility: current.volatility }
          : initialGlickoRating();
        const score: 0 | 1 =
          abandonTeam !== null
            ? player.team === abandonTeam
              ? 0
              : 1
            : player.outcome === 'WIN'
              ? 1
              : 0;
        scoreByUserId.set(player.userId, score);
        const opponents = players
          .filter((opponent) => opponent.team !== player.team)
          .map((opponent) => ({
            rating: profileByUserId.get(opponent.userId)?.rating ?? GLICKO2_DEFAULTS.rating,
            deviation:
              profileByUserId.get(opponent.userId)?.deviation ?? GLICKO2_DEFAULTS.maximumDeviation,
            score,
          }));
        const next = updateGlicko2(currentRating, opponents);
        deltas.set(player.userId, { next, delta: next.rating - currentRating.rating });
      }

      const crossTeamPairs: Array<{ readonly low: string; readonly high: string }> = [];
      for (const left of teamZero) {
        for (const right of teamOne) {
          const [low, high] = sortedPair(left.userId, right.userId);
          crossTeamPairs.push({ low, high });
        }
      }
      const priorRivalryDetails =
        crossTeamPairs.length > 0
          ? await tx
              .select()
              .from(ratingRivalriesTable)
              .where(
                and(
                  eq(ratingRivalriesTable.seasonId, seasonId),
                  eq(ratingRivalriesTable.mode, match.mode),
                  or(
                    ...crossTeamPairs.map((pair) =>
                      and(
                        eq(ratingRivalriesTable.playerLow, pair.low),
                        eq(ratingRivalriesTable.playerHigh, pair.high),
                      ),
                    ),
                  ),
                ),
              )
          : [];
      const rivalryDetailsByKey = new Map(
        priorRivalryDetails.map((rivalry) => [
          `${rivalry.playerLow}:${rivalry.playerHigh}`,
          rivalry,
        ]),
      );
      const newOpponentsByUser = new Map(userIds.map((userId) => [userId, 0]));
      for (const pair of crossTeamPairs) {
        if (!rivalryDetailsByKey.has(`${pair.low}:${pair.high}`)) {
          newOpponentsByUser.set(pair.low, (newOpponentsByUser.get(pair.low) ?? 0) + 1);
          newOpponentsByUser.set(pair.high, (newOpponentsByUser.get(pair.high) ?? 0) + 1);
        }
      }

      for (const pair of crossTeamPairs) {
        await tx
          .insert(ratingRivalriesTable)
          .values({
            seasonId,
            mode: match.mode,
            playerLow: pair.low,
            playerHigh: pair.high,
            matchesPlayed: 1,
            shortMatches: isShort ? 1 : 0,
            abandonMatches: reason === 'ABANDON' ? 1 : 0,
            playerLowWins: scoreByUserId.get(pair.low) === 1 ? 1 : 0,
            playerHighWins: scoreByUserId.get(pair.high) === 1 ? 1 : 0,
            firstPlayedAt: matchTime,
            lastPlayedAt: matchTime,
          })
          .onConflictDoUpdate({
            target: [
              ratingRivalriesTable.seasonId,
              ratingRivalriesTable.mode,
              ratingRivalriesTable.playerLow,
              ratingRivalriesTable.playerHigh,
            ],
            set: {
              matchesPlayed: sql`${ratingRivalriesTable.matchesPlayed} + 1`,
              shortMatches: sql`${ratingRivalriesTable.shortMatches} + ${isShort ? 1 : 0}`,
              abandonMatches: sql`${ratingRivalriesTable.abandonMatches} + ${reason === 'ABANDON' ? 1 : 0}`,
              playerLowWins: sql`${ratingRivalriesTable.playerLowWins} + ${scoreByUserId.get(pair.low) === 1 ? 1 : 0}`,
              playerHighWins: sql`${ratingRivalriesTable.playerHighWins} + ${scoreByUserId.get(pair.high) === 1 ? 1 : 0}`,
              lastPlayedAt: matchTime,
            },
          });
      }

      const priorCountByPair = new Map(
        priorRivalryDetails.map((rivalry) => [
          `${rivalry.playerLow}:${rivalry.playerHigh}`,
          rivalry.matchesPlayed,
        ]),
      );
      const priorAbandonByPair = new Map(
        priorRivalryDetails.map((rivalry) => [
          `${rivalry.playerLow}:${rivalry.playerHigh}`,
          rivalry.abandonMatches,
        ]),
      );

      const periodRows = await tx
        .select()
        .from(ratingPeriodStatsTable)
        .where(
          and(
            eq(ratingPeriodStatsTable.seasonId, seasonId),
            eq(ratingPeriodStatsTable.mode, match.mode),
            or(
              and(
                eq(ratingPeriodStatsTable.periodType, 'WEEK'),
                eq(ratingPeriodStatsTable.periodStart, weekStart),
              ),
              and(
                eq(ratingPeriodStatsTable.periodType, 'MONTH'),
                eq(ratingPeriodStatsTable.periodStart, monthStart),
              ),
            ),
            inArray(ratingPeriodStatsTable.userId, userIds),
          ),
        );
      const periodRowMap = new Map(
        periodRows.map((row) => [`${row.periodType}:${row.userId}`, row]),
      );
      const projectionPlayers: RatingProjectionPlayer[] = [];

      for (const player of players) {
        const priorProfile = profileByUserId.get(player.userId);
        const nextRating = deltas.get(player.userId)!;
        const newOpponentCount = newOpponentsByUser.get(player.userId) ?? 0;
        const nextMatches = (priorProfile?.matchesPlayed ?? 0) + 1;
        const nextOpponents = (priorProfile?.opponentsCount ?? 0) + newOpponentCount;
        const nextWins = (priorProfile?.wins ?? 0) + (player.outcome === 'WIN' ? 1 : 0);
        const nextLosses = (priorProfile?.losses ?? 0) + (player.outcome === 'WIN' ? 0 : 1);
        const nextAbandons = (priorProfile?.abandons ?? 0) + (player.outcome === 'ABANDON' ? 1 : 0);
        const globalEligible =
          nextMatches >= this.config.minimumMatches &&
          nextOpponents >= this.config.minimumOpponents;

        await tx
          .update(ratingProfilesTable)
          .set({
            rating: nextRating.next.rating,
            deviation: nextRating.next.deviation,
            volatility: nextRating.next.volatility,
            matchesPlayed: nextMatches,
            opponentsCount: nextOpponents,
            wins: nextWins,
            losses: nextLosses,
            abandons: nextAbandons,
            updatedAt: matchTime,
          })
          .where(
            and(
              eq(ratingProfilesTable.seasonId, seasonId),
              eq(ratingProfilesTable.userId, player.userId),
              eq(ratingProfilesTable.mode, match.mode),
            ),
          );
        await tx
          .update(matchPlayersTable)
          .set({ ratingDelta: nextRating.delta })
          .where(
            and(eq(matchPlayersTable.matchId, matchId), eq(matchPlayersTable.seat, player.seat)),
          );

        const opponents = players
          .filter((opponent) => opponent.team !== player.team)
          .map((opponent) => opponent.userId);
        const weekRow = periodRowMap.get(`WEEK:${player.userId}`);
        const monthRow = periodRowMap.get(`MONTH:${player.userId}`);
        const weekOpponents = [...new Set([...(weekRow?.opponentIds ?? []), ...opponents])];
        const monthOpponents = [...new Set([...(monthRow?.opponentIds ?? []), ...opponents])];
        const weekMatches = (weekRow?.matchesPlayed ?? 0) + 1;
        const monthMatches = (monthRow?.matchesPlayed ?? 0) + 1;
        const weekScore = (weekRow?.ratingPoints ?? 0) + nextRating.delta;
        const monthScore = (monthRow?.ratingPoints ?? 0) + nextRating.delta;
        const weekEligible =
          weekMatches >= this.config.minimumMatches &&
          weekOpponents.length >= this.config.minimumOpponents;
        const monthEligible =
          monthMatches >= this.config.minimumMatches &&
          monthOpponents.length >= this.config.minimumOpponents;
        const updatePeriod = async (
          periodType: 'WEEK' | 'MONTH',
          periodStart: Date,
          periodOpponents: string[],
        ) => {
          await tx
            .insert(ratingPeriodStatsTable)
            .values({
              seasonId,
              userId: player.userId,
              mode: match.mode,
              periodType,
              periodStart,
              ratingPoints: nextRating.delta,
              matchesPlayed: 1,
              opponentIds: periodOpponents,
              updatedAt: matchTime,
            })
            .onConflictDoUpdate({
              target: [
                ratingPeriodStatsTable.seasonId,
                ratingPeriodStatsTable.userId,
                ratingPeriodStatsTable.mode,
                ratingPeriodStatsTable.periodType,
                ratingPeriodStatsTable.periodStart,
              ],
              set: {
                ratingPoints: sql`${ratingPeriodStatsTable.ratingPoints} + ${nextRating.delta}`,
                matchesPlayed: sql`${ratingPeriodStatsTable.matchesPlayed} + 1`,
                opponentIds: sql`(
                  SELECT COALESCE(jsonb_agg(DISTINCT rival), '[]'::jsonb)
                  FROM jsonb_array_elements_text(
                    ${ratingPeriodStatsTable.opponentIds} || ${JSON.stringify(periodOpponents)}::jsonb
                  ) AS rivals(rival)
                )`,
                updatedAt: matchTime,
              },
            });
        };
        await updatePeriod('WEEK', weekStart, opponents);
        await updatePeriod('MONTH', monthStart, opponents);

        projectionPlayers.push({
          userId: player.userId,
          rating: nextRating.next.rating,
          globalEligible,
          weekScore,
          weekEligible,
          monthScore,
          monthEligible,
        });
      }

      const signals = await this.detectAbuseSignals({
        tx,
        mode: match.mode,
        seasonId,
        players,
        isShort,
        reason,
        priorCountByPair,
        priorAbandonByPair,
        matchTime,
      });
      if (signals.length > 0) {
        await this.enqueueReviewCase({
          tx,
          matchId,
          mode: match.mode,
          seasonId,
          players,
          signals,
          durationMs,
          reason,
          rivalries: priorCountByPair,
          matchTime,
        });
      }

      const projection: RatingProjectionPayload = {
        mode: match.mode,
        weekStart: weekStart.toISOString(),
        monthStart: monthStart.toISOString(),
        players: projectionPlayers,
      };
      await tx.insert(ratingRedisOutboxTable).values({
        matchId,
        seasonId,
        payload: projection as unknown as Record<string, unknown>,
        createdAt: matchTime,
      });
      await tx.insert(ratingJobsTable).values({ matchId, seasonId, processedAt: matchTime });
      return true;
    });

    if (processed) await this.projectOutbox(matchId);
  }

  private async detectAbuseSignals(input: {
    readonly tx: AppTransaction;
    readonly mode: GameMode;
    readonly seasonId: string;
    readonly players: readonly RatedPlayer[];
    readonly isShort: boolean;
    readonly reason: string;
    readonly priorCountByPair: ReadonlyMap<string, number>;
    readonly priorAbandonByPair: ReadonlyMap<string, number>;
    readonly matchTime: Date;
  }): Promise<ReviewSignal[]> {
    const signals = new Set<ReviewSignal>();
    const teamZero = input.players.filter((player) => player.team === 0);
    const teamOne = input.players.filter((player) => player.team === 1);
    let maxRepeatCount = 0;
    let maxAbandonCount = 0;
    for (const left of teamZero) {
      for (const right of teamOne) {
        const [low, high] = sortedPair(left.userId, right.userId);
        const key = `${low}:${high}`;
        const repeatCount = (input.priorCountByPair.get(key) ?? 0) + 1;
        const abandonCount =
          (input.priorAbandonByPair.get(key) ?? 0) + (input.reason === 'ABANDON' ? 1 : 0);
        maxRepeatCount = Math.max(maxRepeatCount, repeatCount);
        maxAbandonCount = Math.max(maxAbandonCount, abandonCount);
      }
    }
    if (maxRepeatCount >= this.config.repeatedPairSignalCount) signals.add('REPEATED_OPPONENTS');
    if (input.isShort && maxRepeatCount >= 2) signals.add('SHORT_MATCH');
    if (maxAbandonCount >= this.config.coordinatedAbandonSignalCount)
      signals.add('COORDINATED_ABANDONS');

    const newPlayers = input.players.filter(
      (player) =>
        input.matchTime.getTime() - player.accountCreatedAt.getTime() <=
        this.config.newAccountAgeMs,
    );
    const newcomerPlayer = alias(matchPlayersTable, 'newcomer_player');
    const winnerPlayer = alias(matchPlayersTable, 'winner_player');
    const seenFeedPairs = new Set<string>();
    for (const newcomer of newPlayers) {
      if (newcomer.outcome === 'WIN') continue;
      const winnerIds = input.players
        .filter((player) => player.team !== newcomer.team && player.outcome === 'WIN')
        .map((player) => player.userId);
      for (const winnerId of winnerIds) {
        const pairKey = `${newcomer.userId}:${winnerId}`;
        if (seenFeedPairs.has(pairKey)) continue;
        seenFeedPairs.add(pairKey);
        const repeatedLosses = await input.tx
          .selectDistinct({ matchId: newcomerPlayer.matchId })
          .from(newcomerPlayer)
          .innerJoin(
            winnerPlayer,
            and(
              eq(winnerPlayer.matchId, newcomerPlayer.matchId),
              eq(winnerPlayer.userId, winnerId),
              eq(winnerPlayer.outcome, 'WIN'),
            ),
          )
          .innerJoin(matchesTable, eq(matchesTable.id, newcomerPlayer.matchId))
          .where(
            and(
              eq(newcomerPlayer.userId, newcomer.userId),
              inArray(newcomerPlayer.outcome, ['LOSS', 'ABANDON']),
              eq(matchesTable.isCompetitive, true),
              eq(matchesTable.hasBots, false),
              gte(matchesTable.endedAt, new Date(input.matchTime.getTime() - 72 * 60 * 60 * 1000)),
              lte(matchesTable.endedAt, input.matchTime),
            ),
          )
          .limit(this.config.newAccountFeedLossCount);
        if (repeatedLosses.length >= this.config.newAccountFeedLossCount) {
          signals.add('NEW_ACCOUNT_FEEDING');
        }
      }
    }
    return [...signals];
  }

  private async enqueueReviewCase(input: {
    readonly tx: AppTransaction;
    readonly matchId: string;
    readonly mode: GameMode;
    readonly seasonId: string;
    readonly players: readonly RatedPlayer[];
    readonly signals: readonly ReviewSignal[];
    readonly durationMs: number;
    readonly reason: string;
    readonly rivalries: ReadonlyMap<string, number>;
    readonly matchTime: Date;
  }): Promise<void> {
    const userIds = [...new Set(input.players.map((player) => player.userId))].sort();
    const signalList = [...input.signals].sort();
    const fingerprint = createHash('sha256')
      .update(`${input.seasonId}:${input.mode}:${userIds.join(',')}:${signalList.join(',')}`)
      .digest('hex');
    const repeatEvidence = Object.fromEntries(input.rivalries);
    const observation = {
      matchId: input.matchId,
      occurredAt: input.matchTime.toISOString(),
      mode: input.mode,
      durationMs: input.durationMs,
      reason: input.reason,
      repeatCountsBeforeMatch: repeatEvidence,
    };
    const evidence = {
      seasonId: input.seasonId,
      mode: input.mode,
      observations: [observation],
      message:
        'Señales automáticas para revisión humana; no generan sanciones ni afectan partidas futuras.',
    };
    const severe =
      input.signals.includes('NEW_ACCOUNT_FEEDING') ||
      input.signals.includes('COORDINATED_ABANDONS');
    const severity = severe
      ? 'HIGH'
      : input.signals.includes('REPEATED_OPPONENTS')
        ? 'MEDIUM'
        : 'LOW';
    const now = input.matchTime;
    const [reviewCase] = await input.tx
      .insert(competitiveReviewCasesTable)
      .values({
        id: generateUuidV7(now.getTime()),
        fingerprint,
        status: 'OPEN',
        severity,
        signals: signalList,
        userIds,
        matchIds: [input.matchId],
        evidence,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: competitiveReviewCasesTable.fingerprint,
        set: {
          status: sql`CASE WHEN ${competitiveReviewCasesTable.status} = 'RESOLVED' THEN 'OPEN' ELSE ${competitiveReviewCasesTable.status} END`,
          claimedBy: sql`CASE WHEN ${competitiveReviewCasesTable.status} = 'RESOLVED' THEN NULL ELSE ${competitiveReviewCasesTable.claimedBy} END`,
          claimedAt: sql`CASE WHEN ${competitiveReviewCasesTable.status} = 'RESOLVED' THEN NULL ELSE ${competitiveReviewCasesTable.claimedAt} END`,
          resolvedBy: sql`CASE WHEN ${competitiveReviewCasesTable.status} = 'RESOLVED' THEN NULL ELSE ${competitiveReviewCasesTable.resolvedBy} END`,
          resolvedAt: sql`CASE WHEN ${competitiveReviewCasesTable.status} = 'RESOLVED' THEN NULL ELSE ${competitiveReviewCasesTable.resolvedAt} END`,
          resolutionNote: sql`CASE WHEN ${competitiveReviewCasesTable.status} = 'RESOLVED' THEN NULL ELSE ${competitiveReviewCasesTable.resolutionNote} END`,
          version: sql`${competitiveReviewCasesTable.version} + 1`,
          updatedAt: now,
          evidence: sql`jsonb_set(
            ${competitiveReviewCasesTable.evidence},
            '{observations}',
            COALESCE(${competitiveReviewCasesTable.evidence}->'observations', '[]'::jsonb) || ${JSON.stringify([observation])}::jsonb
          )`,
          matchIds: sql`(
            SELECT ARRAY(SELECT DISTINCT match_id FROM unnest(
              ${competitiveReviewCasesTable.matchIds} || ARRAY[${input.matchId}::uuid]
            ) AS match_id)
          )`,
        },
      })
      .returning({
        id: competitiveReviewCasesTable.id,
        status: competitiveReviewCasesTable.status,
        version: competitiveReviewCasesTable.version,
      });

    if (reviewCase) {
      await input.tx.insert(auditLogsTable).values({
        id: generateUuidV7(now.getTime()),
        actorId: null,
        action: 'COMPETITIVE_REVIEW_SIGNAL_RECORDED',
        entity: 'competitive_review_case',
        entityId: reviewCase.id,
        reason:
          'Señal automática de integridad competitiva; requiere revisión humana y no aplica sanciones.',
        afterState: {
          status: reviewCase.status,
          version: reviewCase.version,
          matchId: input.matchId,
          signals: signalList,
        },
        createdAt: now,
      });
    }
  }

  private scoreChanges(
    payload: RatingProjectionPayload,
    period: 'GLOBAL' | 'WEEKLY' | 'MONTHLY',
  ): LeaderboardChange[] {
    return payload.players.map((player) => ({
      userId: player.userId,
      score:
        period === 'GLOBAL'
          ? player.rating
          : period === 'WEEKLY'
            ? player.weekScore
            : player.monthScore,
      eligible:
        period === 'GLOBAL'
          ? player.globalEligible
          : period === 'WEEKLY'
            ? player.weekEligible
            : player.monthEligible,
    }));
  }

  private async projectOutbox(matchId: string): Promise<void> {
    const [outbox] = await this.db
      .select()
      .from(ratingRedisOutboxTable)
      .where(
        and(
          eq(ratingRedisOutboxTable.matchId, matchId),
          isNull(ratingRedisOutboxTable.projectedAt),
        ),
      )
      .limit(1);
    if (!outbox) return;
    const payload = outbox.payload as unknown as RatingProjectionPayload;
    const [weekStart, monthStart] = [new Date(payload.weekStart), new Date(payload.monthStart)];
    const base = {
      seasonId: outbox.seasonId,
      mode: payload.mode,
      minimumMatches: this.config.minimumMatches,
      minimumOpponents: this.config.minimumOpponents,
    };
    const weekKey = rankingKey({ ...base, period: 'WEEKLY', periodStart: weekStart });
    const monthKey = rankingKey({ ...base, period: 'MONTHLY', periodStart: monthStart });
    const globalKey = rankingKey({ ...base, period: 'GLOBAL' });
    await Promise.all([
      this.leaderboardStore.projectLeaderboard(
        globalKey,
        this.scoreChanges(payload, 'GLOBAL'),
        100 * 24 * 60 * 60,
      ),
      this.leaderboardStore.projectLeaderboard(
        weekKey,
        this.scoreChanges(payload, 'WEEKLY'),
        10 * 24 * 60 * 60,
      ),
      this.leaderboardStore.projectLeaderboard(
        monthKey,
        this.scoreChanges(payload, 'MONTHLY'),
        40 * 24 * 60 * 60,
      ),
    ]);
    await this.db
      .update(ratingRedisOutboxTable)
      .set({ projectedAt: new Date(this.config.nowFn()) })
      .where(
        and(
          eq(ratingRedisOutboxTable.matchId, matchId),
          isNull(ratingRedisOutboxTable.projectedAt),
        ),
      );
  }

  private async runMaintenance(): Promise<void> {
    // Projection failures must not stall season rotation; the outbox remains durable and retries.
    await this.projectPendingOutbox().catch(() => undefined);
    const [season] = await this.db
      .select({ id: ratingSeasonsTable.id, endsAt: ratingSeasonsTable.endsAt })
      .from(ratingSeasonsTable)
      .where(eq(ratingSeasonsTable.status, 'ACTIVE'))
      .limit(1);
    if (season && season.endsAt.getTime() <= this.config.nowFn()) {
      await this.closeSeason(season.id);
    }
  }

  private async projectPendingOutbox(): Promise<void> {
    const pending = await this.db
      .select({ matchId: ratingRedisOutboxTable.matchId })
      .from(ratingRedisOutboxTable)
      .where(isNull(ratingRedisOutboxTable.projectedAt))
      .orderBy(asc(ratingRedisOutboxTable.createdAt))
      .limit(200);
    for (const row of pending) await this.projectOutbox(row.matchId);
  }

  private async eligibleRankingRows(
    period: 'GLOBAL' | 'WEEKLY' | 'MONTHLY',
    mode: GameMode,
    seasonId: string,
    periodStart?: Date,
  ): Promise<readonly (ProjectionPlayerScore & { readonly nickname: string })[]> {
    const publicStats = sql`(${profilesTable.settings}->>'statsVisibility') = 'ALL'`;
    if (period === 'GLOBAL') {
      return this.db
        .select({
          userId: ratingProfilesTable.userId,
          nickname: usersTable.nickname,
          rating: ratingProfilesTable.rating,
          ratingDelta: sql<number>`0`,
          matchesPlayed: ratingProfilesTable.matchesPlayed,
          opponentsCount: ratingProfilesTable.opponentsCount,
          wins: ratingProfilesTable.wins,
        })
        .from(ratingProfilesTable)
        .innerJoin(usersTable, eq(usersTable.id, ratingProfilesTable.userId))
        .innerJoin(profilesTable, eq(profilesTable.userId, ratingProfilesTable.userId))
        .where(
          and(
            eq(ratingProfilesTable.seasonId, seasonId),
            eq(ratingProfilesTable.mode, mode),
            gte(ratingProfilesTable.matchesPlayed, this.config.minimumMatches),
            gte(ratingProfilesTable.opponentsCount, this.config.minimumOpponents),
            eq(usersTable.status, 'ACTIVE'),
            isNull(usersTable.deletedAt),
            publicStats,
          ),
        )
        .orderBy(desc(ratingProfilesTable.rating), desc(ratingProfilesTable.userId));
    }

    if (!periodStart) throw new Error('Falta el inicio de período del ranking.');
    const periodType = period === 'WEEKLY' ? 'WEEK' : 'MONTH';
    return this.db
      .select({
        userId: ratingPeriodStatsTable.userId,
        nickname: usersTable.nickname,
        rating: ratingProfilesTable.rating,
        ratingDelta: ratingPeriodStatsTable.ratingPoints,
        matchesPlayed: ratingPeriodStatsTable.matchesPlayed,
        opponentsCount: sql<number>`jsonb_array_length(${ratingPeriodStatsTable.opponentIds})`,
        wins: ratingProfilesTable.wins,
      })
      .from(ratingPeriodStatsTable)
      .innerJoin(usersTable, eq(usersTable.id, ratingPeriodStatsTable.userId))
      .innerJoin(profilesTable, eq(profilesTable.userId, ratingPeriodStatsTable.userId))
      .innerJoin(
        ratingProfilesTable,
        and(
          eq(ratingProfilesTable.seasonId, ratingPeriodStatsTable.seasonId),
          eq(ratingProfilesTable.userId, ratingPeriodStatsTable.userId),
          eq(ratingProfilesTable.mode, ratingPeriodStatsTable.mode),
        ),
      )
      .where(
        and(
          eq(ratingPeriodStatsTable.seasonId, seasonId),
          eq(ratingPeriodStatsTable.mode, mode),
          eq(ratingPeriodStatsTable.periodType, periodType),
          eq(ratingPeriodStatsTable.periodStart, periodStart),
          gte(ratingPeriodStatsTable.matchesPlayed, this.config.minimumMatches),
          gte(
            sql<number>`jsonb_array_length(${ratingPeriodStatsTable.opponentIds})`,
            this.config.minimumOpponents,
          ),
          eq(usersTable.status, 'ACTIVE'),
          isNull(usersTable.deletedAt),
          publicStats,
        ),
      )
      .orderBy(desc(ratingPeriodStatsTable.ratingPoints), desc(ratingPeriodStatsTable.userId));
  }

  async getLeaderboard(query: LeaderboardQuery): Promise<LeaderboardResponse> {
    const now = new Date(this.config.nowFn());
    const season = await this.activeSeason();
    const periodStart =
      query.period === 'WEEKLY'
        ? startOfWeek(now)
        : query.period === 'MONTHLY'
          ? startOfMonth(now)
          : undefined;
    const records = await this.eligibleRankingRows(
      query.period,
      query.mode,
      season.id,
      periodStart,
    );
    const scores: LeaderboardScore[] = records.map((record) => ({
      userId: record.userId,
      score: query.period === 'GLOBAL' ? record.rating : record.ratingDelta,
    }));
    const key = rankingKey({
      seasonId: season.id,
      mode: query.mode,
      period: query.period,
      ...(periodStart ? { periodStart } : {}),
      minimumMatches: this.config.minimumMatches,
      minimumOpponents: this.config.minimumOpponents,
    });
    const ttlSeconds =
      query.period === 'GLOBAL'
        ? 100 * 24 * 60 * 60
        : query.period === 'WEEKLY'
          ? 10 * 24 * 60 * 60
          : 40 * 24 * 60 * 60;
    const offset = normalizeCursor(query.cursor);
    let page: readonly LeaderboardScore[];
    try {
      await this.leaderboardStore.replaceLeaderboard(key, scores, ttlSeconds);
      page = await this.leaderboardStore.readPage(key, offset, query.limit + 1);
    } catch {
      // Redis is a rebuildable projection, not the source of truth. Keep rankings available
      // from PostgreSQL during a cache outage; the durable outbox retries projection later.
      page = [...scores]
        .sort((left, right) => right.score - left.score || right.userId.localeCompare(left.userId))
        .slice(offset, offset + query.limit + 1);
    }
    const hasMore = page.length > query.limit;
    const visible = page.slice(0, query.limit);
    const byUserId = new Map(records.map((record) => [record.userId, record]));
    const items = visible.flatMap((item, index) => {
      const record = byUserId.get(item.userId);
      if (!record) return [];
      return [
        {
          position: offset + index + 1,
          userId: record.userId,
          nickname: record.nickname,
          score: item.score,
          rating: record.rating,
          division: ratingDivision(record.rating),
          matchesPlayed: record.matchesPlayed,
          opponentsCount: record.opponentsCount,
          wins: record.wins,
        },
      ];
    });
    return LeaderboardResponseSchema.parse({
      period: query.period,
      mode: query.mode,
      season: {
        id: season.id,
        label: season.label,
        startsAt: season.startsAt.toISOString(),
        endsAt: season.endsAt.toISOString(),
        secondsUntilReset: Math.max(0, Math.ceil((season.endsAt.getTime() - now.getTime()) / 1000)),
      },
      minimumMatches: this.config.minimumMatches,
      minimumOpponents: this.config.minimumOpponents,
      items,
      nextCursor: hasMore ? String(offset + items.length) : null,
      generatedAt: now.toISOString(),
    });
  }

  async getPlayerRatingProfiles(userId: string, viewerId: string): Promise<PlayerRatingResponse> {
    const target = await this.usersRepository.findActiveUserWithProfile(userId);
    if (!target || !(await this.usersRepository.canViewStats(viewerId, userId))) {
      throw new DomainApiException(
        404,
        'NOT_FOUND',
        'Las estadísticas de este jugador no están disponibles.',
      );
    }
    const season = await this.activeSeason();
    const isPublic = target.profile.settings?.statsVisibility === 'ALL';
    const ratings = await Promise.all(
      GAME_MODES.map(async (mode) => {
        const [profile] = await this.db
          .select()
          .from(ratingProfilesTable)
          .where(
            and(
              eq(ratingProfilesTable.seasonId, season.id),
              eq(ratingProfilesTable.userId, userId),
              eq(ratingProfilesTable.mode, mode),
            ),
          )
          .limit(1);
        const current = profile ?? {
          rating: GLICKO2_DEFAULTS.rating,
          deviation: GLICKO2_DEFAULTS.maximumDeviation,
          matchesPlayed: 0,
          opponentsCount: 0,
          wins: 0,
          losses: 0,
          abandons: 0,
        };
        const qualifies =
          current.matchesPlayed >= this.config.minimumMatches &&
          current.opponentsCount >= this.config.minimumOpponents;
        let position: number | null = null;
        if (qualifies && isPublic) {
          await this.getLeaderboard({ period: 'GLOBAL', mode, limit: 1 });
          const key = rankingKey({
            seasonId: season.id,
            mode,
            period: 'GLOBAL',
            minimumMatches: this.config.minimumMatches,
            minimumOpponents: this.config.minimumOpponents,
          });
          try {
            position = await this.leaderboardStore.rankOf(key, userId);
          } catch {
            position = null;
          }
          if (position === null) {
            const eligible = await this.eligibleRankingRows('GLOBAL', mode, season.id);
            const fallbackPosition = eligible.findIndex((item) => item.userId === userId) + 1;
            position = fallbackPosition > 0 ? fallbackPosition : null;
          }
        }
        return {
          seasonId: season.id,
          seasonLabel: season.label,
          seasonEndsAt: season.endsAt.toISOString(),
          mode,
          rating: current.rating,
          deviation: current.deviation,
          division: ratingDivision(current.rating),
          position,
          matchesPlayed: current.matchesPlayed,
          opponentsCount: current.opponentsCount,
          wins: current.wins,
          losses: current.losses,
          abandons: current.abandons,
          qualifies,
        };
      }),
    );
    return PlayerRatingResponseSchema.parse({ ratings });
  }

  /** Closes a season exactly once; freezes positions, applies soft resets and writes audit atomically. */
  async closeSeason(
    seasonId?: string,
  ): Promise<{ closed: boolean; deferred: boolean; nextSeasonId: string | null }> {
    const now = new Date(this.config.nowFn());
    return this.db.transaction(async (tx) => {
      if (seasonId) {
        const [audit] = await tx
          .select({ nextSeasonId: ratingSeasonAuditsTable.nextSeasonId })
          .from(ratingSeasonAuditsTable)
          .where(eq(ratingSeasonAuditsTable.seasonId, seasonId))
          .limit(1);
        if (audit) return { closed: true, deferred: false, nextSeasonId: audit.nextSeasonId };
      }
      const active = seasonId
        ? (
            await tx
              .select()
              .from(ratingSeasonsTable)
              .where(
                and(eq(ratingSeasonsTable.id, seasonId), eq(ratingSeasonsTable.status, 'ACTIVE')),
              )
              .for('update')
              .limit(1)
          )[0]
        : (
            await tx
              .select()
              .from(ratingSeasonsTable)
              .where(eq(ratingSeasonsTable.status, 'ACTIVE'))
              .for('update')
              .limit(1)
          )[0];
      if (!active) {
        if (seasonId) {
          const [completedAudit] = await tx
            .select({ nextSeasonId: ratingSeasonAuditsTable.nextSeasonId })
            .from(ratingSeasonAuditsTable)
            .where(eq(ratingSeasonAuditsTable.seasonId, seasonId))
            .limit(1);
          if (completedAudit) {
            return { closed: true, deferred: false, nextSeasonId: completedAudit.nextSeasonId };
          }
        }
        return { closed: false, deferred: false, nextSeasonId: null };
      }

      const [activeCompetitiveTable] = await tx
        .select({ id: tablesTable.id })
        .from(tablesTable)
        .where(
          and(
            eq(tablesTable.isCompetitive, true),
            eq(tablesTable.competitiveSeasonId, active.id),
            eq(tablesTable.status, 'IN_GAME'),
          ),
        )
        .limit(1);
      if (activeCompetitiveTable) return { closed: false, deferred: true, nextSeasonId: null };

      const [pendingMatch] = await tx
        .select({ id: matchesTable.id })
        .from(matchesTable)
        .leftJoin(ratingJobsTable, eq(ratingJobsTable.matchId, matchesTable.id))
        .where(
          and(
            eq(matchesTable.seasonId, active.id),
            eq(matchesTable.isCompetitive, true),
            isNull(ratingJobsTable.matchId),
          ),
        )
        .limit(1);
      if (pendingMatch) return { closed: false, deferred: true, nextSeasonId: null };

      const profiles = await tx
        .select()
        .from(ratingProfilesTable)
        .where(eq(ratingProfilesTable.seasonId, active.id))
        .orderBy(
          asc(ratingProfilesTable.mode),
          desc(ratingProfilesTable.rating),
          desc(ratingProfilesTable.userId),
        );
      const eligibleProfiles = profiles.filter(
        (profile) =>
          profile.matchesPlayed >= this.config.minimumMatches &&
          profile.opponentsCount >= this.config.minimumOpponents,
      );
      const positionByMode = new Map<GameMode, number>();
      const snapshots = eligibleProfiles.map((profile) => {
        const position = (positionByMode.get(profile.mode) ?? 0) + 1;
        positionByMode.set(profile.mode, position);
        return {
          seasonId: active.id,
          mode: profile.mode,
          userId: profile.userId,
          position,
          rating: profile.rating,
          deviation: profile.deviation,
          matchesPlayed: profile.matchesPlayed,
          opponentsCount: profile.opponentsCount,
          wins: profile.wins,
          division: ratingDivision(profile.rating),
          frozenAt: now,
        };
      });
      if (snapshots.length > 0) await tx.insert(ratingSeasonSnapshotsTable).values(snapshots);

      const [lastSeason] = await tx
        .select({ seasonNumber: sql<number>`COALESCE(MAX(${ratingSeasonsTable.seasonNumber}), 0)` })
        .from(ratingSeasonsTable);
      const nextSeasonId = generateUuidV7(now.getTime());
      const nextSeasonNumber = Number(lastSeason?.seasonNumber ?? active.seasonNumber) + 1;
      const nextEndsAt = new Date(
        now.getTime() + this.config.seasonDurationDays * 24 * 60 * 60 * 1000,
      );
      await tx
        .update(ratingSeasonsTable)
        .set({ status: 'CLOSED', closedAt: now, updatedAt: now })
        .where(and(eq(ratingSeasonsTable.id, active.id), eq(ratingSeasonsTable.status, 'ACTIVE')));
      await tx.insert(ratingSeasonsTable).values({
        id: nextSeasonId,
        seasonNumber: nextSeasonNumber,
        label: `Temporada ${nextSeasonNumber}`,
        status: 'ACTIVE',
        startsAt: now,
        endsAt: nextEndsAt,
        createdAt: now,
        updatedAt: now,
      });
      const resetProfiles = profiles.map((profile) => ({
        seasonId: nextSeasonId,
        userId: profile.userId,
        mode: profile.mode,
        ...softResetGlickoRating({
          rating: profile.rating,
          deviation: profile.deviation,
          volatility: profile.volatility,
        }),
        matchesPlayed: 0,
        opponentsCount: 0,
        wins: 0,
        losses: 0,
        abandons: 0,
        updatedAt: now,
      }));
      if (resetProfiles.length > 0) await tx.insert(ratingProfilesTable).values(resetProfiles);
      await tx.insert(ratingSeasonAuditsTable).values({
        seasonId: active.id,
        nextSeasonId,
        snapshotCount: snapshots.length,
        resetStrategy: '75% rating carry-over; deviation=sqrt(old^2+70^2), capped at 350',
        closedAt: now,
      });
      await tx.insert(auditLogsTable).values({
        id: generateUuidV7(now.getTime()),
        actorId: null,
        action: 'RATING_SEASON_CLOSED',
        entity: 'rating_season',
        entityId: active.id,
        reason: 'Cierre programado idempotente de temporada competitiva.',
        beforeState: { status: 'ACTIVE', seasonNumber: active.seasonNumber },
        afterState: { status: 'CLOSED', nextSeasonId, snapshotCount: snapshots.length },
        createdAt: now,
      });
      return { closed: true, deferred: false, nextSeasonId };
    });
  }

  async listCompetitiveReviewCases(query: ReviewCaseListQuery) {
    const where = query.status
      ? and(eq(competitiveReviewCasesTable.status, query.status))
      : undefined;
    const rows = await this.db
      .select()
      .from(competitiveReviewCasesTable)
      .where(where)
      .orderBy(desc(competitiveReviewCasesTable.createdAt), desc(competitiveReviewCasesTable.id))
      .offset(query.cursor)
      .limit(query.limit + 1);
    const hasMore = rows.length > query.limit;
    const visibleRows = rows.slice(0, query.limit);
    const actorIds = visibleRows.flatMap((row) =>
      [row.claimedBy, row.resolvedBy].filter((id): id is string => id !== null),
    );
    const userIds = [...new Set([...visibleRows.flatMap((row) => row.userIds), ...actorIds])];
    const users =
      userIds.length > 0
        ? await this.db
            .select({
              id: usersTable.id,
              nickname: usersTable.nickname,
              createdAt: usersTable.createdAt,
            })
            .from(usersTable)
            .where(inArray(usersTable.id, userIds))
        : [];
    const userById = new Map(users.map((user) => [user.id, user]));
    const result = {
      items: visibleRows.map((row) => ({
        id: row.id,
        status: row.status,
        severity: row.severity,
        signals: row.signals,
        users: row.userIds.map((id) => ({
          id,
          nickname: userById.get(id)?.nickname ?? 'Cuenta eliminada',
          accountCreatedAt: userById.get(id)?.createdAt.toISOString() ?? null,
        })),
        matchIds: row.matchIds,
        evidence: row.evidence,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
        claimedByNickname: row.claimedBy ? (userById.get(row.claimedBy)?.nickname ?? null) : null,
        resolvedByNickname: row.resolvedBy
          ? (userById.get(row.resolvedBy)?.nickname ?? null)
          : null,
        resolutionNote: row.resolutionNote,
        version: row.version,
      })),
      nextCursor: hasMore ? String(query.cursor + visibleRows.length) : null,
    };
    return CompetitiveReviewListResponseSchema.parse(result);
  }

  async claimCompetitiveReviewCase(input: {
    readonly caseId: string;
    readonly expectedVersion: number;
    readonly actorId: string;
    readonly adminSessionId: string;
    readonly ip: string | null;
  }): Promise<{ status: string; version: number }> {
    const now = new Date(this.config.nowFn());
    return this.db.transaction(async (tx) => {
      const updated = await tx
        .update(competitiveReviewCasesTable)
        .set({
          status: 'IN_REVIEW',
          claimedBy: input.actorId,
          claimedAt: now,
          updatedAt: now,
          version: sql`${competitiveReviewCasesTable.version} + 1`,
        })
        .where(
          and(
            eq(competitiveReviewCasesTable.id, input.caseId),
            eq(competitiveReviewCasesTable.status, 'OPEN'),
            eq(competitiveReviewCasesTable.version, input.expectedVersion),
          ),
        )
        .returning({
          status: competitiveReviewCasesTable.status,
          version: competitiveReviewCasesTable.version,
        });
      if (!updated[0]) {
        throw new DomainApiException(
          409,
          'CONFLICT',
          'El caso cambió o ya fue tomado por otro moderador.',
        );
      }
      await tx.insert(auditLogsTable).values({
        id: generateUuidV7(now.getTime()),
        actorId: input.actorId,
        adminSessionId: input.adminSessionId,
        action: 'COMPETITIVE_REVIEW_CLAIMED',
        entity: 'competitive_review_case',
        entityId: input.caseId,
        reason: 'Revisión humana de señales antiabuso competitivas.',
        ip: input.ip,
        afterState: { status: updated[0].status, version: updated[0].version },
        createdAt: now,
      });
      return updated[0];
    });
  }

  async resolveCompetitiveReviewCase(input: {
    readonly caseId: string;
    readonly expectedVersion: number;
    readonly resolutionNote: string;
    readonly actorId: string;
    readonly adminSessionId: string;
    readonly ip: string | null;
  }): Promise<{ status: string; version: number }> {
    const now = new Date(this.config.nowFn());
    return this.db.transaction(async (tx) => {
      const updated = await tx
        .update(competitiveReviewCasesTable)
        .set({
          status: 'RESOLVED',
          resolvedBy: input.actorId,
          resolvedAt: now,
          resolutionNote: input.resolutionNote,
          updatedAt: now,
          version: sql`${competitiveReviewCasesTable.version} + 1`,
        })
        .where(
          and(
            eq(competitiveReviewCasesTable.id, input.caseId),
            eq(competitiveReviewCasesTable.status, 'IN_REVIEW'),
            eq(competitiveReviewCasesTable.claimedBy, input.actorId),
            eq(competitiveReviewCasesTable.version, input.expectedVersion),
          ),
        )
        .returning({
          status: competitiveReviewCasesTable.status,
          version: competitiveReviewCasesTable.version,
        });
      if (!updated[0]) {
        throw new DomainApiException(
          409,
          'CONFLICT',
          'El caso no está tomado por vos o cambió desde la última consulta.',
        );
      }
      await tx.insert(auditLogsTable).values({
        id: generateUuidV7(now.getTime()),
        actorId: input.actorId,
        adminSessionId: input.adminSessionId,
        action: 'COMPETITIVE_REVIEW_RESOLVED',
        entity: 'competitive_review_case',
        entityId: input.caseId,
        reason: input.resolutionNote,
        ip: input.ip,
        afterState: {
          status: updated[0].status,
          version: updated[0].version,
          sanctionsAutomaticallyApplied: false,
        },
        createdAt: now,
      });
      return updated[0];
    });
  }
}
