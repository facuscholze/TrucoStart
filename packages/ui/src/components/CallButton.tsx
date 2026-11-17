import type { ReactNode } from 'react';
import { usePrefersReducedMotion } from '../tokens/motion.js';
import { designTokens } from '../tokens/theme.js';

export type CallButtonTone = 'truco' | 'envido' | 'flor' | 'accept' | 'decline' | 'neutral';

export interface CallButtonProps {
  readonly children: ReactNode;
  readonly subtitle?: string;
  readonly tone?: CallButtonTone;
  readonly disabled?: boolean;
  readonly active?: boolean;
  readonly reducedMotion?: boolean;
  readonly ariaLabel?: string;
  readonly onClick?: () => void;
}

const TONE_PALETTE: Readonly<Record<CallButtonTone, { fg: string; bg: string; border: string }>> = {
  truco: {
    fg: designTokens.colors.accentGold,
    bg: designTokens.colors.surfaceElevated,
    border: designTokens.colors.accentGold,
  },
  envido: {
    fg: designTokens.colors.accentSky,
    bg: designTokens.colors.surfaceElevated,
    border: designTokens.colors.accentSky,
  },
  flor: {
    fg: designTokens.colors.success,
    bg: designTokens.colors.surfaceElevated,
    border: designTokens.colors.success,
  },
  accept: {
    fg: designTokens.colors.surface,
    bg: designTokens.colors.success,
    border: designTokens.colors.success,
  },
  decline: {
    fg: designTokens.colors.dangerTextOnSurface,
    bg: designTokens.colors.surfaceElevated,
    border: designTokens.colors.danger,
  },
  neutral: {
    fg: designTokens.colors.textPrimary,
    bg: designTokens.colors.surface,
    border: 'rgba(244, 239, 230, 0.3)',
  },
};

export function CallButton({
  children,
  subtitle,
  tone = 'truco',
  disabled = false,
  active = false,
  reducedMotion,
  ariaLabel,
  onClick,
}: CallButtonProps) {
  const prefersReduced = usePrefersReducedMotion(reducedMotion);
  const palette = TONE_PALETTE[tone];

  return (
    <button
      type="button"
      disabled={disabled}
      aria-label={ariaLabel}
      aria-pressed={active || undefined}
      onClick={disabled ? undefined : onClick}
      style={{
        display: 'inline-flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: `${designTokens.touchTargetMinPx}px`,
        minWidth: `${designTokens.touchTargetMinPx}px`,
        padding: '0.45rem 0.9rem',
        borderRadius: '12px',
        backgroundColor: palette.bg,
        color: palette.fg,
        border: `1.5px solid ${palette.border}`,
        fontFamily: designTokens.typography.sansFamily,
        fontWeight: 700,
        fontSize: '0.86rem',
        lineHeight: 1.2,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.48 : 1,
        boxShadow: active ? `0 0 0 2px ${palette.border}` : '0 2px 8px rgba(0, 0, 0, 0.28)',
        transition: prefersReduced ? 'none' : 'transform 120ms ease-out, box-shadow 120ms ease-out',
      }}
    >
      <span>{children}</span>
      {subtitle && (
        <span
          style={{
            fontSize: '0.68rem',
            fontWeight: 600,
            opacity: 0.85,
            marginTop: '0.12rem',
          }}
        >
          {subtitle}
        </span>
      )}
    </button>
  );
}
