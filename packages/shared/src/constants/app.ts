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
