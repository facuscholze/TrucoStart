import type {
  AdminAuditListResponse,
  AdminDashboardMetrics,
  AdminMatchReplay,
  AdminPermission,
  AdminReportDetail,
  AdminReportListResponse,
  AdminRole,
  AdminSessionSummary,
  AdminUserDetail,
  AdminUserListResponse,
  ClaimReportRequest,
  CreateSanctionRequest,
  CreateSanctionResponse,
  ResolveReportRequest,
  ReportReasonCode,
  ReportStatus,
} from '@truco/shared';

export interface AdminCredentials {
  readonly email: string;
  readonly password: string;
  readonly totpCode: string;
}

export interface ReportFilters {
  readonly status?: ReportStatus | undefined;
  readonly reasonCode?: ReportReasonCode | undefined;
}

export interface AuditFilters {
  readonly action?: string | undefined;
  readonly entityId?: string | undefined;
}

export interface AdminPermissionSnapshot {
  readonly permissions: readonly AdminPermission[];
  readonly role: AdminRole;
  readonly emailMasked: string;
}

/**
 * Contrato del panel con la API. Todas las llamadas usan cookies de admin
 * (`truco_admin_access`), separadas de las de jugador, y el servidor vuelve a
 * verificar el permiso en cada endpoint.
 */
export interface AdminClient {
  login(input: AdminCredentials): Promise<AdminSessionSummary>;
  me(): Promise<AdminSessionSummary>;
  logout(): Promise<void>;
  permissions(): Promise<AdminPermissionSnapshot>;
  dashboard(): Promise<AdminDashboardMetrics>;
  listUsers(params: { query?: string }): Promise<AdminUserListResponse>;
  userDetail(userId: string, reason: string): Promise<AdminUserDetail>;
  sanctionUser(userId: string, input: CreateSanctionRequest): Promise<CreateSanctionResponse>;
  forceNicknameChange(userId: string, reason: string): Promise<{ ok: true }>;
  listReports(params: ReportFilters): Promise<AdminReportListResponse>;
  reportDetail(reportId: string): Promise<AdminReportDetail>;
  claimReport(reportId: string, input: ClaimReportRequest): Promise<{ version: number }>;
  resolveReport(
    reportId: string,
    input: ResolveReportRequest,
  ): Promise<{ status: string; version: number }>;
  replay(matchId: string, reason: string): Promise<AdminMatchReplay>;
  listAudit(params: AuditFilters): Promise<AdminAuditListResponse>;
}

export class AdminApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'AdminApiError';
  }
}

const BASE_URL = '/v1/admin';

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${BASE_URL}${path}`, {
    ...init,
    credentials: 'include',
    headers: {
      'content-type': 'application/json',
      ...(init.headers ?? {}),
    },
  });

  if (!response.ok) {
    let code = 'UNKNOWN';
    let message = `Error ${response.status}`;
    try {
      const body = (await response.json()) as { code?: string; message?: string };
      code = body.code ?? code;
      message = body.message ?? message;
    } catch {
      // El cuerpo no era JSON: se conserva el mensaje genérico.
    }
    throw new AdminApiError(response.status, code, message);
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

function withQuery(path: string, params: Record<string, string | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') search.set(key, value);
  }
  const qs = search.toString();
  return qs.length > 0 ? `${path}?${qs}` : path;
}

export const httpAdminClient: AdminClient = {
  async login(input) {
    const body = await request<{ session: AdminSessionSummary }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify(input),
    });
    return body.session;
  },
  async me() {
    const body = await request<{ session: AdminSessionSummary }>('/auth/me');
    return body.session;
  },
  async logout() {
    await request<{ ok: true }>('/auth/logout', { method: 'POST' });
  },
  permissions() {
    return request<AdminPermissionSnapshot>('/session/permissions');
  },
  dashboard() {
    return request<AdminDashboardMetrics>('/dashboard');
  },
  listUsers(params) {
    return request<AdminUserListResponse>(withQuery('/users', { query: params.query }));
  },
  userDetail(userId, reason) {
    return request<AdminUserDetail>(withQuery(`/users/${userId}`, { reason }));
  },
  sanctionUser(userId, input) {
    return request<CreateSanctionResponse>(`/users/${userId}/sanctions`, {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },
  forceNicknameChange(userId, reason) {
    return request<{ ok: true }>(`/users/${userId}/nickname-reset`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    });
  },
  listReports(params) {
    return request<AdminReportListResponse>(
      withQuery('/reports', { status: params.status, reasonCode: params.reasonCode }),
    );
  },
  reportDetail(reportId) {
    return request<AdminReportDetail>(`/reports/${reportId}`);
  },
  claimReport(reportId, input) {
    return request<{ version: number }>(`/reports/${reportId}/claim`, {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },
  resolveReport(reportId, input) {
    return request<{ status: string; version: number }>(`/reports/${reportId}/resolve`, {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },
  replay(matchId, reason) {
    return request<AdminMatchReplay>(withQuery(`/matches/${matchId}/replay`, { reason }));
  },
  listAudit(params) {
    return request<AdminAuditListResponse>(
      withQuery('/audit', { action: params.action, entityId: params.entityId }),
    );
  },
};
