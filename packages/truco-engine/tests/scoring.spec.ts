import { describe, expect, it } from 'vitest';
import { createStandardDeck, getCardById } from '../src/cards.js';
import {
  envidoCardValue,
  isFlor,
  resolveShowdownWinner,
  scoreEnvido,
  scoreFlor,
  seatHandOrder,
} from '../src/scoring.js';
import type { Card } from '../src/types.js';

function referenceEnvido(c1: Card, c2: Card, c3: Card): number {
  const val = (c: Card) => (c.rank >= 10 ? 0 : c.rank);
  const pairs: Array<[Card, Card]> = [
    [c1, c2],
    [c1, c3],
    [c2, c3],
  ];
  let bestPair = -1;
  for (const [a, b] of pairs) {
    if (a.suit === b.suit) {
      bestPair = Math.max(bestPair, 20 + val(a) + val(b));
    }
  }
  if (bestPair >= 0) return bestPair;
  return Math.max(val(c1), val(c2), val(c3));
}

describe('Exhaustive Envido & Flor scoring (all 9,880 3-card hands)', () => {
  it('matches reference Envido and Flor formulas across all C(40, 3) = 9,880 hands', () => {
    const deck = createStandardDeck();
    let count = 0;
    let florCount = 0;

    for (let i = 0; i < deck.length; i++) {
      for (let j = i + 1; j < deck.length; j++) {
        for (let k = j + 1; k < deck.length; k++) {
          count++;
          const hand = [deck[i]!, deck[j]!, deck[k]!];
          const env = scoreEnvido(hand);
          const expectedEnv = referenceEnvido(hand[0]!, hand[1]!, hand[2]!);

          expect(env).toBe(expectedEnv);
          expect(env).toBeGreaterThanOrEqual(0);
          expect(env).toBeLessThanOrEqual(33);

          const sameSuit = hand[0]!.suit === hand[1]!.suit && hand[1]!.suit === hand[2]!.suit;
          expect(isFlor(hand)).toBe(sameSuit);

          if (sameSuit) {
            florCount++;
            const expectedFlor =
              20 +
              envidoCardValue(hand[0]!) +
              envidoCardValue(hand[1]!) +
              envidoCardValue(hand[2]!);
            expect(scoreFlor(hand)).toBe(expectedFlor);
            expect(scoreFlor(hand)).toBeGreaterThanOrEqual(20);
            expect(scoreFlor(hand)).toBeLessThanOrEqual(38);
          } else {
            expect(scoreFlor(hand)).toBe(0);
          }
        }
      }
    }

    expect(count).toBe(9880);
    // 4 palos * C(10, 3) = 4 * 120 = 480 flores posibles
    expect(florCount).toBe(480);
  });

  it('handles edge cases: empty cards, non-3-card flor check, three figures', () => {
    expect(scoreEnvido([])).toBe(0);
    expect(isFlor([getCardById('7-oros')!, getCardById('6-oros')!])).toBe(false);

    const threeFiguresDifferentSuits = [
      getCardById('10-oros')!,
      getCardById('11-copas')!,
      getCardById('12-espadas')!,
    ];
    expect(scoreEnvido(threeFiguresDifferentSuits)).toBe(0);

    const twoFiguresSameSuit = [
      getCardById('10-oros')!,
      getCardById('12-oros')!,
      getCardById('7-espadas')!,
    ];
    expect(scoreEnvido(twoFiguresSameSuit)).toBe(20);

    const maxFlor = [
      getCardById('7-espadas')!,
      getCardById('6-espadas')!,
      getCardById('5-espadas')!,
    ];
    expect(scoreFlor(maxFlor)).toBe(38);
    expect(scoreEnvido(maxFlor)).toBe(33);
  });

  it('breaks ties in showdown using counter-clockwise hand order from manoSeat', () => {
    expect(seatHandOrder(2, 2, 4)).toBe(0);
    expect(seatHandOrder(3, 2, 4)).toBe(1);
    expect(seatHandOrder(0, 2, 4)).toBe(2);
    expect(seatHandOrder(1, 2, 4)).toBe(3);

    // En 2v2 con manoSeat = 2: asiento 3 (orden 1) mata en empate al asiento 0 (orden 2)
    const winner = resolveShowdownWinner(
      [
        { seat: 0, team: 0, score: 27 },
        { seat: 1, team: 1, score: 24 },
        { seat: 2, team: 0, score: 21 },
        { seat: 3, team: 1, score: 27 },
      ],
      2,
      4,
    );
    expect(winner.winningSeat).toBe(3);
    expect(winner.winningTeam).toBe(1);
    expect(winner.winningScore).toBe(27);

    expect(() => resolveShowdownWinner([], 0, 2)).toThrow();
  });
});
