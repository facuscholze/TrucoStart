import { describe, expect, it } from 'vitest';
import {
  AR_CORTO_15_V1,
  AR_SIN_FLOR_V1,
  AR_STANDARD_V1,
  calculateFaltaPoints,
  createRuleSetVariant,
  getRuleSetByCode,
  INITIAL_RULESETS,
  validateRuleSet,
} from '../src/rulesets.js';
import { getSignalDefinition, isValidSignalId, SIGNALS_CATALOG } from '../src/signals.js';

describe('RuleSets, Falta Envido modes & Signals catalog', () => {
  it('exposes the 3 canonical Argentine RuleSets and validates overrides', () => {
    expect(INITIAL_RULESETS).toHaveLength(3);
    expect(getRuleSetByCode('ar-standard-v1')).toBe(AR_STANDARD_V1);
    expect(getRuleSetByCode('ar-sin-flor-v1')).toBe(AR_SIN_FLOR_V1);
    expect(getRuleSetByCode('ar-corto-15-v1')).toBe(AR_CORTO_15_V1);
    expect(getRuleSetByCode('nonexistent')).toBeUndefined();

    expect(AR_STANDARD_V1.flor.enabled).toBe(true);
    expect(AR_STANDARD_V1.targetScore).toBe(30);
    expect(AR_SIN_FLOR_V1.flor.enabled).toBe(false);
    expect(AR_CORTO_15_V1.targetScore).toBe(15);

    for (const rs of INITIAL_RULESETS) {
      expect(validateRuleSet(rs).ok).toBe(true);
    }

    expect(validateRuleSet(createRuleSetVariant(AR_STANDARD_V1, { targetScore: 2 })).ok).toBe(
      false,
    );
    expect(
      validateRuleSet(createRuleSetVariant(AR_STANDARD_V1, { truco: { trucoPoints: 1 } })).ok,
    ).toBe(false);
    expect(
      validateRuleSet(createRuleSetVariant(AR_STANDARD_V1, { envido: { maxEnvidoRepeats: 0 } })).ok,
    ).toBe(false);
    expect(
      validateRuleSet(
        createRuleSetVariant(AR_STANDARD_V1, { signals: { maxSignalsPerHandPerPlayer: -1 } }),
      ).ok,
    ).toBe(false);
  });

  it('calculates Falta Envido points in both LEADER_REMAINING and MALAS_MATCH_BUENAS_LEADER modes', () => {
    // LEADER_REMAINING: lo que le falta al líder para llegar a targetScore
    expect(calculateFaltaPoints(AR_STANDARD_V1, { 0: 8, 1: 12 }, 0)).toBe(18);
    expect(calculateFaltaPoints(AR_STANDARD_V1, { 0: 22, 1: 19 }, 1)).toBe(8);
    expect(calculateFaltaPoints(AR_CORTO_15_V1, { 0: 9, 1: 4 }, 1)).toBe(6);

    // MALAS_MATCH_BUENAS_LEADER: en malas (<15 ambos) gana el partido; en buenas lo que falta al líder
    const malasBuenasRs = createRuleSetVariant(AR_STANDARD_V1, {
      envido: { faltaEnvidoMode: 'MALAS_MATCH_BUENAS_LEADER' },
    });
    expect(calculateFaltaPoints(malasBuenasRs, { 0: 8, 1: 12 }, 0)).toBe(22); // 8 + 22 = 30
    expect(calculateFaltaPoints(malasBuenasRs, { 0: 16, 1: 12 }, 1)).toBe(14); // 30 - 16 = 14
  });

  it('loads signals.json catalog and validates signal IDs', () => {
    expect(SIGNALS_CATALOG.length).toBeGreaterThanOrEqual(8);
    expect(isValidSignalId('guino_ojo')).toBe(true);
    expect(isValidSignalId('unknown_signal')).toBe(false);
    expect(getSignalDefinition('guino_ojo')?.meaning).toContain('1 de espadas');
  });
});
