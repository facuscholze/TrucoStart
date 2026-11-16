export const DEFAULT_APP_NAME = 'Mesa de Truco';
export const API_V1_PREFIX = '/v1';

/**
 * Alfabeto sin caracteres ambiguos (excluye 0, O, 1, I) para códigos de mesa de 6 caracteres.
 */
export const JOIN_CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
export const JOIN_CODE_LENGTH = 6;

export const DEFAULT_TURN_TIMEOUT_MS = 30_000;
export const DEFAULT_TURN_WARNING_LEAD_MS = 5_000;
export const DEFAULT_RECONNECT_GRACE_MS = 45_000;
export const DEFAULT_WS_RATE_LIMIT_WINDOW_MS = 10_000;
export const DEFAULT_WS_TABLE_EVENT_MAX = 15;
export const DEFAULT_REFRESH_TOKEN_TTL_SECONDS = 2_592_000;

export const ACCESS_COOKIE_NAME = 'truco_access';
export const REFRESH_COOKIE_NAME = 'truco_refresh';
export const DEFAULT_ACCESS_TOKEN_TTL_SECONDS = 900; // 15 min
export const DEFAULT_WS_TICKET_TTL_MS = 60_000; // 60 s
export const DEFAULT_EMAIL_VERIFY_TTL_MS = 86_400_000; // 24 h
export const DEFAULT_PASSWORD_RESET_TTL_MS = 1_800_000; // 30 min

export const LOBBY_WS_NAMESPACE = '/lobby';
export const MATCH_LIFECYCLE_QUEUE_NAME = 'truco-match-lifecycle';
export const MATCH_LIFECYCLE_DLQ_NAME = 'truco-match-lifecycle-dlq';
export const DEFAULT_PUBLIC_TABLES_LIMIT = 25;
export const MAX_PUBLIC_TABLES_RESULTS = 50;
export const DEFAULT_TABLE_IDLE_TTL_MS = 600_000; // 10 min para mesas vacías o sin iniciar
export const DEFAULT_ABANDONED_TABLE_TTL_MS = 3_600_000; // 60 min para partidas huérfanas
export const DEFAULT_TABLE_INVITE_TTL_MS = 900_000; // 15 min para enlaces de invitación firmados
export const DEFAULT_MATCHMAKING_TIMEOUT_MS = 120_000; // 2 min de espera máxima en cola

export const LOCKOUT_THRESHOLD_ATTEMPTS = 5;
export const LOGIN_ACCOUNT_CAPTCHA_THRESHOLD = 3;
export const LOGIN_FAILURE_WINDOW_MS = 900_000; // 15 min
export const LOCKOUT_DURATIONS_MS = Object.freeze([
  60_000, // 5to intento fallido -> 1 min
  300_000, // 6to intento fallido -> 5 min
  900_000, // 7mo intento fallido -> 15 min
  3_600_000, // 8vo+ intento fallido -> 60 min
]);
