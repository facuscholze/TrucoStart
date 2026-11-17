import { describe, expect, it } from 'vitest';
import {
  CARDS_PER_PLAYER,
  compareCards,
  createStandardDeck,
  dealHands,
  getCardById,
  getTrucoPower,
  shuffleDeck,
} from '../src/cards.js';
import { createSeededRng } from '../src/rng.js';
import type { CardId } from '../src/types.js';

const EXPECTED_TIERS_HIGH_TO_LOW: readonly (readonly CardId[])[] = [
  ['1-espadas'],
  ['1-bastos'],
  ['7-espadas'],
  ['7-oros'],
  ['3-espadas', '3-bastos', '3-oros', '3-copas'],
  ['2-espadas', '2-bastos', '2-oros', '2-copas'],
  ['1-copas', '1-oros'],
  ['12-espadas', '12-bastos', '12-oros', '12-copas'],
  ['11-espadas', '11-bastos', '11-oros', '11-copas'],
  ['10-espadas', '10-bastos', '10-oros', '10-copas'],
  ['7-copas', '7-bastos'],
  ['6-espadas', '6-bastos', '6-oros', '6-copas'],
  ['5-espadas', '5-bastos', '5-oros', '5-copas'],
  ['4-espadas', '4-bastos', '4-oros', '4-copas'],
];

describe('Spanish 40-card deck & exhaustive Truco hierarchy', () => {
  it('contains exactly 40 unique Spanish cards across the 14 power tiers', () => {
    const deck = createStandardDeck();
    expect(deck).toHaveLength(40);

    const tierFlatten = EXPECTED_TIERS_HIGH_TO_LOW.flat();
    expect(tierFlatten).toHaveLength(40);
    expect(new Set(tierFlatten).size).toBe(40);

    for (const id of tierFlatten) {
      const card = getCardById(id);
      expect(card).toBeDefined();
      expect(getTrucoPower(card!)).toBeGreaterThanOrEqual(1);
    }
  });

  it('verifies all 1,600 ordered pairs (40 x 40) against the official Argentine hierarchy', () => {
    const tierIndexById = new Map<CardId, number>();
    EXPECTED_TIERS_HIGH_TO_LOW.forEach((group, tierIdx) => {
      for (const id of group) {
        tierIndexById.set(id, tierIdx);
      }
    });

    const deck = createStandardDeck();
    let pairsChecked = 0;

    for (const cardA of deck) {
      for (const cardB of deck) {
        pairsChecked++;
        const tierA = tierIndexById.get(cardA.id)!;
        const tierB = tierIndexById.get(cardB.id)!;
        const actual = compareCards(cardA, cardB);

        if (tierA < tierB) {
          expect(actual, `${cardA.id} debe matar a ${cardB.id}`).toBe(1);
        } else if (tierA > tierB) {
          expect(actual, `${cardB.id} debe matar a ${cardA.id}`).toBe(-1);
        } else {
          expect(actual, `${cardA.id} y ${cardB.id} deben empatar (parda)`).toBe(0);
        }
      }
    }

    expect(pairsChecked).toBe(1600);
  });

  it('shuffles deterministically via Fisher-Yates and rejects out-of-range RNG values', () => {
    const deck = createStandardDeck();
    const s1 = shuffleDeck(deck, createSeededRng(42));
    const s2 = shuffleDeck(deck, createSeededRng(42));
    const s3 = shuffleDeck(deck, createSeededRng(99));

    expect(s1.ok).toBe(true);
    expect(s2.ok).toBe(true);
    expect(s3.ok).toBe(true);
    if (!s1.ok || !s2.ok || !s3.ok) return;

    expect(s1.value.map((c) => c.id)).toEqual(s2.value.map((c) => c.id));
    expect(s1.value.map((c) => c.id)).not.toEqual(s3.value.map((c) => c.id));
    expect(new Set(s1.value.map((c) => c.id)).size).toBe(40);

    const invalidHigh = shuffleDeck(deck, { nextFloat: () => 1 });
    expect(invalidHigh.ok).toBe(false);

    const invalidNeg = shuffleDeck(deck, { nextFloat: () => -0.1 });
    expect(invalidNeg.ok).toBe(false);
  });

  it('deals 3 unique cards per seat starting counter-clockwise from manoSeat for N seats', () => {
    const deck = createStandardDeck();
    const hands = dealHands(deck, 6, 4);

    const seen = new Set<CardId>();
    for (let seat = 0; seat < 6; seat++) {
      const seatCards = hands[seat]!;
      expect(seatCards).toHaveLength(CARDS_PER_PLAYER);
      for (const c of seatCards) {
        expect(seen.has(c.id)).toBe(false);
        seen.add(c.id);
      }
    }
    expect(seen.size).toBe(18);
    expect(hands[4]![0]!.id).toBe(deck[0]!.id);
    expect(hands[5]![0]!.id).toBe(deck[1]!.id);
    expect(hands[0]![0]!.id).toBe(deck[2]!.id);
  });
});
