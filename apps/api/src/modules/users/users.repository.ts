import { Inject, Injectable } from '@nestjs/common';
import type {
  UserMatchDetailResponse,
  UserMatchHistoryItem,
  UserMatchHistoryQuery,
  UserModeStats,
  UserSettings,
  UserStatsResponse,
} from '@truco/shared';
import { and, desc, eq, inArray, isNull, lt, or } from 'drizzle-orm';
import { type AppDatabase, DRIZZLE_DB } from '../../db/database.provider.js';
import {
  authTokensTable,
  friendshipsTable,
  matchesTable,
  matchEventsTable,
  matchPlayersTable,
  type ProfileRow,
  profilesTable,
  sessionsTable,
  tutorialProgressTable,
  userBlocksTable,
  type UserRow,
  usersTable,
} from '../../db/schema/index.js';

@Injectable()
export class UsersRepository {
  constructor(@Inject(DRIZZLE_DB) private readonly db: AppDatabase) {}

  async findActiveUserWithProfile(
    userId: string,
  ): Promise<{ user: UserRow; profile: ProfileRow } | null> {
    const [user] = await this.db
      .select()
      .from(usersTable)
      .where(and(eq(usersTable.id, userId), isNull(usersTable.deletedAt)))
      .limit(1);
    if (!user) return null;

    const [profile] = await this.db
      .select()
      .from(profilesTable)
      .where(eq(profilesTable.userId, userId))
      .limit(1);
    if (!profile) return null;

    return { user, profile };
  }

  private async canViewWithVisibility(
    viewerId: string,
    targetId: string,
    setting: 'historyVisibility' | 'statsVisibility',
  ): Promise<boolean> {
    if (viewerId === targetId) return true;
    const [profile] = await this.db
      .select({ settings: profilesTable.settings })
      .from(profilesTable)
      .where(eq(profilesTable.userId, targetId))
      .limit(1);
    if (!profile) return false;

    // Bloqueo siempre prevalece sobre una configuración pública explícita.
    const [block] = await this.db
      .select({ blockerId: userBlocksTable.blockerId })
      .from(userBlocksTable)
      .where(
        or(
          and(eq(userBlocksTable.blockerId, viewerId), eq(userBlocksTable.blockedId, targetId)),
          and(eq(userBlocksTable.blockerId, targetId), eq(userBlocksTable.blockedId, viewerId)),
        ),
      )
      .limit(1);
    if (block) return false;

    const visibility = profile.settings?.[setting] ?? 'FRIENDS';
    if (visibility === 'ALL') return true;
    if (visibility === 'NOBODY') return false;

    const [friendship] = await this.db
      .select({ id: friendshipsTable.id })
      .from(friendshipsTable)
      .where(
        and(
          eq(friendshipsTable.status, 'ACCEPTED'),
          or(
            and(eq(friendshipsTable.userLow, viewerId), eq(friendshipsTable.userHigh, targetId)),
            and(eq(friendshipsTable.userLow, targetId), eq(friendshipsTable.userHigh, viewerId)),
          ),
        ),
      )
      .limit(1);
    return Boolean(friendship);
  }

  async canViewHistory(viewerId: string, targetId: string): Promise<boolean> {
    return this.canViewWithVisibility(viewerId, targetId, 'historyVisibility');
  }

  async canViewStats(viewerId: string, targetId: string): Promise<boolean> {
    return this.canViewWithVisibility(viewerId, targetId, 'statsVisibility');
  }

  async findUserByNicknameLower(nicknameLower: string): Promise<UserRow | null> {
    const [row] = await this.db
      .select()
      .from(usersTable)
      .where(eq(usersTable.nicknameLower, nicknameLower))
      .limit(1);
    return row ?? null;
  }

  async updateUserNickname(
    userId: string,
    nickname: string,
    nicknameLower: string,
    now: Date,
  ): Promise<UserRow> {
    const [updated] = await this.db
      .update(usersTable)
      .set({ nickname, nicknameLower, updatedAt: now })
      .where(eq(usersTable.id, userId))
      .returning();
    return updated!;
  }

  async updateProfileFields(
    userId: string,
    patch: {
      readonly avatarId?: string;
      readonly bio?: string;
      readonly settings?: Partial<UserSettings>;
    },
    currentProfile: ProfileRow,
    now: Date,
  ): Promise<ProfileRow> {
    const nextSettings: UserSettings = {
      soundEnabled: patch.settings?.soundEnabled ?? currentProfile.settings?.soundEnabled ?? true,
      animationsReduced:
        patch.settings?.animationsReduced ?? currentProfile.settings?.animationsReduced ?? false,
      confirmCalls: patch.settings?.confirmCalls ?? currentProfile.settings?.confirmCalls ?? false,
      historyVisibility:
        patch.settings?.historyVisibility ??
        currentProfile.settings?.historyVisibility ??
        'FRIENDS',
      statsVisibility:
        patch.settings?.statsVisibility ?? currentProfile.settings?.statsVisibility ?? 'FRIENDS',
      presenceVisibility:
        patch.settings?.presenceVisibility ??
        currentProfile.settings?.presenceVisibility ??
        'FRIENDS',
    };

    const [updated] = await this.db
      .update(profilesTable)
      .set({
        avatarId: patch.avatarId ?? currentProfile.avatarId,
        bio: patch.bio ?? currentProfile.bio,
        settings: nextSettings,
        updatedAt: now,
      })
      .where(eq(profilesTable.userId, userId))
      .returning();
    return updated!;
  }

  async getTutorialProgress(
    userId: string,
  ): Promise<{ completedLessons: string[]; updatedAt: Date | null }> {
    const rows = await this.db
      .select({
        completedLessons: tutorialProgressTable.completedLessons,
        updatedAt: tutorialProgressTable.updatedAt,
      })
      .from(tutorialProgressTable)
      .where(eq(tutorialProgressTable.userId, userId))
      .limit(1);
    const row = rows[0];
    return row
      ? { completedLessons: row.completedLessons, updatedAt: row.updatedAt }
      : { completedLessons: [], updatedAt: null };
  }

  async saveTutorialProgress(userId: string, completedLessons: string[]): Promise<Date> {
    const rows = await this.db
      .insert(tutorialProgressTable)
      .values({ userId, completedLessons, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: tutorialProgressTable.userId,
        set: { completedLessons, updatedAt: new Date() },
      })
      .returning({ updatedAt: tutorialProgressTable.updatedAt });
    return rows[0]!.updatedAt;
  }

  async computeUserStats(userId: string): Promise<UserStatsResponse> {
    const entries = await this.db
      .select({
        matchId: matchesTable.id,
        mode: matchesTable.mode,
        outcome: matchPlayersTable.outcome,
        team: matchPlayersTable.team,
      })
      .from(matchPlayersTable)
      .innerJoin(matchesTable, eq(matchPlayersTable.matchId, matchesTable.id))
      .where(
        and(
          eq(matchPlayersTable.userId, userId),
          eq(matchesTable.isPractice, false),
          eq(matchesTable.hasBots, false),
        ),
      )
      .orderBy(desc(matchesTable.startedAt), desc(matchesTable.id));

    const stats = {
      '1v1': this.emptyModeStats(),
      '2v2': this.emptyModeStats(),
      '3v3': this.emptyModeStats(),
    };
    const modeByMatch = new Map<string, '1v1' | '2v2' | '3v3'>();
    const teamByMatch = new Map<string, number>();
    let wins = 0;
    let losses = 0;
    let abandons = 0;
    const streakOpen = { '1v1': true, '2v2': true, '3v3': true };

    for (const row of entries) {
      if (row.mode !== '1v1' && row.mode !== '2v2' && row.mode !== '3v3') continue;
      const modeStats = stats[row.mode];
      modeStats.matchesPlayed++;
      if (row.outcome === 'WIN') {
        wins++;
        modeStats.wins++;
        if (streakOpen[row.mode]) modeStats.currentStreak++;
      } else {
        streakOpen[row.mode] = false;
        if (row.outcome === 'LOSS') {
          losses++;
          modeStats.losses++;
        } else if (row.outcome === 'ABANDON') {
          abandons++;
          modeStats.abandons++;
        }
      }
      modeByMatch.set(row.matchId, row.mode);
      teamByMatch.set(row.matchId, row.team);
    }

    const matchIds = [...modeByMatch.keys()];
    if (matchIds.length > 0) {
      const events = await this.db
        .select({ matchId: matchEventsTable.matchId, payload: matchEventsTable.payload })
        .from(matchEventsTable)
        .where(
          and(
            inArray(matchEventsTable.matchId, matchIds),
            eq(matchEventsTable.type, 'game.callResolved'),
          ),
        );
      for (const event of events) {
        const mode = modeByMatch.get(event.matchId);
        const team = teamByMatch.get(event.matchId);
        const family = event.payload['family'];
        if (!mode || team === undefined || (family !== 'ENVIDO' && family !== 'TRUCO')) continue;
        const winningTeam = event.payload['winningTeam'];
        const bucket = family === 'ENVIDO' ? stats[mode].envido : stats[mode].truco;
        bucket.resolved++;
        if (typeof winningTeam === 'number' && winningTeam === team) bucket.won++;
      }
    }

    const matchesPlayed = wins + losses + abandons;
    return {
      userId,
      matchesPlayed,
      wins,
      losses,
      abandons,
      winRate: this.rate(wins, matchesPlayed),
      byMode: {
        '1v1': this.finalizeModeStats(stats['1v1']),
        '2v2': this.finalizeModeStats(stats['2v2']),
        '3v3': this.finalizeModeStats(stats['3v3']),
      },
    };
  }

  private emptyModeStats(): {
    matchesPlayed: number;
    wins: number;
    losses: number;
    abandons: number;
    winRate: number;
    currentStreak: number;
    envido: { resolved: number; won: number; winRate: number };
    truco: { resolved: number; won: number; winRate: number };
  } {
    return {
      matchesPlayed: 0,
      wins: 0,
      losses: 0,
      abandons: 0,
      winRate: 0,
      currentStreak: 0,
      envido: { resolved: 0, won: 0, winRate: 0 },
      truco: { resolved: 0, won: 0, winRate: 0 },
    };
  }

  private rate(wins: number, played: number): number {
    return played === 0 ? 0 : Math.round((wins / played) * 10_000) / 10_000;
  }

  private finalizeModeStats<T extends ReturnType<UsersRepository['emptyModeStats']>>(
    stats: T,
  ): UserModeStats {
    return {
      ...stats,
      winRate: this.rate(stats.wins, stats.matchesPlayed),
      envido: {
        ...stats.envido,
        winRate: this.rate(stats.envido.won, stats.envido.resolved),
      },
      truco: {
        ...stats.truco,
        winRate: this.rate(stats.truco.won, stats.truco.resolved),
      },
    };
  }

  async listUserMatches(params: {
    readonly userId: string;
    readonly cursor?: string;
    readonly limit: number;
    readonly filters?: UserMatchHistoryQuery;
  }): Promise<{ items: UserMatchHistoryItem[]; nextCursor: string | null }> {
    const filters = params.filters;
    const conditions = [
      eq(matchPlayersTable.userId, params.userId),
      eq(matchesTable.isPractice, false),
    ];
    if (params.cursor) conditions.push(lt(matchesTable.id, params.cursor));
    if (filters?.mode) conditions.push(eq(matchesTable.mode, filters.mode));
    if (filters?.outcome) conditions.push(eq(matchPlayersTable.outcome, filters.outcome));
    if (filters?.bots === 'BOTS') conditions.push(eq(matchesTable.hasBots, true));
    if (filters?.bots === 'HUMANS') conditions.push(eq(matchesTable.hasBots, false));

    const rows = await this.db
      .select({
        matchId: matchesTable.id,
        mode: matchesTable.mode,
        rulesetCode: matchesTable.rulesetCode,
        hasBots: matchesTable.hasBots,
        startedAt: matchesTable.startedAt,
        endedAt: matchesTable.endedAt,
        seat: matchPlayersTable.seat,
        team: matchPlayersTable.team,
        score: matchPlayersTable.score,
        outcome: matchPlayersTable.outcome,
      })
      .from(matchPlayersTable)
      .innerJoin(matchesTable, eq(matchPlayersTable.matchId, matchesTable.id))
      .where(and(...conditions))
      .orderBy(desc(matchesTable.id))
      .limit(params.limit + 1);

    const hasMore = rows.length > params.limit;
    const slice = hasMore ? rows.slice(0, params.limit) : rows;
    const items: UserMatchHistoryItem[] = slice.map((r) => ({
      matchId: r.matchId,
      mode: r.mode,
      rulesetCode: r.rulesetCode,
      seat: r.seat,
      team: r.team,
      score: r.score,
      outcome: r.outcome,
      hasBots: r.hasBots,
      startedAt: r.startedAt.toISOString(),
      endedAt: r.endedAt ? r.endedAt.toISOString() : null,
    }));

    const last = items[items.length - 1];
    return {
      items,
      nextCursor: hasMore && last ? last.matchId : null,
    };
  }

  async getUserMatchDetail(params: {
    readonly matchId: string;
    readonly targetUserId: string;
    readonly viewerUserId: string;
  }): Promise<UserMatchDetailResponse | null> {
    const [match] = await this.db
      .select()
      .from(matchesTable)
      .innerJoin(matchPlayersTable, eq(matchPlayersTable.matchId, matchesTable.id))
      .where(
        and(
          eq(matchesTable.id, params.matchId),
          eq(matchesTable.isPractice, false),
          eq(matchPlayersTable.userId, params.targetUserId),
        ),
      )
      .limit(1);
    if (!match) return null;

    const [matchRow] = await this.db
      .select()
      .from(matchesTable)
      .where(eq(matchesTable.id, params.matchId))
      .limit(1);
    if (!matchRow) return null;

    const players = await this.db
      .select({
        userId: matchPlayersTable.userId,
        nickname: usersTable.nickname,
        seat: matchPlayersTable.seat,
        team: matchPlayersTable.team,
        score: matchPlayersTable.score,
        outcome: matchPlayersTable.outcome,
      })
      .from(matchPlayersTable)
      .innerJoin(usersTable, eq(usersTable.id, matchPlayersTable.userId))
      .where(eq(matchPlayersTable.matchId, params.matchId))
      .orderBy(matchPlayersTable.seat);
    const result = matchRow.result ?? {};
    const events = await this.db
      .select({
        seq: matchEventsTable.seq,
        type: matchEventsTable.type,
        at: matchEventsTable.createdAt,
      })
      .from(matchEventsTable)
      .where(
        and(
          eq(matchEventsTable.matchId, params.matchId),
          inArray(matchEventsTable.type, [
            'game.callMade',
            'game.callResolved',
            'game.handEnded',
            'game.scoreUpdated',
            'game.ended',
          ]),
        ),
      )
      .orderBy(matchEventsTable.seq);

    return {
      matchId: matchRow.id,
      mode: matchRow.mode,
      rulesetCode: matchRow.rulesetCode,
      hasBots: matchRow.hasBots,
      seedCommitment: matchRow.seedCommitment,
      startedAt: matchRow.startedAt.toISOString(),
      endedAt: matchRow.endedAt?.toISOString() ?? null,
      result: {
        winnerTeam: typeof result['winnerTeam'] === 'number' ? result['winnerTeam'] : null,
        scoresByTeam:
          result['scoresByTeam'] && typeof result['scoresByTeam'] === 'object'
            ? (result['scoresByTeam'] as Record<string, number>)
            : {},
        reason: typeof result['reason'] === 'string' ? result['reason'] : null,
      },
      players: players.map((player) => ({
        ...player,
        isSelf: player.userId === params.viewerUserId,
      })),
      events: events.map((event) => ({
        seq: event.seq,
        type: event.type as UserMatchDetailResponse['events'][number]['type'],
        at: event.at.toISOString(),
      })),
    };
  }

  async anonymizeAndDeleteAccount(userId: string, now: Date): Promise<void> {
    const shortSuffix = userId.replace(/-/g, '').slice(-8);
    const anonNick = `Eliminado_${shortSuffix}`;

    await this.db
      .update(sessionsTable)
      .set({ revokedAt: now, revokedReason: 'ACCOUNT_DELETED' })
      .where(and(eq(sessionsTable.userId, userId), isNull(sessionsTable.revokedAt)));

    await this.db
      .update(authTokensTable)
      .set({ consumedAt: now })
      .where(and(eq(authTokensTable.userId, userId), isNull(authTokensTable.consumedAt)));

    await this.db
      .update(usersTable)
      .set({
        email: null,
        passwordHash: null,
        googleSub: null,
        nickname: anonNick,
        nicknameLower: anonNick.toLowerCase(),
        status: 'DELETED',
        deletedAt: now,
        lockedUntil: null,
        failedLoginCount: 0,
        updatedAt: now,
      })
      .where(eq(usersTable.id, userId));

    await this.db
      .update(profilesTable)
      .set({
        avatarId: 'mate-classic',
        bio: '',
        settings: {
          soundEnabled: true,
          animationsReduced: false,
          confirmCalls: false,
          historyVisibility: 'FRIENDS',
          statsVisibility: 'FRIENDS',
          presenceVisibility: 'FRIENDS',
        },
        updatedAt: now,
      })
      .where(eq(profilesTable.userId, userId));
  }
}
