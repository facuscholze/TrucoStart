import { describe, expect, it } from 'vitest';
import { contrastRatio, designTokens } from '../src/index.js';

describe('@truco/ui design tokens & WCAG AA contrast', () => {
  it('meets WCAG AA (>= 4.5:1) for primary text on cloth green and surface', () => {
    const { textPrimary, clothGreen, surface, accentGold, accentSky, success } =
      designTokens.colors;

    expect(contrastRatio(textPrimary, clothGreen)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(textPrimary, surface)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(accentGold, surface)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(accentSky, surface)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(success, surface)).toBeGreaterThanOrEqual(4.5);
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
