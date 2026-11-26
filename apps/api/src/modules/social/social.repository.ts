import { Inject, Injectable } from '@nestjs/common';
import type {
  FriendListItem,
  FriendRequestListItem,
  FriendRequestMutationResponse,
  PlayerRelationshipStatus,
  PlayerSearchResult,
  SocialInvitationItem,
  SocialNotificationItem,
  SocialNotificationType,
} from '@truco/shared';
import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  ilike,
  inArray,
  isNull,
  lt,
  lte,
  or,
  sql,
} from 'drizzle-orm';
import { DomainApiException } from '../../common/api-exception.js';
import { generateUuidV7 } from '../../common/uuidv7.js';
import { type AppDatabase, DRIZZLE_DB } from '../../db/database.provider.js';
import {
  friendshipsTable,
  profilesTable,
  sanctionsTable,
  socialInvitationsTable,
  socialNotificationsTable,
  tableSeatsTable,
  tablesTable,
  userBlocksTable,
  usersTable,
} from '../../db/schema/index.js';

export interface SocialNotificationDispatch {
  readonly userId: string;
  readonly event: SocialNotificationItem;
}

export interface SocialMutationResult {
  readonly requestId: string;
  readonly status: FriendRequestMutationResponse['status'];
  readonly reciprocalRequestAccepted: boolean;
  readonly notifications: readonly SocialNotificationDispatch[];
}

export interface SocialInvitationMutationResult {
  readonly invitationId: string;
  readonly notifications: readonly SocialNotificationDispatch[];
  readonly expiresAt?: string;
}

const EFFECTIVE_SANCTION_TYPES = ['MUTE', 'SUSPEND', 'BAN'] as const;

@Injectable()
export class SocialRepository {
  constructor(@Inject(DRIZZLE_DB) private readonly db: AppDatabase) {}

  async isUserEligible(userId: string, now: Date): Promise<boolean> {
    return this.isUserEligibleWith(this.db, userId, now);
  }

  private async isUserEligibleWith(
    queryable: Pick<AppDatabase, 'select'>,
    userId: string,
    now: Date,
  ): Promise<boolean> {
    const [user] = await queryable
      .select({ id: usersTable.id, status: usersTable.status, deletedAt: usersTable.deletedAt })
      .from(usersTable)
      .where(eq(usersTable.id, userId))
      .limit(1);
    if (!user || user.status !== 'ACTIVE' || user.deletedAt !== null) return false;
    return !(await this.hasEffectiveSanction(queryable, userId, now));
  }

  private async hasEffectiveSanction(
    queryable: Pick<AppDatabase, 'select'>,
    userId: string,
    now: Date,
  ): Promise<boolean> {
    const [sanction] = await queryable
      .select({ id: sanctionsTable.id })
      .from(sanctionsTable)
      .where(
        and(
          eq(sanctionsTable.userId, userId),
          isNull(sanctionsTable.revokedAt),
          or(isNull(sanctionsTable.expiresAt), gt(sanctionsTable.expiresAt, now)),
          inArray(sanctionsTable.type, [...EFFECTIVE_SANCTION_TYPES]),
        ),
      )
      .limit(1);
    return Boolean(sanction);
  }

  async isBlockedEitherDirection(userA: string, userB: string): Promise<boolean> {
    const [row] = await this.db
      .select({ blockerId: userBlocksTable.blockerId })
      .from(userBlocksTable)
      .where(
        or(
          and(eq(userBlocksTable.blockerId, userA), eq(userBlocksTable.blockedId, userB)),
          and(eq(userBlocksTable.blockerId, userB), eq(userBlocksTable.blockedId, userA)),
        ),
      )
      .limit(1);
    return Boolean(row);
  }

  async listBlockedCounterpartIds(userId: string): Promise<string[]> {
    const rows = await this.db
      .select({ blockerId: userBlocksTable.blockerId, blockedId: userBlocksTable.blockedId })
      .from(userBlocksTable)
      .where(or(eq(userBlocksTable.blockerId, userId), eq(userBlocksTable.blockedId, userId)));
    return rows.map((row) => (row.blockerId === userId ? row.blockedId : row.blockerId));
  }

  async areFriends(userA: string, userB: string): Promise<boolean> {
    const low = userA < userB ? userA : userB;
    const high = userA < userB ? userB : userA;
    const [row] = await this.db
      .select({ id: friendshipsTable.id })
      .from(friendshipsTable)
      .where(
        and(
          eq(friendshipsTable.userLow, low),
          eq(friendshipsTable.userHigh, high),
          eq(friendshipsTable.status, 'ACCEPTED'),
        ),
      )
      .limit(1);
    return Boolean(row) && !(await this.isBlockedEitherDirection(userA, userB));
  }

  async searchUsers(input: {
    readonly viewerUserId: string;
    readonly nickname: string;
    readonly limit: number;
    readonly now: Date;
  }): Promise<PlayerSearchResult[]> {
    const needle = input.nickname.trim().toLocaleLowerCase('es-AR');
    const rows = await this.db
      .select({
        userId: usersTable.id,
        nickname: usersTable.nickname,
        nicknameLower: usersTable.nicknameLower,
        avatarId: profilesTable.avatarId,
        level: profilesTable.level,
      })
      .from(usersTable)
      .innerJoin(profilesTable, eq(profilesTable.userId, usersTable.id))
      .where(
        and(
          eq(usersTable.status, 'ACTIVE'),
          isNull(usersTable.deletedAt),
          sql`${usersTable.id} <> ${input.viewerUserId}`,
          ilike(usersTable.nicknameLower, `${needle}%`),
          sql`not exists (
            select 1 from ${sanctionsTable} s
            where s.user_id = ${usersTable.id}
              and s.revoked_at is null
              and (s.expires_at is null or s.expires_at > ${input.now})
              and s.type in ('MUTE', 'SUSPEND', 'BAN')
          )`,
          sql`not exists (
            select 1 from ${userBlocksTable} b
            where (b.blocker_id = ${input.viewerUserId} and b.blocked_id = ${usersTable.id})
               or (b.blocker_id = ${usersTable.id} and b.blocked_id = ${input.viewerUserId})
          )`,
        ),
      )
      .orderBy(asc(usersTable.nicknameLower), asc(usersTable.id))
      .limit(input.limit);

    if (rows.length === 0) return [];
    const ids = rows.map((row) => row.userId);
    const relationships = await this.db
      .select({
        id: friendshipsTable.id,
        userLow: friendshipsTable.userLow,
        userHigh: friendshipsTable.userHigh,
        requestedBy: friendshipsTable.requestedBy,
        status: friendshipsTable.status,
      })
      .from(friendshipsTable)
      .where(
        and(
          inArray(friendshipsTable.status, ['PENDING', 'ACCEPTED']),
          or(
            and(
              eq(friendshipsTable.userLow, input.viewerUserId),
              inArray(friendshipsTable.userHigh, ids),
            ),
            and(
              eq(friendshipsTable.userHigh, input.viewerUserId),
              inArray(friendshipsTable.userLow, ids),
            ),
          ),
        ),
      );

    const relationshipByUser = new Map<string, PlayerRelationshipStatus>();
    for (const relationship of relationships) {
      const otherId =
        relationship.userLow === input.viewerUserId ? relationship.userHigh : relationship.userLow;
      relationshipByUser.set(
        otherId,
        relationship.status === 'ACCEPTED'
          ? 'FRIENDS'
          : relationship.requestedBy === input.viewerUserId
            ? 'PENDING_OUTGOING'
            : 'PENDING_INCOMING',
      );
    }
    return rows.map((row) => ({
      userId: row.userId,
      nickname: row.nickname,
      avatarId: row.avatarId,
      level: row.level,
      relationship: relationshipByUser.get(row.userId) ?? 'NONE',
    }));
  }

  async isUserInGame(userId: string): Promise<boolean> {
    const [seat] = await this.db
      .select({ tableId: tableSeatsTable.tableId })
      .from(tableSeatsTable)
      .innerJoin(tablesTable, eq(tablesTable.id, tableSeatsTable.tableId))
      .where(
        and(
          eq(tableSeatsTable.userId, userId),
          eq(tableSeatsTable.isActive, true),
          eq(tablesTable.status, 'IN_GAME'),
        ),
      )
      .limit(1);
    return Boolean(seat);
  }

  async getPresenceVisibility(userId: string): Promise<'ALL' | 'FRIENDS' | 'NOBODY'> {
    const [profile] = await this.db
      .select({ settings: profilesTable.settings })
      .from(profilesTable)
      .where(eq(profilesTable.userId, userId))
      .limit(1);
    const value = profile?.settings?.presenceVisibility ?? 'FRIENDS';
    return value === 'ALL' || value === 'NOBODY' ? value : 'FRIENDS';
  }

  async listFriends(userId: string, limit: number): Promise<FriendListItem[]> {
    const pairs = await this.db
      .select()
      .from(friendshipsTable)
      .where(
        and(
          eq(friendshipsTable.status, 'ACCEPTED'),
          or(eq(friendshipsTable.userLow, userId), eq(friendshipsTable.userHigh, userId)),
        ),
      )
      .orderBy(desc(friendshipsTable.updatedAt), asc(friendshipsTable.id))
      .limit(limit);
    if (pairs.length === 0) return [];

    const otherIds = pairs.map((pair) => (pair.userLow === userId ? pair.userHigh : pair.userLow));
    const people = await this.db
      .select({
        userId: usersTable.id,
        nickname: usersTable.nickname,
        avatarId: profilesTable.avatarId,
        level: profilesTable.level,
      })
      .from(usersTable)
      .innerJoin(profilesTable, eq(profilesTable.userId, usersTable.id))
      .where(inArray(usersTable.id, otherIds));
    const byId = new Map(people.map((person) => [person.userId, person]));

    return pairs.flatMap((pair) => {
      const otherId = pair.userLow === userId ? pair.userHigh : pair.userLow;
      const person = byId.get(otherId);
      if (!person) return [];
      return [
        {
          friendshipId: pair.id,
          userId: person.userId,
          nickname: person.nickname,
          avatarId: person.avatarId,
          level: person.level,
          presence: null,
          friendsSince: pair.updatedAt.toISOString(),
        },
      ];
    });
  }

  async listFriendRequests(userId: string): Promise<FriendRequestListItem[]> {
    const requests = await this.db
      .select()
      .from(friendshipsTable)
      .where(
        and(
          eq(friendshipsTable.status, 'PENDING'),
          or(eq(friendshipsTable.userLow, userId), eq(friendshipsTable.userHigh, userId)),
        ),
      )
      .orderBy(desc(friendshipsTable.createdAt), desc(friendshipsTable.id))
      .limit(100);
    if (requests.length === 0) return [];
    const otherIds = requests.map((row) =>
      row.requestedBy === userId
        ? row.userLow === userId
          ? row.userHigh
          : row.userLow
        : row.requestedBy,
    );
    const people = await this.db
      .select({
        userId: usersTable.id,
        nickname: usersTable.nickname,
        avatarId: profilesTable.avatarId,
      })
      .from(usersTable)
      .innerJoin(profilesTable, eq(profilesTable.userId, usersTable.id))
      .where(inArray(usersTable.id, otherIds));
    const byId = new Map(people.map((person) => [person.userId, person]));
    return requests.flatMap((row) => {
      const otherId =
        row.requestedBy === userId
          ? row.userLow === userId
            ? row.userHigh
            : row.userLow
          : row.requestedBy;
      const person = byId.get(otherId);
      if (!person) return [];
      return [
        {
          id: row.id,
          userId: person.userId,
          nickname: person.nickname,
          avatarId: person.avatarId,
          direction: row.requestedBy === userId ? ('OUTGOING' as const) : ('INCOMING' as const),
          createdAt: row.createdAt.toISOString(),
        },
      ];
    });
  }

  async createFriendRequest(input: {
    readonly senderId: string;
    readonly senderNickname: string;
    readonly targetId: string;
    readonly now: Date;
  }): Promise<SocialMutationResult> {
    if (input.senderId === input.targetId) {
      throw new DomainApiException(
        400,
        'VALIDATION_ERROR',
        'No podés enviarte una solicitud a vos mismo.',
      );
    }
    const low = input.senderId < input.targetId ? input.senderId : input.targetId;
    const high = input.senderId < input.targetId ? input.targetId : input.senderId;

    return this.db.transaction(async (tx) => {
      const lockedUsers = await tx
        .select({ id: usersTable.id })
        .from(usersTable)
        .where(inArray(usersTable.id, [low, high]))
        .orderBy(asc(usersTable.id))
        .for('update');
      if (lockedUsers.length !== 2) {
        throw new DomainApiException(404, 'NOT_FOUND', 'No encontramos a ese jugador.');
      }
      if (
        !(await this.isUserEligibleWith(tx, input.senderId, input.now)) ||
        !(await this.isUserEligibleWith(tx, input.targetId, input.now))
      ) {
        throw new DomainApiException(
          403,
          'FORBIDDEN',
          'No se pueden enviar solicitudes a una cuenta sancionada o inactiva.',
        );
      }
      const [block] = await tx
        .select({ blockerId: userBlocksTable.blockerId })
        .from(userBlocksTable)
        .where(
          or(
            and(
              eq(userBlocksTable.blockerId, input.senderId),
              eq(userBlocksTable.blockedId, input.targetId),
            ),
            and(
              eq(userBlocksTable.blockerId, input.targetId),
              eq(userBlocksTable.blockedId, input.senderId),
            ),
          ),
        )
        .limit(1);
      if (block) throw new DomainApiException(404, 'NOT_FOUND', 'No se pudo enviar la solicitud.');

      const [existing] = await tx
        .select()
        .from(friendshipsTable)
        .where(
          and(
            eq(friendshipsTable.userLow, low),
            eq(friendshipsTable.userHigh, high),
            inArray(friendshipsTable.status, ['PENDING', 'ACCEPTED']),
          ),
        )
        .limit(1);
      if (existing?.status === 'ACCEPTED') {
        throw new DomainApiException(409, 'CONFLICT', 'Ya son amigos.');
      }
      if (existing?.status === 'PENDING') {
        if (existing.requestedBy !== input.senderId) {
          const [updated] = await tx
            .update(friendshipsTable)
            .set({ status: 'ACCEPTED', updatedAt: input.now })
            .where(
              and(eq(friendshipsTable.id, existing.id), eq(friendshipsTable.status, 'PENDING')),
            )
            .returning();
          if (!updated) {
            return {
              requestId: existing.id,
              status: 'ACCEPTED',
              reciprocalRequestAccepted: true,
              notifications: [],
            };
          }
          const notification = await this.insertNotificationTx(tx, {
            userId: existing.requestedBy,
            actorUserId: input.senderId,
            actorNickname: input.senderNickname,
            type: 'FRIEND_REQUEST_ACCEPTED',
            referenceId: existing.id,
            now: input.now,
          });
          return {
            requestId: existing.id,
            status: 'ACCEPTED',
            reciprocalRequestAccepted: true,
            notifications: notification ? [notification] : [],
          };
        }
        return {
          requestId: existing.id,
          status: 'PENDING',
          reciprocalRequestAccepted: false,
          notifications: [],
        };
      }

      const requestId = generateUuidV7(input.now.getTime());
      await tx.insert(friendshipsTable).values({
        id: requestId,
        userLow: low,
        userHigh: high,
        requestedBy: input.senderId,
        status: 'PENDING',
        createdAt: input.now,
        updatedAt: input.now,
      });
      const notification = await this.insertNotificationTx(tx, {
        userId: input.targetId,
        actorUserId: input.senderId,
        actorNickname: input.senderNickname,
        type: 'FRIEND_REQUEST',
        referenceId: requestId,
        now: input.now,
      });
      return {
        requestId,
        status: 'PENDING',
        reciprocalRequestAccepted: false,
        notifications: notification ? [notification] : [],
      };
    });
  }

  async actOnFriendRequest(input: {
    readonly requestId: string;
    readonly userId: string;
    readonly nickname: string;
    readonly action: 'ACCEPT' | 'DECLINE' | 'CANCEL';
    readonly now: Date;
  }): Promise<SocialMutationResult> {
    return this.db.transaction(async (tx) => {
      const [request] = await tx
        .select()
        .from(friendshipsTable)
        .where(eq(friendshipsTable.id, input.requestId))
        .for('update');
      if (!request || (request.userLow !== input.userId && request.userHigh !== input.userId)) {
        throw new DomainApiException(404, 'NOT_FOUND', 'Solicitud de amistad no encontrada.');
      }
      const recipientId =
        request.requestedBy === request.userLow ? request.userHigh : request.userLow;
      if (input.action === 'ACCEPT' && input.userId !== recipientId) {
        throw new DomainApiException(
          403,
          'FORBIDDEN',
          'Solo quien recibió la solicitud puede aceptarla.',
        );
      }
      if (input.action === 'DECLINE' && input.userId !== recipientId) {
        throw new DomainApiException(
          403,
          'FORBIDDEN',
          'Solo quien recibió la solicitud puede rechazarla.',
        );
      }
      if (input.action === 'CANCEL' && input.userId !== request.requestedBy) {
        throw new DomainApiException(
          403,
          'FORBIDDEN',
          'Solo quien envió la solicitud puede cancelarla.',
        );
      }
      if (request.status !== 'PENDING') {
        if (input.action === 'ACCEPT' && request.status === 'ACCEPTED') {
          return {
            requestId: request.id,
            status: 'ACCEPTED',
            reciprocalRequestAccepted: false,
            notifications: [],
          };
        }
        throw new DomainApiException(409, 'CONFLICT', 'La solicitud ya fue respondida.');
      }

      let nextStatus: 'ACCEPTED' | 'REJECTED' | 'CANCELLED';
      if (input.action === 'ACCEPT') nextStatus = 'ACCEPTED';
      else if (input.action === 'DECLINE') nextStatus = 'REJECTED';
      else nextStatus = 'CANCELLED';
      const [updated] = await tx
        .update(friendshipsTable)
        .set({ status: nextStatus, updatedAt: input.now })
        .where(and(eq(friendshipsTable.id, request.id), eq(friendshipsTable.status, 'PENDING')))
        .returning();
      if (!updated) {
        if (input.action === 'ACCEPT') {
          return {
            requestId: request.id,
            status: 'ACCEPTED',
            reciprocalRequestAccepted: false,
            notifications: [],
          };
        }
        throw new DomainApiException(409, 'CONFLICT', 'La solicitud ya fue respondida.');
      }

      const notifications: SocialNotificationDispatch[] = [];
      if (input.action === 'ACCEPT' || input.action === 'DECLINE') {
        const type: SocialNotificationType =
          input.action === 'ACCEPT' ? 'FRIEND_REQUEST_ACCEPTED' : 'FRIEND_REQUEST_REJECTED';
        const notification = await this.insertNotificationTx(tx, {
          userId: request.requestedBy,
          actorUserId: input.userId,
          actorNickname: input.nickname,
          type,
          referenceId: request.id,
          now: input.now,
        });
        if (notification) notifications.push(notification);
      }
      return {
        requestId: request.id,
        status: nextStatus,
        reciprocalRequestAccepted: false,
        notifications,
      };
    });
  }

  async removeFriend(userId: string, otherUserId: string, now: Date): Promise<void> {
    const low = userId < otherUserId ? userId : otherUserId;
    const high = userId < otherUserId ? otherUserId : userId;
    await this.db.transaction(async (tx) => {
      // Match the lock order used by invitation creation/acceptance so a concurrent accept
      // cannot slip through after the friendship has been removed.
      const users = await tx
        .select({ id: usersTable.id })
        .from(usersTable)
        .where(inArray(usersTable.id, [low, high]))
        .orderBy(asc(usersTable.id))
        .for('update');
      if (users.length !== 2)
        throw new DomainApiException(404, 'NOT_FOUND', 'Amistad no encontrada.');

      const [updated] = await tx
        .update(friendshipsTable)
        .set({ status: 'REMOVED', updatedAt: now })
        .where(
          and(
            eq(friendshipsTable.userLow, low),
            eq(friendshipsTable.userHigh, high),
            eq(friendshipsTable.status, 'ACCEPTED'),
          ),
        )
        .returning({ id: friendshipsTable.id });
      if (!updated) throw new DomainApiException(404, 'NOT_FOUND', 'Amistad no encontrada.');

      await tx
        .update(socialInvitationsTable)
        .set({ status: 'CANCELLED', updatedAt: now })
        .where(
          and(
            eq(socialInvitationsTable.status, 'PENDING'),
            or(
              and(
                eq(socialInvitationsTable.senderId, userId),
                eq(socialInvitationsTable.recipientId, otherUserId),
              ),
              and(
                eq(socialInvitationsTable.senderId, otherUserId),
                eq(socialInvitationsTable.recipientId, userId),
              ),
            ),
          ),
        );
    });
  }

  async listBlockedUsers(
    userId: string,
  ): Promise<Array<{ userId: string; nickname: string; blockedAt: string }>> {
    const rows = await this.db
      .select({
        userId: userBlocksTable.blockedId,
        blockedAt: userBlocksTable.createdAt,
        nickname: usersTable.nickname,
      })
      .from(userBlocksTable)
      .innerJoin(usersTable, eq(usersTable.id, userBlocksTable.blockedId))
      .where(eq(userBlocksTable.blockerId, userId))
      .orderBy(desc(userBlocksTable.createdAt))
      .limit(100);
    return rows.map((row) => ({
      userId: row.userId,
      nickname: row.nickname,
      blockedAt: row.blockedAt.toISOString(),
    }));
  }

  async blockUser(userId: string, targetId: string, now: Date): Promise<void> {
    if (userId === targetId)
      throw new DomainApiException(400, 'VALIDATION_ERROR', 'No podés bloquearte a vos mismo.');
    await this.db.transaction(async (tx) => {
      const people = await tx
        .select({ id: usersTable.id })
        .from(usersTable)
        .where(inArray(usersTable.id, [userId, targetId]))
        .orderBy(asc(usersTable.id))
        .for('update');
      if (people.length !== 2)
        throw new DomainApiException(404, 'NOT_FOUND', 'Jugador no encontrado.');
      await tx
        .insert(userBlocksTable)
        .values({ blockerId: userId, blockedId: targetId, createdAt: now })
        .onConflictDoNothing();
      const low = userId < targetId ? userId : targetId;
      const high = userId < targetId ? targetId : userId;
      await tx
        .update(friendshipsTable)
        .set({ status: 'REMOVED', updatedAt: now })
        .where(
          and(
            eq(friendshipsTable.userLow, low),
            eq(friendshipsTable.userHigh, high),
            inArray(friendshipsTable.status, ['PENDING', 'ACCEPTED']),
          ),
        );
      await tx
        .update(socialInvitationsTable)
        .set({ status: 'CANCELLED', updatedAt: now })
        .where(
          and(
            inArray(socialInvitationsTable.status, ['PENDING']),
            or(
              and(
                eq(socialInvitationsTable.senderId, userId),
                eq(socialInvitationsTable.recipientId, targetId),
              ),
              and(
                eq(socialInvitationsTable.senderId, targetId),
                eq(socialInvitationsTable.recipientId, userId),
              ),
            ),
          ),
        );
    });
  }

  async unblockUser(userId: string, targetId: string): Promise<void> {
    const [removed] = await this.db
      .delete(userBlocksTable)
      .where(and(eq(userBlocksTable.blockerId, userId), eq(userBlocksTable.blockedId, targetId)))
      .returning({ blockerId: userBlocksTable.blockerId });
    if (!removed) throw new DomainApiException(404, 'NOT_FOUND', 'Bloqueo no encontrado.');
  }

  async createInvitation(input: {
    readonly kind: 'TABLE' | 'CHALLENGE';
    readonly senderId: string;
    readonly senderNickname: string;
    readonly recipientId: string;
    readonly tableId: string | null;
    readonly mode: '1v1' | null;
    readonly rulesetCode: string | null;
    readonly expiresAt: Date;
    readonly now: Date;
  }): Promise<SocialInvitationMutationResult> {
    const low = input.senderId < input.recipientId ? input.senderId : input.recipientId;
    const high = input.senderId < input.recipientId ? input.recipientId : input.senderId;
    return this.db.transaction(async (tx) => {
      const locked = await tx
        .select({ id: usersTable.id })
        .from(usersTable)
        .where(inArray(usersTable.id, [low, high]))
        .orderBy(asc(usersTable.id))
        .for('update');
      if (locked.length !== 2)
        throw new DomainApiException(404, 'NOT_FOUND', 'Jugador no encontrado.');
      if (
        !(await this.isUserEligibleWith(tx, input.senderId, input.now)) ||
        !(await this.isUserEligibleWith(tx, input.recipientId, input.now))
      ) {
        throw new DomainApiException(
          403,
          'FORBIDDEN',
          'No se pueden crear invitaciones para una cuenta sancionada o inactiva.',
        );
      }
      const [blocked] = await tx
        .select({ blockerId: userBlocksTable.blockerId })
        .from(userBlocksTable)
        .where(
          or(
            and(
              eq(userBlocksTable.blockerId, input.senderId),
              eq(userBlocksTable.blockedId, input.recipientId),
            ),
            and(
              eq(userBlocksTable.blockerId, input.recipientId),
              eq(userBlocksTable.blockedId, input.senderId),
            ),
          ),
        )
        .limit(1);
      if (blocked)
        throw new DomainApiException(404, 'NOT_FOUND', 'No se pudo crear la invitación.');
      const [friendship] = await tx
        .select({ id: friendshipsTable.id })
        .from(friendshipsTable)
        .where(
          and(
            eq(friendshipsTable.userLow, low),
            eq(friendshipsTable.userHigh, high),
            eq(friendshipsTable.status, 'ACCEPTED'),
          ),
        )
        .limit(1);
      if (!friendship)
        throw new DomainApiException(403, 'FORBIDDEN', 'Solo podés invitar a tus amigos.');

      const [existing] = await tx
        .select()
        .from(socialInvitationsTable)
        .where(
          and(
            eq(socialInvitationsTable.kind, input.kind),
            eq(socialInvitationsTable.senderId, input.senderId),
            eq(socialInvitationsTable.recipientId, input.recipientId),
            eq(socialInvitationsTable.status, 'PENDING'),
            input.kind === 'TABLE'
              ? eq(socialInvitationsTable.tableId, input.tableId!)
              : isNull(socialInvitationsTable.tableId),
          ),
        )
        .limit(1);
      if (existing) {
        return {
          invitationId: existing.id,
          expiresAt: existing.expiresAt.toISOString(),
          notifications: [],
        };
      }

      const invitationId = generateUuidV7(input.now.getTime());
      await tx.insert(socialInvitationsTable).values({
        id: invitationId,
        kind: input.kind,
        status: 'PENDING',
        senderId: input.senderId,
        recipientId: input.recipientId,
        tableId: input.tableId,
        mode: input.mode,
        rulesetCode: input.rulesetCode,
        expiresAt: input.expiresAt,
        createdAt: input.now,
        updatedAt: input.now,
      });
      const type: SocialNotificationType =
        input.kind === 'TABLE' ? 'TABLE_INVITATION' : 'CHALLENGE';
      const notification = await this.insertNotificationTx(tx, {
        userId: input.recipientId,
        actorUserId: input.senderId,
        actorNickname: input.senderNickname,
        type,
        referenceId: invitationId,
        tableId: input.tableId,
        now: input.now,
      });
      return {
        invitationId,
        expiresAt: input.expiresAt.toISOString(),
        notifications: notification ? [notification] : [],
      };
    });
  }

  async getInvitationForRecipient(invitationId: string, recipientId: string) {
    const [row] = await this.db
      .select()
      .from(socialInvitationsTable)
      .where(
        and(
          eq(socialInvitationsTable.id, invitationId),
          eq(socialInvitationsTable.recipientId, recipientId),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  async listInvitations(
    userId: string,
    direction: 'INCOMING' | 'OUTGOING',
    now: Date,
  ): Promise<SocialInvitationItem[]> {
    const ownerColumn =
      direction === 'INCOMING'
        ? socialInvitationsTable.recipientId
        : socialInvitationsTable.senderId;
    const rows = await this.db
      .select()
      .from(socialInvitationsTable)
      .where(
        and(
          eq(ownerColumn, userId),
          eq(socialInvitationsTable.status, 'PENDING'),
          gt(socialInvitationsTable.expiresAt, now),
        ),
      )
      .orderBy(desc(socialInvitationsTable.createdAt), desc(socialInvitationsTable.id))
      .limit(100);
    if (rows.length === 0) return [];
    const otherIds = rows.map((row) => (direction === 'INCOMING' ? row.senderId : row.recipientId));
    const people = await this.db
      .select({ userId: usersTable.id, nickname: usersTable.nickname })
      .from(usersTable)
      .where(inArray(usersTable.id, otherIds));
    const nicknames = new Map(people.map((person) => [person.userId, person.nickname]));
    return rows.map((row) => ({
      id: row.id,
      kind: row.kind,
      status: row.status,
      otherUserId: row[direction === 'INCOMING' ? 'senderId' : 'recipientId'],
      otherNickname:
        nicknames.get(row[direction === 'INCOMING' ? 'senderId' : 'recipientId']) ?? 'Jugador',
      tableId: row.tableId,
      mode: row.mode as '1v1' | null,
      rulesetCode: row.rulesetCode as SocialInvitationItem['rulesetCode'],
      expiresAt: row.expiresAt.toISOString(),
      createdAt: row.createdAt.toISOString(),
    }));
  }

  async cancelOrDeclineInvitation(input: {
    readonly invitationId: string;
    readonly userId: string;
    readonly action: 'CANCEL' | 'DECLINE';
    readonly nickname: string;
    readonly now: Date;
  }): Promise<{
    status: 'CANCELLED' | 'DECLINED';
    notification: SocialNotificationDispatch | null;
  }> {
    return this.db.transaction(async (tx) => {
      const [invitation] = await tx
        .select()
        .from(socialInvitationsTable)
        .where(eq(socialInvitationsTable.id, input.invitationId))
        .for('update');
      if (!invitation) throw new DomainApiException(404, 'NOT_FOUND', 'Invitación no encontrada.');
      const allowedUser = input.action === 'CANCEL' ? invitation.senderId : invitation.recipientId;
      if (allowedUser !== input.userId)
        throw new DomainApiException(404, 'NOT_FOUND', 'Invitación no encontrada.');
      if (invitation.status !== 'PENDING')
        throw new DomainApiException(409, 'CONFLICT', 'La invitación ya fue respondida.');
      const nextStatus = input.action === 'CANCEL' ? 'CANCELLED' : 'DECLINED';
      await tx
        .update(socialInvitationsTable)
        .set({ status: nextStatus, updatedAt: input.now })
        .where(
          and(
            eq(socialInvitationsTable.id, invitation.id),
            eq(socialInvitationsTable.status, 'PENDING'),
          ),
        );
      let notification: SocialNotificationDispatch | null = null;
      if (input.action === 'DECLINE') {
        const type: SocialNotificationType =
          invitation.kind === 'TABLE' ? 'TABLE_INVITATION_DECLINED' : 'CHALLENGE_DECLINED';
        notification = await this.insertNotificationTx(tx, {
          userId: invitation.senderId,
          actorUserId: input.userId,
          actorNickname: input.nickname,
          type,
          referenceId: invitation.id,
          tableId: invitation.tableId,
          now: input.now,
        });
      }
      return { status: nextStatus, notification };
    });
  }

  async recordInvitationAccepted(input: {
    readonly invitationId: string;
    readonly senderId: string;
    readonly recipientId: string;
    readonly recipientNickname: string;
    readonly kind: 'TABLE' | 'CHALLENGE';
    readonly tableId: string | null;
    readonly now: Date;
  }): Promise<SocialNotificationDispatch | null> {
    return this.db.transaction((tx) =>
      this.insertNotificationTx(tx, {
        userId: input.senderId,
        actorUserId: input.recipientId,
        actorNickname: input.recipientNickname,
        type: input.kind === 'TABLE' ? 'TABLE_INVITATION_ACCEPTED' : 'CHALLENGE_ACCEPTED',
        referenceId: input.invitationId,
        tableId: input.tableId,
        now: input.now,
      }),
    );
  }

  async listNotifications(input: {
    readonly userId: string;
    readonly cursor?: string;
    readonly limit: number;
    readonly unreadOnly?: boolean;
  }): Promise<{ items: SocialNotificationItem[]; nextCursor: string | null; unreadCount: number }> {
    const conditions = [eq(socialNotificationsTable.userId, input.userId)];
    if (input.cursor) conditions.push(lt(socialNotificationsTable.id, input.cursor));
    if (input.unreadOnly) conditions.push(isNull(socialNotificationsTable.readAt));
    const [unreadRow] = await this.db
      .select({ value: count() })
      .from(socialNotificationsTable)
      .where(
        and(
          eq(socialNotificationsTable.userId, input.userId),
          isNull(socialNotificationsTable.readAt),
        ),
      );
    const rows = await this.db
      .select({ notification: socialNotificationsTable, actorNickname: usersTable.nickname })
      .from(socialNotificationsTable)
      .leftJoin(usersTable, eq(usersTable.id, socialNotificationsTable.actorUserId))
      .where(and(...conditions))
      .orderBy(desc(socialNotificationsTable.id))
      .limit(input.limit + 1);
    const hasMore = rows.length > input.limit;
    const page = hasMore ? rows.slice(0, input.limit) : rows;
    const items = page.map(({ notification, actorNickname }) =>
      this.mapNotification(notification, actorNickname),
    );
    return {
      items,
      nextCursor: hasMore ? (items.at(-1)?.id ?? null) : null,
      unreadCount: Number(unreadRow?.value ?? 0),
    };
  }

  async unreadNotificationCount(userId: string): Promise<number> {
    const [row] = await this.db
      .select({ value: count() })
      .from(socialNotificationsTable)
      .where(
        and(eq(socialNotificationsTable.userId, userId), isNull(socialNotificationsTable.readAt)),
      );
    return Number(row?.value ?? 0);
  }

  async getNotification(
    userId: string,
    notificationId: string,
  ): Promise<SocialNotificationItem | null> {
    const [row] = await this.db
      .select({ notification: socialNotificationsTable, actorNickname: usersTable.nickname })
      .from(socialNotificationsTable)
      .leftJoin(usersTable, eq(usersTable.id, socialNotificationsTable.actorUserId))
      .where(
        and(
          eq(socialNotificationsTable.userId, userId),
          eq(socialNotificationsTable.id, notificationId),
        ),
      )
      .limit(1);
    return row ? this.mapNotification(row.notification, row.actorNickname) : null;
  }

  async markNotificationRead(
    userId: string,
    notificationId: string,
    now: Date,
  ): Promise<SocialNotificationItem | null> {
    await this.db
      .update(socialNotificationsTable)
      .set({ readAt: now })
      .where(
        and(
          eq(socialNotificationsTable.userId, userId),
          eq(socialNotificationsTable.id, notificationId),
          isNull(socialNotificationsTable.readAt),
        ),
      );
    return this.getNotification(userId, notificationId);
  }

  async markAllNotificationsRead(userId: string, now: Date): Promise<number> {
    const updated = await this.db
      .update(socialNotificationsTable)
      .set({ readAt: now })
      .where(
        and(eq(socialNotificationsTable.userId, userId), isNull(socialNotificationsTable.readAt)),
      )
      .returning({ id: socialNotificationsTable.id });
    return updated.length;
  }

  async expirePendingInvitations(now: Date): Promise<number> {
    const expired = await this.db
      .update(socialInvitationsTable)
      .set({ status: 'EXPIRED', updatedAt: now })
      .where(
        and(
          eq(socialInvitationsTable.status, 'PENDING'),
          lte(socialInvitationsTable.expiresAt, now),
        ),
      )
      .returning({ id: socialInvitationsTable.id });
    return expired.length;
  }

  private async insertNotificationTx(
    tx: Parameters<Parameters<AppDatabase['transaction']>[0]>[0],
    input: {
      readonly userId: string;
      readonly actorUserId: string | null;
      readonly actorNickname: string;
      readonly type: SocialNotificationType;
      readonly referenceId: string | null;
      readonly tableId?: string | null;
      readonly now: Date;
    },
  ): Promise<SocialNotificationDispatch | null> {
    const id = generateUuidV7(input.now.getTime());
    const [inserted] = await tx
      .insert(socialNotificationsTable)
      .values({
        id,
        userId: input.userId,
        actorUserId: input.actorUserId,
        type: input.type,
        referenceId: input.referenceId,
        tableId: input.tableId ?? null,
        payload: {},
        createdAt: input.now,
        readAt: null,
      })
      .onConflictDoNothing()
      .returning({ id: socialNotificationsTable.id });
    if (!inserted) return null;
    return {
      userId: input.userId,
      event: {
        id,
        type: input.type,
        actorUserId: input.actorUserId,
        actorNickname: input.actorNickname || null,
        referenceId: input.referenceId,
        tableId: input.tableId ?? null,
        createdAt: input.now.toISOString(),
        readAt: null,
      },
    };
  }

  private mapNotification(
    notification: typeof socialNotificationsTable.$inferSelect,
    actorNickname: string | null,
  ): SocialNotificationItem {
    return {
      id: notification.id,
      type: notification.type,
      actorUserId: notification.actorUserId,
      actorNickname,
      referenceId: notification.referenceId,
      tableId: notification.tableId,
      createdAt: notification.createdAt.toISOString(),
      readAt: notification.readAt?.toISOString() ?? null,
    };
  }
}
