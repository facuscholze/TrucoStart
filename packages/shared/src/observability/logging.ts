/**
 * Logging estructurado compartido: nivel, redacción de datos personales/cartas y
 * correlación entre `apps/api` y `apps/game-server`.
 *
 * Reglas duras (testeadas en `logging.spec.ts`):
 *  - nunca se registran emails, cookies, tokens ni contraseñas;
 *  - nunca se registran identificadores de cartas ni manos;
 *  - toda línea lleva `service` y `correlationId` cuando exista.
 */

export const CORRELATION_ID_HEADER = 'x-correlation-id';

/** Paths de redacción para pino (`redact`). */
export const LOG_REDACT_PATHS: readonly string[] = Object.freeze([
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["set-cookie"]',
  'res.headers["set-cookie"]',
  '*.password',
  '*.newPassword',
  '*.currentPassword',
  '*.passwordHash',
  '*.totpCode',
  '*.recoveryCode',
  '*.token',
  '*.accessToken',
  '*.refreshToken',
  '*.secret',
  '*.email',
  '*.hand',
  '*.cards',
  '*.cardId',
]);

const EMAIL_PATTERN = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const CARD_ID_PATTERN = /\b(?:1|2|3|4|5|6|7|10|11|12)-(?:espadas|bastos|oros|copas)\b/g;
const BEARER_PATTERN = /\b(?:Bearer\s+)[A-Za-z0-9._~+/-]+=*/gi;
/** Tokens opacos largos (JWT, base64url de sesión, nonces). */
const LONG_TOKEN_PATTERN = /\b[A-Za-z0-9_-]{32,}\b/g;
/** Ids internos (UUID v7 y similares): se conservan porque no son datos personales. */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const SENSITIVE_KEYS = new Set([
  'password',
  'newpassword',
  'currentpassword',
  'passwordhash',
  'totpcode',
  'recoverycode',
  'token',
  'accesstoken',
  'refreshtoken',
  'secret',
  'secretkey',
  'email',
  'cookie',
  'authorization',
  'cardid',
  'hand',
  'cards',
  'deck',
]);

export const REDACTED = '[redactado]';

/** Sanitiza texto libre (mensajes, razones de sanción, etc.). */
export function redactLogText(input: string): string {
  if (UUID_PATTERN.test(input)) return input;
  return input
    .replace(EMAIL_PATTERN, '[email]')
    .replace(CARD_ID_PATTERN, '[carta]')
    .replace(BEARER_PATTERN, `Bearer ${REDACTED}`)
    .replace(LONG_TOKEN_PATTERN, (match) => (UUID_PATTERN.test(match) ? match : REDACTED));
}

/** Sanitiza recursivamente un objeto antes de loguearlo. */
export function redactLogPayload(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[profundidad-máxima]';
  if (typeof value === 'string') return redactLogText(value);
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((item) => redactLogPayload(item, depth + 1));

  const output: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (SENSITIVE_KEYS.has(key.toLowerCase())) {
      output[key] = REDACTED;
      continue;
    }
    output[key] = redactLogPayload(entry, depth + 1);
  }
  return output;
}

export interface LoggerOptionsInput {
  readonly service: 'api' | 'game-server' | 'web' | 'admin';
  readonly level?: string;
  /** `true` en desarrollo local: formato legible por humanos. */
  readonly pretty?: boolean;
}

export interface BuiltLoggerOptions {
  readonly name: string;
  readonly level: string;
  readonly redact: { readonly paths: string[]; readonly censor: string };
  readonly base: { readonly service: string; readonly env: string };
  readonly formatters: { readonly level: (label: string) => { level: string } };
  readonly timestamp: false;
}

export function buildLoggerOptions(input: LoggerOptionsInput): BuiltLoggerOptions {
  return {
    name: `truco-${input.service}`,
    level: input.level ?? process.env['LOG_LEVEL'] ?? (input.pretty ? 'debug' : 'info'),
    redact: { paths: [...LOG_REDACT_PATHS], censor: REDACTED },
    base: { service: input.service, env: process.env['NODE_ENV'] ?? 'development' },
    formatters: { level: (label: string) => ({ level: label }) },
    timestamp: false,
  };
}

/** Cabecera de correlación válida: 8..64 caracteres seguros. */
export const CORRELATION_ID_PATTERN = /^[A-Za-z0-9._:-]{8,64}$/;

export function pickCorrelationId(candidate: unknown, fallback: () => string): string {
  if (typeof candidate === 'string' && CORRELATION_ID_PATTERN.test(candidate)) return candidate;
  return fallback();
}

export function createCorrelationId(randomHex: () => string = () => defaultRandomHex()): string {
  return randomHex();
}

function defaultRandomHex(): string {
  const bytes = new Uint8Array(12);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** Campos mínimos de una línea de log de request HTTP. */
export interface RequestLogFieldsInput {
  readonly service: 'api' | 'game-server';
  readonly correlationId: string;
  readonly method: string;
  readonly path: string;
  readonly status: number;
  readonly durationMs: number;
  readonly userId?: string | null;
  readonly errorCode?: string | null;
}

export function buildRequestLogFields(input: RequestLogFieldsInput): Record<string, unknown> {
  return {
    service: input.service,
    correlationId: input.correlationId,
    method: input.method,
    // Sólo el path: nunca query string (puede traer emails o tokens).
    path: input.path.split('?')[0],
    status: input.status,
    durationMs: input.durationMs,
    ...(input.userId ? { userId: input.userId } : {}),
    ...(input.errorCode ? { errorCode: input.errorCode } : {}),
  };
}
