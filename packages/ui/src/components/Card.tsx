import type { CSSProperties } from 'react';
import {
  describeSpanishCard,
  SUIT_IDENTITIES,
  type SpanishRank,
  type SpanishSuit,
} from '../cards/deck-catalog.js';
import { SpanishCardBackSvg, SpanishCardSvg } from '../cards/SpanishCardSvg.js';
import { usePrefersReducedMotion } from '../tokens/motion.js';
import { designTokens } from '../tokens/theme.js';

export type CardSize = 'xs' | 'sm' | 'md' | 'lg';

export interface CardProps {
  readonly rank?: SpanishRank;
  readonly suit?: SpanishSuit;
  readonly faceDown?: boolean;
  readonly size?: CardSize;
  readonly playable?: boolean;
  readonly selected?: boolean;
  readonly disabled?: boolean;
  readonly reducedMotion?: boolean;
  readonly ariaLabel?: string;
  readonly onPlay?: () => void;
  readonly style?: CSSProperties;
}

const SIZE_DIMENSIONS: Readonly<Record<CardSize, { width: number; height: number }>> = {
  xs: { width: 44, height: 66 },
  sm: { width: 58, height: 87 },
  md: { width: 78, height: 117 },
  lg: { width: 98, height: 147 },
};

export function Card({
  rank,
  suit,
  faceDown = false,
  size = 'md',
  playable = false,
  selected = false,
  disabled = false,
  reducedMotion,
  ariaLabel,
  onPlay,
  style,
}: CardProps) {
  const prefersReduced = usePrefersReducedMotion(reducedMotion);
  const dims = SIZE_DIMENSIONS[size];
  const isFaceDown = faceDown || !rank || !suit;
  const visualText = isFaceDown
    ? ''
    : `${rank}${SUIT_IDENTITIES[suit!].glyphCode}${rank}${SUIT_IDENTITIES[suit!].glyphCode}`;
  const computedLabel = isFaceDown
    ? (ariaLabel ?? 'Carta cubierta')
    : `${ariaLabel ?? describeSpanishCard(rank!, suit!)} ${visualText}`;

  const sharedBoxStyle: CSSProperties = {
    position: 'relative',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: `${Math.max(dims.width, playable ? designTokens.touchTargetMinPx : dims.width)}px`,
    height: `${Math.max(dims.height, playable ? designTokens.touchTargetMinPx : dims.height)}px`,
    minWidth: playable ? `${designTokens.touchTargetMinPx}px` : undefined,
    minHeight: playable ? `${designTokens.touchTargetMinPx}px` : undefined,
    padding: 0,
    border: 'none',
    borderRadius: '10px',
    backgroundColor: 'transparent',
    boxShadow: selected
      ? `0 0 0 3px ${designTokens.colors.accentGold}, 0 10px 22px rgba(0, 0, 0, 0.45)`
      : '0 6px 14px rgba(0, 0, 0, 0.38)',
    transform: !prefersReduced && selected ? 'translateY(-8px)' : 'none',
    transition: prefersReduced ? 'none' : 'transform 150ms ease-out, box-shadow 150ms ease-out',
    opacity: disabled ? 0.55 : 1,
    cursor: playable && !disabled ? 'pointer' : 'default',
    ...style,
  };

  const innerGraphic = isFaceDown ? (
    <SpanishCardBackSvg />
  ) : (
    <SpanishCardSvg rank={rank} suit={suit} />
  );

  if (playable || onPlay) {
    return (
      <button
        type="button"
        disabled={disabled}
        aria-label={computedLabel}
        aria-pressed={selected || undefined}
        onClick={disabled ? undefined : onPlay}
        style={sharedBoxStyle}
      >
        {innerGraphic}
      </button>
    );
  }

  return (
    <div role="img" aria-label={computedLabel} style={sharedBoxStyle}>
      {innerGraphic}
    </div>
  );
}
