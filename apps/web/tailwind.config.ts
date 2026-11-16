import { designTokens } from '@truco/ui';
import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        cloth: designTokens.colors.clothGreen,
        surface: designTokens.colors.surface,
        ivory: designTokens.colors.textPrimary,
        gold: designTokens.colors.accentGold,
        sky: designTokens.colors.accentSky,
        danger: designTokens.colors.danger,
        success: designTokens.colors.success,
      },
      fontFamily: {
        display: ['Fraunces', 'Georgia', 'serif'],
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};

export default config;
