/**
 * Configuración del módulo de ligas (M10b, entrega 2).
 *
 * Todo son límites de producto y de operación, no decisiones de reglas: el formato del
 * calendario, los plazos y los ascensos los define cada liga al crearse.
 */
export interface LeaguesRuntimeConfig {
  readonly nowFn: () => number;
  /** Ligas activas que una misma cuenta puede organizar a la vez. */
  readonly maxActivePerCreator: number;
  /** Ligas por ventana por cuenta (crear). */
  readonly createPerAccountMax: number;
  /** Ligas por ventana por IP (crear). */
  readonly createPerIpMax: number;
  /** Inscripciones por ventana por cuenta (incluye intentos rechazados). */
  readonly joinPerAccountMax: number;
  /**
   * Reprogramaciones por ventana por cuenta. Es un tope de abuso, distinto del límite por
   * partida (`maxReschedulesPerMatch`), que es una regla de la liga.
   */
  readonly reschedulePerAccountMax: number;
  readonly rateLimitWindowMs: number;
  /** Frecuencia del barrido que abre jornadas y define partidas vencidas. */
  readonly maintenanceIntervalMs: number;
  /** Tope de monedas virtuales que una liga puede repartir en total. */
  readonly maxTotalPrizeCoins: number;
  /**
   * Tope de partidas por jornada que se aprovisionan de una vez. Una jornada de 200
   * jugadores son 100 partidas: por encima de este número el barrido aprovisiona por tandas
   * para no abrir cien salas en un solo ciclo.
   */
  readonly maxRoomsPerSweep: number;
}

export const LEAGUES_RUNTIME_CONFIG = Symbol('LEAGUES_RUNTIME_CONFIG');

export function buildLeaguesRuntimeConfig(
  overrides: Partial<LeaguesRuntimeConfig> = {},
): LeaguesRuntimeConfig {
  const envNumber = (name: string): number | undefined => {
    const raw = process.env[name];
    if (raw === undefined || raw.trim().length === 0) return undefined;
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
  };

  return {
    nowFn: overrides.nowFn ?? Date.now,
    maxActivePerCreator:
      overrides.maxActivePerCreator ?? envNumber('LEAGUES_MAX_ACTIVE_PER_CREATOR') ?? 3,
    createPerAccountMax:
      overrides.createPerAccountMax ?? envNumber('LEAGUES_CREATE_PER_ACCOUNT') ?? 5,
    createPerIpMax: overrides.createPerIpMax ?? envNumber('LEAGUES_CREATE_PER_IP') ?? 10,
    joinPerAccountMax: overrides.joinPerAccountMax ?? envNumber('LEAGUES_JOIN_PER_ACCOUNT') ?? 30,
    reschedulePerAccountMax:
      overrides.reschedulePerAccountMax ?? envNumber('LEAGUES_RESCHEDULE_PER_ACCOUNT') ?? 10,
    rateLimitWindowMs: overrides.rateLimitWindowMs ?? 60 * 60 * 1000,
    maintenanceIntervalMs: overrides.maintenanceIntervalMs ?? 60_000,
    maxTotalPrizeCoins:
      overrides.maxTotalPrizeCoins ?? envNumber('LEAGUES_MAX_PRIZE_COINS') ?? 20_000,
    maxRoomsPerSweep: overrides.maxRoomsPerSweep ?? envNumber('LEAGUES_MAX_ROOMS_PER_SWEEP') ?? 50,
  };
}
