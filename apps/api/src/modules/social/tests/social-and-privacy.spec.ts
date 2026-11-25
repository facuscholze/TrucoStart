import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createApiApp } from '../../../bootstrap.js';
import { generateUuidV7 } from '../../../common/uuidv7.js';
import { TEST_LEGAL_ACCEPTANCE } from '../../../common/testing/legal-acceptance.fixture.js';
import {
  createAdaptiveTestDatabase,
  type DatabaseConnectionHandle,
} from '../../../db/database.provider.js';
import {
  friendshipsTable,
  matchesTable,
  matchEventsTable,
  matchPlayersTable,
  sanctionsTable,
  socialInvitationsTable,
  tableSeatsTable,
  tablesTable,
} from '../../../db/schema/index.js';
import { buildCookieHeader, extractAuthCookies } from '../../auth/tests/test-cookie-jar.js';
import { LobbyRealtimeGateway } from '../../lobby/lobby-realtime.gateway.js';
import { USER_PRESENCE_STORE } from '../presence-store.interface.js';

interface TestPlayer {
  readonly id: string;
  readonly nickname: string;
  readonly cookie: string;
}

describe('M9a social graph, privacy and invitations', () => {
  let dbHandle: DatabaseConnectionHandle;
  let app: NestFastifyApplication;
  const clockMs = Date.UTC(2026, 10, 18, 15, 0, 0);
  let serial = 0;

  beforeAll(async () => {
    dbHandle = await createAdaptiveTestDatabase();
    app = await createApiApp({
      dbHandle,
      trustProxyCidrs: ['127.0.0.1/32'],
      authOptions: {
        runtimeConfig: {
          sessionSecret: 'social-tests-secret-minimum-32-characters!!',
          nowFn: () => clockMs,
        },
      },
    });
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    await dbHandle.close();
  });

  async function register(nickname: string): Promise<TestPlayer> {
    serial++;
    const response = await app.inject({
      method: 'POST',
      url: '/v1/auth/register',
      headers: { 'x-forwarded-for': `192.0.2.${serial}` },
      payload: {
        email: `social-${serial}@truco.ar`,
        password: 'SocialTest12345',
        nickname,
        legal: TEST_LEGAL_ACCEPTANCE,
      },
    });
    expect(response.statusCode).toBe(201);
    const user = response.json().user as { id: string; nickname: string };
    const cookies = extractAuthCookies(response.headers['set-cookie']).map;
    return { id: user.id, nickname: user.nickname, cookie: buildCookieHeader(cookies) };
  }

  const req = (
    player: TestPlayer,
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    url: string,
    payload?: Record<string, unknown>,
  ) =>
    app.inject({
      method,
      url,
      headers: { cookie: player.cookie },
      ...(payload !== undefined ? { payload } : {}),
    });

  it('serializes crossed requests, accepts twice safely, and applies history and stats privacy independently', async () => {
    const alice = await register('M9Alice');
    const bob = await register('M9Bobby');
    const charlie = await register('M9Charlie');
    const outsider = await register('M9Outsider');

    const unauthenticated = await app.inject({
      method: 'GET',
      url: `/v1/users/${alice.id}/matches`,
    });
    expect(unauthenticated.statusCode).toBe(401);
    expect(
      (await app.inject({ method: 'GET', url: `/v1/users/${alice.id}/stats` })).statusCode,
    ).toBe(401);
    const privateBeforeFriendship = await req(bob, 'GET', `/v1/users/${alice.id}/matches`);
    expect(privateBeforeFriendship.statusCode).toBe(404);
    expect((await req(bob, 'GET', `/v1/users/${alice.id}/stats`)).statusCode).toBe(404);

    const crossed = await Promise.all([
      req(alice, 'POST', '/v1/social/friend-requests', { targetUserId: bob.id }),
      req(bob, 'POST', '/v1/social/friend-requests', { targetUserId: alice.id }),
    ]);
    expect(crossed.map((response) => response.statusCode)).toEqual([201, 201]);
    const [pair] = await dbHandle.db
      .select()
      .from(friendshipsTable)
      .where(
        and(
          eq(friendshipsTable.userLow, alice.id < bob.id ? alice.id : bob.id),
          eq(friendshipsTable.userHigh, alice.id < bob.id ? bob.id : alice.id),
        ),
      );
    expect(pair?.status).toBe('ACCEPTED');
    const friends = await req(alice, 'GET', '/v1/social/friends');
    expect(friends.statusCode).toBe(200);
    expect(friends.json().items.map((item: { userId: string }) => item.userId)).toContain(bob.id);

    const incoming = await req(charlie, 'POST', '/v1/social/friend-requests', {
      targetUserId: alice.id,
    });
    expect(incoming.statusCode).toBe(201);
    const pending = incoming.json().requestId as string;
    const accepts = await Promise.all([
      req(alice, 'POST', `/v1/social/friend-requests/${pending}/accept`),
      req(alice, 'POST', `/v1/social/friend-requests/${pending}/accept`),
    ]);
    expect(accepts.map((response) => response.statusCode)).toEqual([200, 200]);
    expect(accepts.every((response) => response.json().status === 'ACCEPTED')).toBe(true);

    const matchId = generateUuidV7(clockMs);
    await dbHandle.db.insert(matchesTable).values({
      id: matchId,
      mode: '1v1',
      rulesetCode: 'ar-standard-v1',
      seedCommitment: 'c'.repeat(64),
      startedAt: new Date(clockMs - 10_000),
      endedAt: new Date(clockMs),
    });
    await dbHandle.db.insert(matchPlayersTable).values({
      matchId,
      seat: 0,
      userId: alice.id,
      team: 0,
      score: 30,
      outcome: 'WIN',
    });
    await dbHandle.db.insert(matchEventsTable).values([
      {
        matchId,
        seq: 1,
        type: 'game.callMade',
        payload: { family: 'ENVIDO', seat: 0, team: 0 },
        createdAt: new Date(clockMs - 8_000),
      },
      {
        matchId,
        seq: 2,
        type: 'game.callResolved',
        payload: { family: 'ENVIDO', winningTeam: 0, accepted: true, pointsAwarded: 2 },
        createdAt: new Date(clockMs - 7_000),
      },
      {
        matchId,
        seq: 3,
        type: 'game.callResolved',
        payload: { family: 'TRUCO', winningTeam: 1, accepted: true, pointsAwarded: 2 },
        createdAt: new Date(clockMs - 6_000),
      },
      {
        matchId,
        seq: 4,
        type: 'game.cardPlayed',
        payload: { card: { rank: 12, suit: 'oros' }, seat: 0 },
        createdAt: new Date(clockMs - 5_000),
      },
    ]);

    const bobCanView = await req(bob, 'GET', `/v1/users/${alice.id}/matches`);
    expect(bobCanView.statusCode).toBe(200);
    const bobCannotDetailWithoutParticipation = await req(
      bob,
      'GET',
      `/v1/users/${alice.id}/matches/${matchId}`,
    );
    expect(bobCannotDetailWithoutParticipation.statusCode).toBe(200);
    expect(
      bobCannotDetailWithoutParticipation
        .json()
        .events.map((event: { type: string }) => event.type),
    ).toEqual(['game.callMade', 'game.callResolved', 'game.callResolved']);
    expect(JSON.stringify(bobCannotDetailWithoutParticipation.json())).not.toContain('cardPlayed');
    expect(JSON.stringify(bobCannotDetailWithoutParticipation.json())).not.toContain('seedReveal');
    const onlyWins = await req(bob, 'GET', `/v1/users/${alice.id}/matches?outcome=WIN&bots=HUMANS`);
    expect(onlyWins.statusCode).toBe(200);
    expect(onlyWins.json().items).toHaveLength(1);
    const otherMode = await req(bob, 'GET', `/v1/users/${alice.id}/matches?mode=2v2`);
    expect(otherMode.statusCode).toBe(200);
    expect(otherMode.json().items).toHaveLength(0);

    const hideHistory = await req(alice, 'PATCH', '/v1/me', {
      settings: { historyVisibility: 'NOBODY' },
    });
    expect(hideHistory.statusCode).toBe(200);
    expect(hideHistory.json().profile.settings.historyVisibility).toBe('NOBODY');
    expect((await req(bob, 'GET', `/v1/users/${alice.id}/matches`)).statusCode).toBe(404);
    expect((await req(bob, 'GET', `/v1/users/${alice.id}/stats`)).statusCode).toBe(200);
    expect((await req(charlie, 'GET', `/v1/users/${alice.id}/matches`)).statusCode).toBe(404);
    expect((await req(charlie, 'GET', `/v1/users/${alice.id}/stats`)).statusCode).toBe(200);
    expect((await req(outsider, 'GET', `/v1/users/${alice.id}/matches`)).statusCode).toBe(404);
    expect((await req(outsider, 'GET', `/v1/users/${alice.id}/stats`)).statusCode).toBe(404);
    expect((await req(alice, 'GET', `/v1/users/${alice.id}/matches`)).statusCode).toBe(200);
    expect((await req(alice, 'GET', `/v1/users/${alice.id}/stats`)).statusCode).toBe(200);

    const exposeHistory = await req(alice, 'PATCH', '/v1/me', {
      settings: { historyVisibility: 'ALL' },
    });
    expect(exposeHistory.statusCode).toBe(200);
    expect((await req(outsider, 'GET', `/v1/users/${alice.id}/matches`)).statusCode).toBe(200);
    expect((await req(outsider, 'GET', `/v1/users/${alice.id}/stats`)).statusCode).toBe(404);

    const exposeStats = await req(alice, 'PATCH', '/v1/me', {
      settings: { statsVisibility: 'ALL' },
    });
    expect(exposeStats.statusCode).toBe(200);
    expect(exposeStats.json().profile.settings.statsVisibility).toBe('ALL');
    expect((await req(outsider, 'GET', `/v1/users/${alice.id}/stats`)).statusCode).toBe(200);

    const restoreHistory = await req(alice, 'PATCH', '/v1/me', {
      settings: { historyVisibility: 'FRIENDS' },
    });
    expect(restoreHistory.statusCode).toBe(200);
    expect((await req(outsider, 'GET', `/v1/users/${alice.id}/matches`)).statusCode).toBe(404);
    expect((await req(outsider, 'GET', `/v1/users/${alice.id}/stats`)).statusCode).toBe(200);

    const hideStats = await req(alice, 'PATCH', '/v1/me', {
      settings: { statsVisibility: 'NOBODY' },
    });
    expect(hideStats.statusCode).toBe(200);
    expect((await req(outsider, 'GET', `/v1/users/${alice.id}/stats`)).statusCode).toBe(404);
    expect((await req(bob, 'GET', `/v1/users/${alice.id}/stats`)).statusCode).toBe(404);
    expect((await req(bob, 'GET', `/v1/users/${alice.id}/matches`)).statusCode).toBe(200);
    const stats = await req(alice, 'GET', `/v1/users/${alice.id}/stats`);
    expect(stats.statusCode).toBe(200);
    expect(stats.json().byMode['1v1'].matchesPlayed).toBe(1);
    expect(stats.json().byMode['1v1'].currentStreak).toBe(1);
    expect(stats.json().byMode['1v1'].envido).toEqual({ resolved: 1, won: 1, winRate: 1 });
    expect(stats.json().byMode['1v1'].truco).toEqual({ resolved: 1, won: 0, winRate: 0 });
  });

  it('enforces blocks and active-sanction exclusions for search, requests and direct 1v1 challenges', async () => {
    const alice = await register('BlockAlice');
    const bob = await register('BlockBobby');
    const sanctioned = await register('SancTarget');

    const sent = await req(alice, 'POST', '/v1/social/friend-requests', { targetUserId: bob.id });
    expect(sent.statusCode).toBe(201);
    const accept = await req(
      bob,
      'POST',
      `/v1/social/friend-requests/${sent.json().requestId}/accept`,
    );
    expect(accept.statusCode).toBe(200);

    const sanctionId = generateUuidV7(clockMs);
    await dbHandle.db.insert(sanctionsTable).values({
      id: sanctionId,
      userId: sanctioned.id,
      type: 'SUSPEND',
      reason: 'Prueba de exclusión social',
      expiresAt: new Date(clockMs + 60_000),
      revokedAt: null,
      createdAt: new Date(clockMs),
    });
    const search = await req(alice, 'GET', '/v1/social/search?nickname=Sanc');
    expect(search.statusCode).toBe(200);
    expect(search.json().items).toEqual([]);
    const requestToSanctioned = await req(alice, 'POST', '/v1/social/friend-requests', {
      targetUserId: sanctioned.id,
    });
    expect(requestToSanctioned.statusCode).toBe(403);
    expect(
      (
        await req(sanctioned, 'POST', '/v1/social/friend-requests', {
          targetUserId: alice.id,
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await req(sanctioned, 'POST', '/v1/social/challenges', {
          recipientUserId: alice.id,
          rulesetCode: 'ar-standard-v1',
        })
      ).statusCode,
    ).toBe(403);

    const table = await req(alice, 'POST', '/v1/tables', {
      mode: '1v1',
      visibility: 'PRIVATE',
      rulesetCode: 'ar-standard-v1',
    });
    expect(table.statusCode).toBe(201);
    const tableId = table.json().id as string;
    const pendingTableInvite = await req(alice, 'POST', '/v1/social/table-invitations', {
      recipientUserId: bob.id,
      tableId,
    });
    expect(pendingTableInvite.statusCode).toBe(201);
    const pendingChallenge = await req(alice, 'POST', '/v1/social/challenges', {
      recipientUserId: bob.id,
      rulesetCode: 'ar-standard-v1',
    });
    expect(pendingChallenge.statusCode).toBe(201);

    const realtime = app.get(LobbyRealtimeGateway);
    const presenceSpy = vi
      .spyOn(realtime, 'emitSocialPresence')
      .mockImplementation(() => undefined);
    const blocked = await req(alice, 'POST', `/v1/social/blocks/${bob.id}`);
    expect(blocked.statusCode).toBe(200);
    expect(presenceSpy).toHaveBeenCalledWith(
      alice.id,
      expect.objectContaining({ userId: bob.id, status: 'OFFLINE', visible: false }),
    );
    expect(presenceSpy).toHaveBeenCalledWith(
      bob.id,
      expect.objectContaining({ userId: alice.id, status: 'OFFLINE', visible: false }),
    );
    presenceSpy.mockRestore();
    expect(blocked.json()).toEqual({ userId: bob.id, blocked: true });
    expect((await req(alice, 'GET', '/v1/social/search?nickname=BlockBob')).json().items).toEqual(
      [],
    );
    const friendRequestAfterBlock = await req(bob, 'POST', '/v1/social/friend-requests', {
      targetUserId: alice.id,
    });
    expect(friendRequestAfterBlock.statusCode).toBe(404);
    const invitationIds = [
      pendingTableInvite.json().invitationId as string,
      pendingChallenge.json().invitationId as string,
    ];
    const cancelledInvitations = await dbHandle.db
      .select({ id: socialInvitationsTable.id, status: socialInvitationsTable.status })
      .from(socialInvitationsTable)
      .where(
        and(
          eq(socialInvitationsTable.senderId, alice.id),
          eq(socialInvitationsTable.recipientId, bob.id),
        ),
      );
    expect(cancelledInvitations).toEqual(
      expect.arrayContaining(
        invitationIds.map((id) => expect.objectContaining({ id, status: 'CANCELLED' })),
      ),
    );
    for (const invitationId of invitationIds) {
      expect(
        (await req(bob, 'POST', `/v1/social/invitations/${invitationId}/accept`)).statusCode,
      ).toBe(409);
    }
    expect(
      (
        await req(alice, 'POST', '/v1/social/table-invitations', {
          recipientUserId: bob.id,
          tableId,
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await req(alice, 'POST', '/v1/social/challenges', {
          recipientUserId: bob.id,
          rulesetCode: 'ar-standard-v1',
        })
      ).statusCode,
    ).toBe(404);
    expect((await req(alice, 'GET', '/v1/social/friends')).json().items).toHaveLength(0);
    expect((await req(alice, 'DELETE', `/v1/tables/${tableId}`)).statusCode).toBe(200);
  });

  it('publishes presence according to ALL/FRIENDS/NOBODY settings and clears private status', async () => {
    const alice = await register('PresenceAlice');
    const bob = await register('PresenceBobby');
    const outsider = await register('PresenceOutsider');

    const request = await req(alice, 'POST', '/v1/social/friend-requests', {
      targetUserId: bob.id,
    });
    expect(request.statusCode).toBe(201);
    const acceptedFriend = await req(
      bob,
      'POST',
      `/v1/social/friend-requests/${request.json().requestId}/accept`,
    );
    expect(acceptedFriend.statusCode).toBe(200);

    const tableResponse = await req(alice, 'POST', '/v1/tables', {
      mode: '1v1',
      visibility: 'PRIVATE',
      rulesetCode: 'ar-standard-v1',
    });
    expect(tableResponse.statusCode).toBe(201);
    const tableId = tableResponse.json().id as string;
    const invitation = await req(alice, 'POST', '/v1/social/table-invitations', {
      recipientUserId: bob.id,
      tableId,
    });
    expect(invitation.statusCode).toBe(201);
    const acceptedInvitation = await req(
      bob,
      'POST',
      `/v1/social/invitations/${invitation.json().invitationId}/accept`,
    );
    expect(acceptedInvitation.statusCode).toBe(200);

    await dbHandle.db
      .update(tablesTable)
      .set({ status: 'IN_GAME' })
      .where(eq(tablesTable.id, tableId));
    const presenceStore = app.get(USER_PRESENCE_STORE);
    const socketId = 'presence-test-socket';
    await presenceStore.connect(bob.id, socketId, clockMs, 45_000);

    const realtime = app.get(LobbyRealtimeGateway);
    const emitSpy = vi.spyOn(realtime, 'emitSocialPresence').mockImplementation(() => undefined);
    const broadcastSpy = vi
      .spyOn(realtime, 'broadcastSocialPresence')
      .mockImplementation(() => undefined);
    try {
      await realtime.refreshSocialPresence([bob.id]);
      expect(emitSpy).toHaveBeenLastCalledWith(
        alice.id,
        expect.objectContaining({ userId: bob.id, status: 'IN_GAME', visible: true }),
      );
      expect(emitSpy.mock.calls.some(([recipientId]) => recipientId === outsider.id)).toBe(false);
      expect(broadcastSpy).not.toHaveBeenCalled();
      const friendsWhilePlaying = await req(alice, 'GET', '/v1/social/friends');
      expect(friendsWhilePlaying.json().items).toEqual(
        expect.arrayContaining([expect.objectContaining({ userId: bob.id, presence: 'IN_GAME' })]),
      );

      await dbHandle.db
        .update(tablesTable)
        .set({ status: 'FINISHED' })
        .where(eq(tablesTable.id, tableId));
      await dbHandle.db
        .update(tableSeatsTable)
        .set({ isActive: false })
        .where(eq(tableSeatsTable.tableId, tableId));
      await realtime.refreshSocialPresence([bob.id]);
      expect(emitSpy).toHaveBeenLastCalledWith(
        alice.id,
        expect.objectContaining({ userId: bob.id, status: 'ONLINE', visible: true }),
      );

      const hidePresence = await req(bob, 'PATCH', '/v1/me', {
        settings: { presenceVisibility: 'NOBODY' },
      });
      expect(hidePresence.statusCode).toBe(200);
      expect(emitSpy).toHaveBeenLastCalledWith(
        alice.id,
        expect.objectContaining({ userId: bob.id, status: 'OFFLINE', visible: false }),
      );
      const friendsAfterHiding = await req(alice, 'GET', '/v1/social/friends');
      expect(friendsAfterHiding.json().items).toEqual(
        expect.arrayContaining([expect.objectContaining({ userId: bob.id, presence: null })]),
      );

      const showPresenceToAll = await req(bob, 'PATCH', '/v1/me', {
        settings: { presenceVisibility: 'ALL' },
      });
      expect(showPresenceToAll.statusCode).toBe(200);
      expect(broadcastSpy).toHaveBeenLastCalledWith(
        expect.objectContaining({ userId: bob.id, status: 'ONLINE', visible: true }),
        bob.id,
        [],
      );

      expect((await req(alice, 'POST', `/v1/social/blocks/${bob.id}`)).statusCode).toBe(200);
      const emittedClearEvents = emitSpy.mock.calls.length;
      await realtime.refreshSocialPresence([bob.id]);
      expect(emitSpy).toHaveBeenCalledTimes(emittedClearEvents);
      expect(broadcastSpy).toHaveBeenLastCalledWith(
        expect.objectContaining({ userId: bob.id, status: 'ONLINE', visible: true }),
        bob.id,
        [alice.id],
      );
      expect((await req(alice, 'GET', '/v1/social/friends')).json().items).toHaveLength(0);
    } finally {
      emitSpy.mockRestore();
      broadcastSpy.mockRestore();
      await presenceStore.disconnect(bob.id, socketId, clockMs);
    }
  });

  it('creates expiring table invites and 1v1 challenges with a single-use accept path', async () => {
    const alice = await register('InviteAlice');
    const bob = await register('InviteBobby');

    const request = await req(alice, 'POST', '/v1/social/friend-requests', {
      targetUserId: bob.id,
    });
    expect(request.statusCode).toBe(201);
    expect(
      (await req(bob, 'POST', `/v1/social/friend-requests/${request.json().requestId}/accept`))
        .statusCode,
    ).toBe(200);

    const tableResponse = await req(alice, 'POST', '/v1/tables', {
      mode: '1v1',
      visibility: 'PRIVATE',
      rulesetCode: 'ar-standard-v1',
    });
    expect(tableResponse.statusCode).toBe(201);
    const tableId = tableResponse.json().id as string;
    const invitation = await req(alice, 'POST', '/v1/social/table-invitations', {
      recipientUserId: bob.id,
      tableId,
    });
    expect(invitation.statusCode).toBe(201);
    const accepted = await req(
      bob,
      'POST',
      `/v1/social/invitations/${invitation.json().invitationId}/accept`,
    );
    expect(accepted.statusCode).toBe(200);
    expect(accepted.json().kind).toBe('TABLE');
    expect(accepted.json().table.seats).toHaveLength(2);
    const acceptedTwice = await req(
      bob,
      'POST',
      `/v1/social/invitations/${invitation.json().invitationId}/accept`,
    );
    expect(acceptedTwice.statusCode).toBe(200);
    expect(acceptedTwice.json().table.id).toBe(accepted.json().table.id);
    expect(acceptedTwice.json().table.seats).toHaveLength(2);

    const deleteTable = await req(alice, 'DELETE', `/v1/tables/${tableId}`);
    expect(deleteTable.statusCode).toBe(200);

    const challenge = await req(bob, 'POST', '/v1/social/challenges', {
      recipientUserId: alice.id,
      mode: '1v1',
      rulesetCode: 'ar-standard-v1',
    });
    expect(challenge.statusCode).toBe(201);
    const challengeAccepted = await req(
      alice,
      'POST',
      `/v1/social/invitations/${challenge.json().invitationId}/accept`,
    );
    expect(challengeAccepted.statusCode).toBe(200);
    expect(challengeAccepted.json().kind).toBe('CHALLENGE');
    expect(challengeAccepted.json().table.mode).toBe('1v1');
    expect(challengeAccepted.json().table.rulesetCode).toBe('ar-standard-v1');
    expect(challengeAccepted.json().table.seats).toHaveLength(2);
    const challengeTwice = await req(
      alice,
      'POST',
      `/v1/social/invitations/${challenge.json().invitationId}/accept`,
    );
    expect(challengeTwice.statusCode).toBe(409);

    const realtime = app.get(LobbyRealtimeGateway);
    const emitSpy = vi
      .spyOn(realtime, 'emitSocialNotification')
      .mockImplementation(() => undefined);
    const declinedChallenge = await req(alice, 'POST', '/v1/social/challenges', {
      recipientUserId: bob.id,
      rulesetCode: 'ar-standard-v1',
    });
    expect(declinedChallenge.statusCode).toBe(201);
    const declineResult = await req(
      bob,
      'POST',
      `/v1/social/invitations/${declinedChallenge.json().invitationId}/decline`,
    );
    expect(declineResult.statusCode).toBe(200);
    expect(emitSpy).toHaveBeenCalledWith(
      alice.id,
      expect.objectContaining({ type: 'CHALLENGE_DECLINED' }),
    );
    const notifications = await req(alice, 'GET', '/v1/social/notifications');
    expect(notifications.json().items).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: 'CHALLENGE_DECLINED' })]),
    );
    emitSpy.mockRestore();
  });

  it('commits cancellation when friendship is removed before accepting a table invite or challenge', async () => {
    const alice = await register('CancelAlice');
    const bob = await register('CancelBobby');
    const friendRequest = await req(alice, 'POST', '/v1/social/friend-requests', {
      targetUserId: bob.id,
    });
    expect(friendRequest.statusCode).toBe(201);
    expect(
      (
        await req(
          bob,
          'POST',
          `/v1/social/friend-requests/${friendRequest.json().requestId}/accept`,
        )
      ).statusCode,
    ).toBe(200);

    const table = await req(alice, 'POST', '/v1/tables', {
      mode: '1v1',
      visibility: 'PRIVATE',
      rulesetCode: 'ar-standard-v1',
    });
    expect(table.statusCode).toBe(201);
    const tableInvite = await req(alice, 'POST', '/v1/social/table-invitations', {
      recipientUserId: bob.id,
      tableId: table.json().id,
    });
    expect(tableInvite.statusCode).toBe(201);
    const tableInviteId = tableInvite.json().invitationId as string;
    expect((await req(alice, 'DELETE', `/v1/social/friends/${bob.id}`)).statusCode).toBe(200);
    const [immediatelyCancelledTableInvite] = await dbHandle.db
      .select({ status: socialInvitationsTable.status })
      .from(socialInvitationsTable)
      .where(eq(socialInvitationsTable.id, tableInviteId));
    expect(immediatelyCancelledTableInvite?.status).toBe('CANCELLED');
    const tableAccept = await req(bob, 'POST', `/v1/social/invitations/${tableInviteId}/accept`);
    expect(tableAccept.statusCode).toBe(404);
    const [cancelledTableInvite] = await dbHandle.db
      .select({ status: socialInvitationsTable.status })
      .from(socialInvitationsTable)
      .where(eq(socialInvitationsTable.id, tableInviteId));
    expect(cancelledTableInvite?.status).toBe('CANCELLED');

    const renewedRequest = await req(alice, 'POST', '/v1/social/friend-requests', {
      targetUserId: bob.id,
    });
    expect(renewedRequest.statusCode).toBe(201);
    expect(
      (
        await req(
          bob,
          'POST',
          `/v1/social/friend-requests/${renewedRequest.json().requestId}/accept`,
        )
      ).statusCode,
    ).toBe(200);
    const challenge = await req(alice, 'POST', '/v1/social/challenges', {
      recipientUserId: bob.id,
      rulesetCode: 'ar-standard-v1',
    });
    expect(challenge.statusCode).toBe(201);
    const challengeId = challenge.json().invitationId as string;
    expect((await req(bob, 'DELETE', `/v1/social/friends/${alice.id}`)).statusCode).toBe(200);
    const [immediatelyCancelledChallenge] = await dbHandle.db
      .select({ status: socialInvitationsTable.status })
      .from(socialInvitationsTable)
      .where(eq(socialInvitationsTable.id, challengeId));
    expect(immediatelyCancelledChallenge?.status).toBe('CANCELLED');
    const challengeAccept = await req(bob, 'POST', `/v1/social/invitations/${challengeId}/accept`);
    expect(challengeAccept.statusCode).toBe(404);
    const [cancelledChallenge] = await dbHandle.db
      .select({ status: socialInvitationsTable.status })
      .from(socialInvitationsTable)
      .where(eq(socialInvitationsTable.id, challengeId));
    expect(cancelledChallenge?.status).toBe('CANCELLED');
  });
});
