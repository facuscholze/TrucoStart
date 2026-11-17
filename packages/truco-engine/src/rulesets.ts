import { ok, type Result, type RuleError, ruleError, type TeamId } from './types.js';

export type EnvidoBidType = 'ENVIDO' | 'REAL_ENVIDO' | 'FALTA_ENVIDO';
export type FlorBidType = 'FLOR' | 'CONTRAFLOR' | 'CONTRAFLOR_AL_RESTO';
export type TrucoBidType = 'TRUCO' | 'RETRUCO' | 'VALE_CUATRO';

export type FaltaEnvidoMode = 'LEADER_REMAINING' | 'MALAS_MATCH_BUENAS_LEADER';
export type EnvidoFirstMode = 'CANCEL_TRUCO' | 'SUSPEND_TRUCO' | 'DISABLED';
export type PendingEnvidoOnFoldMode = 'AWARD_DECLINED_POINTS' | 'CANCEL';
export type TimeoutOnTurnMode = 'FOLD_HAND' | 'PLAY_LOWEST_CARD';
export type ResponderSelectionMode = 'NEXT_IN_TURN' | 'PIE_OF_TEAM' | 'ANY_TEAM_MEMBER';

export interface EnvidoRules {
  readonly envidoPoints: number;
  readonly realEnvidoPoints: number;
  readonly maxEnvidoRepeats: number;
  readonly declinedBasePoints: number;
  readonly faltaEnvidoMode: FaltaEnvidoMode;
  readonly envidoFirstMode: EnvidoFirstMode;
  readonly pendingEnvidoOnFold: PendingEnvidoOnFoldMode;
}

export interface FlorRules {
  readonly enabled: boolean;
  readonly florPoints: number;
  readonly conFlorQuieroPoints: number;
  readonly contraflorPoints: number;
  readonly contraflorDeclinedPoints: number;
  readonly allowContraflor: boolean;
  readonly allowContraflorAlResto: boolean;
}

export interface TrucoRules {
  readonly baseHandPoints: number;
  readonly trucoPoints: number;
  readonly retrucoPoints: number;
  readonly valeCuatroPoints: number;
}

export interface ManoDeOnceRules {
  readonly enabled: boolean;
  readonly forbidTrucoByLeadingTeamAtMinusOne: boolean;
}

export interface SignalRules {
  readonly enabled: boolean;
  readonly maxSignalsPerHandPerPlayer: number;
}

export interface SystemActionRules {
  readonly timeoutOnTurn: TimeoutOnTurnMode;
  readonly maxConsecutiveTimeoutsBeforeAbandon: number;
}

export interface RuleSet {
  readonly code: string;
  readonly version: number;
  readonly name: string;
  readonly targetScore: number;
  readonly malasScoreThreshold: number;
  readonly responderSelectionMode: ResponderSelectionMode;
  readonly envido: EnvidoRules;
  readonly flor: FlorRules;
  readonly truco: TrucoRules;
  readonly manoDeOnce: ManoDeOnceRules;
  readonly signals: SignalRules;
  readonly system: SystemActionRules;
}

export const AR_STANDARD_V1: RuleSet = Object.freeze<RuleSet>({
  code: 'ar-standard-v1',
  version: 1,
  name: 'Truco Argentino Estándar (a 30, con Flor)',
  targetScore: 30,
  malasScoreThreshold: 15,
  responderSelectionMode: 'NEXT_IN_TURN',
  envido: {
    envidoPoints: 2,
    realEnvidoPoints: 3,
    maxEnvidoRepeats: 2,
    declinedBasePoints: 1,
    faltaEnvidoMode: 'LEADER_REMAINING',
    envidoFirstMode: 'CANCEL_TRUCO',
    pendingEnvidoOnFold: 'AWARD_DECLINED_POINTS',
  },
  flor: {
    enabled: true,
    florPoints: 3,
    conFlorQuieroPoints: 4,
    contraflorPoints: 6,
    contraflorDeclinedPoints: 4,
    allowContraflor: true,
    allowContraflorAlResto: true,
  },
  truco: {
    baseHandPoints: 1,
    trucoPoints: 2,
    retrucoPoints: 3,
    valeCuatroPoints: 4,
  },
  manoDeOnce: {
    enabled: false,
    forbidTrucoByLeadingTeamAtMinusOne: true,
  },
  signals: {
    enabled: true,
    maxSignalsPerHandPerPlayer: 3,
  },
  system: {
    timeoutOnTurn: 'FOLD_HAND',
    maxConsecutiveTimeoutsBeforeAbandon: 3,
  },
});

export const AR_SIN_FLOR_V1: RuleSet = Object.freeze<RuleSet>({
  ...AR_STANDARD_V1,
  code: 'ar-sin-flor-v1',
  name: 'Truco Argentino Sin Flor (a 30)',
  flor: {
    ...AR_STANDARD_V1.flor,
    enabled: false,
    allowContraflor: false,
    allowContraflorAlResto: false,
  },
});

export const AR_CORTO_15_V1: RuleSet = Object.freeze<RuleSet>({
  ...AR_SIN_FLOR_V1,
  code: 'ar-corto-15-v1',
  name: 'Truco Argentino Corto (a 15, sin Flor)',
  targetScore: 15,
  malasScoreThreshold: 0,
});

export const AR_CORTO_15_FLOR_V1: RuleSet = Object.freeze<RuleSet>({
  ...AR_STANDARD_V1,
  code: 'ar-corto-15-flor-v1',
  name: 'Truco Argentino Corto con Flor (a 15, con Flor)',
  targetScore: 15,
  malasScoreThreshold: 0,
});

export const INITIAL_RULESETS: readonly RuleSet[] = Object.freeze([
  AR_STANDARD_V1,
  AR_SIN_FLOR_V1,
  AR_CORTO_15_V1,
]);

export interface RuleSetOverrides {
  readonly code?: string;
  readonly version?: number;
  readonly name?: string;
  readonly targetScore?: number;
  readonly malasScoreThreshold?: number;
  readonly responderSelectionMode?: ResponderSelectionMode;
  readonly envido?: Partial<EnvidoRules>;
  readonly flor?: Partial<FlorRules>;
  readonly truco?: Partial<TrucoRules>;
  readonly manoDeOnce?: Partial<ManoDeOnceRules>;
  readonly signals?: Partial<SignalRules>;
  readonly system?: Partial<SystemActionRules>;
}

export function createRuleSetVariant(base: RuleSet, overrides: RuleSetOverrides): RuleSet {
  return {
    ...base,
    ...overrides,
    envido: { ...base.envido, ...overrides.envido },
    flor: { ...base.flor, ...overrides.flor },
    truco: { ...base.truco, ...overrides.truco },
    manoDeOnce: { ...base.manoDeOnce, ...overrides.manoDeOnce },
    signals: { ...base.signals, ...overrides.signals },
    system: { ...base.system, ...overrides.system },
  };
}

export function getRuleSetByCode(code: string): RuleSet | undefined {
  if (code === AR_CORTO_15_FLOR_V1.code) return AR_CORTO_15_FLOR_V1;
  return INITIAL_RULESETS.find((r) => r.code === code);
}

export function validateRuleSet(ruleset: RuleSet): Result<RuleSet, RuleError> {
  if (!ruleset.code || ruleset.targetScore < 5) {
    return ruleError('INVALID_RULESET', 'targetScore debe ser al menos 5 y code no vacío');
  }
  if (
    ruleset.truco.baseHandPoints < 1 ||
    ruleset.truco.trucoPoints <= ruleset.truco.baseHandPoints ||
    ruleset.truco.retrucoPoints <= ruleset.truco.trucoPoints ||
    ruleset.truco.valeCuatroPoints <= ruleset.truco.retrucoPoints
  ) {
    return ruleError('INVALID_RULESET', 'La escalera de puntos de truco debe ser creciente');
  }
  if (ruleset.envido.maxEnvidoRepeats < 1) {
    return ruleError('INVALID_RULESET', 'maxEnvidoRepeats debe ser >= 1');
  }
  if (ruleset.signals.maxSignalsPerHandPerPlayer < 0) {
    return ruleError('INVALID_RULESET', 'maxSignalsPerHandPerPlayer no puede ser negativo');
  }
  if (ruleset.system.maxConsecutiveTimeoutsBeforeAbandon < 1) {
    return ruleError('INVALID_RULESET', 'maxConsecutiveTimeoutsBeforeAbandon debe ser al menos 1');
  }
  return ok(ruleset);
}

/**
 * Calcula cuántos puntos otorga una Falta Envido o Contraflor al Resto según el RuleSet.
 */
export function calculateFaltaPoints(
  ruleset: RuleSet,
  scoresByTeam: Readonly<Record<TeamId, number>>,
  winningTeam: TeamId,
): number {
  const scores = Object.values(scoresByTeam);
  const maxScore = scores.length > 0 ? Math.max(...scores) : 0;

  if (
    ruleset.envido.faltaEnvidoMode === 'MALAS_MATCH_BUENAS_LEADER' &&
    maxScore < ruleset.malasScoreThreshold
  ) {
    const winnerCurrent = scoresByTeam[winningTeam] ?? 0;
    return Math.max(1, ruleset.targetScore - winnerCurrent);
  }

  return Math.max(1, ruleset.targetScore - maxScore);
}
