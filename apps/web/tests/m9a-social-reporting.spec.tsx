import type {
  AuthUserSummary,
  MeResponse,
  UserMatchDetailResponse,
  UserMatchesResponse,
  UserStatsResponse,
} from '@truco/shared';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProfileScreen } from '../src/features/profile/ProfileScreen.js';
import { SocialScreen } from '../src/features/social/SocialScreen.js';

const api = vi.hoisted(() => ({
  createReportRequest: vi.fn(),
  ensureGuestOrActiveSession: vi.fn(),
  getMeRequest: vi.fn(),
  getUserMatchDetailRequest: vi.fn(),
  getUserMatchesRequest: vi.fn(),
  getUserStatsRequest: vi.fn(),
  listActiveSessionsRequest: vi.fn(),
  listBlockedUsersRequest: vi.fn(),
  listFriendRequestsRequest: vi.fn(),
  listFriendsRequest: vi.fn(),
  listSocialInvitationsRequest: vi.fn(),
  listSocialNotificationsRequest: vi.fn(),
  getUnreadSocialNotificationCountRequest: vi.fn(),
  patchMeRequest: vi.fn(),
  markSocialNotificationReadRequest: vi.fn(),
}));

vi.mock('../src/lib/api-client.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ...api,
}));

afterEach(() => cleanup());
beforeEach(() => vi.clearAllMocks());

const CURRENT_USER: AuthUserSummary = {
  id: '019a7e40-0000-7000-8000-0000000000a1',
  email: 'yo@truco.ar',
  emailVerified: true,
  nickname: 'TanaDelSur',
  isGuest: false,
  role: 'PLAYER',
  status: 'ACTIVE',
  createdAt: '2026-11-18T12:00:00.000Z',
};
const FRIEND_ID = '019a7e40-0000-7000-8000-0000000000a2';
const MATCH_ID = '019a7e40-0000-7000-8000-0000000000a3';

const EMPTY_MODE_STATS: UserStatsResponse['byMode']['1v1'] = {
  matchesPlayed: 0,
  wins: 0,
  losses: 0,
  abandons: 0,
  winRate: 0,
  currentStreak: 0,
  envido: { resolved: 0, won: 0, winRate: 0 },
  truco: { resolved: 0, won: 0, winRate: 0 },
};

const USER_STATS: UserStatsResponse = {
  userId: CURRENT_USER.id,
  matchesPlayed: 1,
  wins: 1,
  losses: 0,
  abandons: 0,
  winRate: 1,
  byMode: {
    '1v1': { ...EMPTY_MODE_STATS, matchesPlayed: 1, wins: 1, winRate: 1, currentStreak: 1 },
    '2v2': EMPTY_MODE_STATS,
  },
};

const USER_MATCHES: UserMatchesResponse = {
  items: [
    {
      matchId: MATCH_ID,
      mode: '1v1',
      rulesetCode: 'ar-standard-v1',
      seat: 0,
      team: 0,
      score: 30,
      outcome: 'WIN',
      hasBots: false,
      startedAt: '2026-11-18T11:00:00.000Z',
      endedAt: '2026-11-18T11:05:00.000Z',
    },
  ],
  nextCursor: null,
};

const MATCH_DETAIL: UserMatchDetailResponse = {
  matchId: MATCH_ID,
  mode: '1v1',
  rulesetCode: 'ar-standard-v1',
  hasBots: false,
  seedCommitment: 'a'.repeat(64),
  startedAt: '2026-11-18T11:00:00.000Z',
  endedAt: '2026-11-18T11:05:00.000Z',
  result: { winnerTeam: 0, scoresByTeam: { '0': 30, '1': 21 }, reason: null },
  players: [
    {
      userId: CURRENT_USER.id,
      nickname: CURRENT_USER.nickname,
      seat: 0,
      team: 0,
      score: 30,
      outcome: 'WIN',
      isSelf: true,
    },
    {
      userId: FRIEND_ID,
      nickname: 'TanoBaston',
      seat: 1,
      team: 1,
      score: 21,
      outcome: 'LOSS',
      isSelf: false,
    },
  ],
  events: [{ seq: 1, type: 'game.ended', at: '2026-11-18T11:05:00.000Z' }],
};

function configureProfileApi() {
  const me: MeResponse = {
    user: CURRENT_USER,
    profile: {
      avatarId: 'mate-classic',
      level: 4,
      xp: 1200,
      bio: '',
      settings: {
        soundEnabled: true,
        animationsReduced: false,
        confirmCalls: false,
        historyVisibility: 'FRIENDS',
        statsVisibility: 'FRIENDS',
        presenceVisibility: 'FRIENDS',
      },
    },
  };
  api.getMeRequest.mockResolvedValue(me);
  api.getUserStatsRequest.mockResolvedValue(USER_STATS);
  api.getUserMatchesRequest.mockResolvedValue(USER_MATCHES);
  api.listActiveSessionsRequest.mockResolvedValue({ sessions: [] });
  api.getUserMatchDetailRequest.mockResolvedValue(MATCH_DETAIL);
}

describe('M9a report entry points', () => {
  it('lets a player report someone directly from the friends list', async () => {
    api.listFriendsRequest.mockResolvedValue({
      items: [
        {
          friendshipId: '019a7e40-0000-7000-8000-0000000000b1',
          userId: FRIEND_ID,
          nickname: 'TanoBaston',
          avatarId: 'mate-classic',
          level: 3,
          presence: 'ONLINE',
          friendsSince: '2026-11-17T10:00:00.000Z',
        },
      ],
    });
    api.listFriendRequestsRequest.mockResolvedValue({ items: [] });
    api.listSocialInvitationsRequest.mockResolvedValue({ items: [] });
    api.listBlockedUsersRequest.mockResolvedValue({ items: [] });
    api.listSocialNotificationsRequest.mockResolvedValue({
      items: [],
      nextCursor: null,
      unreadCount: 0,
    });
    api.getUnreadSocialNotificationCountRequest.mockResolvedValue({ unreadCount: 0 });
    api.createReportRequest.mockResolvedValue({
      id: '019a7e40-0000-7000-8000-0000000000c1',
      status: 'OPEN',
      mergedWithExisting: false,
      createdAt: '2026-11-18T12:10:00.000Z',
      eventLogRef: null,
    });

    render(
      <SocialScreen
        currentUser={CURRENT_USER}
        onSessionChanged={() => undefined}
        onNavigate={() => undefined}
      />,
    );

    await screen.findByText('TanoBaston');
    fireEvent.click(screen.getByRole('button', { name: 'Reportar' }));
    expect(await screen.findByText('Reportar a un jugador')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Enviar reporte' }));

    await waitFor(() =>
      expect(api.createReportRequest).toHaveBeenCalledWith({
        targetUserId: FRIEND_ID,
        reasonCode: 'ABUSIVE_BEHAVIOR',
      }),
    );
    expect(screen.getByTestId('report-success')).toBeTruthy();
  });

  it('da a la acción de notificación un nombre accesible completo y una etiqueta corta', async () => {
    api.listFriendsRequest.mockResolvedValue({ items: [] });
    api.listFriendRequestsRequest.mockResolvedValue({ items: [] });
    api.listSocialInvitationsRequest.mockResolvedValue({ items: [] });
    api.listBlockedUsersRequest.mockResolvedValue({ items: [] });
    api.listSocialNotificationsRequest.mockResolvedValue({
      items: [
        {
          id: '019a7e40-0000-7000-8000-0000000000d1',
          type: 'TABLE_INVITATION',
          actorUserId: FRIEND_ID,
          actorNickname: 'TanoBaston',
          referenceId: null,
          tableId: null,
          createdAt: '2026-11-18T12:00:00.000Z',
          readAt: null,
        },
      ],
      nextCursor: null,
      unreadCount: 1,
    });
    api.getUnreadSocialNotificationCountRequest.mockResolvedValue({ unreadCount: 1 });
    api.markSocialNotificationReadRequest.mockResolvedValue({
      notification: {
        id: '019a7e40-0000-7000-8000-0000000000d1',
        type: 'TABLE_INVITATION',
        actorUserId: FRIEND_ID,
        actorNickname: 'TanoBaston',
        referenceId: null,
        tableId: null,
        createdAt: '2026-11-18T12:00:00.000Z',
        readAt: '2026-11-18T12:05:00.000Z',
      },
    });

    render(
      <SocialScreen
        currentUser={CURRENT_USER}
        onSessionChanged={() => undefined}
        onNavigate={() => undefined}
      />,
    );

    // Nombre accesible completo: quién y qué evento, sin perder el texto largo de la acción.
    const action = await screen.findByRole('button', {
      name: 'Marcar como leída la notificación: TanoBaston te invitó a una mesa',
    });
    // La etiqueta visible es corta para que no se parta en tres líneas en la tarjeta.
    expect(action.textContent).toBe('Marcar leída');
    fireEvent.click(action);
    await waitFor(() =>
      expect(api.markSocialNotificationReadRequest).toHaveBeenCalledWith(
        '019a7e40-0000-7000-8000-0000000000d1',
      ),
    );
  });

  it('persists statistics visibility independently from history visibility', async () => {
    configureProfileApi();
    api.patchMeRequest.mockResolvedValue(await api.getMeRequest());

    render(
      <ProfileScreen
        currentUser={CURRENT_USER}
        onSessionChanged={() => undefined}
        onNavigate={() => undefined}
      />,
    );

    expect(await screen.findByText('1 partida · 100% de efectividad')).toBeTruthy();
    const statsVisibility = await screen.findByRole('combobox', {
      name: 'Quién puede ver mis estadísticas',
    });
    fireEvent.change(statsVisibility, { target: { value: 'NOBODY' } });
    await waitFor(() =>
      expect(api.patchMeRequest).toHaveBeenCalledWith({ settings: { statsVisibility: 'NOBODY' } }),
    );
  });

  it('lets a player report an opponent from match history and attaches the match ID', async () => {
    configureProfileApi();
    api.createReportRequest.mockResolvedValue({
      id: '019a7e40-0000-7000-8000-0000000000c2',
      status: 'OPEN',
      mergedWithExisting: false,
      createdAt: '2026-11-18T12:10:00.000Z',
      eventLogRef: { matchId: MATCH_ID, eventCount: 12, lastSeq: 12, digest: 'b'.repeat(64) },
    });

    render(
      <ProfileScreen
        currentUser={CURRENT_USER}
        onSessionChanged={() => undefined}
        onNavigate={() => undefined}
      />,
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Ver detalle' }));
    fireEvent.click(
      await screen.findByRole('button', { name: 'Reportar jugador de esta partida' }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Enviar reporte' }));

    await waitFor(() =>
      expect(api.createReportRequest).toHaveBeenCalledWith({
        targetUserId: FRIEND_ID,
        reasonCode: 'ABUSIVE_BEHAVIOR',
        matchId: MATCH_ID,
      }),
    );
    expect(screen.getByTestId('report-success')).toBeTruthy();
  });
});
