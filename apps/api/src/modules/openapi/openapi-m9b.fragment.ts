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
const adminSecurity = [{ adminAccessCookie: [] }];

export const OPENAPI_M9B_SCHEMAS: Record<string, unknown> = {
  RankingPeriod: { type: 'string', enum: ['GLOBAL', 'WEEKLY', 'MONTHLY'] },
  RatingDivision: { type: 'string', enum: ['Bronce', 'Plata', 'Oro', 'Diamante'] },
  LeaderboardEntry: {
    type: 'object',
    required: [
      'position',
      'userId',
      'nickname',
      'score',
      'rating',
      'division',
      'matchesPlayed',
      'opponentsCount',
      'wins',
    ],
    properties: {
      position: { type: 'integer', minimum: 1 },
      userId: { type: 'string', format: 'uuid' },
      nickname: { type: 'string', minLength: 1, maxLength: 32 },
      score: { type: 'number' },
      rating: { type: 'number', minimum: 0 },
      division: schemaRef('RatingDivision'),
      matchesPlayed: { type: 'integer', minimum: 0 },
      opponentsCount: { type: 'integer', minimum: 0 },
      wins: { type: 'integer', minimum: 0 },
    },
  },
  LeaderboardResponse: {
    type: 'object',
    required: [
      'period',
      'mode',
      'season',
      'minimumMatches',
      'minimumOpponents',
      'items',
      'nextCursor',
      'generatedAt',
    ],
    properties: {
      period: schemaRef('RankingPeriod'),
      mode: { type: 'string', enum: ['1v1', '2v2'] },
      season: {
        type: 'object',
        required: ['id', 'label', 'startsAt', 'endsAt', 'secondsUntilReset'],
        properties: {
          id: { type: 'string', format: 'uuid' },
          label: { type: 'string' },
          startsAt: { type: 'string', format: 'date-time' },
          endsAt: { type: 'string', format: 'date-time' },
          secondsUntilReset: { type: 'integer', minimum: 0 },
        },
      },
      minimumMatches: { type: 'integer', minimum: 0 },
      minimumOpponents: { type: 'integer', minimum: 0 },
      items: { type: 'array', items: schemaRef('LeaderboardEntry') },
      nextCursor: { type: ['string', 'null'] },
      generatedAt: { type: 'string', format: 'date-time' },
    },
  },
  PlayerRatingProfile: {
    type: 'object',
    required: [
      'seasonId',
      'seasonLabel',
      'seasonEndsAt',
      'mode',
      'rating',
      'deviation',
      'division',
      'position',
      'matchesPlayed',
      'opponentsCount',
      'wins',
      'losses',
      'abandons',
      'qualifies',
    ],
    properties: {
      seasonId: { type: 'string', format: 'uuid' },
      seasonLabel: { type: 'string' },
      seasonEndsAt: { type: 'string', format: 'date-time' },
      mode: { type: 'string', enum: ['1v1', '2v2'] },
      rating: { type: 'number', minimum: 0 },
      deviation: { type: 'number', minimum: 30, maximum: 350 },
      division: schemaRef('RatingDivision'),
      position: { type: ['integer', 'null'], minimum: 1 },
      matchesPlayed: { type: 'integer', minimum: 0 },
      opponentsCount: { type: 'integer', minimum: 0 },
      wins: { type: 'integer', minimum: 0 },
      losses: { type: 'integer', minimum: 0 },
      abandons: { type: 'integer', minimum: 0 },
      qualifies: { type: 'boolean' },
    },
  },
  PlayerRatingResponse: {
    type: 'object',
    required: ['ratings'],
    properties: {
      ratings: {
        type: 'array',
        minItems: 2,
        maxItems: 2,
        items: schemaRef('PlayerRatingProfile'),
      },
    },
  },
  CompetitiveReviewStatus: { type: 'string', enum: ['OPEN', 'IN_REVIEW', 'RESOLVED'] },
  CompetitiveReviewCase: {
    type: 'object',
    required: [
      'id',
      'status',
      'severity',
      'signals',
      'users',
      'matchIds',
      'evidence',
      'createdAt',
      'updatedAt',
      'claimedByNickname',
      'resolvedByNickname',
      'resolutionNote',
      'version',
    ],
    properties: {
      id: { type: 'string', format: 'uuid' },
      status: schemaRef('CompetitiveReviewStatus'),
      severity: { type: 'string', enum: ['LOW', 'MEDIUM', 'HIGH'] },
      signals: { type: 'array', items: { type: 'string' } },
      users: {
        type: 'array',
        items: {
          type: 'object',
          required: ['id', 'nickname', 'accountCreatedAt'],
          properties: {
            id: { type: 'string', format: 'uuid' },
            nickname: { type: 'string' },
            accountCreatedAt: { type: ['string', 'null'], format: 'date-time' },
          },
        },
      },
      matchIds: { type: 'array', items: { type: 'string', format: 'uuid' } },
      evidence: { type: 'object', additionalProperties: true },
      createdAt: { type: 'string', format: 'date-time' },
      updatedAt: { type: 'string', format: 'date-time' },
      claimedByNickname: { type: ['string', 'null'] },
      resolvedByNickname: { type: ['string', 'null'] },
      resolutionNote: { type: ['string', 'null'] },
      version: { type: 'integer', minimum: 0 },
    },
  },
  CompetitiveReviewListResponse: {
    type: 'object',
    required: ['items', 'nextCursor'],
    properties: {
      items: { type: 'array', items: schemaRef('CompetitiveReviewCase') },
      nextCursor: { type: ['string', 'null'] },
    },
  },
  CompetitiveReviewClaimRequest: {
    type: 'object',
    additionalProperties: false,
    required: ['expectedVersion'],
    properties: { expectedVersion: { type: 'integer', minimum: 0 } },
  },
  CompetitiveReviewResolveRequest: {
    type: 'object',
    additionalProperties: false,
    required: ['expectedVersion', 'resolutionNote'],
    properties: {
      expectedVersion: { type: 'integer', minimum: 0 },
      resolutionNote: { type: 'string', minLength: 10, maxLength: 1000 },
    },
  },
  CompetitiveReviewActionResponse: {
    type: 'object',
    required: ['status', 'version'],
    properties: {
      status: { type: 'string', enum: ['IN_REVIEW', 'RESOLVED'] },
      version: { type: 'integer', minimum: 0 },
    },
  },
};

export const OPENAPI_M9B_PATHS: Record<string, unknown> = {
  '/rankings': {
    get: {
      tags: ['Ratings'],
      summary: 'Consultar ranking público global, semanal o mensual por modo',
      description:
        'Sólo incluye cuentas activas que cumplen los mínimos configurados y permiten mostrar estadísticas públicamente (statsVisibility=ALL). Práctica y partidas con bots no modifican el rating.',
      parameters: [
        {
          name: 'period',
          in: 'query',
          required: false,
          schema: { type: 'string', enum: ['GLOBAL', 'WEEKLY', 'MONTHLY'], default: 'GLOBAL' },
        },
        {
          name: 'mode',
          in: 'query',
          required: false,
          schema: { type: 'string', enum: ['1v1', '2v2'], default: '1v1' },
        },
        {
          name: 'cursor',
          in: 'query',
          required: false,
          schema: { type: 'string', pattern: '^\\d{1,7}$' },
        },
        {
          name: 'limit',
          in: 'query',
          required: false,
          schema: { type: 'integer', minimum: 1, maximum: 50, default: 20 },
        },
      ],
      responses: {
        200: response('Página del ranking y cuenta regresiva de temporada', 'LeaderboardResponse'),
        400: errorResponse('Filtro o cursor inválido'),
      },
    },
  },
  '/users/{id}/ratings': {
    get: {
      tags: ['Ratings'],
      summary: 'Consultar perfiles de rating por modo respetando privacidad de estadísticas',
      security: [{ accessCookie: [] }],
      parameters: [uuidPath('id')],
      responses: {
        200: response('Ratings 1v1 y 2v2 de la temporada activa', 'PlayerRatingResponse'),
        401: errorResponse('Sesión requerida o expirada'),
        404: errorResponse('Jugador inexistente o estadísticas no visibles para quien consulta'),
      },
    },
  },
  '/admin/competitive-reviews': {
    get: {
      tags: ['Admin', 'Competitive review'],
      summary: 'Listar señales de integridad para revisión humana (permiso competitive:review)',
      security: adminSecurity,
      parameters: [
        {
          name: 'status',
          in: 'query',
          required: false,
          schema: { type: 'string', enum: ['OPEN', 'IN_REVIEW', 'RESOLVED'] },
        },
        {
          name: 'cursor',
          in: 'query',
          required: false,
          schema: { type: 'integer', minimum: 0, default: 0 },
        },
        {
          name: 'limit',
          in: 'query',
          required: false,
          schema: { type: 'integer', minimum: 1, maximum: 100, default: 25 },
        },
      ],
      responses: {
        200: response('Casos y evidencia no concluyente', 'CompetitiveReviewListResponse'),
        401: errorResponse('Sesión administrativa requerida'),
        403: errorResponse('Falta el permiso competitive:review'),
      },
    },
  },
  '/admin/competitive-reviews/{caseId}/claim': {
    post: {
      tags: ['Admin', 'Competitive review'],
      summary: 'Tomar un caso para revisión humana con control de versión optimista',
      security: adminSecurity,
      parameters: [uuidPath('caseId')],
      requestBody: body('CompetitiveReviewClaimRequest'),
      responses: {
        200: response('Caso asignado al moderador', 'CompetitiveReviewActionResponse'),
        401: errorResponse('Sesión administrativa requerida'),
        403: errorResponse('Falta el permiso competitive:review'),
        409: errorResponse('El caso cambió o ya fue tomado'),
      },
    },
  },
  '/admin/competitive-reviews/{caseId}/resolve': {
    post: {
      tags: ['Admin', 'Competitive review'],
      summary: 'Registrar decisión humana sin aplicar sanciones automáticamente',
      security: adminSecurity,
      parameters: [uuidPath('caseId')],
      requestBody: body('CompetitiveReviewResolveRequest'),
      responses: {
        200: response('Revisión humana registrada y auditada', 'CompetitiveReviewActionResponse'),
        401: errorResponse('Sesión administrativa requerida'),
        403: errorResponse('Falta el permiso competitive:review'),
        409: errorResponse('El caso no está tomado por el moderador o cambió'),
      },
    },
  },
};
