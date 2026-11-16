import { z } from 'zod';
import {
  DEFAULT_APP_NAME,
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

    EMAIL_PROVIDER: EmailProviderTypeSchema.default('console'),
    EMAIL_PROVIDER_API_KEY: z.string().optional().default(''),

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

    TURN_TIMEOUT_MS: PositiveIntFromEnv.default(DEFAULT_TURN_TIMEOUT_MS),
    RECONNECT_GRACE_MS: PositiveIntFromEnv.default(DEFAULT_RECONNECT_GRACE_MS),

    SENTRY_DSN: z.string().optional().default(''),
    OTEL_EXPORTER_OTLP_ENDPOINT: z.string().optional().default(''),

    S3_ENDPOINT: z.string().optional().default(''),
    S3_REGION: z.string().optional().default('us-east-1'),
    S3_BUCKET: z.string().optional().default(''),
    S3_ACCESS_KEY_ID: z.string().optional().default(''),
    S3_SECRET_ACCESS_KEY: z.string().optional().default(''),
  })
  .superRefine((env, ctx) => {
    if (env.EMAIL_PROVIDER !== 'console' && env.EMAIL_PROVIDER_API_KEY.trim().length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['EMAIL_PROVIDER_API_KEY'],
        message: 'EMAIL_PROVIDER_API_KEY es obligatorio cuando EMAIL_PROVIDER no es "console"',
      });
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
