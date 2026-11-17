import { describe, expect, it } from 'vitest';
import { getCardById } from '../src/cards.js';
import { applyAction, createGameWithHands } from '../src/engine.js';
import { handleCallEnvido, handleCallFlor } from '../src/handlers/secondary-handlers.js';
import { handleCallTruco, handleRespondTruco } from '../src/handlers/truco-fold-handlers.js';
import { legalActions } from '../src/legal-actions.js';
import { createSeededRng } from '../src/rng.js';
import {
  AR_CORTO_15_V1,
  AR_SIN_FLOR_V1,
  AR_STANDARD_V1,
  createRuleSetVariant,
} from '../src/rulesets.js';
import type { CardId, PlayerSeat } from '../src/types.js';

const SEATS_2V2: PlayerSeat[] = [
  { seat: 0, team: 0, playerId: 'p0' },
  { seat: 1, team: 1, playerId: 'p1' },
  { seat: 2, team: 0, playerId: 'p2' },
  { seat: 3, team: 1, playerId: 'p3' },
];

const SEATS_1V1: PlayerSeat[] = [
  { seat: 0, team: 0 },
  { seat: 1, team: 1 },
];

function hand(...ids: [CardId, CardId, CardId]) {
  return ids.map((id) => getCardById(id)!);
}

describe('2v2 Responder Selection Modes (NEXT_IN_TURN, PIE_OF_TEAM, ANY_TEAM_MEMBER) & Handler Branches', () => {
  it('defaults to NEXT_IN_TURN: same caller always receives response from next rival in turn order across mano rotations', () => {
    const hands = {
      0: hand('1-espadas', '2-oros', '4-copas'),
      1: hand('3-oros', '5-bastos', '6-espadas'),
      2: hand('1-bastos', '2-copas', '4-bastos'),
      3: hand('7-espadas', '6-oros', '5-copas'),
    };

    // Caso A: manoSeat = 3 (como Mano #4): Seat 3 canta TRUCO -> siguiente rival en orden es Seat 0
    const gMano3 = createGameWithHands({
      ruleset: AR_SIN_FLOR_V1,
      players: SEATS_2V2,
      manoSeat: 3,
      handsBySeat: hands,
      rng: createSeededRng(1),
    });
    const callA = applyAction(gMano3, { type: 'CALL_TRUCO', seat: 3, bid: 'TRUCO' });
    expect(callA.ok).toBe(true);
    if (!callA.ok) return;

    expect(callA.value.state.hand.activeSeat).toBe(0);
    expect(legalActions(callA.value.state, 0).some((a) => a.type === 'RESPOND_TRUCO')).toBe(true);
    expect(legalActions(callA.value.state, 2).some((a) => a.type === 'RESPOND_TRUCO')).toBe(false);
    expect(
      applyAction(callA.value.state, { type: 'RESPOND_TRUCO', seat: 2, decision: 'QUIERO' }).ok,
    ).toBe(false);

    // Caso B: manoSeat = 1 (como Mano #2): cuando le toca a Seat 3 y canta ENVIDO/TRUCO, TAMBIÉN responde Seat 0
    let gMano1 = createGameWithHands({
      ruleset: AR_SIN_FLOR_V1,
      players: SEATS_2V2,
      manoSeat: 1,
      handsBySeat: hands,
      rng: createSeededRng(2),
    });
    for (const act of [
      { type: 'PLAY_CARD' as const, seat: 1, cardId: '3-oros' as CardId },
      { type: 'PLAY_CARD' as const, seat: 2, cardId: '4-bastos' as CardId },
    ]) {
      const step = applyAction(gMano1, act);
      expect(step.ok).toBe(true);
      if (step.ok) gMano1 = step.value.state;
    }

    const callB = applyAction(gMano1, { type: 'CALL_ENVIDO', seat: 3, bid: 'ENVIDO' });
    expect(callB.ok).toBe(true);
    if (!callB.ok) return;

    expect(callB.value.state.hand.activeSeat).toBe(0);
    expect(legalActions(callB.value.state, 0).some((a) => a.type === 'RESPOND_ENVIDO')).toBe(true);
    expect(legalActions(callB.value.state, 2).some((a) => a.type === 'RESPOND_ENVIDO')).toBe(false);
  });

  it('supports configurable PIE_OF_TEAM and ANY_TEAM_MEMBER responder modes, plus partner Flor over pending Envido', () => {
    const hands = {
      0: hand('1-espadas', '2-oros', '4-copas'),
      1: hand('3-oros', '5-bastos', '6-espadas'),
      2: hand('1-bastos', '2-copas', '4-bastos'),
      3: hand('7-bastos', '6-bastos', '4-oros'),
    };

    // PIE_OF_TEAM con manoSeat = 3 -> en Equipo 0 (seats 0 y 2), el pie es Seat 2
    const rsPie = createRuleSetVariant(AR_SIN_FLOR_V1, {
      code: 'test-pie',
      responderSelectionMode: 'PIE_OF_TEAM',
    });
    const gPie = createGameWithHands({
      ruleset: rsPie,
      players: SEATS_2V2,
      manoSeat: 3,
      handsBySeat: hands,
      rng: createSeededRng(3),
    });
    const pieCall = applyAction(gPie, { type: 'CALL_TRUCO', seat: 3, bid: 'TRUCO' });
    expect(pieCall.ok).toBe(true);
    if (pieCall.ok) {
      expect(pieCall.value.state.hand.activeSeat).toBe(2);
      expect(legalActions(pieCall.value.state, 2).some((a) => a.type === 'RESPOND_TRUCO')).toBe(
        true,
      );
      expect(legalActions(pieCall.value.state, 0).some((a) => a.type === 'RESPOND_TRUCO')).toBe(
        false,
      );
    }

    // ANY_TEAM_MEMBER -> ambos integrantes del equipo rival pueden responder
    const rsAny = createRuleSetVariant(AR_SIN_FLOR_V1, {
      code: 'test-any',
      responderSelectionMode: 'ANY_TEAM_MEMBER',
    });
    const gAny = createGameWithHands({
      ruleset: rsAny,
      players: SEATS_2V2,
      manoSeat: 3,
      handsBySeat: hands,
      rng: createSeededRng(4),
    });
    const anyCall = applyAction(gAny, { type: 'CALL_TRUCO', seat: 3, bid: 'TRUCO' });
    expect(anyCall.ok).toBe(true);
    if (anyCall.ok) {
      expect(legalActions(anyCall.value.state, 0).some((a) => a.type === 'RESPOND_TRUCO')).toBe(
        true,
      );
      expect(legalActions(anyCall.value.state, 2).some((a) => a.type === 'RESPOND_TRUCO')).toBe(
        true,
      );
    }

    // Compañero con Flor (Seat 3) ante Envido cantado por Seat 0 hacia Seat 1 en NEXT_IN_TURN
    const gPartnerFlor = createGameWithHands({
      ruleset: AR_STANDARD_V1,
      players: SEATS_2V2,
      handsBySeat: {
        0: hand('7-oros', '6-oros', '4-copas'),
        1: hand('3-oros', '5-espadas', '6-espadas'),
        2: hand('1-bastos', '2-copas', '4-bastos'),
        3: hand('7-bastos', '6-bastos', '5-bastos'), // FLOR
      },
      rng: createSeededRng(5),
    });
    const env0 = applyAction(gPartnerFlor, { type: 'CALL_ENVIDO', seat: 0, bid: 'ENVIDO' });
    expect(env0.ok).toBe(true);
    if (env0.ok) {
      expect(env0.value.state.hand.activeSeat).toBe(1);
      expect(legalActions(env0.value.state, 3)).toContainEqual({
        type: 'CALL_FLOR',
        seat: 3,
        bid: 'FLOR',
      });
    }
  });

  it('covers Flor re-raises, Flor over pending Truco (CANCEL_TRUCO), fold on pending Envido reaching targetScore or CANCEL, and handler defensive guards', () => {
    // 1) FLOR -> CONTRAFLOR -> CONTRAFLOR_AL_RESTO -> CON_FLOR_QUIERO (cubre announcedFlorSeats ya existente)
    const gFlorChain = createGameWithHands({
      ruleset: AR_STANDARD_V1,
      players: SEATS_1V1,
      handsBySeat: {
        0: hand('7-oros', '6-oros', '5-oros'), // 38
        1: hand('7-bastos', '6-bastos', '5-bastos'), // 38
      },
      rng: createSeededRng(10),
    });
    const f1 = applyAction(gFlorChain, { type: 'CALL_FLOR', seat: 0, bid: 'FLOR' });
    expect(f1.ok).toBe(true);
    if (!f1.ok) return;
    const f2 = applyAction(f1.value.state, { type: 'CALL_FLOR', seat: 1, bid: 'CONTRAFLOR' });
    expect(f2.ok).toBe(true);
    if (!f2.ok) return;
    const f3 = applyAction(f2.value.state, {
      type: 'CALL_FLOR',
      seat: 0,
      bid: 'CONTRAFLOR_AL_RESTO',
    });
    expect(f3.ok).toBe(true);
    if (!f3.ok) return;
    const f4 = applyAction(f3.value.state, {
      type: 'RESPOND_FLOR',
      seat: 1,
      decision: 'CON_FLOR_QUIERO',
    });
    expect(f4.ok).toBe(true);
    if (f4.ok) {
      // Empate 38 a 38 -> gana Seat 0 por ser mano (30 pts al resto)
      expect(f4.value.state.winnerTeam).toBe(0);
    }

    // 2) TRUCO en R1 -> Seat 1 canta FLOR con CANCEL_TRUCO (por defecto en AR_STANDARD_V1)
    const tCall = applyAction(gFlorChain, { type: 'CALL_TRUCO', seat: 0, bid: 'TRUCO' });
    expect(tCall.ok).toBe(true);
    if (tCall.ok) {
      const fOver = applyAction(tCall.value.state, { type: 'CALL_FLOR', seat: 1, bid: 'FLOR' });
      expect(fOver.ok).toBe(true);
      if (fOver.ok) {
        expect(fOver.value.state.hand.truco.suspendedCaller).toBeNull();
      }
    }

    // 3) FOLD_HAND ante Envido pendiente cuando los puntos del envido alcanzan targetScore (TARGET_REACHED)
    const gFoldWin = createGameWithHands({
      ruleset: AR_CORTO_15_V1,
      players: SEATS_1V1,
      handsBySeat: {
        0: hand('7-oros', '6-oros', '4-copas'),
        1: hand('4-bastos', '5-copas', '6-espadas'),
      },
      scoresByTeam: { 0: 14, 1: 10 },
      rng: createSeededRng(11),
    });
    const envAt14 = applyAction(gFoldWin, { type: 'CALL_ENVIDO', seat: 0, bid: 'ENVIDO' });
    expect(envAt14.ok).toBe(true);
    if (envAt14.ok) {
      const foldAt14 = applyAction(envAt14.value.state, { type: 'FOLD_HAND', seat: 1 });
      expect(foldAt14.ok).toBe(true);
      if (foldAt14.ok) {
        expect(foldAt14.value.state.status).toBe('FINISHED');
        expect(foldAt14.value.events).toContainEqual({
          type: 'HAND_ENDED',
          handNumber: 1,
          winnerTeam: 0,
          pointsAwarded: 0,
          reason: 'TARGET_REACHED',
        });
      }
    }

    // 4) FOLD_HAND ante Envido pendiente con pendingEnvidoOnFold = 'CANCEL'
    const rsCancelEnv = createRuleSetVariant(AR_CORTO_15_V1, {
      code: 'test-cancel-env',
      envido: { pendingEnvidoOnFold: 'CANCEL' },
    });
    const gFoldCancel = createGameWithHands({
      ruleset: rsCancelEnv,
      players: SEATS_1V1,
      handsBySeat: {
        0: hand('7-oros', '6-oros', '4-copas'),
        1: hand('4-bastos', '5-copas', '6-espadas'),
      },
      rng: createSeededRng(12),
    });
    const envCancel = applyAction(gFoldCancel, { type: 'CALL_ENVIDO', seat: 0, bid: 'ENVIDO' });
    if (envCancel.ok) {
      const foldCancel = applyAction(envCancel.value.state, { type: 'FOLD_HAND', seat: 1 });
      expect(foldCancel.ok).toBe(true);
      if (foldCancel.ok) {
        // Solo 1 punto del mazo, 0 del envido cancelado
        expect(foldCancel.value.state.scoresByTeam[0]).toBe(1);
      }
    }

    // 5) Guardas defensivas directas de los handlers internos ante invocaciones inválidas
    expect(handleCallEnvido(gFoldCancel, 0, 0, 'ENVIDO').ok).toBe(true);
    if (envCancel.ok) {
      // Mismo equipo intenta volver a cantar envido
      expect(handleCallEnvido(envCancel.value.state, 0, 0, 'ENVIDO').ok).toBe(false);
    }
    expect(handleCallFlor(gFoldCancel, 0, 0, 'FLOR').ok).toBe(false);
    expect(handleCallTruco(gFoldCancel, 0, 0, 'RETRUCO').ok).toBe(false);
    expect(handleRespondTruco(gFoldCancel, 1, 'QUIERO').ok).toBe(false);
  });
});
