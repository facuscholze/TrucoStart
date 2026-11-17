import { describe, expect, it } from 'vitest';
import {
  BOT_DIFFICULTY_PARAMS,
  chooseBotAction,
  hasUnbeatableCard,
  buildCardKnowledge,
} from '../src/bot/index.js';
import { getCardById } from '../src/cards.js';
import { applyAction, createGameWithHands } from '../src/engine.js';
import { createSeededRng } from '../src/rng.js';
import { AR_STANDARD_V1 } from '../src/rulesets.js';
import type { CardId, PlayerSeat } from '../src/types.js';
import { viewFor } from '../src/view.js';

const SEATS_1V1: PlayerSeat[] = [
  { seat: 0, team: 0 },
  { seat: 1, team: 1 },
];

const hand = (...ids: [CardId, CardId, CardId]) => ids.map((id) => getCardById(id)!);

describe('M6 · IA de Truco (BL-010) — reglas obligatorias', () => {
  it('nunca rechaza un Vale Cuatro si tiene una carta imbatible sobre la mesa', () => {
    // Ronda 1: seat 0 gana con 12-bastos. Ronda 2: seat 1 conserva el 1-espadas (macho).
    const game = createGameWithHands({
      ruleset: AR_STANDARD_V1,
      players: SEATS_1V1,
      handsBySeat: {
        0: hand('12-bastos', '4-copas', '5-copas'),
        1: hand('1-espadas', '6-oros', '7-copas'),
      },
      rng: createSeededRng(41),
    });

    const step = (
      state: Parameters<typeof applyAction>[0],
      action: Parameters<typeof applyAction>[1],
    ) => {
      const result = applyAction(state, action);
      if (!result.ok)
        throw new Error(`Acción inválida ${JSON.stringify(action)}: ${result.error.code}`);
      return result.value.state;
    };

    let state = step(game, { type: 'PLAY_CARD', seat: 0, cardId: '12-bastos' });
    state = step(state, { type: 'PLAY_CARD', seat: 1, cardId: '6-oros' });
    expect(state.hand.currentRoundIndex).toBe(1);

    // Cadena de cantos hasta dejar un VALE_CUATRO pendiente para seat 1.
    state = step(state, { type: 'CALL_TRUCO', seat: 0, bid: 'TRUCO' });
    state = step(state, { type: 'CALL_TRUCO', seat: 1, bid: 'RETRUCO' });
    state = step(state, { type: 'CALL_TRUCO', seat: 0, bid: 'VALE_CUATRO' });
    expect(state.hand.truco.pending?.bid).toBe('VALE_CUATRO');

    const view = viewFor(state, 1);
    expect(hasUnbeatableCard(view, buildCardKnowledge(view))).toBe(true);

    for (const difficulty of ['EASY', 'MEDIUM', 'HARD'] as const) {
      const action = chooseBotAction(view, createSeededRng(7), difficulty);
      expect(action).toMatchObject({ type: 'RESPOND_TRUCO', seat: 1, decision: 'QUIERO' });
    }
  });

  it('no gasta la carta alta cuando la más baja alcanza para ganar la baza', () => {
    const game = createGameWithHands({
      ruleset: AR_STANDARD_V1,
      players: SEATS_1V1,
      handsBySeat: {
        0: hand('5-oros', '4-bastos', '3-copas'),
        1: hand('1-espadas', '5-copas', '6-oros'),
      },
      rng: createSeededRng(43),
    });
    const played = applyAction(game, { type: 'PLAY_CARD', seat: 0, cardId: '5-oros' });
    expect(played.ok).toBe(true);
    if (!played.ok) return;

    for (const difficulty of ['EASY', 'MEDIUM', 'HARD'] as const) {
      // 6-oros (poder 3) mata al 5-oros (poder 2): el 1-espadas queda guardado.
      expect(chooseBotAction(viewFor(played.value.state, 1), undefined, difficulty)).toEqual({
        type: 'PLAY_CARD',
        seat: 1,
        cardId: '6-oros',
      });
    }
  });

  it('canta Envido con un tanto alto (31) y ajusta el umbral según la dificultad (26)', () => {
    const build = (...ids: CardId[]) =>
      createGameWithHands({
        ruleset: AR_STANDARD_V1,
        players: SEATS_1V1,
        handsBySeat: {
          0: hand(ids[0]!, ids[1]!, ids[2]!),
          1: hand('5-bastos', '6-copas', '3-espadas'),
        },
        rng: createSeededRng(47),
      });

    // Tanto 31: cualquier nivel lo canta.
    const strongView = viewFor(build('7-oros', '4-oros', '5-copas'), 0);
    for (const difficulty of ['EASY', 'MEDIUM', 'HARD'] as const) {
      expect(chooseBotAction(strongView, undefined, difficulty).type).toBe('CALL_ENVIDO');
    }

    // Tanto 26: solo el nivel difícil baja el umbral lo suficiente para cantarlo.
    const mediumView = viewFor(build('5-oros', '1-oros', '4-espadas'), 0);
    expect(chooseBotAction(mediumView, undefined, 'HARD')).toMatchObject({
      type: 'CALL_ENVIDO',
      seat: 0,
      bid: 'ENVIDO',
    });
    expect(chooseBotAction(mediumView, undefined, 'EASY').type).not.toBe('CALL_ENVIDO');
    expect(chooseBotAction(mediumView, undefined, 'MEDIUM').type).not.toBe('CALL_ENVIDO');
  });

  it('expone parámetros explícitos y monótonos por dificultad (sin código duplicado)', () => {
    const { EASY, MEDIUM, HARD } = BOT_DIFFICULTY_PARAMS;
    expect(EASY.envidoCallThreshold).toBeGreaterThan(MEDIUM.envidoCallThreshold);
    expect(MEDIUM.envidoCallThreshold).toBeGreaterThan(HARD.envidoCallThreshold);
    expect(EASY.trucoAcceptStrength).toBeGreaterThan(MEDIUM.trucoAcceptStrength);
    expect(MEDIUM.trucoAcceptStrength).toBeGreaterThan(HARD.trucoAcceptStrength);
    expect(EASY.evaluationNoise).toBeGreaterThan(HARD.evaluationNoise);
    expect(EASY.usesCardMemory).toBe(false);
    expect(HARD.usesCardMemory).toBe(true);
    expect(Object.isFrozen(BOT_DIFFICULTY_PARAMS)).toBe(true);
  });
});
