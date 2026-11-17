import { describe, expect, it } from 'vitest';
import {
  acceptPendingTruco,
  applyTrucoBid,
  canTeamCallTrucoBid,
  createInitialTrucoState,
  getLegalEnvidoBids,
  getLegalFlorRaises,
  pushEnvidoBid,
  pushFlorBid,
  resolveEnvidoAcceptedPoints,
  resolveFlorAcceptedPoints,
} from '../src/calls.js';
import { AR_SIN_FLOR_V1, AR_STANDARD_V1, createRuleSetVariant } from '../src/rulesets.js';

describe('Call state machines: Envido, Flor & Truco', () => {
  it('evaluates full Envido chains (E -> E -> RE -> FE) with exact accepted and declined points', () => {
    const scores = { 0: 10, 1: 18 };
    const step1 = pushEnvidoBid(AR_STANDARD_V1, null, 'ENVIDO', 0, 0);
    expect(step1.ok).toBe(true);
    if (!step1.ok) return;
    expect(step1.value.declinedPoints).toBe(1);
    expect(resolveEnvidoAcceptedPoints(AR_STANDARD_V1, step1.value, scores, 0)).toBe(2);

    // El mismo equipo no puede subir su propio canto
    expect(pushEnvidoBid(AR_STANDARD_V1, step1.value, 'ENVIDO', 2, 0).ok).toBe(false);

    const step2 = pushEnvidoBid(AR_STANDARD_V1, step1.value, 'ENVIDO', 1, 1);
    expect(step2.ok).toBe(true);
    if (!step2.ok) return;
    expect(step2.value.declinedPoints).toBe(2);
    expect(resolveEnvidoAcceptedPoints(AR_STANDARD_V1, step2.value, scores, 1)).toBe(4);

    // No se permite un 3er ENVIDO cuando maxEnvidoRepeats = 2
    expect(getLegalEnvidoBids(AR_STANDARD_V1, step2.value)).toEqual([
      'REAL_ENVIDO',
      'FALTA_ENVIDO',
    ]);
    expect(pushEnvidoBid(AR_STANDARD_V1, step2.value, 'ENVIDO', 0, 0).ok).toBe(false);

    const step3 = pushEnvidoBid(AR_STANDARD_V1, step2.value, 'REAL_ENVIDO', 0, 0);
    expect(step3.ok).toBe(true);
    if (!step3.ok) return;
    expect(step3.value.declinedPoints).toBe(4);
    expect(resolveEnvidoAcceptedPoints(AR_STANDARD_V1, step3.value, scores, 0)).toBe(7);

    // No se puede volver atrás de REAL_ENVIDO a ENVIDO
    expect(getLegalEnvidoBids(AR_STANDARD_V1, step3.value)).toEqual(['FALTA_ENVIDO']);
    expect(pushEnvidoBid(AR_STANDARD_V1, step3.value, 'REAL_ENVIDO', 1, 1).ok).toBe(false);

    const step4 = pushEnvidoBid(AR_STANDARD_V1, step3.value, 'FALTA_ENVIDO', 1, 1);
    expect(step4.ok).toBe(true);
    if (!step4.ok) return;
    expect(step4.value.declinedPoints).toBe(7);
    expect(getLegalEnvidoBids(AR_STANDARD_V1, step4.value)).toEqual([]);
    // Líder tiene 18 -> faltan 12 para llegar a 30
    expect(resolveEnvidoAcceptedPoints(AR_STANDARD_V1, step4.value, scores, 0)).toBe(12);
  });

  it('evaluates direct REAL_ENVIDO and direct FALTA_ENVIDO', () => {
    const directReal = pushEnvidoBid(AR_STANDARD_V1, null, 'REAL_ENVIDO', 0, 0);
    expect(directReal.ok).toBe(true);
    if (directReal.ok) {
      expect(directReal.value.declinedPoints).toBe(1);
      expect(directReal.value.acceptedStaticPoints).toBe(3);
    }

    const directFalta = pushEnvidoBid(AR_STANDARD_V1, null, 'FALTA_ENVIDO', 1, 1);
    expect(directFalta.ok).toBe(true);
    if (directFalta.ok) {
      expect(directFalta.value.declinedPoints).toBe(1);
      expect(directFalta.value.acceptedStaticPoints).toBeNull();
    }
  });

  it('evaluates Flor -> Contraflor -> Contraflor al Resto and respects flor.enabled = false', () => {
    expect(getLegalFlorRaises(AR_SIN_FLOR_V1, null)).toEqual([]);
    expect(pushFlorBid(AR_SIN_FLOR_V1, null, 'FLOR', 0, 0).ok).toBe(false);

    const flor1 = pushFlorBid(AR_STANDARD_V1, null, 'FLOR', 0, 0);
    expect(flor1.ok).toBe(true);
    if (!flor1.ok) return;
    expect(flor1.value.declinedPoints).toBe(3);
    expect(resolveFlorAcceptedPoints(AR_STANDARD_V1, flor1.value, { 0: 20, 1: 10 }, 0)).toBe(4);
    expect(pushFlorBid(AR_STANDARD_V1, flor1.value, 'CONTRAFLOR', 2, 0).ok).toBe(false);

    const contra = pushFlorBid(AR_STANDARD_V1, flor1.value, 'CONTRAFLOR', 1, 1);
    expect(contra.ok).toBe(true);
    if (!contra.ok) return;
    expect(contra.value.declinedPoints).toBe(4);
    expect(resolveFlorAcceptedPoints(AR_STANDARD_V1, contra.value, { 0: 20, 1: 10 }, 1)).toBe(6);

    const resto = pushFlorBid(AR_STANDARD_V1, contra.value, 'CONTRAFLOR_AL_RESTO', 0, 0);
    expect(resto.ok).toBe(true);
    if (!resto.ok) return;
    expect(resto.value.declinedPoints).toBe(6);
    expect(getLegalFlorRaises(AR_STANDARD_V1, resto.value)).toEqual([]);
    expect(resolveFlorAcceptedPoints(AR_STANDARD_V1, resto.value, { 0: 20, 1: 10 }, 0)).toBe(10);
  });

  it('evaluates Truco -> Retruco -> Vale Cuatro (immediate and deferred) and Mano de Once', () => {
    const scores = { 0: 5, 1: 5 };
    const s0 = createInitialTrucoState(AR_STANDARD_V1);
    expect(s0.currentPoints).toBe(1);
    expect(acceptPendingTruco(s0).ok).toBe(false);

    const t1 = applyTrucoBid(AR_STANDARD_V1, s0, 'TRUCO', 0, 0, scores);
    expect(t1.ok).toBe(true);
    if (!t1.ok) return;
    expect(t1.value.pending?.declinedPoints).toBe(1);
    expect(t1.value.pending?.targetPoints).toBe(2);
    expect(canTeamCallTrucoBid(AR_STANDARD_V1, t1.value, 0, scores)).toBeNull();

    // Quiero y Retruco directo
    const r1 = applyTrucoBid(AR_STANDARD_V1, t1.value, 'RETRUCO', 1, 1, scores);
    expect(r1.ok).toBe(true);
    if (!r1.ok) return;
    expect(r1.value.currentPoints).toBe(2);
    expect(r1.value.pending?.declinedPoints).toBe(2);
    expect(r1.value.pending?.targetPoints).toBe(3);

    // Aceptado con QUIERO y luego Vale Cuatro diferido
    const r1Accepted = acceptPendingTruco(r1.value);
    expect(r1Accepted.ok).toBe(true);
    if (!r1Accepted.ok) return;
    expect(r1Accepted.value.currentPoints).toBe(3);
    expect(canTeamCallTrucoBid(AR_STANDARD_V1, r1Accepted.value, 1, scores)).toBeNull();
    expect(canTeamCallTrucoBid(AR_STANDARD_V1, r1Accepted.value, 0, scores)).toBe('VALE_CUATRO');

    const vc = applyTrucoBid(AR_STANDARD_V1, r1Accepted.value, 'VALE_CUATRO', 0, 0, scores);
    expect(vc.ok).toBe(true);
    if (!vc.ok) return;
    const vcAccepted = acceptPendingTruco(vc.value);
    expect(vcAccepted.ok).toBe(true);
    if (!vcAccepted.ok) return;
    expect(vcAccepted.value.currentPoints).toBe(4);
    expect(canTeamCallTrucoBid(AR_STANDARD_V1, vcAccepted.value, 1, scores)).toBeNull();

    // Mano de once activa
    const rsManoOnce = createRuleSetVariant(AR_STANDARD_V1, {
      manoDeOnce: { enabled: true, forbidTrucoByLeadingTeamAtMinusOne: true },
    });
    expect(canTeamCallTrucoBid(rsManoOnce, s0, 0, { 0: 29, 1: 20 })).toBeNull();
    expect(canTeamCallTrucoBid(rsManoOnce, s0, 1, { 0: 29, 1: 20 })).toBe('TRUCO');
  });
});
