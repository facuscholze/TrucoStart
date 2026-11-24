import { ACCESS_COOKIE_NAME, REFRESH_COOKIE_NAME } from '@truco/shared';
import { OPENAPI_LOBBY_PATHS } from './openapi-lobby.fragment.js';
import { OPENAPI_M9A_PATHS } from './openapi-m9a.fragment.js';
import { OPENAPI_M9B_PATHS } from './openapi-m9b.fragment.js';
import { OPENAPI_COMPONENTS_SCHEMAS } from './openapi.schemas.js';

export interface OpenApiDocument {
  readonly openapi: '3.1.0';
  readonly info: {
    readonly title: string;
    readonly version: string;
    readonly description: string;
  };
  readonly servers: ReadonlyArray<{ readonly url: string; readonly description: string }>;
  readonly components: Record<string, unknown>;
  readonly paths: Record<string, unknown>;
}

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

export function buildOpenApiV1Document(): OpenApiDocument {
  return {
    openapi: '3.1.0',
    info: {
      title: 'Mesa de Truco — HTTP API v1',
      version: '0.6.0',
      description:
        'API HTTP v1 para autenticación segura, perfiles con controles de privacidad, historial verificable de partidas, grafo social, matchmaking competitivo con Glicko-2, rankings públicos y revisión humana de integridad.',
    },
    servers: [{ url: '/v1', description: 'API v1' }],
    components: {
      securitySchemes: {
        accessCookie: {
          type: 'apiKey',
          in: 'cookie',
          name: ACCESS_COOKIE_NAME,
          description: 'Cookie HttpOnly; Secure; SameSite=Lax de acceso corto (15 min).',
        },
        refreshCookie: {
          type: 'apiKey',
          in: 'cookie',
          name: REFRESH_COOKIE_NAME,
          description: 'Cookie HttpOnly; Secure; SameSite=Lax rotativa en /v1/auth (30 días).',
        },
        adminAccessCookie: {
          type: 'apiKey',
          in: 'cookie',
          name: 'truco_admin_access',
          description:
            'Cookie administrativa HttpOnly; Secure; SameSite=Strict, limitada a /v1/admin y con 2FA obligatorio.',
        },
      },
      schemas: OPENAPI_COMPONENTS_SCHEMAS,
    },
    paths: {
      '/health': {
        get: {
          tags: ['Health'],
          summary: 'Liveness probe',
          responses: { 200: JSON_RES('Servicio vivo', '#/components/schemas/HealthResponse') },
        },
      },
      '/ready': {
        get: {
          tags: ['Health'],
          summary: 'Readiness probe (verifica conectividad activa con PostgreSQL/PGlite)',
          responses: {
            200: JSON_RES('Servicio listo', '#/components/schemas/HealthResponse'),
            503: ERR_RES('Dependencia no disponible'),
          },
        },
      },
      '/auth/guest': {
        post: {
          tags: ['Auth'],
          summary: 'Crear cuenta invitada efímera con apodo criollo autogenerado',
          requestBody: JSON_BODY('#/components/schemas/GuestCreateRequest', false),
          responses: {
            201: JSON_RES('Sesión invitada creada', '#/components/schemas/AuthSessionResponse'),
            429: ERR_RES('Rate limit superado'),
          },
        },
      },
      '/auth/promote-guest': {
        post: {
          tags: ['Auth'],
          summary: 'Vincular cuenta invitada preservando user.id, progreso e historial',
          security: [{ accessCookie: [] }],
          requestBody: JSON_BODY('#/components/schemas/PromoteGuestRequest'),
          responses: {
            200: JSON_RES('Cuenta promovida', '#/components/schemas/AuthSessionResponse'),
            400: ERR_RES('Datos inválidos o apodo bloqueado'),
            401: ERR_RES('No autenticado'),
            409: ERR_RES('Email/apodo ocupado o cuenta no invitada'),
          },
        },
      },
      '/auth/register': {
        post: {
          tags: ['Auth'],
          summary: 'Registrar nueva cuenta con contraseña Argon2id y verificación de correo',
          requestBody: JSON_BODY('#/components/schemas/RegisterRequest'),
          responses: {
            201: JSON_RES('Cuenta creada', '#/components/schemas/AuthSessionResponse'),
            400: ERR_RES('Datos inválidos, apodo bloqueado o captcha fallido'),
            409: ERR_RES('Email o apodo ya en uso'),
            429: ERR_RES('Rate limit superado'),
          },
        },
      },
      '/auth/login': {
        post: {
          tags: ['Auth'],
          summary:
            'Iniciar sesión con lockout progresivo por (cuenta + IP) y Captcha tras umbral por cuenta',
          requestBody: JSON_BODY('#/components/schemas/LoginRequest'),
          responses: {
            200: JSON_RES('Sesión iniciada', '#/components/schemas/AuthSessionResponse'),
            400: ERR_RES('Captcha requerido o inválido tras fallos acumulados en la cuenta'),
            401: ERR_RES('Credenciales inválidas'),
            423: ERR_RES('Combinación (cuenta + IP) bloqueada temporalmente'),
            429: ERR_RES('Rate limit por IP o por (cuenta + IP)'),
          },
        },
      },
      '/auth/google': {
        post: {
          tags: ['Auth'],
          summary: 'Iniciar sesión o vincular cuenta mediante Google ID Token',
          requestBody: JSON_BODY('#/components/schemas/GoogleAuthRequest'),
          responses: {
            200: JSON_RES('Sesión iniciada con Google', '#/components/schemas/AuthSessionResponse'),
            401: ERR_RES('ID Token inválido'),
          },
        },
      },
      '/auth/refresh': {
        post: {
          tags: ['Auth'],
          summary: 'Rotar refresh token; ante reutilización revoca toda la familia de sesiones',
          security: [{ refreshCookie: [] }],
          responses: {
            200: JSON_RES('Cookies rotadas', '#/components/schemas/AuthSessionResponse'),
            401: ERR_RES('Refresh ausente, expirado o reutilización detectada'),
          },
        },
      },
      '/auth/logout': {
        post: {
          tags: ['Auth'],
          summary: 'Cerrar sesión actual o global y limpiar cookies',
          requestBody: JSON_BODY('#/components/schemas/LogoutRequest', false),
          responses: {
            200: JSON_RES('Sesión cerrada', '#/components/schemas/NonEnumeratingAckResponse'),
          },
        },
      },
      '/auth/sessions': {
        get: {
          tags: ['Auth'],
          summary: 'Listar sesiones/dispositivos activos propios',
          security: [{ accessCookie: [] }],
          responses: {
            200: JSON_RES('Sesiones activas', '#/components/schemas/SessionListResponse'),
            401: ERR_RES('No autenticado'),
          },
        },
      },
      '/auth/sessions/{sessionId}': {
        delete: {
          tags: ['Auth'],
          summary: 'Revocar una sesión específica propia',
          security: [{ accessCookie: [] }],
          parameters: [
            {
              name: 'sessionId',
              in: 'path',
              required: true,
              schema: { type: 'string', format: 'uuid' },
            },
          ],
          responses: {
            200: JSON_RES('Sesión revocada', '#/components/schemas/NonEnumeratingAckResponse'),
            403: ERR_RES('La sesión pertenece a otro usuario'),
            404: ERR_RES('Sesión inexistente'),
          },
        },
      },
      '/auth/forgot': {
        post: {
          tags: ['Auth'],
          summary: 'Solicitar recuperación de contraseña (respuesta uniforme anti-enumeración)',
          requestBody: JSON_BODY('#/components/schemas/EmailOnlyRequest'),
          responses: {
            200: JSON_RES('Solicitud aceptada', '#/components/schemas/NonEnumeratingAckResponse'),
          },
        },
      },
      '/auth/reset': {
        post: {
          tags: ['Auth'],
          summary: 'Restablecer contraseña mediante token de un solo uso',
          requestBody: JSON_BODY('#/components/schemas/ResetPasswordRequest'),
          responses: {
            200: JSON_RES(
              'Contraseña actualizada',
              '#/components/schemas/NonEnumeratingAckResponse',
            ),
            400: ERR_RES('Token inválido o vencido'),
          },
        },
      },
      '/auth/verify-email': {
        post: {
          tags: ['Auth'],
          summary: 'Confirmar dirección de correo electrónico',
          requestBody: JSON_BODY('#/components/schemas/VerifyEmailRequest'),
          responses: {
            200: JSON_RES('Email verificado', '#/components/schemas/NonEnumeratingAckResponse'),
            400: ERR_RES('Token inválido o vencido'),
          },
        },
      },
      '/auth/resend-verification': {
        post: {
          tags: ['Auth'],
          summary: 'Reenviar correo de verificación (anti-enumeración)',
          requestBody: JSON_BODY('#/components/schemas/EmailOnlyRequest'),
          responses: {
            200: JSON_RES('Solicitud aceptada', '#/components/schemas/NonEnumeratingAckResponse'),
          },
        },
      },
      '/auth/ws-ticket': {
        post: {
          tags: ['Auth'],
          summary:
            'Emitir ticket firmado efímero de un solo uso (jti + TTL 60 s) para Socket.IO contra game-server',
          security: [{ accessCookie: [] }],
          responses: {
            200: JSON_RES('Ticket WS emitido', '#/components/schemas/WsTicketResponse'),
            401: ERR_RES('Sesión inválida o expirada'),
          },
        },
      },
      '/me': {
        get: {
          tags: ['Users'],
          summary: 'Obtener cuenta y perfil privados del usuario autenticado',
          security: [{ accessCookie: [] }],
          responses: { 200: JSON_RES('Datos propios', '#/components/schemas/MeResponse') },
        },
        patch: {
          tags: ['Users'],
          summary: 'Actualizar apodo, avatar, bio o preferencias propias',
          security: [{ accessCookie: [] }],
          requestBody: JSON_BODY('#/components/schemas/PatchMeRequest'),
          responses: { 200: JSON_RES('Perfil actualizado', '#/components/schemas/MeResponse') },
        },
        delete: {
          tags: ['Users'],
          summary: 'Eliminar cuenta propia y anonimizar datos personales (Ley 25.326)',
          security: [{ accessCookie: [] }],
          requestBody: JSON_BODY('#/components/schemas/DeleteAccountRequest', false),
          responses: {
            200: JSON_RES('Cuenta eliminada', '#/components/schemas/DeleteAccountResponse'),
          },
        },
      },
      '/me/export': {
        get: {
          tags: ['Users'],
          summary: 'Exportar copia portátil de datos personales, estadísticas y partidas recientes',
          security: [{ accessCookie: [] }],
          responses: {
            200: JSON_RES('Exportación JSON', '#/components/schemas/AccountExportResponse'),
          },
        },
      },
      '/users/{id}': {
        get: {
          tags: ['Users'],
          summary: 'Obtener perfil estrictamente público de un jugador (sin PII)',
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          ],
          responses: {
            200: JSON_RES('Perfil público', '#/components/schemas/PublicUserProfile'),
            404: ERR_RES('Jugador no encontrado'),
          },
        },
      },
      '/users/{id}/stats': {
        get: {
          tags: ['Users'],
          summary:
            'Obtener estadísticas agregadas, restringidas por la política independiente de privacidad de estadísticas',
          security: [{ accessCookie: [] }],
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          ],
          responses: {
            200: JSON_RES(
              'Estadísticas visibles por política de privacidad',
              '#/components/schemas/UserStatsResponse',
            ),
            401: ERR_RES('No autenticado'),
            404: ERR_RES('Jugador inexistente o historial privado para quien consulta'),
          },
        },
      },
      '/users/{id}/matches': {
        get: {
          tags: ['Users'],
          summary: 'Listar historial paginado con filtros y controles de visibilidad social',
          security: [{ accessCookie: [] }],
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
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
            {
              name: 'mode',
              in: 'query',
              required: false,
              schema: { type: 'string', enum: ['1v1', '2v2'] },
            },
            {
              name: 'outcome',
              in: 'query',
              required: false,
              schema: { type: 'string', enum: ['WIN', 'LOSS', 'ABANDON'] },
            },
            {
              name: 'bots',
              in: 'query',
              required: false,
              schema: { type: 'string', enum: ['ANY', 'BOTS', 'HUMANS'], default: 'ANY' },
            },
          ],
          responses: {
            200: JSON_RES(
              'Página de partidas visible por política de privacidad',
              '#/components/schemas/UserMatchesResponse',
            ),
            400: ERR_RES('Filtros o cursor inválidos'),
            401: ERR_RES('No autenticado'),
            404: ERR_RES('Jugador inexistente o historial privado para quien consulta'),
          },
        },
      },
      ...OPENAPI_M9A_PATHS,
      ...OPENAPI_LOBBY_PATHS,
      ...OPENAPI_M9B_PATHS,
    },
  };
}
