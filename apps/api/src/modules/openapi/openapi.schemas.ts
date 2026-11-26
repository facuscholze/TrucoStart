import { OPENAPI_LOBBY_SCHEMAS } from './openapi-lobby.fragment.js';
import { OPENAPI_M7_SCHEMAS } from './openapi-m7.fragment.js';
import { OPENAPI_M9A_SCHEMAS } from './openapi-m9a.fragment.js';
import { OPENAPI_M9B_SCHEMAS } from './openapi-m9b.fragment.js';
import { OPENAPI_M9C_SCHEMAS } from './openapi-m9c.fragment.js';

export const OPENAPI_COMPONENTS_SCHEMAS: Record<string, unknown> = {
  ApiErrorResponse: {
    type: 'object',
    required: ['error'],
    properties: {
      error: {
        type: 'object',
        required: ['code', 'message'],
        properties: {
          code: {
            type: 'string',
            enum: [
              'VALIDATION_ERROR',
              'UNAUTHORIZED',
              'FORBIDDEN',
              'NOT_FOUND',
              'CONFLICT',
              'RATE_LIMITED',
              'ACCOUNT_LOCKED',
              'CAPTCHA_FAILED',
              'RULE_VIOLATION',
              'ROOM_FULL',
              'INVALID_STATE',
              'INTERNAL_ERROR',
            ],
          },
          message: { type: 'string' },
          details: { type: 'object', additionalProperties: true },
        },
      },
    },
  },
  HealthResponse: {
    type: 'object',
    required: ['status', 'service', 'appName', 'timestamp'],
    properties: {
      status: { type: 'string', enum: ['ok'] },
      service: { type: 'string', enum: ['api'] },
      appName: { type: 'string' },
      timestamp: { type: 'string', format: 'date-time' },
    },
  },
  AuthUserSummary: {
    type: 'object',
    required: [
      'id',
      'email',
      'emailVerified',
      'nickname',
      'isGuest',
      'role',
      'status',
      'createdAt',
    ],
    properties: {
      id: { type: 'string', format: 'uuid' },
      email: { type: ['string', 'null'], format: 'email' },
      emailVerified: { type: 'boolean' },
      nickname: { type: 'string', minLength: 3, maxLength: 20 },
      isGuest: { type: 'boolean' },
      role: { type: 'string', enum: ['PLAYER', 'SUPPORT', 'MODERATOR', 'ADMIN'] },
      status: { type: 'string', enum: ['ACTIVE', 'SUSPENDED', 'BANNED', 'DELETED'] },
      createdAt: { type: 'string', format: 'date-time' },
    },
  },
  AuthSessionResponse: {
    type: 'object',
    required: ['user', 'sessionId', 'expiresAt'],
    properties: {
      user: { $ref: '#/components/schemas/AuthUserSummary' },
      sessionId: { type: 'string', format: 'uuid' },
      expiresAt: { type: 'string', format: 'date-time' },
    },
  },
  GuestCreateRequest: {
    type: 'object',
    additionalProperties: false,
    properties: { deviceName: { type: 'string', maxLength: 80 } },
  },
  RegisterRequest: {
    type: 'object',
    additionalProperties: false,
    required: ['email', 'password', 'nickname'],
    properties: {
      email: { type: 'string', format: 'email' },
      password: { type: 'string', minLength: 8, maxLength: 128 },
      nickname: { type: 'string', minLength: 3, maxLength: 20 },
      captchaToken: { type: 'string' },
      deviceName: { type: 'string', maxLength: 80 },
    },
  },
  PromoteGuestRequest: {
    type: 'object',
    additionalProperties: false,
    required: ['email', 'password'],
    properties: {
      email: { type: 'string', format: 'email' },
      password: { type: 'string', minLength: 8, maxLength: 128 },
      nickname: { type: 'string', minLength: 3, maxLength: 20 },
      captchaToken: { type: 'string' },
    },
  },
  LoginRequest: {
    type: 'object',
    additionalProperties: false,
    required: ['email', 'password'],
    properties: {
      email: { type: 'string', format: 'email' },
      password: { type: 'string', minLength: 1, maxLength: 128 },
      captchaToken: { type: 'string' },
      deviceName: { type: 'string', maxLength: 80 },
    },
  },
  GoogleAuthRequest: {
    type: 'object',
    additionalProperties: false,
    required: ['idToken'],
    properties: {
      idToken: { type: 'string', minLength: 10 },
      deviceName: { type: 'string', maxLength: 80 },
    },
  },
  LogoutRequest: {
    type: 'object',
    additionalProperties: false,
    properties: { allDevices: { type: 'boolean', default: false } },
  },
  EmailOnlyRequest: {
    type: 'object',
    additionalProperties: false,
    required: ['email'],
    properties: { email: { type: 'string', format: 'email' } },
  },
  ResetPasswordRequest: {
    type: 'object',
    additionalProperties: false,
    required: ['token', 'newPassword'],
    properties: {
      token: { type: 'string', minLength: 20 },
      newPassword: { type: 'string', minLength: 8, maxLength: 128 },
    },
  },
  VerifyEmailRequest: {
    type: 'object',
    additionalProperties: false,
    required: ['token'],
    properties: { token: { type: 'string', minLength: 20 } },
  },
  NonEnumeratingAckResponse: {
    type: 'object',
    required: ['accepted', 'message'],
    properties: {
      accepted: { type: 'boolean', const: true },
      message: { type: 'string' },
    },
  },
  SessionListResponse: {
    type: 'object',
    required: ['sessions'],
    properties: {
      sessions: {
        type: 'array',
        items: {
          type: 'object',
          required: [
            'id',
            'deviceName',
            'ipAddress',
            'userAgent',
            'createdAt',
            'lastUsedAt',
            'expiresAt',
            'isCurrent',
          ],
          properties: {
            id: { type: 'string', format: 'uuid' },
            deviceName: { type: 'string' },
            ipAddress: { type: ['string', 'null'] },
            userAgent: { type: ['string', 'null'] },
            createdAt: { type: 'string', format: 'date-time' },
            lastUsedAt: { type: 'string', format: 'date-time' },
            expiresAt: { type: 'string', format: 'date-time' },
            isCurrent: { type: 'boolean' },
          },
        },
      },
    },
  },
  WsTicketResponse: {
    type: 'object',
    required: ['ticket', 'expiresAt'],
    properties: {
      ticket: { type: 'string' },
      expiresAt: { type: 'integer', description: 'Timestamp epoch en milisegundos' },
    },
  },
  ProfileDetails: {
    type: 'object',
    required: ['avatarId', 'level', 'xp', 'bio', 'settings'],
    properties: {
      avatarId: { type: 'string' },
      level: { type: 'integer', minimum: 1 },
      xp: { type: 'integer', minimum: 0 },
      bio: { type: 'string', maxLength: 280 },
      settings: {
        type: 'object',
        required: [
          'soundEnabled',
          'animationsReduced',
          'confirmCalls',
          'historyVisibility',
          'statsVisibility',
          'presenceVisibility',
        ],
        properties: {
          soundEnabled: { type: 'boolean' },
          animationsReduced: { type: 'boolean' },
          confirmCalls: { type: 'boolean' },
          historyVisibility: { type: 'string', enum: ['ALL', 'FRIENDS', 'NOBODY'] },
          statsVisibility: { type: 'string', enum: ['ALL', 'FRIENDS', 'NOBODY'] },
          presenceVisibility: { type: 'string', enum: ['ALL', 'FRIENDS', 'NOBODY'] },
        },
      },
    },
  },
  MeResponse: {
    type: 'object',
    required: ['user', 'profile'],
    properties: {
      user: { $ref: '#/components/schemas/AuthUserSummary' },
      profile: { $ref: '#/components/schemas/ProfileDetails' },
    },
  },
  PatchMeRequest: {
    type: 'object',
    additionalProperties: false,
    properties: {
      nickname: { type: 'string', minLength: 3, maxLength: 20 },
      avatarId: { type: 'string', maxLength: 64 },
      bio: { type: 'string', maxLength: 280 },
      settings: {
        type: 'object',
        additionalProperties: false,
        properties: {
          soundEnabled: { type: 'boolean' },
          animationsReduced: { type: 'boolean' },
          confirmCalls: { type: 'boolean' },
          historyVisibility: { type: 'string', enum: ['ALL', 'FRIENDS', 'NOBODY'] },
          statsVisibility: { type: 'string', enum: ['ALL', 'FRIENDS', 'NOBODY'] },
          presenceVisibility: { type: 'string', enum: ['ALL', 'FRIENDS', 'NOBODY'] },
        },
      },
    },
  },
  PublicUserProfile: {
    type: 'object',
    required: ['id', 'nickname', 'isGuest', 'avatarId', 'level', 'xp', 'bio', 'createdAt'],
    properties: {
      id: { type: 'string', format: 'uuid' },
      nickname: { type: 'string' },
      isGuest: { type: 'boolean' },
      avatarId: { type: 'string' },
      level: { type: 'integer' },
      xp: { type: 'integer' },
      bio: { type: 'string' },
      createdAt: { type: 'string', format: 'date-time' },
    },
  },
  MatchCallStats: {
    type: 'object',
    required: ['resolved', 'won', 'winRate'],
    properties: {
      resolved: { type: 'integer', minimum: 0 },
      won: { type: 'integer', minimum: 0 },
      winRate: { type: 'number', minimum: 0, maximum: 1 },
    },
  },
  UserModeStats: {
    type: 'object',
    required: [
      'matchesPlayed',
      'wins',
      'losses',
      'abandons',
      'winRate',
      'currentStreak',
      'envido',
      'truco',
    ],
    properties: {
      matchesPlayed: { type: 'integer', minimum: 0 },
      wins: { type: 'integer', minimum: 0 },
      losses: { type: 'integer', minimum: 0 },
      abandons: { type: 'integer', minimum: 0 },
      winRate: { type: 'number', minimum: 0, maximum: 1 },
      currentStreak: { type: 'integer', minimum: 0 },
      envido: { $ref: '#/components/schemas/MatchCallStats' },
      truco: { $ref: '#/components/schemas/MatchCallStats' },
    },
  },
  UserStatsResponse: {
    type: 'object',
    required: ['userId', 'matchesPlayed', 'wins', 'losses', 'abandons', 'winRate', 'byMode'],
    properties: {
      userId: { type: 'string', format: 'uuid' },
      matchesPlayed: { type: 'integer', minimum: 0 },
      wins: { type: 'integer', minimum: 0 },
      losses: { type: 'integer', minimum: 0 },
      abandons: { type: 'integer', minimum: 0 },
      winRate: { type: 'number', minimum: 0, maximum: 1 },
      byMode: {
        type: 'object',
        required: ['1v1', '2v2'],
        properties: {
          '1v1': { $ref: '#/components/schemas/UserModeStats' },
          '2v2': { $ref: '#/components/schemas/UserModeStats' },
        },
      },
    },
  },
  UserMatchesResponse: {
    type: 'object',
    required: ['items', 'nextCursor'],
    properties: {
      items: {
        type: 'array',
        items: {
          type: 'object',
          required: [
            'matchId',
            'mode',
            'rulesetCode',
            'seat',
            'team',
            'score',
            'outcome',
            'hasBots',
            'startedAt',
            'endedAt',
          ],
          properties: {
            matchId: { type: 'string', format: 'uuid' },
            mode: { type: 'string', enum: ['1v1', '2v2'] },
            rulesetCode: { type: 'string' },
            seat: { type: 'integer' },
            team: { type: 'integer' },
            score: { type: 'integer' },
            outcome: { type: 'string', enum: ['WIN', 'LOSS', 'ABANDON'] },
            hasBots: { type: 'boolean' },
            startedAt: { type: 'string', format: 'date-time' },
            endedAt: { type: ['string', 'null'], format: 'date-time' },
          },
        },
      },
      nextCursor: { type: ['string', 'null'] },
    },
  },
  AccountExportResponse: {
    type: 'object',
    required: ['exportedAt', 'user', 'profile', 'activeSessionsCount', 'stats', 'recentMatches'],
    properties: {
      exportedAt: { type: 'string', format: 'date-time' },
      user: { $ref: '#/components/schemas/AuthUserSummary' },
      profile: { $ref: '#/components/schemas/ProfileDetails' },
      activeSessionsCount: { type: 'integer' },
      stats: { $ref: '#/components/schemas/UserStatsResponse' },
      recentMatches: {
        $ref: '#/components/schemas/UserMatchesResponse/properties/items',
      },
    },
  },
  DeleteAccountRequest: {
    type: 'object',
    additionalProperties: false,
    properties: { password: { type: 'string' } },
  },
  DeleteAccountResponse: {
    type: 'object',
    required: ['deleted', 'userId'],
    properties: {
      deleted: { type: 'boolean', const: true },
      userId: { type: 'string', format: 'uuid' },
    },
  },
  ...OPENAPI_M7_SCHEMAS,
  ...OPENAPI_M9A_SCHEMAS,
  ...OPENAPI_LOBBY_SCHEMAS,
  ...OPENAPI_M9B_SCHEMAS,
  ...OPENAPI_M9C_SCHEMAS,
};
