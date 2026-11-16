import type {
  AuthSessionResponse,
  AuthUserSummary,
  CreateTableRequest,
  MeResponse,
  TableDetailResponse,
  WsTicketResponse,
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

export async function ensureGuestOrActiveSession(): Promise<AuthUserSummary> {
  try {
    const me = await requestJson<MeResponse>('/v1/me', { method: 'GET' });
    return me.user;
  } catch (err) {
    if (err instanceof WebApiError && err.status === 401) {
      const guest = await requestJson<AuthSessionResponse>('/v1/auth/guest', {
        method: 'POST',
        body: JSON.stringify({ deviceName: 'Navegador Web PWA' }),
      });
      return guest.user;
    }
    throw err;
  }
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

export async function createTableRequest(body: CreateTableRequest): Promise<TableDetailResponse> {
  return requestJson<TableDetailResponse>('/v1/tables', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export async function joinTableByCodeRequest(code: string): Promise<TableDetailResponse> {
  return requestJson<TableDetailResponse>('/v1/tables/join-by-code', {
    method: 'POST',
    body: JSON.stringify({ code: code.trim().toUpperCase() }),
  });
}
