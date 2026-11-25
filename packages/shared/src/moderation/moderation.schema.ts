import { z } from 'zod';

/** Motivos de reporte habilitados en la mesa, el resultado y el perfil. */
export const ReportReasonCodeSchema = z.enum([
  'ABANDONMENT',
  'COLLUSION',
  'OFFENSIVE_NICKNAME',
  'ABUSIVE_BEHAVIOR',
  'OTHER',
]);
export type ReportReasonCode = z.infer<typeof ReportReasonCodeSchema>;

export const REPORT_REASON_LABELS_ES_AR: Readonly<Record<ReportReasonCode, string>> = Object.freeze(
  {
    ABANDONMENT: 'Abandono reiterado',
    COLLUSION: 'Sospecha de colusión o señas fuera del sistema',
    OFFENSIVE_NICKNAME: 'Apodo ofensivo',
    ABUSIVE_BEHAVIOR: 'Comportamiento abusivo',
    OTHER: 'Otro',
  },
);

export const ReportStatusSchema = z.enum([
  'OPEN',
  'IN_REVIEW',
  'RESOLVED_ACTIONED',
  'RESOLVED_DISMISSED',
]);
export type ReportStatus = z.infer<typeof ReportStatusSchema>;

export const REPORT_STATUS_LABELS_ES_AR: Readonly<Record<ReportStatus, string>> = Object.freeze({
  OPEN: 'Abierto',
  IN_REVIEW: 'En revisión',
  RESOLVED_ACTIONED: 'Resuelto con sanción',
  RESOLVED_DISMISSED: 'Resuelto sin sanción',
});

/** Referencia al log de eventos de la partida que se adjunta automáticamente al reporte. */
export const ReportEventLogRefSchema = z.object({
  matchId: z.string().uuid(),
  /** Cantidad de eventos persistidos en `match_events` al momento del reporte. */
  eventCount: z.number().int().nonnegative(),
  /** `seq` del último evento incluido. */
  lastSeq: z.number().int().nonnegative(),
  /** Hash del conjunto de eventos, para detectar manipulación posterior. */
  digest: z.string().length(64),
});
export type ReportEventLogRef = z.infer<typeof ReportEventLogRefSchema>;

export const CreateReportRequestSchema = z
  .object({
    targetUserId: z.string().uuid(),
    reasonCode: ReportReasonCodeSchema,
    details: z.string().trim().max(500).optional(),
    matchId: z.string().uuid().optional(),
  })
  .strict();
export type CreateReportRequest = z.infer<typeof CreateReportRequestSchema>;

export const CreateReportResponseSchema = z.object({
  id: z.string().uuid(),
  status: ReportStatusSchema,
  createdAt: z.string(),
  /** `true` cuando el reporte se fusionó con uno idéntico ya abierto (anti-duplicados). */
  mergedWithExisting: z.boolean(),
  eventLogRef: ReportEventLogRefSchema.nullable(),
});
export type CreateReportResponse = z.infer<typeof CreateReportResponseSchema>;

/** Estado de moderación de la propia cuenta (lo consume la web y el game-server). */
export const MyModerationStateSchema = z.object({
  accountStatus: z.enum(['ACTIVE', 'SUSPENDED', 'BANNED', 'DELETED']),
  statusReason: z.string().nullable(),
  statusExpiresAt: z.string().nullable(),
  mutedUntil: z.string().nullable(),
  openReportsAgainstMe: z.number().int().nonnegative(),
});
export type MyModerationState = z.infer<typeof MyModerationStateSchema>;

/** Respuesta interna (`/v1/internal/moderation/:userId`) que consume el game-server. */
export const ModerationSnapshotSchema = z.object({
  accountStatus: z.enum(['ACTIVE', 'SUSPENDED', 'BANNED', 'DELETED']),
  statusReason: z.string().nullable(),
  statusExpiresAt: z.string().nullable(),
  mutedUntil: z.string().nullable(),
});
export type ModerationSnapshot = z.infer<typeof ModerationSnapshotSchema>;

export const INTERNAL_SECRET_HEADER = 'x-internal-secret';

export const REPORT_LIMITS = Object.freeze({
  /** Máximo de reportes abiertos por cuenta. */
  maxOpenReportsPerReporter: 10,
  /** Ventana de deduplicación por (denunciante, denunciado, motivo, partida). */
  dedupeWindowHours: 24,
  /** Reportes permitidos por ventana de rate limit. */
  reportsPerWindow: 5,
  rateLimitWindowMs: 60 * 60 * 1000,
});

/* -------------------------------------------------------------------------- */
/* Administración: roles, permisos y sesiones                                  */
/* -------------------------------------------------------------------------- */

export const AdminRoleSchema = z.enum(['SUPPORT', 'MODERATOR', 'ADMIN']);
export type AdminRole = z.infer<typeof AdminRoleSchema>;

export const AdminPermissionSchema = z.enum([
  'dashboard:read',
  'users:read',
  'users:read_pii',
  'reports:read',
  'reports:claim',
  'reports:resolve',
  'sanctions:issue',
  'sanctions:issue_ban',
  'nickname:force_change',
  'matches:replay',
  'competitive:review',
  'audit:read',
  'admins:manage',
  'gamification:configure',
]);
export type AdminPermission = z.infer<typeof AdminPermissionSchema>;

/**
 * Matriz de roles y permisos (única fuente de verdad, compartida por API y panel).
 * La API valida esta matriz en cada endpoint: la UI solo la usa para pintar el menú.
 */
export const ADMIN_ROLE_PERMISSIONS: Readonly<Record<AdminRole, readonly AdminPermission[]>> =
  Object.freeze({
    SUPPORT: Object.freeze([
      'dashboard:read',
      'users:read',
      'reports:read',
      'reports:claim',
      'audit:read',
    ] as const),
    MODERATOR: Object.freeze([
      'dashboard:read',
      'users:read',
      'reports:read',
      'reports:claim',
      'reports:resolve',
      'sanctions:issue',
      'nickname:force_change',
      'matches:replay',
      'competitive:review',
      'audit:read',
    ] as const),
    ADMIN: Object.freeze([
      'dashboard:read',
      'users:read',
      'users:read_pii',
      'reports:read',
      'reports:claim',
      'reports:resolve',
      'sanctions:issue',
      'sanctions:issue_ban',
      'nickname:force_change',
      'matches:replay',
      'competitive:review',
      'audit:read',
      'admins:manage',
      'gamification:configure',
    ] as const),
  });

export function adminRoleHasPermission(role: AdminRole, permission: AdminPermission): boolean {
  return ADMIN_ROLE_PERMISSIONS[role].includes(permission);
}

export const ADMIN_SESSION_COOKIE_NAME = 'truco_admin_access';
export const ADMIN_SESSION_TTL_SECONDS = 30 * 60;

const TotpCodeSchema = z
  .string()
  .trim()
  .regex(/^\d{6}$/, 'El código 2FA debe tener 6 dígitos');

export const AdminLoginRequestSchema = z
  .object({
    email: z.string().trim().email().max(254),
    password: z.string().min(8).max(200),
    totpCode: TotpCodeSchema,
  })
  .strict();
export type AdminLoginRequest = z.infer<typeof AdminLoginRequestSchema>;

export const AdminSessionSummarySchema = z.object({
  userId: z.string().uuid(),
  nickname: z.string(),
  role: AdminRoleSchema,
  permissions: z.array(AdminPermissionSchema),
  /** Email enmascarado salvo permiso explícito `users:read_pii`. */
  emailMasked: z.string(),
  expiresAt: z.string(),
  twoFactorEnabled: z.boolean(),
});
export type AdminSessionSummary = z.infer<typeof AdminSessionSummarySchema>;

export const AdminLoginResponseSchema = z.object({
  session: AdminSessionSummarySchema,
});
export type AdminLoginResponse = z.infer<typeof AdminLoginResponseSchema>;

/* -------------------------------------------------------------------------- */
/* Administración: dashboard, usuarios, reportes, sanciones, auditoría         */
/* -------------------------------------------------------------------------- */

export const AdminDashboardMetricsSchema = z.object({
  activeUsers24h: z.number().int().nonnegative(),
  usersTotal: z.number().int().nonnegative(),
  matchesInProgress: z.number().int().nonnegative(),
  matchesFinished24h: z.number().int().nonnegative(),
  openReports: z.number().int().nonnegative(),
  reportsResolved24h: z.number().int().nonnegative(),
  sanctionsActive: z.number().int().nonnegative(),
  generatedAt: z.string(),
});
export type AdminDashboardMetrics = z.infer<typeof AdminDashboardMetricsSchema>;

export const AdminUserListItemSchema = z.object({
  id: z.string().uuid(),
  nickname: z.string(),
  emailMasked: z.string().nullable(),
  role: z.enum(['PLAYER', 'SUPPORT', 'MODERATOR', 'ADMIN']),
  status: z.enum(['ACTIVE', 'SUSPENDED', 'BANNED', 'DELETED']),
  statusReason: z.string().nullable(),
  statusExpiresAt: z.string().nullable(),
  mutedUntil: z.string().nullable(),
  isGuest: z.boolean(),
  createdAt: z.string(),
  lastSeenAt: z.string().nullable(),
  openReportsAgainst: z.number().int().nonnegative(),
});
export type AdminUserListItem = z.infer<typeof AdminUserListItemSchema>;

export const AdminUserListResponseSchema = z.object({
  items: z.array(AdminUserListItemSchema),
  nextCursor: z.string().nullable(),
});
export type AdminUserListResponse = z.infer<typeof AdminUserListResponseSchema>;

export const SanctionTypeSchema = z.enum(['WARNING', 'MUTE', 'SUSPEND', 'BAN']);
export type SanctionType = z.infer<typeof SanctionTypeSchema>;

export const SANCTION_TYPE_LABELS_ES_AR: Readonly<Record<SanctionType, string>> = Object.freeze({
  WARNING: 'Advertencia',
  MUTE: 'Silencio',
  SUSPEND: 'Suspensión temporal',
  BAN: 'Bloqueo permanente',
});

export const SanctionItemSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  type: SanctionTypeSchema,
  reason: z.string(),
  reportId: z.string().uuid().nullable(),
  issuedBy: z.string().uuid().nullable(),
  issuedByNickname: z.string().nullable(),
  expiresAt: z.string().nullable(),
  createdAt: z.string(),
  revokedAt: z.string().nullable(),
});
export type SanctionItem = z.infer<typeof SanctionItemSchema>;

export const AdminUserDetailSchema = AdminUserListItemSchema.extend({
  email: z.string().nullable(),
  bio: z.string(),
  sanctions: z.array(SanctionItemSchema),
  recentMatches: z.array(
    z.object({
      matchId: z.string().uuid(),
      mode: z.enum(['1v1', '2v2']),
      outcome: z.enum(['WIN', 'LOSS', 'DRAW', 'ABANDONED']),
      endedAt: z.string().nullable(),
    }),
  ),
});
export type AdminUserDetail = z.infer<typeof AdminUserDetailSchema>;

export const CreateSanctionRequestSchema = z
  .object({
    type: SanctionTypeSchema,
    reason: z.string().trim().min(10).max(500),
    reportId: z.string().uuid().optional(),
    /** Obligatorio para MUTE, SUSPEND y BAN. */
    durationHours: z
      .number()
      .int()
      .min(1)
      .max(24 * 365)
      .optional(),
    forceNicknameChange: z.boolean().optional(),
  })
  .strict()
  .refine((value) => value.type === 'WARNING' || value.durationHours !== undefined, {
    message: 'Las sanciones de silencio, suspensión y bloqueo requieren vencimiento',
    path: ['durationHours'],
  });
export type CreateSanctionRequest = z.infer<typeof CreateSanctionRequestSchema>;

export const CreateSanctionResponseSchema = z.object({
  sanction: SanctionItemSchema,
  appliedStatus: z.enum(['ACTIVE', 'SUSPENDED', 'BANNED']),
  mutedUntil: z.string().nullable(),
  sessionsRevoked: z.number().int().nonnegative(),
});
export type CreateSanctionResponse = z.infer<typeof CreateSanctionResponseSchema>;

export const AdminReportListItemSchema = z.object({
  id: z.string().uuid(),
  status: ReportStatusSchema,
  reasonCode: ReportReasonCodeSchema,
  createdAt: z.string(),
  reporterId: z.string().uuid(),
  reporterNickname: z.string(),
  targetId: z.string().uuid(),
  targetNickname: z.string(),
  matchId: z.string().uuid().nullable(),
  claimedBy: z.string().uuid().nullable(),
  claimedByNickname: z.string().nullable(),
  version: z.number().int().nonnegative(),
  duplicateCount: z.number().int().nonnegative(),
});
export type AdminReportListItem = z.infer<typeof AdminReportListItemSchema>;

export const AdminReportListResponseSchema = z.object({
  items: z.array(AdminReportListItemSchema),
  nextCursor: z.string().nullable(),
  totals: z.object({
    OPEN: z.number().int().nonnegative(),
    IN_REVIEW: z.number().int().nonnegative(),
    RESOLVED_ACTIONED: z.number().int().nonnegative(),
    RESOLVED_DISMISSED: z.number().int().nonnegative(),
  }),
});
export type AdminReportListResponse = z.infer<typeof AdminReportListResponseSchema>;

export const AdminReportDetailSchema = z.object({
  report: AdminReportListItemSchema.extend({
    details: z.string().nullable(),
    resolutionNote: z.string().nullable(),
    resolvedByNickname: z.string().nullable(),
    resolvedAt: z.string().nullable(),
    eventLogRef: ReportEventLogRefSchema.nullable(),
  }),
  target: z.object({
    id: z.string().uuid(),
    nickname: z.string(),
    status: z.enum(['ACTIVE', 'SUSPENDED', 'BANNED', 'DELETED']),
    statusReason: z.string().nullable(),
    statusExpiresAt: z.string().nullable(),
    mutedUntil: z.string().nullable(),
    sanctionsCount: z.number().int().nonnegative(),
    openReportsAgainst: z.number().int().nonnegative(),
  }),
  /** `true` si el reporte puede auditarse con replay (partida terminada con eventos). */
  replayAvailable: z.boolean(),
});
export type AdminReportDetail = z.infer<typeof AdminReportDetailSchema>;

export const ResolveReportRequestSchema = z
  .object({
    outcome: z.enum(['RESOLVED_ACTIONED', 'RESOLVED_DISMISSED']),
    note: z.string().trim().min(10).max(500),
    /** Versión leída por el moderador: si cambió, otro resolvió el reporte (409). */
    expectedVersion: z.number().int().nonnegative(),
  })
  .strict();
export type ResolveReportRequest = z.infer<typeof ResolveReportRequestSchema>;

export const ClaimReportRequestSchema = z
  .object({ expectedVersion: z.number().int().nonnegative() })
  .strict();
export type ClaimReportRequest = z.infer<typeof ClaimReportRequestSchema>;

export const AdminReplayEventSchema = z.object({
  seq: z.number().int().positive(),
  type: z.string(),
  payload: z.record(z.string(), z.unknown()),
  at: z.string(),
});
export type AdminReplayEvent = z.infer<typeof AdminReplayEventSchema>;

export const AdminMatchReplaySchema = z.object({
  matchId: z.string().uuid(),
  mode: z.enum(['1v1', '2v2']),
  rulesetCode: z.string(),
  startedAt: z.string(),
  endedAt: z.string().nullable(),
  result: z.record(z.string(), z.unknown()).nullable(),
  players: z.array(
    z.object({
      userId: z.string().uuid(),
      nickname: z.string(),
      seat: z.number().int().nonnegative(),
      team: z.number().int().nonnegative(),
      outcome: z.enum(['WIN', 'LOSS', 'DRAW', 'ABANDONED']),
    }),
  ),
  events: z.array(AdminReplayEventSchema),
  /** Resumen reconstruido con `@truco/engine` a partir de `match_events`. */
  reconstructed: z.object({
    handsPlayed: z.number().int().nonnegative(),
    finalScores: z.record(z.string(), z.number()),
    lastEventType: z.string().nullable(),
    valid: z.boolean(),
    note: z.string().nullable(),
  }),
});
export type AdminMatchReplay = z.infer<typeof AdminMatchReplaySchema>;

export const AdminAuditEntrySchema = z.object({
  id: z.string().uuid(),
  actorId: z.string().uuid().nullable(),
  actorNickname: z.string().nullable(),
  action: z.string(),
  entity: z.string(),
  entityId: z.string().nullable(),
  reason: z.string().nullable(),
  ip: z.string().nullable(),
  createdAt: z.string(),
  beforeState: z.record(z.string(), z.unknown()).nullable(),
  afterState: z.record(z.string(), z.unknown()).nullable(),
});
export type AdminAuditEntry = z.infer<typeof AdminAuditEntrySchema>;

export const AdminAuditListResponseSchema = z.object({
  items: z.array(AdminAuditEntrySchema),
  nextCursor: z.string().nullable(),
});
export type AdminAuditListResponse = z.infer<typeof AdminAuditListResponseSchema>;

/** Enmascara un email conservando el dominio: `juan.perez@mail.com` → `j***z@mail.com`. */
export function maskEmail(email: string | null): string | null {
  if (!email) return null;
  const [local, domain] = email.split('@');
  if (!local || !domain) return '***';
  const visibleStart = local.slice(0, 1);
  const visibleEnd = local.length > 2 ? local.slice(-1) : '';
  return `${visibleStart}***${visibleEnd}@${domain}`;
}
