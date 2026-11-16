const ERR_RES = (description: string) => ({
  description,
  content: { 'application/json': { schema: { $ref: '#/components/schemas/ApiErrorResponse' } } },
});
const JSON_BODY = (schemaRef: string, required = true) => ({
  required,
  content: { 'application/json': { schema: { $ref: schemaRef } } },
});
const JSON_RES = (description: string, schemaRef: string) => ({
  description,
  content: { 'application/json': { schema: { $ref: schemaRef } } },
});

export const OPENAPI_LOBBY_SCHEMAS: Record<string, unknown> = {
  PublicLobbySeatSummary: {
    type: 'object',
    additionalProperties: false,
    required: ['seat', 'team', 'occupied', 'nickname'],
    properties: {
      seat: { type: 'integer', minimum: 0, maximum: 3 },
      team: { type: 'integer', enum: [0, 1] },
      occupied: { type: 'boolean' },
      nickname: { type: ['string', 'null'] },
    },
  },
  PublicLobbyTableSummary: {
    type: 'object',
    additionalProperties: false,
    required: [
      'id',
      'mode',
      'rulesetCode',
      'targetScore',
      'flor',
      'turnTimeoutMs',
      'status',
      'ownerNickname',
      'occupiedSeats',
      'maxSeats',
      'seats',
      'createdAt',
    ],
    properties: {
      id: { type: 'string', format: 'uuid' },
      mode: { type: 'string', enum: ['1v1', '2v2'] },
      rulesetCode: {
        type: 'string',
        enum: ['ar-standard-v1', 'ar-sin-flor-v1', 'ar-corto-15-v1', 'ar-corto-15-flor-v1'],
      },
      targetScore: { type: 'integer', enum: [15, 30] },
      flor: { type: 'boolean' },
      turnTimeoutMs: { type: 'integer', minimum: 500, maximum: 120000 },
      status: { type: 'string', enum: ['WAITING', 'IN_GAME'] },
      ownerNickname: { type: 'string' },
      occupiedSeats: { type: 'integer', minimum: 0, maximum: 4 },
      maxSeats: { type: 'integer', enum: [2, 4] },
      seats: { type: 'array', items: { $ref: '#/components/schemas/PublicLobbySeatSummary' } },
      createdAt: { type: 'string', format: 'date-time' },
    },
  },
  PublicTableListResponse: {
    type: 'object',
    required: ['tables'],
    properties: {
      tables: {
        type: 'array',
        items: { $ref: '#/components/schemas/PublicLobbyTableSummary' },
      },
    },
  },
  CreateTableRequest: {
    type: 'object',
    additionalProperties: false,
    required: ['mode'],
    properties: {
      mode: { type: 'string', enum: ['1v1', '2v2'] },
      visibility: { type: 'string', enum: ['PUBLIC', 'PRIVATE'], default: 'PUBLIC' },
      rulesetCode: {
        type: 'string',
        enum: ['ar-standard-v1', 'ar-sin-flor-v1', 'ar-corto-15-v1', 'ar-corto-15-flor-v1'],
      },
      targetScore: { type: 'integer', enum: [15, 30] },
      flor: { type: 'boolean' },
      turnTimeoutMs: { type: 'integer', minimum: 500, maximum: 120000, default: 25000 },
    },
  },
  TableParticipantSeat: {
    type: 'object',
    required: ['seat', 'team', 'occupied', 'nickname', 'isOwner', 'isSelf'],
    properties: {
      seat: { type: 'integer', minimum: 0, maximum: 3 },
      team: { type: 'integer', enum: [0, 1] },
      occupied: { type: 'boolean' },
      nickname: { type: ['string', 'null'] },
      isOwner: { type: 'boolean' },
      isSelf: { type: 'boolean' },
    },
  },
  TableDetailResponse: {
    type: 'object',
    required: [
      'id',
      'roomId',
      'mode',
      'visibility',
      'rulesetCode',
      'targetScore',
      'flor',
      'turnTimeoutMs',
      'status',
      'ownerNickname',
      'isOwner',
      'mySeat',
      'occupiedSeats',
      'maxSeats',
      'seats',
      'joinCode',
      'inviteToken',
      'inviteExpiresAt',
      'expiresAt',
      'createdAt',
    ],
    properties: {
      id: { type: 'string', format: 'uuid' },
      roomId: { type: 'string', format: 'uuid' },
      mode: { type: 'string', enum: ['1v1', '2v2'] },
      visibility: { type: 'string', enum: ['PUBLIC', 'PRIVATE'] },
      rulesetCode: {
        type: 'string',
        enum: ['ar-standard-v1', 'ar-sin-flor-v1', 'ar-corto-15-v1', 'ar-corto-15-flor-v1'],
      },
      targetScore: { type: 'integer', enum: [15, 30] },
      flor: { type: 'boolean' },
      turnTimeoutMs: { type: 'integer' },
      status: { type: 'string', enum: ['WAITING', 'IN_GAME', 'FINISHED', 'CLOSED', 'EXPIRED'] },
      ownerNickname: { type: 'string' },
      isOwner: { type: 'boolean' },
      mySeat: { type: ['integer', 'null'] },
      occupiedSeats: { type: 'integer', minimum: 0, maximum: 4 },
      maxSeats: { type: 'integer', enum: [2, 4] },
      seats: { type: 'array', items: { $ref: '#/components/schemas/TableParticipantSeat' } },
      joinCode: { type: ['string', 'null'] },
      inviteToken: { type: ['string', 'null'] },
      inviteExpiresAt: { type: ['string', 'null'], format: 'date-time' },
      expiresAt: { type: 'string', format: 'date-time' },
      createdAt: { type: 'string', format: 'date-time' },
    },
  },
  JoinByCodeRequest: {
    type: 'object',
    additionalProperties: false,
    properties: {
      code: { type: 'string', minLength: 6, maxLength: 6 },
      inviteToken: { type: 'string', minLength: 16, maxLength: 1024 },
      preferredSeat: { type: 'integer', minimum: 0, maximum: 3 },
    },
  },
  JoinPublicTableRequest: {
    type: 'object',
    additionalProperties: false,
    properties: {
      preferredSeat: { type: 'integer', minimum: 0, maximum: 3 },
    },
  },
  TableInviteResponse: {
    type: 'object',
    required: ['tableId', 'joinCode', 'inviteToken', 'invitePath', 'expiresAt'],
    properties: {
      tableId: { type: 'string', format: 'uuid' },
      joinCode: { type: 'string' },
      inviteToken: { type: 'string' },
      invitePath: { type: 'string' },
      expiresAt: { type: 'string', format: 'date-time' },
    },
  },
  LeaveTableResponse: {
    type: 'object',
    required: ['left', 'tableId', 'tableStatus', 'newOwnerNickname'],
    properties: {
      left: { type: 'boolean', const: true },
      tableId: { type: 'string', format: 'uuid' },
      tableStatus: {
        type: 'string',
        enum: ['WAITING', 'IN_GAME', 'FINISHED', 'CLOSED', 'EXPIRED'],
      },
      newOwnerNickname: { type: ['string', 'null'] },
    },
  },
  DeleteTableResponse: {
    type: 'object',
    required: ['deleted', 'tableId'],
    properties: {
      deleted: { type: 'boolean', const: true },
      tableId: { type: 'string', format: 'uuid' },
    },
  },
  MatchmakingEnqueueRequest: {
    type: 'object',
    additionalProperties: false,
    required: ['mode'],
    properties: {
      mode: { type: 'string', enum: ['1v1', '2v2'] },
      rulesetCode: {
        type: 'string',
        enum: ['ar-standard-v1', 'ar-sin-flor-v1', 'ar-corto-15-v1', 'ar-corto-15-flor-v1'],
        default: 'ar-standard-v1',
      },
    },
  },
  MatchmakingQueueStatusResponse: {
    type: 'object',
    required: ['status'],
    properties: {
      status: { type: 'string', enum: ['IDLE', 'QUEUED', 'MATCHED'] },
      mode: { type: 'string', enum: ['1v1', '2v2'] },
      rulesetCode: { type: 'string' },
      enqueuedAt: { type: 'string', format: 'date-time' },
      expiresAt: { type: 'string', format: 'date-time' },
      position: { type: 'integer', minimum: 1 },
      tableId: { type: 'string', format: 'uuid' },
      roomId: { type: 'string', format: 'uuid' },
      mySeat: { type: 'integer', minimum: 0, maximum: 3 },
      myTeam: { type: 'integer', enum: [0, 1] },
    },
  },
  MatchmakingCancelResponse: {
    type: 'object',
    required: ['cancelled'],
    properties: {
      cancelled: { type: 'boolean' },
    },
  },
};

export const OPENAPI_LOBBY_PATHS: Record<string, unknown> = {
  '/tables': {
    get: {
      tags: ['Lobby'],
      summary: 'Listar mesas estrictamente públicas filtradas por modo, puntos, flor y estado',
      parameters: [
        { name: 'mode', in: 'query', schema: { type: 'string', enum: ['1v1', '2v2'] } },
        { name: 'targetScore', in: 'query', schema: { type: 'integer', enum: [15, 30] } },
        { name: 'flor', in: 'query', schema: { type: 'string', enum: ['true', 'false'] } },
        {
          name: 'rulesetCode',
          in: 'query',
          schema: {
            type: 'string',
            enum: ['ar-standard-v1', 'ar-sin-flor-v1', 'ar-corto-15-v1', 'ar-corto-15-flor-v1'],
          },
        },
        {
          name: 'status',
          in: 'query',
          schema: { type: 'string', enum: ['WAITING', 'IN_GAME'] },
        },
        {
          name: 'limit',
          in: 'query',
          schema: { type: 'integer', minimum: 1, maximum: 50, default: 25 },
        },
      ],
      responses: {
        200: JSON_RES('Listado público de mesas', '#/components/schemas/PublicTableListResponse'),
      },
    },
    post: {
      tags: ['Lobby'],
      summary: 'Crear mesa pública o privada y aprovisionar sala en game-server',
      security: [{ accessCookie: [] }],
      requestBody: JSON_BODY('#/components/schemas/CreateTableRequest'),
      responses: {
        201: JSON_RES('Mesa creada', '#/components/schemas/TableDetailResponse'),
        401: ERR_RES('No autenticado'),
        409: ERR_RES('Ya participa en una mesa activa o cola de matchmaking'),
      },
    },
  },
  '/tables/join-by-code': {
    post: {
      tags: ['Lobby'],
      summary:
        'Unirse a una mesa mediante código corto de 6 caracteres (rate-limited por IP y cuenta) o inviteToken firmado',
      security: [{ accessCookie: [] }],
      requestBody: JSON_BODY('#/components/schemas/JoinByCodeRequest'),
      responses: {
        200: JSON_RES('Ingreso confirmado', '#/components/schemas/TableDetailResponse'),
        400: ERR_RES('Token de invitación inválido o expirado'),
        404: ERR_RES('Código inexistente'),
        409: ERR_RES('Mesa llena, iniciada o usuario ya en otra mesa'),
        429: ERR_RES('Límite de intentos excedido'),
      },
    },
  },
  '/tables/{id}': {
    get: {
      tags: ['Lobby'],
      summary: 'Consultar detalle de mesa (mesas privadas restringidas a integrantes)',
      security: [{ accessCookie: [] }],
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
      ],
      responses: {
        200: JSON_RES('Detalle de mesa', '#/components/schemas/TableDetailResponse'),
        404: ERR_RES('Mesa inexistente o privada ajena'),
      },
    },
    delete: {
      tags: ['Lobby'],
      summary: 'Cerrar mesa antes de que inicie la partida (solo dueño)',
      security: [{ accessCookie: [] }],
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
      ],
      responses: {
        200: JSON_RES('Mesa cerrada', '#/components/schemas/DeleteTableResponse'),
        403: ERR_RES('No es el dueño de la mesa'),
        409: ERR_RES('La partida ya comenzó'),
      },
    },
  },
  '/tables/{id}/join': {
    post: {
      tags: ['Lobby'],
      summary: 'Unirse directamente a una mesa pública con reserva atómica de asiento',
      security: [{ accessCookie: [] }],
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
      ],
      requestBody: JSON_BODY('#/components/schemas/JoinPublicTableRequest', false),
      responses: {
        200: JSON_RES('Asiento reservado', '#/components/schemas/TableDetailResponse'),
        403: ERR_RES('Mesa privada requiere código o invitación'),
        409: ERR_RES('Mesa llena o usuario ya activo'),
      },
    },
  },
  '/tables/{id}/invite': {
    post: {
      tags: ['Lobby'],
      summary: 'Emitir enlace firmado de invitación con expiración para integrantes de la mesa',
      security: [{ accessCookie: [] }],
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
      ],
      responses: {
        201: JSON_RES('Invitación firmada', '#/components/schemas/TableInviteResponse'),
        403: ERR_RES('No integra la mesa'),
      },
    },
  },
  '/tables/{id}/leave': {
    post: {
      tags: ['Lobby'],
      summary:
        'Abandonar mesa en espera (transfiere propiedad determinísticamente o cierra si vacía)',
      security: [{ accessCookie: [] }],
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
      ],
      responses: {
        200: JSON_RES('Salida procesada', '#/components/schemas/LeaveTableResponse'),
        409: ERR_RES('La partida ya comenzó'),
      },
    },
  },
  '/matchmaking/queue': {
    get: {
      tags: ['Matchmaking'],
      summary: 'Consultar estado actual en cola de matchmaking (IDLE, QUEUED o MATCHED)',
      security: [{ accessCookie: [] }],
      responses: {
        200: JSON_RES('Estado de cola', '#/components/schemas/MatchmakingQueueStatusResponse'),
      },
    },
    post: {
      tags: ['Matchmaking'],
      summary: 'Encolarse en matchmaking rápido por modo (1v1 o 2v2)',
      security: [{ accessCookie: [] }],
      requestBody: JSON_BODY('#/components/schemas/MatchmakingEnqueueRequest'),
      responses: {
        200: JSON_RES(
          'Encolado esperando cupo',
          '#/components/schemas/MatchmakingQueueStatusResponse',
        ),
        201: JSON_RES(
          'Emparejado y mesa creada',
          '#/components/schemas/MatchmakingQueueStatusResponse',
        ),
        409: ERR_RES('Usuario ya tiene mesa activa'),
      },
    },
    delete: {
      tags: ['Matchmaking'],
      summary: 'Cancelar búsqueda de partida de forma segura e idempotente',
      security: [{ accessCookie: [] }],
      responses: {
        200: JSON_RES('Cancelación procesada', '#/components/schemas/MatchmakingCancelResponse'),
      },
    },
  },
};
