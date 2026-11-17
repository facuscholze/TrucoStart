/**
 * Estado de moderación consultado por el game-server.
 * Lo provee `apps/api` (autoritativo) y el servidor de juego solo lo aplica:
 * - cuentas suspendidas o bloqueadas no pueden unirse ni reconectarse a una mesa;
 * - cuentas silenciadas no pueden usar chat rápido ni señas/emotes.
 */
export interface ModerationSnapshot {
  readonly accountStatus: 'ACTIVE' | 'SUSPENDED' | 'BANNED' | 'DELETED';
  readonly mutedUntilMs: number | null;
  readonly statusReason?: string | null;
  readonly statusExpiresAtMs?: number | null;
}

export type ModerationLookup = (userId: string) => Promise<ModerationSnapshot | null>;

/** TTL del cache local para no pegarle a la API en cada mensaje. */
export const MODERATION_CACHE_TTL_MS = 15_000;

export function isMutedSnapshot(
  snapshot: ModerationSnapshot | null | undefined,
  nowMs: number,
): boolean {
  return snapshot?.mutedUntilMs != null && snapshot.mutedUntilMs > nowMs;
}

export function describeBlockedStatus(snapshot: ModerationSnapshot): string {
  if (snapshot.accountStatus === 'BANNED') {
    return `Tu cuenta está bloqueada permanentemente. Motivo: ${snapshot.statusReason ?? 'no informado'}.`;
  }
  if (snapshot.accountStatus === 'SUSPENDED') {
    const until = snapshot.statusExpiresAtMs
      ? new Date(snapshot.statusExpiresAtMs).toISOString().slice(0, 10)
      : 'sin fecha';
    return `Tu cuenta está suspendida hasta el ${until}. Motivo: ${snapshot.statusReason ?? 'no informado'}.`;
  }
  return 'Tu cuenta no está habilitada para jugar.';
}
