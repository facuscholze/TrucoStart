/**
 * Parámetros explícitos por nivel de dificultad de la IA (BL-010).
 * Un único algoritmo los consume: no hay código duplicado por nivel.
 */
export type BotDifficulty = 'EASY' | 'MEDIUM' | 'HARD';

export interface BotParams {
  readonly difficulty: BotDifficulty;
  /** Tanto mínimo para cantar Envido de entrada (0..33). */
  readonly envidoCallThreshold: number;
  /** Tanto mínimo para subir a Real Envido. */
  readonly envidoRaiseThreshold: number;
  /** Probabilidad estimada mínima de ganar el envido para responder "Quiero". */
  readonly envidoAcceptProbability: number;
  /** Fuerza de mano mínima para cantar/subir Truco. */
  readonly trucoRaiseStrength: number;
  /** Fuerza de mano mínima para aceptar un Truco/Retruco. */
  readonly trucoAcceptStrength: number;
  /** Probabilidad de farol moderado (cantar Truco con mano floja). */
  readonly bluffRate: number;
  /** Ruido aplicado a la evaluación de fuerza (0 = perfecto, 1 = muy ruidoso). */
  readonly evaluationNoise: number;
  /** Probabilidad de cometer una jugada subóptima de carta (nivel fácil). */
  readonly cardMistakeRate: number;
  /** Si es true, recuerda cartas jugadas y estima probabilidades; si no, juega "a ciegas". */
  readonly usesCardMemory: boolean;
}

export const BOT_DIFFICULTY_PARAMS: Readonly<Record<BotDifficulty, BotParams>> = Object.freeze({
  EASY: Object.freeze({
    difficulty: 'EASY',
    envidoCallThreshold: 30,
    envidoRaiseThreshold: 33,
    envidoAcceptProbability: 0.62,
    trucoRaiseStrength: 0.85,
    trucoAcceptStrength: 0.62,
    bluffRate: 0.02,
    evaluationNoise: 0.22,
    cardMistakeRate: 0.15,
    usesCardMemory: false,
  }),
  MEDIUM: Object.freeze({
    difficulty: 'MEDIUM',
    envidoCallThreshold: 27,
    envidoRaiseThreshold: 32,
    envidoAcceptProbability: 0.55,
    trucoRaiseStrength: 0.7,
    trucoAcceptStrength: 0.5,
    bluffRate: 0.07,
    evaluationNoise: 0.1,
    cardMistakeRate: 0.05,
    usesCardMemory: true,
  }),
  HARD: Object.freeze({
    difficulty: 'HARD',
    envidoCallThreshold: 25,
    envidoRaiseThreshold: 31,
    envidoAcceptProbability: 0.65,
    trucoRaiseStrength: 0.78,
    trucoAcceptStrength: 0.4,
    bluffRate: 0.12,
    evaluationNoise: 0.03,
    cardMistakeRate: 0,
    usesCardMemory: true,
  }),
} as const);

export function resolveBotParams(difficultyOrParams?: BotDifficulty | BotParams): BotParams {
  if (!difficultyOrParams) return BOT_DIFFICULTY_PARAMS.MEDIUM;
  if (typeof difficultyOrParams === 'string') {
    return BOT_DIFFICULTY_PARAMS[difficultyOrParams] ?? BOT_DIFFICULTY_PARAMS.MEDIUM;
  }
  return difficultyOrParams;
}
