import type { CSSProperties, ReactNode } from 'react';
import { designTokens } from '../tokens/theme.js';

export type BadgeVariant = 'gold' | 'sky' | 'success' | 'danger' | 'neutral';

export interface BadgeProps {
  readonly children: ReactNode;
  readonly variant?: BadgeVariant;
  readonly className?: string;
  readonly style?: CSSProperties;
}

const variantColors: Record<BadgeVariant, { fg: string; border: string; bg: string }> = {
  gold: {
    fg: designTokens.colors.accentGold,
    border: designTokens.colors.accentGold,
    bg: designTokens.colors.surface,
  },
  sky: {
    fg: designTokens.colors.accentSky,
    border: designTokens.colors.accentSky,
    bg: designTokens.colors.surface,
  },
  success: {
    fg: designTokens.colors.success,
    border: designTokens.colors.success,
    bg: designTokens.colors.surface,
  },
  danger: {
    fg: designTokens.colors.dangerTextOnSurface,
    border: designTokens.colors.danger,
    bg: designTokens.colors.surface,
  },
  neutral: {
    fg: designTokens.colors.textMuted,
    border: 'rgba(244, 239, 230, 0.25)',
    bg: designTokens.colors.surface,
  },
};

export function Badge({ children, variant = 'gold', className, style }: BadgeProps) {
  const palette = variantColors[variant];
  return (
    <span
      className={className}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '0.25rem',
        padding: '0.16rem 0.58rem',
        borderRadius: '9999px',
        fontSize: '0.72rem',
        fontWeight: 700,
        lineHeight: 1.25,
        letterSpacing: '0.02em',
        fontFamily: designTokens.typography.sansFamily,
        color: palette.fg,
        backgroundColor: palette.bg,
        border: `1px solid ${palette.border}`,
        whiteSpace: 'nowrap',
        ...style,
      }}
    >
      {children}
    </span>
  );
}
