import { buildSignedInternalRpcHeaders, signInternalRequestHeaders } from '@truco/shared';

export const USER_EVICTION = Symbol('USER_EVICTION');

export interface UserEvictionRequest {
  readonly userId: string;
  readonly reason: string;
  /** `true` corta la conexión WS y libera el asiento; `false` sólo invalida el caché. */
  readonly disconnect: boolean;
}

export interface UserEvictionPort {
  /**
   * Avisa al game-server que un usuario sancionado debe salir del juego de inmediato.
   * Es best-effort: si el game-server no responde, la sanción igual queda aplicada en la API.
   */
  evict(request: UserEvictionRequest): Promise<{ evicted: boolean; rooms: string[] }>;
}

/** Cliente HTTP firmado (HMAC + timestamp + nonce) hacia `apps/game-server`. */
export class HttpUserEvictionClient implements UserEvictionPort {
  constructor(
    private readonly options: {
      readonly baseUrl: string;
      readonly internalSecret: string;
      readonly timeoutMs?: number;
      readonly fetchImpl?: typeof fetch;
    },
  ) {}

  async evict(request: UserEvictionRequest): Promise<{ evicted: boolean; rooms: string[] }> {
    const fetchImpl = this.options.fetchImpl ?? fetch;
    const base = this.options.baseUrl.replace(/\/$/, '');
    const path = `/internal/users/${encodeURIComponent(request.userId)}/evict`;
    const rawBody = JSON.stringify({ reason: request.reason, disconnect: request.disconnect });
    const headers = signInternalRequestHeaders({
      method: 'POST',
      path,
      rawBody,
      secret: this.options.internalSecret,
    });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs ?? 2_000);
    try {
      const response = await fetchImpl(`${base}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body: rawBody,
        signal: controller.signal,
      });
      if (!response.ok) return { evicted: false, rooms: [] };
      const body = (await response.json()) as { evicted?: boolean; rooms?: string[] };
      return { evicted: body.evicted === true, rooms: body.rooms ?? [] };
    } catch {
      // Best-effort: la sanción ya está aplicada y el caché del game-server vence en 15 s.
      return { evicted: false, rooms: [] };
    } finally {
      clearTimeout(timer);
    }
  }
}

export { buildSignedInternalRpcHeaders };
