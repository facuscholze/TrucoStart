import { Inject, Injectable } from '@nestjs/common';
import {
  type AccountExportResponse,
  type DeleteAccountResponse,
  type MeResponse,
  normalizeNicknameLower,
  type PatchMeRequest,
  type PublicUserProfile,
  TUTORIAL_LESSON_IDS,
  type TutorialProgressResponse,
  type TutorialProgressUpdateRequest,
  type UserMatchDetailResponse,
  type UserMatchHistoryQuery,
  type UserMatchesResponse,
  type UserStatsResponse,
  validateNickname,
} from '@truco/shared';
import { DomainApiException } from '../../common/api-exception.js';
import { AuditRepository } from '../audit/audit.repository.js';
import {
  AUTH_RUNTIME_CONFIG,
  type AuthRuntimeConfig,
  type RequestClientMeta,
} from '../auth/auth.config.js';
import {
  AuthRepository,
  mapProfileRowToDetails,
  mapUserRowToSummary,
} from '../auth/auth.repository.js';
import type { AuthenticatedPrincipal } from '../auth/guards/session-auth.guard.js';
import { PasswordHasher } from '../auth/security/password-hasher.js';
import { ProgressionService } from '../progression/progression.service.js';
import { SocialService } from '../social/social.service.js';
import { UsersRepository } from './users.repository.js';

@Injectable()
export class UsersService {
  constructor(
    @Inject(AUTH_RUNTIME_CONFIG) private readonly config: AuthRuntimeConfig,
    @Inject(UsersRepository) private readonly usersRepo: UsersRepository,
    @Inject(AuthRepository) private readonly authRepo: AuthRepository,
    @Inject(AuditRepository) private readonly audit: AuditRepository,
    @Inject(PasswordHasher) private readonly passwordHasher: PasswordHasher,
    @Inject(SocialService) private readonly socialService: SocialService,
    @Inject(ProgressionService) private readonly progressionService: ProgressionService,
  ) {}

  async getMe(principal: AuthenticatedPrincipal): Promise<MeResponse> {
    const found = await this.usersRepo.findActiveUserWithProfile(principal.userId);
    if (!found) {
      throw new DomainApiException(404, 'NOT_FOUND', 'Usuario no encontrado.');
    }
    return {
      user: mapUserRowToSummary(found.user),
      profile: mapProfileRowToDetails(found.profile),
    };
  }

  async updateOwnProfile(
    principal: AuthenticatedPrincipal,
    input: PatchMeRequest,
    meta: RequestClientMeta,
  ): Promise<MeResponse> {
    const found = await this.usersRepo.findActiveUserWithProfile(principal.userId);
    if (!found) {
      throw new DomainApiException(404, 'NOT_FOUND', 'Usuario no encontrado.');
    }

    const now = new Date(this.config.nowFn());
    let updatedUser = found.user;

    if (input.nickname !== undefined) {
      const nextNick = input.nickname.trim();
      const check = validateNickname(nextNick, {
        extraBlockedTerms: this.config.nicknameBlockedTerms,
      });
      if (!check.valid) {
        throw new DomainApiException(
          400,
          'VALIDATION_ERROR',
          check.reason ?? 'Apodo no permitido',
          { field: 'nickname' },
        );
      }
      const nextLower = normalizeNicknameLower(nextNick);
      const existingOwner = await this.usersRepo.findUserByNicknameLower(nextLower);
      if (existingOwner && existingOwner.id !== found.user.id) {
        throw new DomainApiException(
          409,
          'CONFLICT',
          'Ese apodo ya está en uso (sin distinción de mayúsculas).',
          { field: 'nickname' },
        );
      }
      updatedUser = await this.usersRepo.updateUserNickname(
        found.user.id,
        nextNick,
        nextLower,
        now,
      );
    }

    const updatedProfile = await this.usersRepo.updateProfileFields(
      found.user.id,
      {
        avatarId: input.avatarId,
        bio: input.bio,
        settings: input.settings,
      },
      found.profile,
      now,
    );

    await this.socialService.onPresenceVisibilityChanged(
      found.user.id,
      found.profile.settings?.presenceVisibility ?? 'FRIENDS',
      updatedProfile.settings?.presenceVisibility ?? 'FRIENDS',
    );

    await this.audit.record({
      actorId: principal.userId,
      action: 'USER_PROFILE_UPDATED',
      entity: 'user',
      entityId: found.user.id,
      beforeState: {
        nickname: found.user.nickname,
        avatarId: found.profile.avatarId,
        bio: found.profile.bio,
      },
      afterState: {
        nickname: updatedUser.nickname,
        avatarId: updatedProfile.avatarId,
        bio: updatedProfile.bio,
      },
      ip: meta.ip,
      now,
    });

    return {
      user: mapUserRowToSummary(updatedUser),
      profile: mapProfileRowToDetails(updatedProfile),
    };
  }

  async getPublicUserProfile(targetUserId: string): Promise<PublicUserProfile> {
    const found = await this.usersRepo.findActiveUserWithProfile(targetUserId);
    if (!found) {
      throw new DomainApiException(404, 'NOT_FOUND', 'Jugador no encontrado.');
    }
    return {
      id: found.user.id,
      nickname: found.user.nickname,
      isGuest: found.user.isGuest,
      avatarId: found.profile.avatarId,
      level: found.profile.level,
      xp: found.profile.xp,
      bio: found.profile.bio,
      createdAt: found.user.createdAt.toISOString(),
    };
  }

  async getTutorialProgress(principal: AuthenticatedPrincipal): Promise<TutorialProgressResponse> {
    const progress = await this.usersRepo.getTutorialProgress(principal.userId);
    return {
      completedLessons: progress.completedLessons as TutorialProgressResponse['completedLessons'],
      totalLessons: TUTORIAL_LESSON_IDS.length,
      updatedAt: progress.updatedAt ? progress.updatedAt.toISOString() : null,
    };
  }

  async saveTutorialProgress(
    principal: AuthenticatedPrincipal,
    input: TutorialProgressUpdateRequest,
    meta: RequestClientMeta,
  ): Promise<TutorialProgressResponse> {
    const unique = Array.from(new Set(input.completedLessons));
    const updatedAt = await this.usersRepo.saveTutorialProgress(principal.userId, unique);
    await this.progressionService.syncTutorialAchievements(principal.userId, updatedAt);
    await this.audit.record({
      actorId: principal.userId,
      action: 'users.tutorial.progress',
      entity: 'user',
      entityId: principal.userId,
      ip: meta.ip,
      now: new Date(),
      afterState: { completedLessons: unique },
    });
    return {
      completedLessons: unique,
      totalLessons: TUTORIAL_LESSON_IDS.length,
      updatedAt: updatedAt.toISOString(),
    };
  }

  private async assertCanViewHistory(viewerUserId: string, targetUserId: string): Promise<void> {
    const canView = await this.usersRepo.canViewHistory(viewerUserId, targetUserId);
    if (!canView) {
      // 404 avoids confirming that a user's private history exists.
      throw new DomainApiException(
        404,
        'NOT_FOUND',
        'El historial de este jugador no está disponible.',
      );
    }
  }

  async getPublicUserStats(
    principal: AuthenticatedPrincipal,
    targetUserId: string,
  ): Promise<UserStatsResponse> {
    const found = await this.usersRepo.findActiveUserWithProfile(targetUserId);
    if (!found) {
      throw new DomainApiException(404, 'NOT_FOUND', 'Jugador no encontrado.');
    }
    if (!(await this.usersRepo.canViewStats(principal.userId, targetUserId))) {
      // Igual que el historial, 404 no confirma la existencia de estadísticas privadas.
      throw new DomainApiException(
        404,
        'NOT_FOUND',
        'Las estadísticas de este jugador no están disponibles.',
      );
    }
    return this.usersRepo.computeUserStats(found.user.id);
  }

  async getUserMatches(
    principal: AuthenticatedPrincipal,
    targetUserId: string,
    query: UserMatchHistoryQuery,
  ): Promise<UserMatchesResponse> {
    const found = await this.usersRepo.findActiveUserWithProfile(targetUserId);
    if (!found) {
      throw new DomainApiException(404, 'NOT_FOUND', 'Jugador no encontrado.');
    }
    await this.assertCanViewHistory(principal.userId, targetUserId);
    return this.usersRepo.listUserMatches({
      userId: found.user.id,
      cursor: query.cursor,
      limit: query.limit,
      filters: query,
    });
  }

  async getUserMatchDetail(
    principal: AuthenticatedPrincipal,
    targetUserId: string,
    matchId: string,
  ): Promise<UserMatchDetailResponse> {
    const found = await this.usersRepo.findActiveUserWithProfile(targetUserId);
    if (!found) {
      throw new DomainApiException(404, 'NOT_FOUND', 'Jugador no encontrado.');
    }
    await this.assertCanViewHistory(principal.userId, targetUserId);
    const detail = await this.usersRepo.getUserMatchDetail({
      matchId,
      targetUserId,
      viewerUserId: principal.userId,
    });
    if (!detail) {
      throw new DomainApiException(
        404,
        'NOT_FOUND',
        'Partida no encontrada en el historial del jugador.',
      );
    }
    return detail;
  }

  async exportAccountData(
    principal: AuthenticatedPrincipal,
    meta: RequestClientMeta,
  ): Promise<AccountExportResponse> {
    const targetUserId = principal.userId;
    const found = await this.usersRepo.findActiveUserWithProfile(targetUserId);
    if (!found) {
      throw new DomainApiException(404, 'NOT_FOUND', 'Cuenta no encontrada.');
    }

    const now = new Date(this.config.nowFn());
    const activeSessions = await this.authRepo.listActiveUserSessions(targetUserId, now);
    const stats = await this.usersRepo.computeUserStats(targetUserId);
    const matchesPage = await this.usersRepo.listUserMatches({
      userId: targetUserId,
      limit: 50,
    });

    await this.audit.record({
      actorId: principal.userId,
      action: 'USER_DATA_EXPORTED',
      entity: 'user',
      entityId: targetUserId,
      ip: meta.ip,
      now,
    });

    return {
      exportedAt: now.toISOString(),
      user: mapUserRowToSummary(found.user),
      profile: mapProfileRowToDetails(found.profile),
      activeSessionsCount: activeSessions.length,
      stats,
      recentMatches: matchesPage.items,
    };
  }

  async deleteAccount(
    principal: AuthenticatedPrincipal,
    password: string | undefined,
    meta: RequestClientMeta,
  ): Promise<DeleteAccountResponse> {
    const targetUserId = principal.userId;
    const found = await this.usersRepo.findActiveUserWithProfile(targetUserId);
    if (!found) {
      throw new DomainApiException(404, 'NOT_FOUND', 'Cuenta no encontrada.');
    }

    if (found.user.passwordHash !== null) {
      if (!password) {
        throw new DomainApiException(
          400,
          'VALIDATION_ERROR',
          'Debés ingresar tu contraseña actual para confirmar la eliminación de la cuenta.',
        );
      }
      const valid = await this.passwordHasher.verifyPasswordTimingSafe(
        password,
        found.user.passwordHash,
      );
      if (!valid) {
        throw new DomainApiException(401, 'UNAUTHORIZED', 'La contraseña ingresada no coincide.');
      }
    }

    const now = new Date(this.config.nowFn());
    await this.audit.record({
      actorId: principal.userId,
      action: 'USER_ACCOUNT_DELETED',
      entity: 'user',
      entityId: targetUserId,
      beforeState: { isGuest: found.user.isGuest },
      afterState: { status: 'DELETED', piiAnonymized: true },
      ip: meta.ip,
      now,
    });

    await this.usersRepo.anonymizeAndDeleteAccount(targetUserId, now);
    return { deleted: true, userId: targetUserId };
  }
}
