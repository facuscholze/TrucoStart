import type {
  AccountExportResponse,
  AuthSessionResponse,
  AuthUserSummary,
  CreateTableRequest,
  DeleteAccountResponse,
  DeleteTableResponse,
  ForgotPasswordRequest,
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

export async function getUserStatsRequest(userId: string): Promise<UserStatsResponse> {
  return requestJson<UserStatsResponse>(`/v1/users/${encodeURIComponent(userId)}/stats`, {
    method: 'GET',
  });
}

export async function getUserMatchesRequest(
  userId: string,
  cursor?: string | null,
  limit = 10,
): Promise<UserMatchesResponse> {
  const qs = new URLSearchParams({ limit: String(limit) });
  if (cursor) qs.set('cursor', cursor);
  return requestJson<UserMatchesResponse>(
    `/v1/users/${encodeURIComponent(userId)}/matches?${qs.toString()}`,
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

export async function getMyModerationStateRequest(): Promise<MyModerationState> {
  return requestJson<MyModerationState>('/v1/me/moderation', { method: 'GET' });
}

export interface PublicLobbyFilters {
  mode?: '1v1' | '2v2';
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
