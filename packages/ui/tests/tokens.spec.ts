import { describe, expect, it } from 'vitest';
import { contrastRatio, designTokens } from '../src/index.js';

describe('@truco/ui design tokens & WCAG AA contrast', () => {
  it('meets WCAG AA (>= 4.5:1) across all text/accent/surface combinations in components', () => {
    const {
      textPrimary,
      textMuted,
      clothGreen,
      surface,
      surfaceElevated,
      cardParchment,
      cardInk,
      accentGold,
      accentSky,
      dangerTextOnSurface,
      success,
    } = designTokens.colors;

    expect(contrastRatio(textPrimary, clothGreen)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(textPrimary, surface)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(textPrimary, surfaceElevated)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(textMuted, surface)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(textMuted, clothGreen)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(accentGold, surface)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(accentGold, surfaceElevated)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(accentSky, surface)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(accentSky, surfaceElevated)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(success, surface)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(surface, success)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(dangerTextOnSurface, surface)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(dangerTextOnSurface, surfaceElevated)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(cardInk, cardParchment)).toBeGreaterThanOrEqual(7);
  });

  it('enforces mobile-first breakpoints and minimum 44px touch targets', () => {
    expect(designTokens.breakpointsPx).toEqual({
      mobile: 360,
      tablet: 768,
      desktop: 1200,
    });
    expect(designTokens.touchTargetMinPx).toBeGreaterThanOrEqual(44);
    expect(designTokens.typography.scoreNumericVariant).toBe('tabular-nums');
  });
});
