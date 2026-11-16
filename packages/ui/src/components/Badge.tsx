import type { ReactNode } from 'react';
import { designTokens } from '../tokens/theme.js';

export type BadgeVariant = 'gold' | 'sky' | 'success' | 'danger';

export interface BadgeProps {
  readonly children: ReactNode;
  readonly variant?: BadgeVariant;
}

const variantColors: Record<BadgeVariant, { fg: string; border: string }> = {
  gold: { fg: designTokens.colors.accentGold, border: designTokens.colors.accentGold },
  sky: { fg: designTokens.colors.accentSky, border: designTokens.colors.accentSky },
  success: { fg: designTokens.colors.success, border: designTokens.colors.success },
  danger: { fg: designTokens.colors.textPrimary, border: designTokens.colors.danger },
};

export function Badge({ children, variant = 'gold' }: BadgeProps) {
  const palette = variantColors[variant];
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        padding: '0.15rem 0.6rem',
        borderRadius: '9999px',
        fontSize: '0.75rem',
        fontWeight: 600,
        letterSpacing: '0.02em',
        color: palette.fg,
        backgroundColor: designTokens.colors.surface,
        border: `1px solid ${palette.border}`,
      }}
    >
      {children}
    </span>
  );
}
