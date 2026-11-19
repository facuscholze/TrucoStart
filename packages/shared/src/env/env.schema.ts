import { z } from 'zod';
import {
  DEFAULT_APP_NAME,
  DEFAULT_IDLE_ROOM_SWEEP_MS,
  DEFAULT_IDLE_ROOM_TTL_MS,
  DEFAULT_RECONNECT_GRACE_MS,
  DEFAULT_REFRESH_TOKEN_TTL_SECONDS,
  DEFAULT_TURN_TIMEOUT_MS,
} from '../constants/app.js';

const PositiveIntFromEnv = z.coerce.number().int().positive();

export const NodeEnvSchema = z.enum(['development', 'test', 'staging', 'production']);
export const EmailProviderTypeSchema = z.enum(['console', 'resend', 'smtp']);
export const CaptchaProviderTypeSchema = z.enum(['disabled', 'turnstile']);

export const ServerEnvSchema = z
  .object({
    NODE_ENV: NodeEnvSchema.default('development'),
    APP_NAME: z.string().trim().min(1).default(DEFAULT_APP_NAME),

    API_HOST: z.string().trim().min(1).default('0.0.0.0'),
    API_PORT: PositiveIntFromEnv.max(65535).default(3001),
    GAME_SERVER_HOST: z.string().trim().min(1).default('0.0.0.0'),
    GAME_SERVER_PORT: PositiveIntFromEnv.max(65535).default(3002),
    GAME_SERVER_INTERNAL_URL: z.string().url().optional().default('http://127.0.0.1:3002'),
    /** URL interna de la API usada por el game-server para consultar moderación. */
    API_INTERNAL_URL: z.string().url().optional().default('http://127.0.0.1:3001'),

    DATABASE_URL: z
      .string()
      .url()
      .refine(
        (val) => val.startsWith('postgres://') || val.startsWith('postgresql://'),
        'DATABASE_URL debe iniciar con postgres:// o postgresql://',
      ),
    REDIS_URL: z
      .string()
      .url()
      .refine(
        (val) => val.startsWith('redis://') || val.startsWith('rediss://'),
        'REDIS_URL debe iniciar con redis:// o rediss://',
      ),

    SESSION_SECRET: z.string().min(32, 'SESSION_SECRET debe tener al menos 32 caracteres'),
    INTERNAL_RPC_SECRET: z.string().optional().default(''),
    REFRESH_TOKEN_TTL: PositiveIntFromEnv.default(DEFAULT_REFRESH_TOKEN_TTL_SECONDS),
    COOKIE_DOMAIN: z.string().trim().min(1).default('localhost'),
    CORS_ORIGINS: z
      .string()
      .min(1)
      .transform((raw) =>
        raw
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean),
      ),

    SEED_ENCRYPTION_KEY: z
      .string()
      .min(32, 'SEED_ENCRYPTION_KEY debe tener al menos 32 caracteres'),

    GOOGLE_CLIENT_ID: z.string().optional().default(''),
    GOOGLE_CLIENT_SECRET: z.string().optional().default(''),
    GOOGLE_HOSTED_DOMAIN: z.string().optional().default(''),

    EMAIL_PROVIDER: EmailProviderTypeSchema.default('console'),
    EMAIL_FROM_ADDRESS: z.string().optional().default(''),
    /** @deprecated usar RESEND_API_KEY (EMAIL_PROVIDER=resend) o SMTP_CONNECTION_URL (EMAIL_PROVIDER=smtp). */
    EMAIL_PROVIDER_API_KEY: z.string().optional().default(''),
    RESEND_API_KEY: z.string().optional().default(''),
    SMTP_CONNECTION_URL: z.string().optional().default(''),
    /** Base URL pública de la web (se usa para armar links en correos). */
    WEB_BASE_URL: z.string().url().optional().default('http://localhost:5173'),

    CAPTCHA_PROVIDER: CaptchaProviderTypeSchema.default('disabled'),
    CAPTCHA_SITE_KEY: z.string().optional().default(''),
    CAPTCHA_SECRET: z.string().optional().default(''),

    NICKNAME_BLOCKED_TERMS: z
      .string()
      .optional()
      .default('')
      .transform((raw) =>
        raw
          .split(',')
          .map((item) => item.trim().toLowerCase())
          .filter(Boolean),
      ),

    RATE_LIMIT_HTTP_WINDOW_MS: PositiveIntFromEnv.default(60_000),
    RATE_LIMIT_HTTP_MAX: PositiveIntFromEnv.default(120),
    RATE_LIMIT_AUTH_MAX: PositiveIntFromEnv.default(15),
    RATE_LIMIT_WS_ACTION_MAX: PositiveIntFromEnv.default(30),
    RATE_LIMIT_WS_CHAT_MAX: PositiveIntFromEnv.default(10),
    RATE_LIMIT_TABLE_CREATE_MAX: PositiveIntFromEnv.default(6),
    /** Máximas conexiones WS simultáneas por usuario autenticado (M8b). */
    WS_MAX_CONNECTIONS_PER_USER: PositiveIntFromEnv.default(4),
    /**
     * Máximas conexiones WS simultáneas por IP de origen (M8b).
     * El default de 60 contempla redes compartidas (NAT corporativo, CGNAT de
     * ISP móvil, escuelas/cibers) donde muchos jugadores comparten la misma IP
     * pública. ADR-020 documenta la elección.
     */
    WS_MAX_CONNECTIONS_PER_IP: PositiveIntFromEnv.default(60),
    /**
     * Lista de CIDRs de proxies confiables (separados por coma). Si la IP
     * remota de la conexión está dentro de uno de estos rangos, se confía en
     * la cabecera `TRUSTED_PROXY_HEADER` (por defecto `x-forwarded-for`) para
     * obtener la IP real del cliente. Fuera de estos rangos la cabecera se
     * ignora y se usa la IP del socket. Configuración recomendada:
     * Cloudflare (`https://www.cloudflare.com/ips/`) o el balanceador propio.
     */
    TRUSTED_PROXY_CIDRS: z
      .string()
      .optional()
      .default('')
      .transform((raw) =>
        raw
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
      ),
    /**
     * Nombre de la cabecera de IP real del cliente que sólo se respeta si la
     * conexión viene de un `TRUSTED_PROXY_CIDRS`. Por defecto `x-forwarded-for`
     * (estándar de proxies HTTP). Si se usa Cloudflare puede ponerse
     * `cf-connecting-ip`.
     */
    TRUSTED_PROXY_HEADER: z.string().trim().toLowerCase().default('x-forwarded-for'),

    TURN_TIMEOUT_MS: PositiveIntFromEnv.default(DEFAULT_TURN_TIMEOUT_MS),
    RECONNECT_GRACE_MS: PositiveIntFromEnv.default(DEFAULT_RECONNECT_GRACE_MS),
    /** TTL sin conexiones tras el cual el game-server destruye la sala (10 min por defecto). */
    IDLE_ROOM_TTL_MS: PositiveIntFromEnv.default(DEFAULT_IDLE_ROOM_TTL_MS),
    /** Frecuencia del barrido de inactividad del game-server (60 s por defecto). */
    IDLE_ROOM_SWEEP_MS: PositiveIntFromEnv.default(DEFAULT_IDLE_ROOM_SWEEP_MS),

    SENTRY_DSN: z.string().optional().default(''),
    SENTRY_TRACES_SAMPLE_RATE: z.string().optional().default(''),
    OTEL_EXPORTER_OTLP_ENDPOINT: z.string().optional().default(''),
    OTEL_SERVICE_NAME: z.string().optional().default(''),
    OTEL_TRACES_SAMPLER_ARG: z.string().optional().default(''),

    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    /** Token de `Authorization: Bearer` para `/v1/metrics`. Vacío = endpoint deshabilitado. */
    METRICS_TOKEN: z.string().optional().default(''),
    /** Redes (IPv4/IPv6 con prefijo opcional) habilitadas para el panel admin. */
    ADMIN_ALLOWED_NETWORKS: z
      .string()
      .optional()
      .default('')
      .transform((raw) =>
        raw
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean),
      ),
    /** Origen separado del panel admin (se usa para CORS del panel, no del jugador). */
    ADMIN_ORIGIN: z.string().optional().default(''),

    S3_ENDPOINT: z.string().optional().default(''),
    S3_REGION: z.string().optional().default('us-east-1'),
    S3_BUCKET: z.string().optional().default(''),
    S3_ACCESS_KEY_ID: z.string().optional().default(''),
    S3_SECRET_ACCESS_KEY: z.string().optional().default(''),
  })
  .superRefine((env, ctx) => {
    if (env.EMAIL_PROVIDER === 'resend') {
      if (env.RESEND_API_KEY.trim().length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['RESEND_API_KEY'],
          message: 'RESEND_API_KEY es obligatorio cuando EMAIL_PROVIDER=resend',
        });
      }
      if (env.EMAIL_FROM_ADDRESS.trim().length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['EMAIL_FROM_ADDRESS'],
          message: 'EMAIL_FROM_ADDRESS es obligatorio cuando EMAIL_PROVIDER=resend',
        });
      }
    } else if (env.EMAIL_PROVIDER === 'smtp') {
      if (env.SMTP_CONNECTION_URL.trim().length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['SMTP_CONNECTION_URL'],
          message: 'SMTP_CONNECTION_URL es obligatorio cuando EMAIL_PROVIDER=smtp',
        });
      }
      if (env.EMAIL_FROM_ADDRESS.trim().length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['EMAIL_FROM_ADDRESS'],
          message: 'EMAIL_FROM_ADDRESS es obligatorio cuando EMAIL_PROVIDER=smtp',
        });
      }
    }
    if (
      env.CAPTCHA_PROVIDER !== 'disabled' &&
      (env.CAPTCHA_SITE_KEY.trim().length === 0 || env.CAPTCHA_SECRET.trim().length === 0)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['CAPTCHA_SECRET'],
        message:
          'CAPTCHA_SITE_KEY y CAPTCHA_SECRET son obligatorios cuando CAPTCHA_PROVIDER está activo',
      });
    }
    // Si se activa Google OAuth (GOOGLE_CLIENT_ID presente) se exige que en
    // producción se verifique por JWKS (no con el simulador).
    if (env.NODE_ENV === 'production' && env.GOOGLE_CLIENT_ID.trim().length > 0) {
      // Sin GOOGLE_CLIENT_SECRET no se puede intercambiar el authorization code.
      if (env.GOOGLE_CLIENT_SECRET.trim().length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['GOOGLE_CLIENT_SECRET'],
          message:
            'GOOGLE_CLIENT_SECRET es obligatorio en producción cuando GOOGLE_CLIENT_ID está configurado',
        });
      }
    }
  });

export type ServerEnv = z.infer<typeof ServerEnvSchema>;

export function parseServerEnv(rawEnv: Record<string, string | undefined>): ServerEnv {
  const result = ServerEnvSchema.safeParse(rawEnv);
  if (!result.success) {
    const formatted = result.error.issues
      .map((issue) => `${issue.path.join('.') || 'env'}: ${issue.message}`)
      .join('; ');
    throw new Error(`Configuración de entorno inválida: ${formatted}`);
  }
  return result.data;
}
