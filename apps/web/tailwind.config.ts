import { designTokens } from '@truco/ui';
import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      screens: {
        tablet: `${designTokens.breakpointsPx.tablet}px`,
        desktop: `${designTokens.breakpointsPx.desktop}px`,
      },
      colors: {
        cloth: designTokens.colors.clothGreen,
        surface: designTokens.colors.surface,
        elevated: designTokens.colors.surfaceElevated,
        ivory: designTokens.colors.textPrimary,
        muted: designTokens.colors.textMuted,
        gold: designTokens.colors.accentGold,
        sky: designTokens.colors.accentSky,
        danger: designTokens.colors.danger,
        success: designTokens.colors.success,
      },
      fontFamily: {
        display: ['"Fraunces Variable"', 'Fraunces', 'Georgia', 'serif'],
        sans: ['"Inter Variable"', 'Inter', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};

export default config;
