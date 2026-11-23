import { Inject, Injectable } from '@nestjs/common';
import type { AuthUserSummary, ProfileDetails } from '@truco/shared';
import { and, desc, eq, gt, isNull } from 'drizzle-orm';
import { generateUuidV7 } from '../../common/uuidv7.js';
import { type AppDatabase, DRIZZLE_DB } from '../../db/database.provider.js';
import {
  type AuthTokenPurpose,
  type AuthTokenRow,
  authTokensTable,
  type ProfileRow,
  profilesTable,
  type SessionRevokedReason,
  type SessionRow,
  sessionsTable,
  type UserRow,
  usersTable,
} from '../../db/schema/index.js';

export function mapUserRowToSummary(user: UserRow): AuthUserSummary {
  return {
    id: user.id,
    email: user.email,
    emailVerified: user.emailVerifiedAt !== null,
    nickname: user.nickname,
    isGuest: user.isGuest,
    role: user.role,
    status: user.status,
    createdAt: user.createdAt.toISOString(),
  };
}

export function mapProfileRowToDetails(profile: ProfileRow): ProfileDetails {
  return {
    avatarId: profile.avatarId,
    level: profile.level,
    xp: profile.xp,
    bio: profile.bio,
    settings: {
      soundEnabled: profile.settings?.soundEnabled ?? true,
      animationsReduced: profile.settings?.animationsReduced ?? false,
      confirmCalls: profile.settings?.confirmCalls ?? false,
      historyVisibility: profile.settings?.historyVisibility ?? 'FRIENDS',
      statsVisibility: profile.settings?.statsVisibility ?? 'FRIENDS',
      presenceVisibility: profile.settings?.presenceVisibility ?? 'FRIENDS',
    },
  };
}

@Injectable()
export class AuthRepository {
  constructor(@Inject(DRIZZLE_DB) private readonly db: AppDatabase) {}

  async findUserById(userId: string): Promise<UserRow | null> {
    const [row] = await this.db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
    return row ?? null;
  }

  /** Levanta una suspensión temporal ya vencida (estado autoritativo en API). */
  async reactivateExpiredSuspension(userId: string, now: Date): Promise<UserRow | null> {
    const [row] = await this.db
      .update(usersTable)
      .set({
        status: 'ACTIVE',
        statusReason: null,
        statusExpiresAt: null,
        updatedAt: now,
      })
      .where(and(eq(usersTable.id, userId), eq(usersTable.status, 'SUSPENDED')))
      .returning();
    return row ?? null;
  }

  async findUserByEmail(emailLower: string): Promise<UserRow | null> {
    const [row] = await this.db
      .select()
      .from(usersTable)
      .where(eq(usersTable.email, emailLower))
      .limit(1);
    return row ?? null;
  }

  async findUserByGoogleSub(googleSub: string): Promise<UserRow | null> {
    const [row] = await this.db
      .select()
      .from(usersTable)
      .where(eq(usersTable.googleSub, googleSub))
      .limit(1);
    return row ?? null;
  }

  async findUserByNicknameLower(nicknameLower: string): Promise<UserRow | null> {
    const [row] = await this.db
      .select()
      .from(usersTable)
      .where(eq(usersTable.nicknameLower, nicknameLower))
      .limit(1);
    return row ?? null;
  }

  async createUserWithProfile(params: {
    readonly email: string | null;
    readonly passwordHash: string | null;
    readonly googleSub?: string | null;
    readonly nickname: string;
    readonly nicknameLower: string;
    readonly isGuest: boolean;
    readonly emailVerifiedAt?: Date | null;
    readonly now: Date;
    /** Constancia de aceptación legal (M8d). Opcional: los invitados no aceptan. */
    readonly legalAcceptance?: {
      readonly termsVersion: string;
      readonly privacyVersion: string;
      readonly minAge: number;
    } | null;
  }): Promise<{ user: UserRow; profile: ProfileRow }> {
    const userId = generateUuidV7(params.now.getTime());
    const [user] = await this.db
      .insert(usersTable)
      .values({
        id: userId,
        email: params.email,
        passwordHash: params.passwordHash,
        googleSub: params.googleSub ?? null,
        nickname: params.nickname,
        nicknameLower: params.nicknameLower,
        isGuest: params.isGuest,
        emailVerifiedAt: params.emailVerifiedAt ?? null,
        role: 'PLAYER',
        status: 'ACTIVE',
        createdAt: params.now,
        updatedAt: params.now,
        ...(params.legalAcceptance
          ? {
              termsVersion: params.legalAcceptance.termsVersion,
              privacyVersion: params.legalAcceptance.privacyVersion,
              legalAcceptedAt: params.now,
              legalMinAge: params.legalAcceptance.minAge,
            }
          : {}),
      })
      .returning();

    const [profile] = await this.db
      .insert(profilesTable)
      .values({
        userId,
        avatarId: 'mate-classic',
        level: 1,
        xp: 0,
        bio: '',
        settings: {
          soundEnabled: true,
          animationsReduced: false,
          confirmCalls: false,
          historyVisibility: 'FRIENDS',
          statsVisibility: 'FRIENDS',
          presenceVisibility: 'FRIENDS',
        },
        createdAt: params.now,
        updatedAt: params.now,
      })
      .returning();

    return { user: user!, profile: profile! };
  }

  async promoteGuestInPlace(params: {
    readonly userId: string;
    readonly email: string;
    readonly passwordHash: string;
    readonly nickname: string;
    readonly nicknameLower: string;
    readonly now: Date;
    readonly legalAcceptance?: {
      readonly termsVersion: string;
      readonly privacyVersion: string;
      readonly minAge: number;
    } | null;
  }): Promise<UserRow> {
    const [updated] = await this.db
      .update(usersTable)
      .set({
        email: params.email,
        passwordHash: params.passwordHash,
        nickname: params.nickname,
        nicknameLower: params.nicknameLower,
        isGuest: false,
        updatedAt: params.now,
        ...(params.legalAcceptance
          ? {
              termsVersion: params.legalAcceptance.termsVersion,
              privacyVersion: params.legalAcceptance.privacyVersion,
              legalAcceptedAt: params.now,
              legalMinAge: params.legalAcceptance.minAge,
            }
          : {}),
      })
      .where(eq(usersTable.id, params.userId))
      .returning();
    return updated!;
  }

  async updateLoginFailureState(params: {
    readonly userId: string;
    readonly failedLoginCount: number;
    readonly lockedUntil: Date | null;
    readonly now: Date;
  }): Promise<void> {
    await this.db
      .update(usersTable)
      .set({
        failedLoginCount: params.failedLoginCount,
        lockedUntil: params.lockedUntil,
        lastFailedLoginAt: params.now,
        updatedAt: params.now,
      })
      .where(eq(usersTable.id, params.userId));
  }

  async recordSuccessfulLogin(userId: string, now: Date): Promise<UserRow> {
    const [updated] = await this.db
      .update(usersTable)
      .set({
        failedLoginCount: 0,
        lockedUntil: null,
        updatedAt: now,
      })
      .where(eq(usersTable.id, userId))
      .returning();
    return updated!;
  }

  async linkGoogleIdentity(
    userId: string,
    googleSub: string,
    markVerified: boolean,
    now: Date,
  ): Promise<UserRow> {
    const current = await this.findUserById(userId);
    const [updated] = await this.db
      .update(usersTable)
      .set({
        googleSub,
        emailVerifiedAt: current?.emailVerifiedAt ?? (markVerified ? now : null),
        failedLoginCount: 0,
        lockedUntil: null,
        updatedAt: now,
      })
      .where(eq(usersTable.id, userId))
      .returning();
    return updated!;
  }

  async updatePasswordHash(userId: string, passwordHash: string, now: Date): Promise<void> {
    await this.db
      .update(usersTable)
      .set({
        passwordHash,
        failedLoginCount: 0,
        lockedUntil: null,
        updatedAt: now,
      })
      .where(eq(usersTable.id, userId));
  }

  async markEmailVerified(userId: string, now: Date): Promise<void> {
    await this.db
      .update(usersTable)
      .set({ emailVerifiedAt: now, updatedAt: now })
      .where(eq(usersTable.id, userId));
  }

  async createSession(params: {
    readonly userId: string;
    readonly familyId?: string;
    readonly refreshHash: string;
    readonly deviceName: string;
    readonly userAgent: string | null;
    readonly ipAddress: string | null;
    readonly expiresAt: Date;
    readonly now: Date;
  }): Promise<SessionRow> {
    const sessionId = generateUuidV7(params.now.getTime());
    const familyId = params.familyId ?? generateUuidV7(params.now.getTime());
    const [session] = await this.db
      .insert(sessionsTable)
      .values({
        id: sessionId,
        familyId,
        userId: params.userId,
        refreshHash: params.refreshHash,
        deviceName: params.deviceName,
        userAgent: params.userAgent,
        ipAddress: params.ipAddress,
        lastUsedAt: params.now,
        expiresAt: params.expiresAt,
        createdAt: params.now,
      })
      .returning();
    return session!;
  }

  async findSessionById(sessionId: string): Promise<SessionRow | null> {
    const [row] = await this.db
      .select()
      .from(sessionsTable)
      .where(eq(sessionsTable.id, sessionId))
      .limit(1);
    return row ?? null;
  }

  async findSessionByRefreshHash(refreshHash: string): Promise<SessionRow | null> {
    const [row] = await this.db
      .select()
      .from(sessionsTable)
      .where(eq(sessionsTable.refreshHash, refreshHash))
      .limit(1);
    return row ?? null;
  }

  async rotateSessionRefreshToken(params: {
    readonly previousSession: SessionRow;
    readonly newRefreshHash: string;
    readonly userAgent: string | null;
    readonly ipAddress: string | null;
    readonly expiresAt: Date;
    readonly now: Date;
  }): Promise<SessionRow> {
    const nextSession = await this.createSession({
      userId: params.previousSession.userId,
      familyId: params.previousSession.familyId,
      refreshHash: params.newRefreshHash,
      deviceName: params.previousSession.deviceName,
      userAgent: params.userAgent ?? params.previousSession.userAgent,
      ipAddress: params.ipAddress ?? params.previousSession.ipAddress,
      expiresAt: params.expiresAt,
      now: params.now,
    });

    await this.db
      .update(sessionsTable)
      .set({
        revokedAt: params.now,
        revokedReason: 'ROTATED',
        replacedBySessionId: nextSession.id,
      })
      .where(eq(sessionsTable.id, params.previousSession.id));

    return nextSession;
  }

  async revokeSessionFamily(
    familyId: string,
    reason: SessionRevokedReason,
    now: Date,
  ): Promise<number> {
    const rows = await this.db
      .update(sessionsTable)
      .set({ revokedAt: now, revokedReason: reason })
      .where(and(eq(sessionsTable.familyId, familyId), isNull(sessionsTable.revokedAt)))
      .returning({ id: sessionsTable.id });
    return rows.length;
  }

  async revokeSingleSession(
    sessionId: string,
    reason: SessionRevokedReason,
    now: Date,
  ): Promise<void> {
    await this.db
      .update(sessionsTable)
      .set({ revokedAt: now, revokedReason: reason })
      .where(and(eq(sessionsTable.id, sessionId), isNull(sessionsTable.revokedAt)));
  }

  async revokeAllUserSessions(
    userId: string,
    reason: SessionRevokedReason,
    now: Date,
  ): Promise<number> {
    const rows = await this.db
      .update(sessionsTable)
      .set({ revokedAt: now, revokedReason: reason })
      .where(and(eq(sessionsTable.userId, userId), isNull(sessionsTable.revokedAt)))
      .returning({ id: sessionsTable.id });
    return rows.length;
  }

  async listActiveUserSessions(userId: string, now: Date): Promise<SessionRow[]> {
    return this.db
      .select()
      .from(sessionsTable)
      .where(
        and(
          eq(sessionsTable.userId, userId),
          isNull(sessionsTable.revokedAt),
          gt(sessionsTable.expiresAt, now),
        ),
      )
      .orderBy(desc(sessionsTable.lastUsedAt));
  }

  async createAuthToken(params: {
    readonly userId: string;
    readonly purpose: AuthTokenPurpose;
    readonly tokenHash: string;
    readonly expiresAt: Date;
    readonly now: Date;
  }): Promise<AuthTokenRow> {
    await this.db
      .update(authTokensTable)
      .set({ consumedAt: params.now })
      .where(
        and(
          eq(authTokensTable.userId, params.userId),
          eq(authTokensTable.purpose, params.purpose),
          isNull(authTokensTable.consumedAt),
        ),
      );

    const [row] = await this.db
      .insert(authTokensTable)
      .values({
        id: generateUuidV7(params.now.getTime()),
        userId: params.userId,
        purpose: params.purpose,
        tokenHash: params.tokenHash,
        expiresAt: params.expiresAt,
        createdAt: params.now,
      })
      .returning();
    return row!;
  }

  async consumeValidAuthToken(
    tokenHash: string,
    purpose: AuthTokenPurpose,
    now: Date,
  ): Promise<AuthTokenRow | null> {
    const [consumed] = await this.db
      .update(authTokensTable)
      .set({ consumedAt: now })
      .where(
        and(
          eq(authTokensTable.tokenHash, tokenHash),
          eq(authTokensTable.purpose, purpose),
          isNull(authTokensTable.consumedAt),
          gt(authTokensTable.expiresAt, now),
        ),
      )
      .returning();
    return consumed ?? null;
  }
}
