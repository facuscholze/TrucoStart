export const designTokens = {
  colors: {
    clothGreen: '#0F3D2E',
    surface: '#14201B',
    textPrimary: '#F4EFE6',
    accentGold: '#E0B84C',
    accentSky: '#6FB1E0',
    danger: '#D6523F',
    success: '#4CB782',
  },
  typography: {
    displayFamily: '"Fraunces", Georgia, serif',
    sansFamily: '"Inter", system-ui, -apple-system, sans-serif',
    scoreNumericVariant: 'tabular-nums',
  },
  breakpointsPx: {
    mobile: 360,
    tablet: 768,
    desktop: 1200,
  },
  touchTargetMinPx: 44,
} as const;

export type DesignTokens = typeof designTokens;
