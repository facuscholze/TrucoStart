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
const accessSecurity = [{ accessCookie: [] }];
const protectedErrors = {
  401: errorResponse('Sesión requerida o expirada'),
  403: errorResponse('Acción no permitida, cuenta sancionada o relación no elegible'),
  404: errorResponse('Recurso no encontrado o privacidad restringida'),
  409: errorResponse('Conflicto con el estado actual'),
  429: errorResponse('Límite de acciones sociales superado'),
};

export const OPENAPI_M9A_SCHEMAS: Record<string, unknown> = {
  UserMatchDetailResponse: {
    type: 'object',
    required: [
      'matchId',
      'mode',
      'rulesetCode',
      'hasBots',
      'seedCommitment',
      'startedAt',
      'endedAt',
      'result',
      'players',
      'events',
    ],
    properties: {
      matchId: { type: 'string', format: 'uuid' },
      mode: { type: 'string', enum: ['1v1', '2v2', '3v3'] },
      rulesetCode: { type: 'string' },
      hasBots: { type: 'boolean' },
      seedCommitment: { type: 'string' },
      startedAt: { type: 'string', format: 'date-time' },
      endedAt: { type: ['string', 'null'], format: 'date-time' },
      result: {
        type: 'object',
        required: ['winnerTeam', 'scoresByTeam', 'reason'],
        properties: {
          winnerTeam: { type: ['integer', 'null'], minimum: 0 },
          scoresByTeam: { type: 'object', additionalProperties: { type: 'integer', minimum: 0 } },
          reason: { type: ['string', 'null'] },
        },
      },
      players: {
        type: 'array',
        items: {
          type: 'object',
          required: ['userId', 'nickname', 'seat', 'team', 'score', 'outcome', 'isSelf'],
          properties: {
            userId: { type: 'string', format: 'uuid' },
            nickname: { type: 'string' },
            seat: { type: 'integer', minimum: 0 },
            team: { type: 'integer', minimum: 0 },
            score: { type: 'integer', minimum: 0 },
            outcome: { type: 'string', enum: ['WIN', 'LOSS', 'ABANDON'] },
            isSelf: { type: 'boolean' },
          },
        },
      },
      events: {
        type: 'array',
        description: 'Timeline permitida; no expone cartas jugadas ni payloads de señas.',
        items: {
          type: 'object',
          required: ['seq', 'type', 'at'],
          properties: {
            seq: { type: 'integer', minimum: 1 },
            type: {
              type: 'string',
              enum: [
                'game.callMade',
                'game.callResolved',
                'game.handEnded',
                'game.scoreUpdated',
                'game.ended',
              ],
            },
            at: { type: 'string', format: 'date-time' },
          },
        },
      },
    },
  },
  PlayerRelationshipStatus: {
    type: 'string',
    enum: ['NONE', 'FRIENDS', 'PENDING_INCOMING', 'PENDING_OUTGOING'],
  },
  SocialPresenceStatus: { type: 'string', enum: ['ONLINE', 'IN_GAME', 'OFFLINE'] },
  PlayerSearchResponse: {
    type: 'object',
    required: ['items'],
    properties: {
      items: {
        type: 'array',
        maxItems: 20,
        items: {
          type: 'object',
          required: ['userId', 'nickname', 'avatarId', 'level', 'relationship'],
          properties: {
            userId: { type: 'string', format: 'uuid' },
            nickname: { type: 'string' },
            avatarId: { type: 'string' },
            level: { type: 'integer', minimum: 1 },
            relationship: schemaRef('PlayerRelationshipStatus'),
          },
        },
      },
    },
  },
  FriendListResponse: {
    type: 'object',
    required: ['items'],
    properties: {
      items: {
        type: 'array',
        items: {
          type: 'object',
          required: [
            'friendshipId',
            'userId',
            'nickname',
            'avatarId',
            'level',
            'presence',
            'friendsSince',
          ],
          properties: {
            friendshipId: { type: 'string', format: 'uuid' },
            userId: { type: 'string', format: 'uuid' },
            nickname: { type: 'string' },
            avatarId: { type: 'string' },
            level: { type: 'integer', minimum: 1 },
            presence: { oneOf: [schemaRef('SocialPresenceStatus'), { type: 'null' }] },
            friendsSince: { type: 'string', format: 'date-time' },
          },
        },
      },
    },
  },
  FriendRequestListResponse: {
    type: 'object',
    required: ['items'],
    properties: {
      items: {
        type: 'array',
        items: {
          type: 'object',
          required: ['id', 'userId', 'nickname', 'avatarId', 'direction', 'createdAt'],
          properties: {
            id: { type: 'string', format: 'uuid' },
            userId: { type: 'string', format: 'uuid' },
            nickname: { type: 'string' },
            avatarId: { type: 'string' },
            direction: { type: 'string', enum: ['INCOMING', 'OUTGOING'] },
            createdAt: { type: 'string', format: 'date-time' },
          },
        },
      },
    },
  },
  CreateFriendRequest: {
    type: 'object',
    additionalProperties: false,
    required: ['targetUserId'],
    properties: { targetUserId: { type: 'string', format: 'uuid' } },
  },
  FriendRequestMutationResponse: {
    type: 'object',
    required: ['requestId', 'status', 'reciprocalRequestAccepted'],
    properties: {
      requestId: { type: 'string', format: 'uuid' },
      status: { type: 'string', enum: ['PENDING', 'ACCEPTED', 'REJECTED', 'CANCELLED'] },
      reciprocalRequestAccepted: { type: 'boolean' },
    },
  },
  BlockListResponse: {
    type: 'object',
    required: ['items'],
    properties: {
      items: {
        type: 'array',
        items: {
          type: 'object',
          required: ['userId', 'nickname', 'blockedAt'],
          properties: {
            userId: { type: 'string', format: 'uuid' },
            nickname: { type: 'string' },
            blockedAt: { type: 'string', format: 'date-time' },
          },
        },
      },
    },
  },
  BlockMutationResponse: {
    type: 'object',
    required: ['userId', 'blocked'],
    properties: {
      userId: { type: 'string', format: 'uuid' },
      blocked: { type: 'boolean' },
    },
  },
  SocialNotificationType: {
    type: 'string',
    enum: [
      'FRIEND_REQUEST',
      'FRIEND_REQUEST_ACCEPTED',
      'FRIEND_REQUEST_REJECTED',
      'TABLE_INVITATION',
      'TABLE_INVITATION_ACCEPTED',
      'TABLE_INVITATION_DECLINED',
      'CHALLENGE',
      'CHALLENGE_ACCEPTED',
      'CHALLENGE_DECLINED',
    ],
  },
  SocialNotificationItem: {
    type: 'object',
    required: [
      'id',
      'type',
      'actorUserId',
      'actorNickname',
      'referenceId',
      'tableId',
      'createdAt',
      'readAt',
    ],
    properties: {
      id: { type: 'string', format: 'uuid' },
      type: schemaRef('SocialNotificationType'),
      actorUserId: { type: ['string', 'null'], format: 'uuid' },
      actorNickname: { type: ['string', 'null'] },
      referenceId: { type: ['string', 'null'], format: 'uuid' },
      tableId: { type: ['string', 'null'], format: 'uuid' },
      createdAt: { type: 'string', format: 'date-time' },
      readAt: { type: ['string', 'null'], format: 'date-time' },
    },
  },
  SocialNotificationListResponse: {
    type: 'object',
    required: ['items', 'nextCursor', 'unreadCount'],
    properties: {
      items: { type: 'array', items: schemaRef('SocialNotificationItem') },
      nextCursor: { type: ['string', 'null'], format: 'uuid' },
      unreadCount: { type: 'integer', minimum: 0 },
    },
  },
  UnreadNotificationCountResponse: {
    type: 'object',
    required: ['unreadCount'],
    properties: { unreadCount: { type: 'integer', minimum: 0 } },
  },
  ReadNotificationResponse: {
    type: 'object',
    required: ['notification'],
    properties: { notification: schemaRef('SocialNotificationItem') },
  },
  MarkAllNotificationsReadResponse: {
    type: 'object',
    required: ['updated', 'unreadCount'],
    properties: {
      updated: { type: 'integer', minimum: 0 },
      unreadCount: { type: 'integer', const: 0 },
    },
  },
  SocialPresenceEvent: {
    type: 'object',
    required: ['userId', 'status', 'visible', 'observedAt'],
    properties: {
      userId: { type: 'string', format: 'uuid' },
      status: schemaRef('SocialPresenceStatus'),
      visible: { type: 'boolean', default: true },
      observedAt: { type: 'string', format: 'date-time' },
    },
  },
  SocialInvitationItem: {
    type: 'object',
    required: [
      'id',
      'kind',
      'status',
      'otherUserId',
      'otherNickname',
      'tableId',
      'mode',
      'rulesetCode',
      'expiresAt',
      'createdAt',
    ],
    properties: {
      id: { type: 'string', format: 'uuid' },
      kind: { type: 'string', enum: ['TABLE', 'CHALLENGE'] },
      status: { type: 'string', enum: ['PENDING', 'ACCEPTED', 'DECLINED', 'CANCELLED', 'EXPIRED'] },
      otherUserId: { type: 'string', format: 'uuid' },
      otherNickname: { type: 'string' },
      tableId: { type: ['string', 'null'], format: 'uuid' },
      mode: { type: ['string', 'null'], enum: ['1v1', null] },
      rulesetCode: {
        type: ['string', 'null'],
        enum: ['ar-standard-v1', 'ar-sin-flor-v1', 'ar-corto-15-v1', 'ar-corto-15-flor-v1', null],
      },
      expiresAt: { type: 'string', format: 'date-time' },
      createdAt: { type: 'string', format: 'date-time' },
    },
  },
  SocialInvitationListResponse: {
    type: 'object',
    required: ['items'],
    properties: { items: { type: 'array', items: schemaRef('SocialInvitationItem') } },
  },
  CreateTableInvitationRequest: {
    type: 'object',
    additionalProperties: false,
    required: ['recipientUserId', 'tableId'],
    properties: {
      recipientUserId: { type: 'string', format: 'uuid' },
      tableId: { type: 'string', format: 'uuid' },
    },
  },
  CreateChallengeRequest: {
    type: 'object',
    additionalProperties: false,
    required: ['recipientUserId', 'rulesetCode'],
    properties: {
      recipientUserId: { type: 'string', format: 'uuid' },
      mode: { type: 'string', enum: ['1v1'], default: '1v1' },
      rulesetCode: {
        type: 'string',
        enum: ['ar-standard-v1', 'ar-sin-flor-v1', 'ar-corto-15-v1', 'ar-corto-15-flor-v1'],
      },
    },
  },
  CreateSocialInvitationResponse: {
    type: 'object',
    required: ['invitationId', 'kind', 'status', 'expiresAt'],
    properties: {
      invitationId: { type: 'string', format: 'uuid' },
      kind: { type: 'string', enum: ['TABLE', 'CHALLENGE'] },
      status: { type: 'string', const: 'PENDING' },
      expiresAt: { type: 'string', format: 'date-time' },
    },
  },
  AcceptSocialInvitationResponse: {
    type: 'object',
    required: ['invitationId', 'kind', 'table'],
    properties: {
      invitationId: { type: 'string', format: 'uuid' },
      kind: { type: 'string', enum: ['TABLE', 'CHALLENGE'] },
      table: schemaRef('TableDetailResponse'),
    },
  },
  SocialInvitationActionResponse: {
    type: 'object',
    required: ['invitationId', 'status'],
    properties: {
      invitationId: { type: 'string', format: 'uuid' },
      status: { type: 'string', enum: ['DECLINED', 'CANCELLED'] },
    },
  },
};

const protectedResponse = (description: string, schema: string, successCode = 200) => ({
  [successCode]: response(description, schema),
  ...protectedErrors,
  400: errorResponse('Datos o filtros inválidos'),
});

export const OPENAPI_M9A_PATHS: Record<string, unknown> = {
  '/users/{id}/matches/{matchId}': {
    get: {
      tags: ['Users'],
      summary: 'Obtener detalle público y filtrado de una partida del historial visible',
      description:
        'Devuelve solo hitos permitidos del timeline; nunca cartas jugadas, señas privadas ni semilla revelada.',
      security: accessSecurity,
      parameters: [uuidPath('id'), uuidPath('matchId')],
      responses: protectedResponse('Detalle verificable de la partida', 'UserMatchDetailResponse'),
    },
  },
  '/social/search': {
    get: {
      tags: ['Social'],
      summary: 'Buscar jugadores por apodo y conocer el estado de relación',
      security: accessSecurity,
      parameters: [
        {
          name: 'nickname',
          in: 'query',
          required: true,
          schema: { type: 'string', minLength: 2, maxLength: 32 },
        },
        {
          name: 'limit',
          in: 'query',
          required: false,
          schema: { type: 'integer', minimum: 1, maximum: 20, default: 10 },
        },
      ],
      responses: {
        200: response('Resultados disponibles', 'PlayerSearchResponse'),
        401: errorResponse('Sesión requerida'),
        403: errorResponse('Cuenta no elegible por sanción activa'),
        429: errorResponse('Límite de búsqueda superado'),
      },
    },
  },
  '/social/friends': {
    get: {
      tags: ['Social'],
      summary: 'Listar amistades y presencia según la privacidad configurada',
      security: accessSecurity,
      parameters: [
        {
          name: 'limit',
          in: 'query',
          required: false,
          schema: { type: 'integer', minimum: 1, maximum: 100, default: 100 },
        },
      ],
      responses: {
        200: response('Amigos', 'FriendListResponse'),
        401: errorResponse('Sesión requerida'),
        403: errorResponse('Cuenta no elegible por sanción activa'),
      },
    },
  },
  '/social/friend-requests': {
    get: {
      tags: ['Social'],
      summary: 'Listar solicitudes entrantes y salientes pendientes',
      security: accessSecurity,
      responses: {
        200: response('Solicitudes pendientes', 'FriendRequestListResponse'),
        401: errorResponse('Sesión requerida'),
        403: errorResponse('Cuenta no elegible por sanción activa'),
      },
    },
    post: {
      tags: ['Social'],
      summary: 'Enviar solicitud de amistad o aceptar una solicitud recíproca',
      security: accessSecurity,
      requestBody: body('CreateFriendRequest'),
      responses: {
        201: response(
          'Solicitud creada o amistad recíproca aceptada',
          'FriendRequestMutationResponse',
        ),
        ...protectedErrors,
        400: errorResponse('Identificador inválido'),
      },
    },
  },
  '/social/friend-requests/{requestId}/accept': {
    post: {
      tags: ['Social'],
      summary: 'Aceptar solicitud de amistad entrante',
      security: accessSecurity,
      parameters: [uuidPath('requestId')],
      responses: protectedResponse('Solicitud aceptada', 'FriendRequestMutationResponse'),
    },
  },
  '/social/friend-requests/{requestId}/decline': {
    post: {
      tags: ['Social'],
      summary: 'Rechazar solicitud de amistad entrante y notificar al remitente',
      security: accessSecurity,
      parameters: [uuidPath('requestId')],
      responses: protectedResponse('Solicitud rechazada', 'FriendRequestMutationResponse'),
    },
  },
  '/social/friend-requests/{requestId}/cancel': {
    post: {
      tags: ['Social'],
      summary: 'Cancelar solicitud de amistad saliente',
      security: accessSecurity,
      parameters: [uuidPath('requestId')],
      responses: protectedResponse('Solicitud cancelada', 'FriendRequestMutationResponse'),
    },
  },
  '/social/friends/{userId}': {
    delete: {
      tags: ['Social'],
      summary: 'Eliminar una amistad propia',
      security: accessSecurity,
      parameters: [uuidPath('userId')],
      responses: {
        200: {
          description: 'Amistad eliminada',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['removed'],
                properties: { removed: { type: 'boolean', const: true } },
              },
            },
          },
        },
        ...protectedErrors,
      },
    },
  },
  '/social/blocks': {
    get: {
      tags: ['Social'],
      summary: 'Listar jugadores bloqueados por la cuenta actual',
      security: accessSecurity,
      responses: {
        200: response('Bloqueos propios', 'BlockListResponse'),
        401: errorResponse('Sesión requerida'),
        403: errorResponse('Cuenta no elegible por sanción activa'),
      },
    },
  },
  '/social/blocks/{userId}': {
    post: {
      tags: ['Social'],
      summary: 'Bloquear a un jugador y cortar interacciones sociales',
      security: accessSecurity,
      parameters: [uuidPath('userId')],
      responses: protectedResponse('Jugador bloqueado', 'BlockMutationResponse'),
    },
    delete: {
      tags: ['Social'],
      summary: 'Desbloquear a un jugador',
      security: accessSecurity,
      parameters: [uuidPath('userId')],
      responses: protectedResponse('Jugador desbloqueado', 'BlockMutationResponse'),
    },
  },
  '/social/table-invitations': {
    post: {
      tags: ['Social'],
      summary: 'Invitar a un amigo a una mesa de espera existente',
      security: accessSecurity,
      requestBody: body('CreateTableInvitationRequest'),
      responses: {
        201: response('Invitación creada', 'CreateSocialInvitationResponse'),
        ...protectedErrors,
        400: errorResponse('Datos inválidos'),
        410: errorResponse('Mesa por expirar'),
      },
    },
  },
  '/social/challenges': {
    post: {
      tags: ['Social'],
      summary: 'Desafiar a un amigo a una partida directa 1 vs 1',
      security: accessSecurity,
      requestBody: body('CreateChallengeRequest'),
      responses: {
        201: response('Desafío creado', 'CreateSocialInvitationResponse'),
        ...protectedErrors,
        400: errorResponse('Reglas inválidas'),
      },
    },
  },
  '/social/invitations': {
    get: {
      tags: ['Social'],
      summary: 'Listar invitaciones entrantes o salientes vigentes',
      security: accessSecurity,
      parameters: [
        {
          name: 'direction',
          in: 'query',
          required: false,
          schema: { type: 'string', enum: ['INCOMING', 'OUTGOING'], default: 'INCOMING' },
        },
      ],
      responses: {
        200: response('Invitaciones vigentes', 'SocialInvitationListResponse'),
        401: errorResponse('Sesión requerida'),
        403: errorResponse('Cuenta no elegible por sanción activa'),
      },
    },
  },
  '/social/invitations/{invitationId}/accept': {
    post: {
      tags: ['Social'],
      summary: 'Aceptar una invitación y crear/abrir la mesa asociada',
      security: accessSecurity,
      parameters: [uuidPath('invitationId')],
      responses: protectedResponse(
        'Invitación aceptada y mesa lista',
        'AcceptSocialInvitationResponse',
      ),
    },
  },
  '/social/invitations/{invitationId}/decline': {
    post: {
      tags: ['Social'],
      summary: 'Rechazar una invitación social',
      security: accessSecurity,
      parameters: [uuidPath('invitationId')],
      responses: protectedResponse('Invitación rechazada', 'SocialInvitationActionResponse'),
    },
  },
  '/social/invitations/{invitationId}/cancel': {
    post: {
      tags: ['Social'],
      summary: 'Cancelar una invitación social saliente',
      security: accessSecurity,
      parameters: [uuidPath('invitationId')],
      responses: protectedResponse('Invitación cancelada', 'SocialInvitationActionResponse'),
    },
  },
  '/social/notifications': {
    get: {
      tags: ['Social'],
      summary: 'Listar notificaciones sociales paginadas',
      security: accessSecurity,
      parameters: [
        {
          name: 'cursor',
          in: 'query',
          required: false,
          schema: { type: 'string', format: 'uuid' },
        },
        {
          name: 'limit',
          in: 'query',
          required: false,
          schema: { type: 'integer', minimum: 1, maximum: 50, default: 20 },
        },
        { name: 'unreadOnly', in: 'query', required: false, schema: { type: 'boolean' } },
      ],
      responses: {
        200: response('Notificaciones y contador no leído', 'SocialNotificationListResponse'),
        401: errorResponse('Sesión requerida'),
        403: errorResponse('Cuenta no elegible por sanción activa'),
        400: errorResponse('Cursor o filtros inválidos'),
      },
    },
  },
  '/social/notifications/unread-count': {
    get: {
      tags: ['Social'],
      summary: 'Obtener el contador de notificaciones sin leer',
      security: accessSecurity,
      responses: {
        200: response('Contador actualizado', 'UnreadNotificationCountResponse'),
        401: errorResponse('Sesión requerida'),
        403: errorResponse('Cuenta no elegible por sanción activa'),
      },
    },
  },
  '/social/notifications/{notificationId}/read': {
    post: {
      tags: ['Social'],
      summary: 'Marcar una notificación propia como leída',
      security: accessSecurity,
      parameters: [uuidPath('notificationId')],
      responses: protectedResponse('Notificación marcada como leída', 'ReadNotificationResponse'),
    },
  },
  '/social/notifications/read-all': {
    post: {
      tags: ['Social'],
      summary: 'Marcar todas las notificaciones propias como leídas',
      security: accessSecurity,
      responses: protectedResponse(
        'Notificaciones actualizadas',
        'MarkAllNotificationsReadResponse',
      ),
    },
  },
};
