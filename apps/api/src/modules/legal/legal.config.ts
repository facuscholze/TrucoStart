import { LEGAL_MIN_AGE_DEFAULT } from '@truco/shared';

export const LEGAL_RUNTIME_CONFIG = Symbol('LEGAL_RUNTIME_CONFIG');

export interface LegalRuntimeConfig {
  /** Edad mínima exigida para crear cuenta (configurable por `LEGAL_MIN_AGE`). */
  readonly minAge: number;
}

/**
 * Lee `LEGAL_MIN_AGE` del entorno. Si falta o no es numérica cae al valor por
 * defecto (18, la opción más conservadora). El rango se valida en el servicio.
 */
export function buildLegalRuntimeConfig(
  env: Record<string, string | undefined> = process.env,
): LegalRuntimeConfig {
  const raw = env['LEGAL_MIN_AGE'];
  if (raw === undefined || raw.trim() === '') return { minAge: LEGAL_MIN_AGE_DEFAULT };
  const parsed = Number.parseInt(raw.trim(), 10);
  return { minAge: Number.isNaN(parsed) ? LEGAL_MIN_AGE_DEFAULT : parsed };
}
