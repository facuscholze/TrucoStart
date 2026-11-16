import { Inject, Injectable } from '@nestjs/common';
import {
  type AccountExportResponse,
  type CursorPaginationQuery,
  type DeleteAccountResponse,
  type MeResponse,
  normalizeNicknameLower,
  type PatchMeRequest,
  type PublicUserProfile,
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
import { UsersRepository } from './users.repository.js';

@Injectable()
export class UsersService {
  constructor(
    @Inject(AUTH_RUNTIME_CONFIG) private readonly config: AuthRuntimeConfig,
    @Inject(UsersRepository) private readonly usersRepo: UsersRepository,
    @Inject(AuthRepository) private readonly authRepo: AuthRepository,
    @Inject(AuditRepository) private readonly audit: AuditRepository,
    @Inject(PasswordHasher) private readonly passwordHasher: PasswordHasher,
  ) {}

  private assertOwnership(principal: AuthenticatedPrincipal, targetUserId: string): void {
    if (principal.userId !== targetUserId) {
      throw new DomainApiException(
        403,
        'FORBIDDEN',
        'No tenés autorización para acceder o modificar recursos privados de otro usuario.',
      );
    }
  }

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
    targetUserId: string,
    input: PatchMeRequest,
    meta: RequestClientMeta,
  ): Promise<MeResponse> {
    this.assertOwnership(principal, targetUserId);
    const found = await this.usersRepo.findActiveUserWithProfile(targetUserId);
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

  async getPublicUserStats(targetUserId: string): Promise<UserStatsResponse> {
    const found = await this.usersRepo.findActiveUserWithProfile(targetUserId);
    if (!found) {
      throw new DomainApiException(404, 'NOT_FOUND', 'Jugador no encontrado.');
    }
    return this.usersRepo.computeUserStats(found.user.id);
  }

  async getUserMatches(
    targetUserId: string,
    query: CursorPaginationQuery,
  ): Promise<UserMatchesResponse> {
    const found = await this.usersRepo.findActiveUserWithProfile(targetUserId);
    if (!found) {
      throw new DomainApiException(404, 'NOT_FOUND', 'Jugador no encontrado.');
    }
    return this.usersRepo.listUserMatches({
      userId: found.user.id,
      cursor: query.cursor,
      limit: query.limit,
    });
  }

  async exportAccountData(
    principal: AuthenticatedPrincipal,
    targetUserId: string,
    meta: RequestClientMeta,
  ): Promise<AccountExportResponse> {
    this.assertOwnership(principal, targetUserId);
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
    targetUserId: string,
    password: string | undefined,
    meta: RequestClientMeta,
  ): Promise<DeleteAccountResponse> {
    this.assertOwnership(principal, targetUserId);
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
