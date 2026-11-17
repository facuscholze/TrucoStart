import { Inject, Injectable } from '@nestjs/common';
import type { UserMatchHistoryItem, UserSettings, UserStatsResponse } from '@truco/shared';
import { and, desc, eq, isNull, lt } from 'drizzle-orm';
import { type AppDatabase, DRIZZLE_DB } from '../../db/database.provider.js';
import {
  authTokensTable,
  matchesTable,
  matchPlayersTable,
  type ProfileRow,
  profilesTable,
  sessionsTable,
  tutorialProgressTable,
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
      .select({ outcome: matchPlayersTable.outcome })
      .from(matchPlayersTable)
      .where(eq(matchPlayersTable.userId, userId));

    let wins = 0;
    let losses = 0;
    let abandons = 0;
    for (const row of entries) {
      if (row.outcome === 'WIN') wins++;
      else if (row.outcome === 'LOSS') losses++;
      else if (row.outcome === 'ABANDON') abandons++;
    }

    const matchesPlayed = entries.length;
    const winRate = matchesPlayed === 0 ? 0 : Math.round((wins / matchesPlayed) * 10_000) / 10_000;

    return {
      userId,
      matchesPlayed,
      wins,
      losses,
      abandons,
      winRate,
    };
  }

  async listUserMatches(params: {
    readonly userId: string;
    readonly cursor?: string;
    readonly limit: number;
  }): Promise<{ items: UserMatchHistoryItem[]; nextCursor: string | null }> {
    const rows = await this.db
      .select({
        matchId: matchesTable.id,
        mode: matchesTable.mode,
        rulesetCode: matchesTable.rulesetCode,
        startedAt: matchesTable.startedAt,
        endedAt: matchesTable.endedAt,
        seat: matchPlayersTable.seat,
        team: matchPlayersTable.team,
        score: matchPlayersTable.score,
        outcome: matchPlayersTable.outcome,
      })
      .from(matchPlayersTable)
      .innerJoin(matchesTable, eq(matchPlayersTable.matchId, matchesTable.id))
      .where(
        params.cursor
          ? and(
              eq(matchPlayersTable.userId, params.userId),
              lt(matchPlayersTable.matchId, params.cursor),
            )
          : eq(matchPlayersTable.userId, params.userId),
      )
      .orderBy(desc(matchPlayersTable.matchId))
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
      startedAt: r.startedAt.toISOString(),
      endedAt: r.endedAt ? r.endedAt.toISOString() : null,
    }));

    const last = items[items.length - 1];
    return {
      items,
      nextCursor: hasMore && last ? last.matchId : null,
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
        settings: { soundEnabled: true, animationsReduced: false, confirmCalls: false },
        updatedAt: now,
      })
      .where(eq(profilesTable.userId, userId));
  }
}
