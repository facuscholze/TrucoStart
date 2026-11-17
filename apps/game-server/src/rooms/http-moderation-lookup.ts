import { ModerationSnapshotSchema, signInternalRequestHeaders } from '@truco/shared';
import type { ModerationLookup, ModerationSnapshot } from './moderation.js';

export interface HttpModerationLookupOptions {
  /** URL raíz interna de `apps/api` (p. ej. `http://api:3001`); el path incluye `/v1`. */
  readonly baseUrl: string;
  readonly internalSecret: string;
  readonly timeoutMs?: number;
  readonly fetchImpl?: typeof fetch;
}

/**
 * Consulta el estado de moderación a `apps/api` (`/v1/internal/moderation/:userId`).
 * La API es la fuente autoritativa; el game-server solo aplica la restricción.
 */
export function createHttpModerationLookup(options: HttpModerationLookupOptions): ModerationLookup {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 1_500;
  const base = options.baseUrl.replace(/\/$/, '').replace(/\/v1$/, '');

  return async (userId: string): Promise<ModerationSnapshot | null> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      // Ruta interna de la API (con prefijo /v1): la firma cubre método, path y timestamp.
      const path = `/v1/internal/moderation/${encodeURIComponent(userId)}`;
      const response = await fetchImpl(`${base}${path}`, {
        method: 'GET',
        headers: signInternalRequestHeaders({
          method: 'GET',
          path,
          secret: options.internalSecret,
        }),
        signal: controller.signal,
      });
      if (!response.ok) return null;
      const parsed = ModerationSnapshotSchema.safeParse(await response.json());
      if (!parsed.success) return null;
      return {
        accountStatus: parsed.data.accountStatus,
        mutedUntilMs: parsed.data.mutedUntil ? Date.parse(parsed.data.mutedUntil) : null,
        statusReason: parsed.data.statusReason,
        statusExpiresAtMs: parsed.data.statusExpiresAt
          ? Date.parse(parsed.data.statusExpiresAt)
          : null,
      };
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  };
}
