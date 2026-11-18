/**
 * Utilidades compartidas por los escenarios k6 de Mesa de Truco.
 *
 * Estos escenarios se corren contra el stack completo (API NestJS + game-server
 * Socket.IO) levantado en GitHub Actions con PostgreSQL 16 y Redis 7 reales.
 */

export const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';
export const WS_URL = __ENV.WS_URL || 'ws://localhost:3002';
export const REGISTER_PREFIX = __ENV.REGISTER_PREFIX || `k6run-${Date.now()}`;

export function jsonHeaders() {
  return { 'Content-Type': 'application/json' };
}
