import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { chooseBotAction } from '../src/bot/index.js';
import { getCardById } from '../src/cards.js';
import { applyAction, createGame, createGameWithHands } from '../src/engine.js';
import { createSeededRng } from '../src/rng.js';
import { AR_CORTO_15_V1, AR_STANDARD_V1 } from '../src/rulesets.js';
import type { CardId, PlayerSeat } from '../src/types.js';
import { viewFor } from '../src/view.js';

const SEATS_1V1: PlayerSeat[] = [
  { seat: 0, team: 0 },
  { seat: 1, team: 1 },
];

const SEATS_2V2: PlayerSeat[] = [
  { seat: 0, team: 0 },
  { seat: 1, team: 1 },
  { seat: 2, team: 0 },
  { seat: 3, team: 1 },
];

describe('Non-cheating Heuristic AI (chooseBotAction)', () => {
  it('structurally never imports GameState or engine internals, consuming strictly PlayerView', () => {
    const currentDir = path.dirname(fileURLToPath(import.meta.url));
    const botSource = fs.readFileSync(path.resolve(currentDir, '../src/bot/index.ts'), 'utf8');
    expect(botSource).not.toContain('GameState');
    expect(botSource).not.toContain('remainingHandsBySeat');
    expect(botSource).not.toContain('initialHandsBySeat');
    expect(botSource).not.toContain('internalPrngState');
  });

  it('makes sound tactical choices on Flor, Envido, Signals and cheapest-winning-card', () => {
    const hand = (...ids: [CardId, CardId, CardId]) => ids.map((id) => getCardById(id)!);

    // 1) Siempre canta FLOR cuando la tiene en mano
    const gFlor = createGameWithHands({
      ruleset: AR_STANDARD_V1,
      players: SEATS_1V1,
      handsBySeat: {
        0: hand('7-oros', '6-oros', '5-oros'),
        1: hand('4-copas', '5-bastos', '6-espadas'),
      },
      rng: createSeededRng(1),
    });
    expect(chooseBotAction(viewFor(gFlor, 0))).toEqual({
      type: 'CALL_FLOR',
      seat: 0,
      bid: 'FLOR',
    });

    // 2) Canta REAL_ENVIDO con 32 de tanto sin flor
    const gEnv = createGameWithHands({
      ruleset: AR_STANDARD_V1,
      players: SEATS_1V1,
      handsBySeat: {
        0: hand('7-oros', '5-oros', '1-espadas'), // 32 envido
        1: hand('4-copas', '5-bastos', '6-espadas'),
      },
      rng: createSeededRng(2),
    });
    expect(chooseBotAction(viewFor(gEnv, 0))).toEqual({
      type: 'CALL_ENVIDO',
      seat: 0,
      bid: 'REAL_ENVIDO',
    });

    // 3) En 2v2 envía seña de ancho de espadas antes de jugar y luego mata con lo justo
    const g2v2 = createGameWithHands({
      ruleset: AR_STANDARD_V1,
      players: SEATS_2V2,
      handsBySeat: {
        0: hand('12-oros', '5-copas', '4-bastos'),
        1: hand('1-espadas', '2-oros', '4-copas'),
        2: hand('6-oros', '5-oros', '4-oros'),
        3: hand('7-bastos', '6-espadas', '5-espadas'),
      },
      rng: createSeededRng(3),
    });
    const afterS0 = applyAction(g2v2, { type: 'PLAY_CARD', seat: 0, cardId: '12-oros' });
    expect(afterS0.ok).toBe(true);
    if (!afterS0.ok) return;

    // Seat 1 tiene 1-espadas -> envía seña guino_ojo primero
    const sigChoice = chooseBotAction(viewFor(afterS0.value.state, 1));
    expect(sigChoice).toEqual({ type: 'SEND_SIGNAL', seat: 1, signalId: 'guino_ojo' });

    const afterSig = applyAction(afterS0.value.state, sigChoice);
    expect(afterSig.ok).toBe(true);
    if (!afterSig.ok) return;

    // Para matar al 12-oros (power 7), elige 2-oros (power 9) en vez de gastar el 1-espadas (power 14)
    const playChoice = chooseBotAction(viewFor(afterSig.value.state, 1));
    expect(playChoice).toEqual({ type: 'PLAY_CARD', seat: 1, cardId: '2-oros' });

    // Error explícito si legalActions está vacío (partida terminada)
    const ended = applyAction(gFlor, { type: 'SYSTEM_ABANDON', seat: 0 });
    if (ended.ok) {
      expect(() => chooseBotAction(viewFor(ended.value.state, 0))).toThrow();
    }
  });

  it('decisively outperforms a uniform random player (> 75% win rate over 200 matches)', () => {
    let botWins = 0;
    const totalMatches = 200;

    for (let i = 1; i <= totalMatches; i++) {
      const rng = createSeededRng(10_000 + i);
      let state = createGame(AR_CORTO_15_V1, SEATS_1V1, rng);

      while (state.status === 'IN_PROGRESS') {
        const seat = state.hand.activeSeat;
        const view = viewFor(state, seat);
        const action =
          seat === 0
            ? chooseBotAction(view, rng)
            : view.legalActions[Math.floor(rng.nextFloat() * view.legalActions.length)]!;

        const step = applyAction(state, action);
        expect(step.ok).toBe(true);
        if (!step.ok) break;
        state = step.value.state;
      }

      if (state.winnerTeam === 0) {
        botWins++;
      }
    }

    expect(botWins / totalMatches).toBeGreaterThan(0.75);
  });
});
