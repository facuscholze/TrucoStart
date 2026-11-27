export const designTokens = {
  colors: {
    clothGreen: '#0F3D2E',
    clothGreenDeep: '#09281E',
    surface: '#14201B',
    surfaceElevated: '#1B2B24',
    cardParchment: '#F6F0E2',
    cardInk: '#18221D',
    textPrimary: '#F4EFE6',
    textMuted: '#C9C2B4',
    accentGold: '#E0B84C',
    accentSky: '#6FB1E0',
    /** Tercer equipo (truco de 6). Elegido para distinguirse del oro y del celeste en daltonismo. */
    accentClay: '#D98B5F',
    danger: '#D6523F',
    dangerTextOnSurface: '#FF8F7E',
    success: '#4CB782',
  },
  typography: {
    displayFamily: '"Fraunces Variable", "Fraunces", Georgia, serif',
    sansFamily: '"Inter Variable", "Inter", system-ui, -apple-system, sans-serif',
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

/** Paleta de equipos por índice. Con 3 equipos (truco de 6) se usa el tercer color. */
export const TEAM_COLORS: readonly string[] = [
  designTokens.colors.accentGold,
  designTokens.colors.accentSky,
  designTokens.colors.accentClay,
];

export function teamColor(team: number): string {
  return TEAM_COLORS[Math.abs(team) % TEAM_COLORS.length]!;
}
