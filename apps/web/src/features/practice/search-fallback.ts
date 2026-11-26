import type { MatchmakingQueueStatusResponse } from '@truco/shared';

/**
 * Lógica pura de la espera por un rival humano (P1 de `docs/UX_AUDIT_M0-M9C.md`).
 *
 * La partida rápida contra humanos es la acción principal; si la espera supera el umbral
 * configurado se ofrece la práctica contra la máquina como salida rápida, sin cancelar la
 * búsqueda ni ocultar el botón de cancelar. Antes del umbral no se ofrece nada: el jugador
 * puede practicar igual desde el bloque secundario de práctica.
 */

/** Estados en los que el jugador sigue esperando a un humano. */
export type HumanSearchStatus = Extract<MatchmakingQueueStatusResponse, { status: 'QUEUED' }>;

export function isHumanSearchActive(
  status: MatchmakingQueueStatusResponse,
): status is HumanSearchStatus {
  return status.status === 'QUEUED';
}

/**
 * Segundos enteros que el jugador lleva buscando rival, medidos con el reloj recibido.
 * Si la marca de entrada no es una fecha válida devuelve 0 (nunca ofrece antes de tiempo).
 */
export function secondsSearching(queue: HumanSearchStatus, nowMs: number): number {
  const startedAtMs = Date.parse(queue.enqueuedAt);
  if (!Number.isFinite(startedAtMs)) return 0;
  return Math.max(0, Math.floor((nowMs - startedAtMs) / 1000));
}

export function shouldOfferPractice(
  queue: MatchmakingQueueStatusResponse,
  nowMs: number,
  thresholdSeconds: number,
): boolean {
  if (!isHumanSearchActive(queue)) return false;
  return secondsSearching(queue, nowMs) >= thresholdSeconds;
}

/** Segundos que faltan para ofrecer la práctica; 0 cuando ya corresponde ofrecerla. */
export function secondsUntilPracticeOffered(
  queue: MatchmakingQueueStatusResponse,
  nowMs: number,
  thresholdSeconds: number,
): number {
  if (!isHumanSearchActive(queue)) return thresholdSeconds;
  return Math.max(0, thresholdSeconds - secondsSearching(queue, nowMs));
}
