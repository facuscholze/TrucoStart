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

export const OPENAPI_M9C_SCHEMAS: Record<string, unknown> = {
  ProgressionConditionKind: {
    type: 'string',
    enum: ['MATCHES_COMPLETED', 'WINS', 'CLEAN_MATCHES', 'CARD_PLAYS', 'TUTORIAL_LESSONS'],
  },
  ProgressionCondition: {
    type: 'object',
    additionalProperties: false,
    required: ['kind', 'target'],
    properties: {
      kind: schemaRef('ProgressionConditionKind'),
      target: { type: 'integer', minimum: 1 },
      eventType: { type: 'string', maxLength: 64 },
    },
  },
  ProgressionAchievement: {
    type: 'object',
    required: [
      'id',
      'titleKey',
      'descriptionKey',
      'icon',
      'condition',
      'progress',
      'target',
      'rewardXp',
      'rewardCoins',
      'unlockedAt',
    ],
    properties: {
      id: { type: 'string' },
      titleKey: { type: 'string' },
      descriptionKey: { type: 'string' },
      icon: { type: 'string' },
      condition: schemaRef('ProgressionCondition'),
      progress: { type: 'integer', minimum: 0 },
      target: { type: 'integer', minimum: 1 },
      rewardXp: { type: 'integer', minimum: 0 },
      rewardCoins: { type: 'integer', minimum: 0 },
      unlockedAt: { type: ['string', 'null'], format: 'date-time' },
    },
  },
  ProgressionMissionPeriod: { type: 'string', enum: ['DAILY', 'WEEKLY'] },
  ProgressionMission: {
    type: 'object',
    required: [
      'id',
      'templateId',
      'period',
      'titleKey',
      'descriptionKey',
      'progress',
      'target',
      'rewardXp',
      'rewardCoins',
      'periodEndsAt',
      'completedAt',
      'claimedAt',
    ],
    properties: {
      id: { type: 'string', format: 'uuid' },
      templateId: { type: 'string' },
      period: schemaRef('ProgressionMissionPeriod'),
      titleKey: { type: 'string' },
      descriptionKey: { type: 'string' },
      progress: { type: 'integer', minimum: 0 },
      target: { type: 'integer', minimum: 1 },
      rewardXp: { type: 'integer', minimum: 0 },
      rewardCoins: { type: 'integer', minimum: 0 },
      periodEndsAt: { type: 'string', format: 'date-time' },
      completedAt: { type: ['string', 'null'], format: 'date-time' },
      claimedAt: { type: ['string', 'null'], format: 'date-time' },
    },
  },
  ProgressionCosmetic: {
    type: 'object',
    required: ['id', 'nameKey', 'descriptionKey', 'category', 'priceCoins', 'icon', 'owned'],
    properties: {
      id: { type: 'string' },
      nameKey: { type: 'string' },
      descriptionKey: { type: 'string' },
      category: { type: 'string' },
      priceCoins: { type: 'integer', minimum: 0 },
      icon: { type: 'string' },
      owned: { type: 'boolean' },
    },
  },
  ProgressionNotification: {
    type: 'object',
    required: ['id', 'kind', 'payload', 'createdAt', 'readAt'],
    properties: {
      id: { type: 'string', format: 'uuid' },
      kind: { type: 'string', const: 'ACHIEVEMENT_UNLOCKED' },
      payload: { type: 'object', additionalProperties: true },
      createdAt: { type: 'string', format: 'date-time' },
      readAt: { type: ['string', 'null'], format: 'date-time' },
    },
  },
  ProgressionSummary: {
    type: 'object',
    required: [
      'level',
      'xpTotal',
      'xpInLevel',
      'xpForNextLevel',
      'levelProgress',
      'wallet',
      'achievements',
      'missions',
      'cosmetics',
      'notifications',
    ],
    properties: {
      level: { type: 'integer', minimum: 1 },
      xpTotal: { type: 'integer', minimum: 0 },
      xpInLevel: { type: 'integer', minimum: 0 },
      xpForNextLevel: { type: 'integer', minimum: 1 },
      levelProgress: { type: 'number', minimum: 0, maximum: 1 },
      wallet: {
        type: 'object',
        required: [
          'balance',
          'currencyType',
          'hasEconomicValue',
          'playerTransfersEnabled',
          'moneyPurchasesEnabled',
        ],
        properties: {
          balance: { type: 'integer', minimum: 0 },
          currencyType: { type: 'string', const: 'VIRTUAL_COIN' },
          hasEconomicValue: { type: 'boolean', const: false },
          playerTransfersEnabled: { type: 'boolean', const: false },
          moneyPurchasesEnabled: { type: 'boolean', const: false },
        },
      },
      achievements: { type: 'array', items: schemaRef('ProgressionAchievement') },
      missions: { type: 'array', items: schemaRef('ProgressionMission') },
      cosmetics: { type: 'array', items: schemaRef('ProgressionCosmetic') },
      notifications: { type: 'array', items: schemaRef('ProgressionNotification') },
    },
  },
  ProgressionMissionClaimResponse: {
    type: 'object',
    required: ['claimed', 'progression'],
    properties: {
      claimed: { type: 'boolean' },
      progression: schemaRef('ProgressionSummary'),
    },
  },
  ProgressionCosmeticRedeemResponse: {
    type: 'object',
    required: ['acquired', 'progression'],
    properties: {
      acquired: { type: 'boolean' },
      progression: schemaRef('ProgressionSummary'),
    },
  },
  ProgressionNotificationReadResponse: {
    type: 'object',
    required: ['read'],
    properties: { read: { type: 'boolean', const: true } },
  },
  ProgressionConfig: {
    type: 'object',
    additionalProperties: false,
    required: [
      'humanMatchXp',
      'botMatchXp',
      'dailyXpCap',
      'botDailyXpCap',
      'dailyBonusXpCap',
      'humanMatchCoins',
      'botMatchCoins',
      'dailyCoinCap',
      'botDailyCoinCap',
      'dailyCoinSpendCap',
      'baseXpPerLevel',
      'xpGrowthPerLevel',
      'missionRewardMultiplierBp',
      'achievementRewardMultiplierBp',
    ],
    properties: {
      humanMatchXp: { type: 'integer', minimum: 0, maximum: 10_000 },
      botMatchXp: { type: 'integer', minimum: 0, maximum: 10_000 },
      dailyXpCap: { type: 'integer', minimum: 0, maximum: 100_000 },
      botDailyXpCap: { type: 'integer', minimum: 0, maximum: 100_000 },
      dailyBonusXpCap: { type: 'integer', minimum: 0, maximum: 100_000 },
      humanMatchCoins: { type: 'integer', minimum: 0, maximum: 1_000 },
      botMatchCoins: { type: 'integer', minimum: 0, maximum: 1_000 },
      dailyCoinCap: { type: 'integer', minimum: 0, maximum: 10_000 },
      botDailyCoinCap: { type: 'integer', minimum: 0, maximum: 10_000 },
      dailyCoinSpendCap: { type: 'integer', minimum: 0, maximum: 10_000 },
      baseXpPerLevel: { type: 'integer', minimum: 1, maximum: 1_000_000 },
      xpGrowthPerLevel: { type: 'integer', minimum: 0, maximum: 1_000_000 },
      missionRewardMultiplierBp: { type: 'integer', minimum: 0, maximum: 50_000 },
      achievementRewardMultiplierBp: { type: 'integer', minimum: 0, maximum: 50_000 },
    },
  },
  ProgressionConfigUpdateRequest: {
    type: 'object',
    additionalProperties: false,
    required: ['reason', 'config'],
    properties: {
      reason: { type: 'string', minLength: 10, maxLength: 500 },
      config: schemaRef('ProgressionConfig'),
    },
  },
  ProgressionConfigUpdateResponse: {
    type: 'object',
    required: ['config', 'audited'],
    properties: {
      config: schemaRef('ProgressionConfig'),
      audited: { type: 'boolean', const: true },
    },
  },
  ProgressionAdminReversalRequest: {
    type: 'object',
    additionalProperties: false,
    required: ['reason'],
    properties: { reason: { type: 'string', minLength: 10, maxLength: 500 } },
  },
  ProgressionAdminReversalResponse: {
    type: 'object',
    required: ['transactionId', 'reversed'],
    properties: {
      transactionId: { type: 'string', format: 'uuid' },
      reversed: { type: 'boolean' },
    },
  },
};

export const OPENAPI_M9C_PATHS: Record<string, unknown> = {
  '/me/progression': {
    get: {
      tags: ['Progression'],
      summary: 'Consultar XP, nivel, logros, misiones, moneda virtual y notificaciones propias',
      security: playerSecurity,
      responses: {
        200: response('Resumen de progresión propio', 'ProgressionSummary'),
        401: errorResponse('No autenticado'),
      },
    },
  },
  '/me/progression/missions/{id}/claim': {
    post: {
      tags: ['Progression'],
      summary: 'Reclamar una misión completada por partidas registradas en servidor',
      security: playerSecurity,
      parameters: [uuidPath('id')],
      responses: {
        200: response(
          'Recompensa reclamada; un reintento no duplica el crédito',
          'ProgressionMissionClaimResponse',
        ),
        401: errorResponse('No autenticado'),
        404: errorResponse('Misión ajena o inexistente'),
        409: errorResponse('Misión incompleta o recompensa no disponible'),
      },
    },
  },
  '/me/progression/cosmetics/{cosmeticId}/redeem': {
    post: {
      tags: ['Progression'],
      summary:
        'Canjear monedas simbólicas por un cosmético visual sin efecto en reglas o matchmaking',
      security: playerSecurity,
      parameters: [
        {
          name: 'cosmeticId',
          in: 'path',
          required: true,
          schema: { type: 'string', minLength: 1, maxLength: 64 },
        },
      ],
      responses: {
        200: response(
          'Canje registrado en el libro mayor inmutable',
          'ProgressionCosmeticRedeemResponse',
        ),
        401: errorResponse('No autenticado'),
        404: errorResponse('Cosmético inexistente o no disponible'),
        409: errorResponse('Saldo insuficiente o límite diario alcanzado'),
      },
    },
  },
  '/me/progression/notifications/{notificationId}/read': {
    post: {
      tags: ['Progression'],
      summary: 'Marcar como leída una notificación propia de progresión',
      security: playerSecurity,
      parameters: [uuidPath('notificationId')],
      responses: {
        200: response(
          'Notificación marcada como leída de forma idempotente',
          'ProgressionNotificationReadResponse',
        ),
        401: errorResponse('No autenticado'),
        404: errorResponse('Notificación ajena o inexistente'),
      },
    },
  },
  '/admin/progression/config': {
    get: {
      tags: ['Admin progression'],
      summary: 'Consultar parámetros de recompensas y topes',
      security: adminSecurity,
      responses: {
        200: response('Configuración actual', 'ProgressionConfig'),
        401: errorResponse('Sesión administrativa ausente o inválida'),
        403: errorResponse('Falta el permiso gamification:configure'),
      },
    },
    patch: {
      tags: ['Admin progression'],
      summary: 'Actualizar configuración con motivo y auditoría de estado anterior/nuevo',
      security: adminSecurity,
      requestBody: body('ProgressionConfigUpdateRequest'),
      responses: {
        200: response('Configuración actualizada y auditada', 'ProgressionConfigUpdateResponse'),
        400: errorResponse('Configuración o motivo inválidos'),
        401: errorResponse('Sesión administrativa ausente o inválida'),
        403: errorResponse('Falta el permiso gamification:configure'),
      },
    },
  },
  '/admin/progression/wallet-transactions/{transactionId}/reverse': {
    post: {
      tags: ['Admin progression'],
      summary: 'Crear una compensación auditada para un crédito positivo del libro mayor',
      security: adminSecurity,
      parameters: [uuidPath('transactionId')],
      requestBody: body('ProgressionAdminReversalRequest'),
      responses: {
        200: response(
          'Asiento compensatorio creado; sólo se permite una reversión por crédito',
          'ProgressionAdminReversalResponse',
        ),
        400: errorResponse('Identificador o motivo inválido'),
        401: errorResponse('Sesión administrativa ausente o inválida'),
        403: errorResponse('Falta el permiso gamification:configure'),
        404: errorResponse('Asiento inexistente'),
        409: errorResponse('Asiento no positivo, ya revertido o saldo insuficiente'),
      },
    },
  },
};
