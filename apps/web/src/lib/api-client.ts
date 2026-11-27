import type {
  AccountExportResponse,
  AuthSessionResponse,
  AuthUserSummary,
  CreateTableRequest,
  DeleteAccountResponse,
  DeleteTableResponse,
  ForgotPasswordRequest,
  GameMode,
  JoinByCodeRequest,
  LeaveTableResponse,
  LegalStatusResponse,
  LoginRequest,
  MatchmakingCancelResponse,
  MatchmakingEnqueueRequest,
  MatchmakingQueueStatusResponse,
  MeResponse,
  NonEnumeratingAckResponse,
  PatchMeRequest,
  PublicUserProfile,
  PromoteGuestRequest,
  PublicTableListResponse,
  RegisterRequest,
  ResendVerificationRequest,
  ResetPasswordRequest,
  SessionListResponse,
  TableDetailResponse,
  TableInviteResponse,
  UserMatchesResponse,
  UserStatsResponse,
  VerifyEmailRequest,
  WsTicketResponse,
  CreateReportRequest,
  CreateReportResponse,
  MyModerationState,
  TutorialProgressResponse,
  TutorialProgressUpdateRequest,
  UserMatchDetailResponse,
  PlayerSearchResponse,
  FriendListResponse,
  FriendRequestListResponse,
  FriendRequestMutationResponse,
  BlockListResponse,
  BlockMutationResponse,
  SocialInvitationListResponse,
  SocialInvitationListQuery,
  CreateSocialInvitationResponse,
  AcceptSocialInvitationResponse,
  SocialInvitationActionResponse,
  SocialNotificationListResponse,
  UnreadNotificationCountResponse,
  ReadNotificationResponse,
  MarkAllNotificationsReadResponse,
  CreateFriendRequest,
  CreateTableInvitationRequest,
  CreateChallengeRequest,
  LeaderboardQuery,
  LeaderboardResponse,
  PlayerRatingResponse,
  ProgressionSummary,
  ProgressionMissionClaimResponse,
  CreateTournamentRequest,
  TournamentDetailResponse,
  TournamentListResponse,
  TournamentSummary,
  ProgressionCosmeticRedeemResponse,
  LeagueDetail,
  LeagueListResponse,
  RescheduleLeagueMatchResponse,
} from '@truco/shared';

export class WebApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'WebApiError';
  }
}

async function requestJson<TResponse>(path: string, init?: RequestInit): Promise<TResponse> {
  const res = await fetch(path, {
    credentials: 'include',
    ...init,
    headers: {
      ...(init?.body ? { 'content-type': 'application/json' } : {}),
      ...(init?.headers ?? {}),
    },
  });

  const payload = (await res.json().catch(() => null)) as
    TResponse | { error?: { code?: string; message?: string } } | null;

  if (!res.ok) {
    const errObj =
      payload && typeof payload === 'object' && 'error' in payload ? payload.error : undefined;
    throw new WebApiError(
      res.status,
      errObj?.code ?? 'HTTP_ERROR',
      errObj?.message ?? `Error HTTP ${res.status}`,
    );
  }

  return payload as TResponse;
}

/** Estado público de los documentos legales (edad mínima y versiones vigentes). */
export async function getLegalStatusRequest(): Promise<LegalStatusResponse> {
  return requestJson<LegalStatusResponse>('/v1/legal', { method: 'GET' });
}

export async function getMeRequest(): Promise<MeResponse> {
  return requestJson<MeResponse>('/v1/me', { method: 'GET' });
}

export async function createGuestSessionRequest(deviceName?: string): Promise<AuthSessionResponse> {
  return requestJson<AuthSessionResponse>('/v1/auth/guest', {
    method: 'POST',
    body: JSON.stringify({ deviceName: deviceName ?? 'Navegador Web PWA' }),
  });
}

export async function ensureGuestOrActiveSession(): Promise<AuthUserSummary> {
  try {
    const me = await getMeRequest();
    return me.user;
  } catch (err) {
    if (err instanceof WebApiError && err.status === 401) {
      const guest = await createGuestSessionRequest();
      return guest.user;
    }
    throw err;
  }
}

export async function loginAccountRequest(body: LoginRequest): Promise<AuthSessionResponse> {
  return requestJson<AuthSessionResponse>('/v1/auth/login', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export async function registerAccountRequest(body: RegisterRequest): Promise<AuthSessionResponse> {
  return requestJson<AuthSessionResponse>('/v1/auth/register', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export async function promoteGuestAccountRequest(
  body: PromoteGuestRequest,
): Promise<AuthSessionResponse> {
  return requestJson<AuthSessionResponse>('/v1/auth/promote-guest', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export async function logoutSessionRequest(allDevices = false): Promise<NonEnumeratingAckResponse> {
  return requestJson<NonEnumeratingAckResponse>('/v1/auth/logout', {
    method: 'POST',
    body: JSON.stringify({ allDevices }),
  });
}

export async function forgotPasswordRequest(
  body: ForgotPasswordRequest,
): Promise<NonEnumeratingAckResponse> {
  return requestJson<NonEnumeratingAckResponse>('/v1/auth/forgot', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export async function resetPasswordRequest(
  body: ResetPasswordRequest,
): Promise<NonEnumeratingAckResponse> {
  return requestJson<NonEnumeratingAckResponse>('/v1/auth/reset', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export async function verifyEmailRequest(
  body: VerifyEmailRequest,
): Promise<NonEnumeratingAckResponse> {
  return requestJson<NonEnumeratingAckResponse>('/v1/auth/verify-email', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export async function resendVerificationEmailRequest(
  body: ResendVerificationRequest,
): Promise<NonEnumeratingAckResponse> {
  return requestJson<NonEnumeratingAckResponse>('/v1/auth/resend-verification', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export async function listActiveSessionsRequest(): Promise<SessionListResponse> {
  return requestJson<SessionListResponse>('/v1/auth/sessions', { method: 'GET' });
}

export async function revokeActiveSessionRequest(
  sessionId: string,
): Promise<NonEnumeratingAckResponse> {
  return requestJson<NonEnumeratingAckResponse>(
    `/v1/auth/sessions/${encodeURIComponent(sessionId)}`,
    { method: 'DELETE' },
  );
}

export async function patchMeRequest(body: PatchMeRequest): Promise<MeResponse> {
  return requestJson<MeResponse>('/v1/me', {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}

export async function exportAccountDataRequest(): Promise<AccountExportResponse> {
  return requestJson<AccountExportResponse>('/v1/me/export', { method: 'GET' });
}

export async function deleteOwnAccountRequest(password?: string): Promise<DeleteAccountResponse> {
  return requestJson<DeleteAccountResponse>('/v1/me', {
    method: 'DELETE',
    body: JSON.stringify(password ? { password } : {}),
  });
}

export async function getPublicUserProfileRequest(userId: string): Promise<PublicUserProfile> {
  return requestJson<PublicUserProfile>(`/v1/users/${encodeURIComponent(userId)}`, {
    method: 'GET',
  });
}

export async function getLeaderboardRequest(
  query: Pick<LeaderboardQuery, 'period' | 'mode' | 'limit'> & { readonly cursor?: string | null },
): Promise<LeaderboardResponse> {
  const params = new URLSearchParams({
    period: query.period,
    mode: query.mode,
    limit: String(query.limit),
  });
  if (query.cursor) params.set('cursor', query.cursor);
  return requestJson<LeaderboardResponse>(`/v1/rankings?${params.toString()}`, { method: 'GET' });
}

export async function getPlayerRatingsRequest(userId: string): Promise<PlayerRatingResponse> {
  return requestJson<PlayerRatingResponse>(`/v1/users/${encodeURIComponent(userId)}/ratings`, {
    method: 'GET',
  });
}

export async function getUserStatsRequest(userId: string): Promise<UserStatsResponse> {
  return requestJson<UserStatsResponse>(`/v1/users/${encodeURIComponent(userId)}/stats`, {
    method: 'GET',
  });
}

export interface UserHistoryFilters {
  readonly mode?: GameMode;
  readonly outcome?: 'WIN' | 'LOSS' | 'ABANDON';
  readonly bots?: 'ANY' | 'BOTS' | 'HUMANS';
}

export async function getUserMatchesRequest(
  userId: string,
  cursor?: string | null,
  limit = 10,
  filters: UserHistoryFilters = {},
): Promise<UserMatchesResponse> {
  const qs = new URLSearchParams({ limit: String(limit) });
  if (cursor) qs.set('cursor', cursor);
  if (filters.mode) qs.set('mode', filters.mode);
  if (filters.outcome) qs.set('outcome', filters.outcome);
  if (filters.bots) qs.set('bots', filters.bots);
  return requestJson<UserMatchesResponse>(
    `/v1/users/${encodeURIComponent(userId)}/matches?${qs.toString()}`,
    { method: 'GET' },
  );
}

export async function getUserMatchDetailRequest(
  userId: string,
  matchId: string,
): Promise<UserMatchDetailResponse> {
  return requestJson<UserMatchDetailResponse>(
    `/v1/users/${encodeURIComponent(userId)}/matches/${encodeURIComponent(matchId)}`,
    { method: 'GET' },
  );
}

export async function createReportRequest(
  input: CreateReportRequest,
): Promise<CreateReportResponse> {
  return requestJson<CreateReportResponse>('/v1/me/reports', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function searchPlayersRequest(
  nickname: string,
  limit = 10,
): Promise<PlayerSearchResponse> {
  const qs = new URLSearchParams({ nickname, limit: String(limit) });
  return requestJson<PlayerSearchResponse>(`/v1/social/search?${qs}`, { method: 'GET' });
}

export async function listFriendsRequest(): Promise<FriendListResponse> {
  return requestJson<FriendListResponse>('/v1/social/friends', { method: 'GET' });
}

export async function listFriendRequestsRequest(): Promise<FriendRequestListResponse> {
  return requestJson<FriendRequestListResponse>('/v1/social/friend-requests', { method: 'GET' });
}

export async function createFriendRequestRequest(
  input: CreateFriendRequest,
): Promise<FriendRequestMutationResponse> {
  return requestJson<FriendRequestMutationResponse>('/v1/social/friend-requests', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function acceptFriendRequestRequest(
  requestId: string,
): Promise<FriendRequestMutationResponse> {
  return requestJson<FriendRequestMutationResponse>(
    `/v1/social/friend-requests/${encodeURIComponent(requestId)}/accept`,
    { method: 'POST' },
  );
}

export async function declineFriendRequestRequest(
  requestId: string,
): Promise<FriendRequestMutationResponse> {
  return requestJson<FriendRequestMutationResponse>(
    `/v1/social/friend-requests/${encodeURIComponent(requestId)}/decline`,
    { method: 'POST' },
  );
}

export async function cancelFriendRequestRequest(
  requestId: string,
): Promise<FriendRequestMutationResponse> {
  return requestJson<FriendRequestMutationResponse>(
    `/v1/social/friend-requests/${encodeURIComponent(requestId)}/cancel`,
    { method: 'POST' },
  );
}

export async function removeFriendRequest(userId: string): Promise<{ removed: true }> {
  return requestJson<{ removed: true }>(`/v1/social/friends/${encodeURIComponent(userId)}`, {
    method: 'DELETE',
  });
}

export async function listBlockedUsersRequest(): Promise<BlockListResponse> {
  return requestJson<BlockListResponse>('/v1/social/blocks', { method: 'GET' });
}

export async function blockUserRequest(userId: string): Promise<BlockMutationResponse> {
  return requestJson<BlockMutationResponse>(`/v1/social/blocks/${encodeURIComponent(userId)}`, {
    method: 'POST',
  });
}

export async function unblockUserRequest(userId: string): Promise<BlockMutationResponse> {
  return requestJson<BlockMutationResponse>(`/v1/social/blocks/${encodeURIComponent(userId)}`, {
    method: 'DELETE',
  });
}

export async function createSocialTableInvitationRequest(
  input: CreateTableInvitationRequest,
): Promise<CreateSocialInvitationResponse> {
  return requestJson<CreateSocialInvitationResponse>('/v1/social/table-invitations', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function createDirectChallengeRequest(
  input: CreateChallengeRequest,
): Promise<CreateSocialInvitationResponse> {
  return requestJson<CreateSocialInvitationResponse>('/v1/social/challenges', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function listSocialInvitationsRequest(
  direction: SocialInvitationListQuery['direction'] = 'INCOMING',
): Promise<SocialInvitationListResponse> {
  const qs = new URLSearchParams({ direction });
  return requestJson<SocialInvitationListResponse>(`/v1/social/invitations?${qs}`, {
    method: 'GET',
  });
}

export async function acceptSocialInvitationRequest(
  invitationId: string,
): Promise<AcceptSocialInvitationResponse> {
  return requestJson<AcceptSocialInvitationResponse>(
    `/v1/social/invitations/${encodeURIComponent(invitationId)}/accept`,
    { method: 'POST' },
  );
}

export async function declineSocialInvitationRequest(
  invitationId: string,
): Promise<SocialInvitationActionResponse> {
  return requestJson<SocialInvitationActionResponse>(
    `/v1/social/invitations/${encodeURIComponent(invitationId)}/decline`,
    { method: 'POST' },
  );
}

export async function cancelSocialInvitationRequest(
  invitationId: string,
): Promise<SocialInvitationActionResponse> {
  return requestJson<SocialInvitationActionResponse>(
    `/v1/social/invitations/${encodeURIComponent(invitationId)}/cancel`,
    { method: 'POST' },
  );
}

export async function listSocialNotificationsRequest(
  options: { cursor?: string | null; limit?: number; unreadOnly?: boolean } = {},
): Promise<SocialNotificationListResponse> {
  const qs = new URLSearchParams({ limit: String(options.limit ?? 20) });
  if (options.cursor) qs.set('cursor', options.cursor);
  if (options.unreadOnly !== undefined) qs.set('unreadOnly', String(options.unreadOnly));
  return requestJson<SocialNotificationListResponse>(`/v1/social/notifications?${qs}`, {
    method: 'GET',
  });
}

export async function getUnreadSocialNotificationCountRequest(): Promise<UnreadNotificationCountResponse> {
  return requestJson<UnreadNotificationCountResponse>('/v1/social/notifications/unread-count', {
    method: 'GET',
  });
}

export async function markSocialNotificationReadRequest(
  notificationId: string,
): Promise<ReadNotificationResponse> {
  return requestJson<ReadNotificationResponse>(
    `/v1/social/notifications/${encodeURIComponent(notificationId)}/read`,
    { method: 'POST' },
  );
}

export async function markAllSocialNotificationsReadRequest(): Promise<MarkAllNotificationsReadResponse> {
  return requestJson<MarkAllNotificationsReadResponse>('/v1/social/notifications/read-all', {
    method: 'POST',
  });
}

export async function getMyModerationStateRequest(): Promise<MyModerationState> {
  return requestJson<MyModerationState>('/v1/me/moderation', { method: 'GET' });
}

export interface PublicLobbyFilters {
  mode?: GameMode;
  targetScore?: 15 | 30;
  flor?: boolean;
  status?: 'WAITING' | 'IN_GAME';
}

export async function listPublicTablesRequest(
  filters: PublicLobbyFilters = {},
): Promise<PublicTableListResponse> {
  const qs = new URLSearchParams();
  if (filters.mode) qs.set('mode', filters.mode);
  if (filters.targetScore) qs.set('targetScore', String(filters.targetScore));
  if (filters.flor !== undefined) qs.set('flor', String(filters.flor));
  if (filters.status) qs.set('status', filters.status);
  const suffix = qs.toString() ? `?${qs.toString()}` : '';
  return requestJson<PublicTableListResponse>(`/v1/tables${suffix}`, { method: 'GET' });
}

export async function createTableRequest(body: CreateTableRequest): Promise<TableDetailResponse> {
  return requestJson<TableDetailResponse>('/v1/tables', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export async function getTutorialProgressRequest(): Promise<TutorialProgressResponse> {
  return requestJson<TutorialProgressResponse>('/v1/me/tutorial', { method: 'GET' });
}

export async function putTutorialProgressRequest(
  body: TutorialProgressUpdateRequest,
): Promise<TutorialProgressResponse> {
  return requestJson<TutorialProgressResponse>('/v1/me/tutorial', {
    method: 'PUT',
    body: JSON.stringify(body),
  });
}

export async function getMyProgressionRequest(): Promise<ProgressionSummary> {
  return requestJson<ProgressionSummary>('/v1/me/progression', { method: 'GET' });
}

export async function claimProgressionMissionRequest(
  missionId: string,
): Promise<ProgressionMissionClaimResponse> {
  return requestJson<ProgressionMissionClaimResponse>(
    `/v1/me/progression/missions/${encodeURIComponent(missionId)}/claim`,
    { method: 'POST' },
  );
}

export async function redeemProgressionCosmeticRequest(
  cosmeticId: string,
): Promise<ProgressionCosmeticRedeemResponse> {
  return requestJson<ProgressionCosmeticRedeemResponse>(
    `/v1/me/progression/cosmetics/${encodeURIComponent(cosmeticId)}/redeem`,
    { method: 'POST' },
  );
}

export async function markProgressionNotificationReadRequest(
  notificationId: string,
): Promise<{ read: true }> {
  return requestJson<{ read: true }>(
    `/v1/me/progression/notifications/${encodeURIComponent(notificationId)}/read`,
    { method: 'POST' },
  );
}

export async function listTournamentsRequest(
  query: {
    readonly status?: readonly string[];
    readonly limit?: number;
    readonly cursor?: string | null;
  } = {},
): Promise<TournamentListResponse> {
  const qs = new URLSearchParams();
  for (const status of query.status ?? []) qs.append('status', status);
  if (query.limit !== undefined) qs.set('limit', String(query.limit));
  if (query.cursor) qs.set('cursor', query.cursor);
  const suffix = qs.toString() ? `?${qs.toString()}` : '';
  return requestJson<TournamentListResponse>(`/v1/tournaments${suffix}`, { method: 'GET' });
}

// ------------------------------------------------------------------ ligas

export async function listLeaguesRequest(
  query: {
    readonly mode?: string;
    readonly division?: string;
    readonly status?: readonly string[];
    readonly limit?: number;
    readonly cursor?: string | null;
  } = {},
): Promise<LeagueListResponse> {
  const qs = new URLSearchParams();
  if (query.mode) qs.set('mode', query.mode);
  if (query.division) qs.set('division', query.division);
  for (const status of query.status ?? []) qs.append('status', status);
  if (query.limit !== undefined) qs.set('limit', String(query.limit));
  if (query.cursor) qs.set('cursor', query.cursor);
  const suffix = qs.toString() ? `?${qs.toString()}` : '';
  return requestJson<LeagueListResponse>(`/v1/leagues${suffix}`, { method: 'GET' });
}

export async function getLeagueDetailRequest(id: string): Promise<LeagueDetail> {
  return requestJson<LeagueDetail>(`/v1/leagues/${encodeURIComponent(id)}`, { method: 'GET' });
}

export async function joinLeagueRequest(id: string): Promise<{ joined: true }> {
  return requestJson<{ joined: true }>(`/v1/leagues/${encodeURIComponent(id)}/join`, {
    method: 'POST',
  });
}

export async function leaveLeagueRequest(id: string): Promise<{ left: true }> {
  return requestJson<{ left: true }>(`/v1/leagues/${encodeURIComponent(id)}/leave`, {
    method: 'POST',
  });
}

export async function rescheduleLeagueMatchRequest(
  matchId: string,
  reason: string,
): Promise<RescheduleLeagueMatchResponse> {
  return requestJson<RescheduleLeagueMatchResponse>(
    `/v1/leagues/matches/${encodeURIComponent(matchId)}/reschedule`,
    { method: 'POST', body: JSON.stringify({ reason }) },
  );
}

export async function getTournamentDetailRequest(id: string): Promise<TournamentDetailResponse> {
  return requestJson<TournamentDetailResponse>(`/v1/tournaments/${encodeURIComponent(id)}`, {
    method: 'GET',
  });
}

export async function createTournamentRequest(body: CreateTournamentRequest): Promise<{
  tournament: TournamentSummary;
}> {
  return requestJson<{ tournament: TournamentSummary }>('/v1/tournaments', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export async function registerForTournamentRequest(id: string): Promise<{ participants: number }> {
  return requestJson<{ participants: number }>(
    `/v1/tournaments/${encodeURIComponent(id)}/register`,
    { method: 'POST' },
  );
}

/**
 * Inscripción de un equipo completo en un torneo 2v2. El capitán anota a los dos
 * integrantes juntos: o queda todo el equipo o no queda nadie.
 */
export async function registerTeamForTournamentRequest(
  id: string,
  body: { readonly name: string; readonly teammateUserId: string },
): Promise<{ teamId: string; participants: number }> {
  return requestJson<{ teamId: string; participants: number }>(
    `/v1/tournaments/${encodeURIComponent(id)}/teams`,
    {
      method: 'POST',
      body: JSON.stringify({ name: body.name, teammateUserIds: [body.teammateUserId] }),
    },
  );
}

export async function unregisterFromTournamentRequest(id: string): Promise<{ withdrawn: true }> {
  return requestJson<{ withdrawn: true }>(`/v1/tournaments/${encodeURIComponent(id)}/unregister`, {
    method: 'POST',
  });
}

export async function checkInTournamentRequest(id: string): Promise<{ checkedIn: true }> {
  return requestJson<{ checkedIn: true }>(`/v1/tournaments/${encodeURIComponent(id)}/check-in`, {
    method: 'POST',
  });
}

export async function resolveTournamentJoinCodeRequest(joinCode: string): Promise<{
  tournamentId: string;
}> {
  return requestJson<{ tournamentId: string }>('/v1/tournaments/join-by-code', {
    method: 'POST',
    body: JSON.stringify({ joinCode }),
  });
}

export async function getMyNextTournamentMatchRequest(): Promise<{
  match: TournamentDetailResponse['myNextMatch'];
  tournament: TournamentSummary | null;
}> {
  return requestJson<{
    match: TournamentDetailResponse['myNextMatch'];
    tournament: TournamentSummary | null;
  }>('/v1/tournaments/my-next-match', { method: 'GET' });
}

export async function getTableDetailRequest(tableId: string): Promise<TableDetailResponse> {
  return requestJson<TableDetailResponse>(`/v1/tables/${encodeURIComponent(tableId)}`, {
    method: 'GET',
  });
}

export async function joinPublicTableRequest(
  tableId: string,
  preferredSeat?: number,
): Promise<TableDetailResponse> {
  return requestJson<TableDetailResponse>(`/v1/tables/${encodeURIComponent(tableId)}/join`, {
    method: 'POST',
    body: JSON.stringify(preferredSeat !== undefined ? { preferredSeat } : {}),
  });
}

/**
 * Acepta tanto un código de 6 caracteres como un enlace completo con `?invite=...` o `?code=...`
 * o un token firmado de invitación.
 */
export function parseJoinInput(rawInput: string): JoinByCodeRequest {
  const trimmed = rawInput.trim();
  if (trimmed.includes('invite=') || trimmed.includes('code=') || trimmed.startsWith('http')) {
    try {
      const url = trimmed.startsWith('http')
        ? new URL(trimmed)
        : new URL(trimmed, 'http://localhost');
      const invite = url.searchParams.get('invite');
      if (invite) return { inviteToken: invite };
      const code = url.searchParams.get('code');
      if (code) return { code: code.trim().toUpperCase() };
    } catch {
      // Continuar al fallback directo
    }
  }
  if (trimmed.length > 12) {
    return { inviteToken: trimmed };
  }
  return { code: trimmed.toUpperCase() };
}

export async function joinTableByCodeRequest(
  rawCodeOrInvite: string,
): Promise<TableDetailResponse> {
  const payload = parseJoinInput(rawCodeOrInvite);
  return requestJson<TableDetailResponse>('/v1/tables/join-by-code', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function createTableInviteRequest(tableId: string): Promise<TableInviteResponse> {
  return requestJson<TableInviteResponse>(`/v1/tables/${encodeURIComponent(tableId)}/invite`, {
    method: 'POST',
  });
}

export async function leaveTableRequest(tableId: string): Promise<LeaveTableResponse> {
  return requestJson<LeaveTableResponse>(`/v1/tables/${encodeURIComponent(tableId)}/leave`, {
    method: 'POST',
  });
}

export async function deleteTableRequest(tableId: string): Promise<DeleteTableResponse> {
  return requestJson<DeleteTableResponse>(`/v1/tables/${encodeURIComponent(tableId)}`, {
    method: 'DELETE',
  });
}

export async function getMatchmakingQueueStatusRequest(): Promise<MatchmakingQueueStatusResponse> {
  return requestJson<MatchmakingQueueStatusResponse>('/v1/matchmaking/queue', { method: 'GET' });
}

export async function enqueueMatchmakingRequest(
  body: MatchmakingEnqueueRequest,
): Promise<MatchmakingQueueStatusResponse> {
  return requestJson<MatchmakingQueueStatusResponse>('/v1/matchmaking/queue', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export async function cancelMatchmakingRequest(): Promise<MatchmakingCancelResponse> {
  return requestJson<MatchmakingCancelResponse>('/v1/matchmaking/queue', { method: 'DELETE' });
}

export function decodeSessionIdFromWsTicket(ticket: string): string | null {
  try {
    const payloadB64 = ticket.split('.')[0];
    if (!payloadB64) return null;
    const normalized = payloadB64.replace(/-/g, '+').replace(/_/g, '/');
    const json = atob(normalized);
    const parsed = JSON.parse(json) as { sessionId?: unknown };
    return typeof parsed.sessionId === 'string' ? parsed.sessionId : null;
  } catch {
    return null;
  }
}

/**
 * Solicita un ticket WebSocket efímero de UN SOLO USO (`jti` único con TTL corto).
 * Debe invocarse en CADA conexión inicial y en CADA reconexión de Socket.IO.
 */
export async function mintSingleUseWsTicket(): Promise<WsTicketResponse> {
  return requestJson<WsTicketResponse>('/v1/auth/ws-ticket', {
    method: 'POST',
  });
}
