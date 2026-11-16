import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ALL_SPANISH_CARDS,
  parseSpanishCardId,
  SPANISH_RANKS,
  SPANISH_SUITS,
  SpanishCardBackSvg,
  SpanishCardSvg,
  SUIT_IDENTITIES,
} from '../src/index.js';

afterEach(() => cleanup());

describe('Original 40-Card Spanish Deck SVG & Non-Color Suit Differentiation', () => {
  it('defines exactly 40 unique Spanish cards (ranks 1..7, 10..12 across 4 suits, excluding 8 and 9)', () => {
    expect(ALL_SPANISH_CARDS).toHaveLength(40);
    expect(SPANISH_SUITS).toEqual(['espadas', 'bastos', 'oros', 'copas']);
    expect(SPANISH_RANKS).toEqual([1, 2, 3, 4, 5, 6, 7, 10, 11, 12]);

    const uniqueIds = new Set(ALL_SPANISH_CARDS.map((c) => c.id));
    expect(uniqueIds.size).toBe(40);

    expect(parseSpanishCardId('1-espadas')).toEqual({ rank: 1, suit: 'espadas' });
    expect(parseSpanishCardId('8-oros')).toBeNull();
    expect(parseSpanishCardId('9-copas')).toBeNull();
  });

  it('distinguishes all 4 suits without relying solely on color (pintas border breaks, letter glyph, and geometric shape)', () => {
    const pintasSet = new Set(SPANISH_SUITS.map((s) => SUIT_IDENTITIES[s].pintasBreaks));
    const glyphSet = new Set(SPANISH_SUITS.map((s) => SUIT_IDENTITIES[s].glyphCode));
    const shapeSet = new Set(SPANISH_SUITS.map((s) => SUIT_IDENTITIES[s].shapeKind));

    expect(pintasSet.size).toBe(4);
    expect(glyphSet.size).toBe(4);
    expect(shapeSet.size).toBe(4);

    for (const card of ALL_SPANISH_CARDS) {
      const { container, unmount } = render(<SpanishCardSvg rank={card.rank} suit={card.suit} />);
      const svg = container.querySelector('svg');
      expect(svg).not.toBeNull();
      expect(svg?.getAttribute('data-card-id')).toBe(card.id);
      expect(svg?.getAttribute('data-suit-glyph')).toBe(SUIT_IDENTITIES[card.suit].glyphCode);

      const pintasGroup = container.querySelector('[data-pintas]');
      expect(pintasGroup?.getAttribute('data-pintas')).toBe(
        String(SUIT_IDENTITIES[card.suit].pintasBreaks),
      );

      const emblemShape = container.querySelector('[data-suit-shape]');
      expect(emblemShape?.getAttribute('data-suit-shape')).toBe(
        SUIT_IDENTITIES[card.suit].shapeKind,
      );
      unmount();
    }

    const backRender = render(<SpanishCardBackSvg />);
    expect(backRender.container.querySelector('[data-card-back="true"]')).not.toBeNull();
  });
});
