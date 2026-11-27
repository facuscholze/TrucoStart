const schemaRef = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const response = (description: string, name: string) => ({
  description,
  content: { 'application/json': { schema: schemaRef(name) } },
});
const errorResponse = (description: string) => ({
  description,
  content: { 'application/json': { schema: schemaRef('ApiErrorResponse') } },
});
const body = (name: string) => ({
  required: true,
  content: { 'application/json': { schema: schemaRef(name) } },
});
const uuidPath = (name: string) => ({
  name,
  in: 'path',
  required: true,
  schema: { type: 'string', format: 'uuid' },
});
const playerSecurity = [{ accessCookie: [] }];
const adminSecurity = [{ adminAccessCookie: [] }];

export const OPENAPI_M7_SCHEMAS: Record<string, unknown> = {
  ReportReasonCode: {
    type: 'string',
    enum: ['ABANDONMENT', 'COLLUSION', 'OFFENSIVE_NICKNAME', 'ABUSIVE_BEHAVIOR', 'OTHER'],
  },
  ReportStatus: {
    type: 'string',
    enum: ['OPEN', 'IN_REVIEW', 'RESOLVED_ACTIONED', 'RESOLVED_DISMISSED'],
  },
  ReportEventLogRef: {
    type: 'object',
    required: ['matchId', 'eventCount', 'lastSeq', 'digest'],
    properties: {
      matchId: { type: 'string', format: 'uuid' },
      eventCount: { type: 'integer', minimum: 0 },
      lastSeq: { type: 'integer', minimum: 0 },
      digest: { type: 'string', minLength: 64, maxLength: 64 },
    },
  },
  CreateReportRequest: {
    type: 'object',
    additionalProperties: false,
    required: ['targetUserId', 'reasonCode'],
    properties: {
      targetUserId: { type: 'string', format: 'uuid' },
      reasonCode: schemaRef('ReportReasonCode'),
      details: { type: 'string', maxLength: 500 },
      matchId: { type: 'string', format: 'uuid' },
    },
  },
  CreateReportResponse: {
    type: 'object',
    required: ['id', 'status', 'createdAt', 'mergedWithExisting', 'eventLogRef'],
    properties: {
      id: { type: 'string', format: 'uuid' },
      status: schemaRef('ReportStatus'),
      createdAt: { type: 'string', format: 'date-time' },
      mergedWithExisting: { type: 'boolean' },
      eventLogRef: { oneOf: [schemaRef('ReportEventLogRef'), { type: 'null' }] },
    },
  },
  MyModerationState: {
    type: 'object',
    required: [
      'accountStatus',
      'statusReason',
      'statusExpiresAt',
      'mutedUntil',
      'openReportsAgainstMe',
    ],
    properties: {
      accountStatus: { type: 'string', enum: ['ACTIVE', 'SUSPENDED', 'BANNED', 'DELETED'] },
      statusReason: { type: ['string', 'null'] },
      statusExpiresAt: { type: ['string', 'null'], format: 'date-time' },
      mutedUntil: { type: ['string', 'null'], format: 'date-time' },
      openReportsAgainstMe: { type: 'integer', minimum: 0 },
    },
  },
  AdminReportListItem: {
    type: 'object',
    required: [
      'id',
      'status',
      'reasonCode',
      'createdAt',
      'reporterId',
      'reporterNickname',
      'targetId',
      'targetNickname',
      'matchId',
      'claimedBy',
      'claimedByNickname',
      'version',
      'duplicateCount',
    ],
    properties: {
      id: { type: 'string', format: 'uuid' },
      status: schemaRef('ReportStatus'),
      reasonCode: schemaRef('ReportReasonCode'),
      createdAt: { type: 'string', format: 'date-time' },
      reporterId: { type: 'string', format: 'uuid' },
      reporterNickname: { type: 'string' },
      targetId: { type: 'string', format: 'uuid' },
      targetNickname: { type: 'string' },
      matchId: { type: ['string', 'null'], format: 'uuid' },
      claimedBy: { type: ['string', 'null'], format: 'uuid' },
      claimedByNickname: { type: ['string', 'null'] },
      version: { type: 'integer', minimum: 0 },
      duplicateCount: { type: 'integer', minimum: 0 },
    },
  },
  AdminReportListResponse: {
    type: 'object',
    required: ['items', 'nextCursor', 'totals'],
    properties: {
      items: { type: 'array', items: schemaRef('AdminReportListItem') },
      nextCursor: { type: ['string', 'null'], format: 'date-time' },
      totals: {
        type: 'object',
        required: ['OPEN', 'IN_REVIEW', 'RESOLVED_ACTIONED', 'RESOLVED_DISMISSED'],
        properties: {
          OPEN: { type: 'integer', minimum: 0 },
          IN_REVIEW: { type: 'integer', minimum: 0 },
          RESOLVED_ACTIONED: { type: 'integer', minimum: 0 },
          RESOLVED_DISMISSED: { type: 'integer', minimum: 0 },
        },
      },
    },
  },
  AdminReportDetail: {
    type: 'object',
    required: ['report', 'target', 'replayAvailable'],
    properties: {
      report: {
        allOf: [
          schemaRef('AdminReportListItem'),
          {
            type: 'object',
            required: [
              'details',
              'resolutionNote',
              'resolvedByNickname',
              'resolvedAt',
              'eventLogRef',
            ],
            properties: {
              details: { type: ['string', 'null'] },
              resolutionNote: { type: ['string', 'null'] },
              resolvedByNickname: { type: ['string', 'null'] },
              resolvedAt: { type: ['string', 'null'], format: 'date-time' },
              eventLogRef: { oneOf: [schemaRef('ReportEventLogRef'), { type: 'null' }] },
            },
          },
        ],
      },
      target: {
        type: 'object',
        required: [
          'id',
          'nickname',
          'status',
          'statusReason',
          'statusExpiresAt',
          'mutedUntil',
          'sanctionsCount',
          'openReportsAgainst',
        ],
        properties: {
          id: { type: 'string', format: 'uuid' },
          nickname: { type: 'string' },
          status: { type: 'string', enum: ['ACTIVE', 'SUSPENDED', 'BANNED', 'DELETED'] },
          statusReason: { type: ['string', 'null'] },
          statusExpiresAt: { type: ['string', 'null'], format: 'date-time' },
          mutedUntil: { type: ['string', 'null'], format: 'date-time' },
          sanctionsCount: { type: 'integer', minimum: 0 },
          openReportsAgainst: { type: 'integer', minimum: 0 },
        },
      },
      replayAvailable: { type: 'boolean' },
    },
  },
  ClaimReportRequest: {
    type: 'object',
    additionalProperties: false,
    required: ['expectedVersion'],
    properties: { expectedVersion: { type: 'integer', minimum: 0 } },
  },
  ResolveReportRequest: {
    type: 'object',
    additionalProperties: false,
    required: ['outcome', 'note', 'expectedVersion'],
    properties: {
      outcome: { type: 'string', enum: ['RESOLVED_ACTIONED', 'RESOLVED_DISMISSED'] },
      note: { type: 'string', minLength: 10, maxLength: 500 },
      expectedVersion: { type: 'integer', minimum: 0 },
    },
  },
  AdminReportClaimResponse: {
    type: 'object',
    required: ['version'],
    properties: { version: { type: 'integer', minimum: 0 } },
  },
  AdminReportResolveResponse: {
    type: 'object',
    required: ['status', 'version'],
    properties: {
      status: { type: 'string', enum: ['RESOLVED_ACTIONED', 'RESOLVED_DISMISSED'] },
      version: { type: 'integer', minimum: 0 },
    },
  },
  AdminReplayEvent: {
    type: 'object',
    required: ['seq', 'type', 'payload', 'at'],
    properties: {
      seq: { type: 'integer', minimum: 1 },
      type: { type: 'string' },
      payload: { type: 'object', additionalProperties: true },
      at: { type: 'string', format: 'date-time' },
    },
  },
  AdminMatchReplay: {
    type: 'object',
    required: [
      'matchId',
      'mode',
      'rulesetCode',
      'startedAt',
      'endedAt',
      'result',
      'players',
      'events',
      'reconstructed',
    ],
    properties: {
      matchId: { type: 'string', format: 'uuid' },
      mode: { type: 'string', enum: ['1v1', '2v2', '3v3'] },
      rulesetCode: { type: 'string' },
      startedAt: { type: 'string', format: 'date-time' },
      endedAt: { type: ['string', 'null'], format: 'date-time' },
      result: { oneOf: [{ type: 'object', additionalProperties: true }, { type: 'null' }] },
      players: {
        type: 'array',
        items: {
          type: 'object',
          required: ['userId', 'nickname', 'seat', 'team', 'outcome'],
          properties: {
            userId: { type: 'string', format: 'uuid' },
            nickname: { type: 'string' },
            seat: { type: 'integer', minimum: 0 },
            team: { type: 'integer', minimum: 0 },
            outcome: { type: 'string', enum: ['WIN', 'LOSS', 'DRAW', 'ABANDONED'] },
          },
        },
      },
      events: { type: 'array', items: schemaRef('AdminReplayEvent') },
      reconstructed: {
        type: 'object',
        required: ['handsPlayed', 'finalScores', 'lastEventType', 'valid', 'note'],
        properties: {
          handsPlayed: { type: 'integer', minimum: 0 },
          finalScores: { type: 'object', additionalProperties: { type: 'number' } },
          lastEventType: { type: ['string', 'null'] },
          valid: { type: 'boolean' },
          note: { type: ['string', 'null'] },
        },
      },
    },
  },
};

export const OPENAPI_M7_PATHS: Record<string, unknown> = {
  '/me/reports': {
    post: {
      tags: ['Moderation'],
      summary: 'Reportar a otro jugador para revisión humana',
      description:
        'El reporte adjunta una referencia de eventos cuando se informa una partida propia. No aplica sanciones automáticamente.',
      security: playerSecurity,
      requestBody: body('CreateReportRequest'),
      responses: {
        201: response('Reporte creado o fusionado con uno activo', 'CreateReportResponse'),
        400: errorResponse('Datos inválidos o autorreporte'),
        401: errorResponse('Sesión requerida o expirada'),
        403: errorResponse('La partida adjunta no pertenece al usuario'),
        404: errorResponse('Jugador reportado inexistente'),
        409: errorResponse('Máximo de reportes abiertos alcanzado'),
        429: errorResponse('Límite de reportes por cuenta superado'),
      },
    },
  },
  '/me/moderation': {
    get: {
      tags: ['Moderation'],
      summary: 'Consultar estado de moderación de la propia cuenta',
      security: playerSecurity,
      responses: {
        200: response(
          'Estado vigente de cuenta y conteo de reportes abiertos recibidos',
          'MyModerationState',
        ),
        401: errorResponse('Sesión requerida o expirada'),
        404: errorResponse('Cuenta no encontrada'),
      },
    },
  },
  '/admin/reports': {
    get: {
      tags: ['Admin moderation'],
      summary: 'Listar reportes con filtros, paginación y totales por estado',
      description: 'Requiere la sesión administrativa y el permiso reports:read.',
      security: adminSecurity,
      parameters: [
        {
          name: 'status',
          in: 'query',
          required: false,
          schema: {
            type: 'string',
            enum: ['OPEN', 'IN_REVIEW', 'RESOLVED_ACTIONED', 'RESOLVED_DISMISSED'],
          },
        },
        {
          name: 'reasonCode',
          in: 'query',
          required: false,
          schema: {
            type: 'string',
            enum: ['ABANDONMENT', 'COLLUSION', 'OFFENSIVE_NICKNAME', 'ABUSIVE_BEHAVIOR', 'OTHER'],
          },
        },
        {
          name: 'cursor',
          in: 'query',
          required: false,
          description: 'createdAt ISO-8601 de la última fila de la página anterior.',
          schema: { type: 'string', maxLength: 64 },
        },
        {
          name: 'limit',
          in: 'query',
          required: false,
          schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
        },
      ],
      responses: {
        200: response(
          'Página de reportes y totales globales por estado',
          'AdminReportListResponse',
        ),
        400: errorResponse('Filtro o límite inválido'),
        401: errorResponse('Sesión administrativa requerida'),
        403: errorResponse('Falta el permiso reports:read'),
      },
    },
  },
  '/admin/reports/{reportId}': {
    get: {
      tags: ['Admin moderation'],
      summary: 'Consultar detalle y disponibilidad de replay de un reporte',
      security: adminSecurity,
      parameters: [uuidPath('reportId')],
      responses: {
        200: response('Detalle del reporte y del jugador reportado', 'AdminReportDetail'),
        401: errorResponse('Sesión administrativa requerida'),
        403: errorResponse('Falta el permiso reports:read'),
        404: errorResponse('Reporte o jugador reportado inexistente'),
      },
    },
  },
  '/admin/reports/{reportId}/claim': {
    post: {
      tags: ['Admin moderation'],
      summary: 'Tomar un reporte para revisión con control optimista de versión',
      security: adminSecurity,
      parameters: [uuidPath('reportId')],
      requestBody: body('ClaimReportRequest'),
      responses: {
        200: response('Reporte asignado; versión incrementada', 'AdminReportClaimResponse'),
        400: errorResponse('expectedVersion inválida'),
        401: errorResponse('Sesión administrativa requerida'),
        403: errorResponse('Falta el permiso reports:claim'),
        409: errorResponse('El reporte cambió de estado o de versión'),
      },
    },
  },
  '/admin/reports/{reportId}/resolve': {
    post: {
      tags: ['Admin moderation'],
      summary: 'Registrar la decisión humana auditada sobre un reporte',
      security: adminSecurity,
      parameters: [uuidPath('reportId')],
      requestBody: body('ResolveReportRequest'),
      responses: {
        200: response('Decisión registrada; versión incrementada', 'AdminReportResolveResponse'),
        400: errorResponse('Resultado, nota o versión inválidos'),
        401: errorResponse('Sesión administrativa requerida'),
        403: errorResponse('Falta el permiso reports:resolve'),
        409: errorResponse('El reporte cambió de estado o de versión'),
      },
    },
  },
  '/admin/matches/{matchId}/replay': {
    get: {
      tags: ['Admin moderation'],
      summary: 'Consultar replay de una partida terminada para revisión humana',
      description:
        'Cada acceso queda auditado. La consulta sólo está disponible para una cuenta administrativa con permiso matches:replay y requiere motivo.',
      security: adminSecurity,
      parameters: [
        uuidPath('matchId'),
        {
          name: 'reason',
          in: 'query',
          required: true,
          schema: { type: 'string', minLength: 10, maxLength: 500 },
        },
      ],
      responses: {
        200: response('Replay filtrado de una partida terminada', 'AdminMatchReplay'),
        400: errorResponse('Motivo de acceso inválido'),
        401: errorResponse('Sesión administrativa requerida'),
        403: errorResponse('Falta el permiso matches:replay'),
        404: errorResponse('Partida inexistente'),
        409: errorResponse('La partida sigue en curso'),
      },
    },
  },
};
