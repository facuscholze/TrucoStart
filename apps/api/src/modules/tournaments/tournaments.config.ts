/**
 * Configuración del módulo de torneos (M10a).
 *
 * Todo son límites de producto, no decisiones de reglas: los plazos de inscripción y
 * check-in los define cada torneo al crearse.
 */
export interface TournamentsRuntimeConfig {
  readonly nowFn: () => number;
  /** Torneos privados activos que una misma cuenta puede tener a la vez. */
  readonly maxActivePrivatePerCreator: number;
  /** Torneos por ventana por cuenta (crear). */
  readonly createPerAccountMax: number;
  /** Torneos por ventana por IP (crear). */
  readonly createPerIpMax: number;
  /** Inscripciones por ventana por cuenta (incluye intentos rechazados). */
  readonly registerPerAccountMax: number;
  readonly rateLimitWindowMs: number;
  /** Frecuencia del barrido que arranca torneos y resuelve incomparecencias. */
  readonly maintenanceIntervalMs: number;
  /** Tope de monedas virtuales que un torneo puede repartir en total. */
  readonly maxTotalPrizeCoins: number;
}

export const TOURNAMENTS_RUNTIME_CONFIG = Symbol('TOURNAMENTS_RUNTIME_CONFIG');

export function buildTournamentsRuntimeConfig(
  overrides: Partial<TournamentsRuntimeConfig> = {},
): TournamentsRuntimeConfig {
  const envNumber = (name: string): number | undefined => {
    const raw = process.env[name];
    if (raw === undefined || raw.trim().length === 0) return undefined;
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
  };

  return {
    nowFn: overrides.nowFn ?? Date.now,
    maxActivePrivatePerCreator:
      overrides.maxActivePrivatePerCreator ?? envNumber('TOURNAMENTS_MAX_ACTIVE_PRIVATE') ?? 3,
    createPerAccountMax:
      overrides.createPerAccountMax ?? envNumber('TOURNAMENTS_CREATE_PER_ACCOUNT') ?? 5,
    createPerIpMax: overrides.createPerIpMax ?? envNumber('TOURNAMENTS_CREATE_PER_IP') ?? 10,
    registerPerAccountMax:
      overrides.registerPerAccountMax ?? envNumber('TOURNAMENTS_REGISTER_PER_ACCOUNT') ?? 20,
    rateLimitWindowMs: overrides.rateLimitWindowMs ?? 60 * 60 * 1000,
    maintenanceIntervalMs: overrides.maintenanceIntervalMs ?? 30_000,
    maxTotalPrizeCoins:
      overrides.maxTotalPrizeCoins ?? envNumber('TOURNAMENTS_MAX_PRIZE_COINS') ?? 5_000,
  };
}
