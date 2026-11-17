export const RATE_LIMIT_STORE = Symbol('RATE_LIMIT_STORE');

export interface RateLimitConsumeResult {
  readonly allowed: boolean;
  readonly remaining: number;
  readonly retryAfterMs: number;
}

export interface ProgressiveLockoutState {
  readonly failedCount: number;
  readonly lockedUntilMs: number | null;
}

export interface RateLimitStore {
  /**
   * Consume 1 unidad en una ventana deslizante de `windowMs` milisegundos.
   */
  consumeWindow(key: string, limit: number, windowMs: number): Promise<RateLimitConsumeResult>;

  /**
   * Obtiene el estado actual de bloqueo progresivo para una clave compuesta (p. ej. `cuenta + IP`).
   */
  getLockoutState(key: string): Promise<ProgressiveLockoutState>;

  /**
   * Registra un fallo sobre una clave compuesta y persiste `lockedUntilMs` con TTL `stateTtlMs`.
   */
  recordLockoutFailure(
    key: string,
    computeLockedUntilMs: (nextFailedCount: number) => number | null,
    stateTtlMs: number,
  ): Promise<ProgressiveLockoutState>;

  /**
   * Elimina el estado de bloqueo progresivo para una clave compuesta.
   */
  clearLockoutState(key: string): Promise<void>;

  /**
   * Incrementa un contador de eventos en ventana deslizante `windowMs` y devuelve el total activo.
   */
  incrementFailureCounter(key: string, windowMs: number): Promise<number>;

  /**
   * Consulta el total activo de eventos en ventana deslizante `windowMs`.
   */
  getFailureCounter(key: string, windowMs: number): Promise<number>;

  /**
   * Limpia un contador de fallos acumulado.
   */
  clearFailureCounter(key: string): Promise<void>;

  close(): Promise<void>;
}
