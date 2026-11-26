/**
 * Configuración de cliente para la tanda de pulido UX.
 *
 * Los umbrales son de interfaz, no de reglas del juego: viven acá para no repartirlos
 * en los componentes y para poder ajustarlos por entorno (`VITE_*`) sin tocar código.
 */

/**
 * Segundos de espera por un rival humano tras los cuales se ofrece automáticamente la
 * práctica contra la máquina como salida rápida (P1 de `docs/UX_AUDIT_M0-M9C.md`).
 * Se puede sobreescribir con `VITE_PRACTICE_FALLBACK_SECONDS`; si el valor no es un
 * entero dentro del rango admitido se usa el default.
 */
export const DEFAULT_PRACTICE_FALLBACK_SECONDS = 30;

const MIN_PRACTICE_FALLBACK_SECONDS = 5;
const MAX_PRACTICE_FALLBACK_SECONDS = 600;

function readFallbackSecondsFromEnv(): number {
  const raw = import.meta.env?.['VITE_PRACTICE_FALLBACK_SECONDS'] as string | undefined;
  if (!raw) return DEFAULT_PRACTICE_FALLBACK_SECONDS;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed)) return DEFAULT_PRACTICE_FALLBACK_SECONDS;
  if (parsed < MIN_PRACTICE_FALLBACK_SECONDS || parsed > MAX_PRACTICE_FALLBACK_SECONDS) {
    return DEFAULT_PRACTICE_FALLBACK_SECONDS;
  }
  return parsed;
}

export const PRACTICE_FALLBACK_SECONDS: number = readFallbackSecondsFromEnv();
