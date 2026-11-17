import { type KeyboardEvent, useRef } from 'react';
import type { SpanishCardId, SpanishRank, SpanishSuit } from '../cards/deck-catalog.js';
import { usePrefersReducedMotion } from '../tokens/motion.js';
import { Card, type CardSize } from './Card.js';

export interface HandCardItem {
  readonly id: SpanishCardId;
  readonly rank: SpanishRank;
  readonly suit: SpanishSuit;
  readonly playable: boolean;
  readonly ariaLabel?: string;
}

export interface HandProps {
  readonly cards: readonly HandCardItem[];
  readonly selectedCardId?: SpanishCardId | null;
  readonly size?: CardSize;
  readonly groupLabel?: string;
  readonly emptyLabel?: string;
  readonly reducedMotion?: boolean;
  readonly onPlayCard?: (cardId: SpanishCardId) => void;
}

export function Hand({
  cards,
  selectedCardId = null,
  size = 'lg',
  groupLabel = 'Tu mano de cartas',
  emptyLabel = 'Sin cartas en mano',
  reducedMotion,
  onPlayCard,
}: HandProps) {
  const prefersReduced = usePrefersReducedMotion(reducedMotion);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
    const container = containerRef.current;
    if (!container) return;
    const buttons = Array.from(
      container.querySelectorAll<HTMLButtonElement>('button:not([disabled])'),
    );
    if (buttons.length <= 1) return;
    const activeIdx = buttons.findIndex((b) => b === document.activeElement);
    if (activeIdx === -1) return;

    event.preventDefault();
    const delta = event.key === 'ArrowRight' ? 1 : -1;
    const nextIdx = (activeIdx + delta + buttons.length) % buttons.length;
    buttons[nextIdx]?.focus();
  };

  if (cards.length === 0) {
    return (
      <div
        role="group"
        aria-label={groupLabel}
        style={{
          minHeight: '88px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '0.82rem',
          opacity: 0.78,
        }}
      >
        {emptyLabel}
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      role="group"
      aria-label={groupLabel}
      onKeyDown={handleKeyDown}
      style={{
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'center',
        gap: '0.55rem',
        padding: '0.35rem 0.25rem',
      }}
    >
      {cards.map((card, idx) => {
        const middleOffset = idx - (cards.length - 1) / 2;
        const angleDeg = prefersReduced ? 0 : middleOffset * 4.5;
        const liftY = prefersReduced ? 0 : Math.abs(middleOffset) * 3;
        const isSelected = selectedCardId === card.id;

        return (
          <div
            key={card.id}
            style={{
              transform: prefersReduced ? 'none' : `translateY(${liftY}px) rotate(${angleDeg}deg)`,
              transition: prefersReduced ? 'none' : 'transform 160ms ease-out',
            }}
          >
            <Card
              rank={card.rank}
              suit={card.suit}
              size={size}
              playable={Boolean(onPlayCard)}
              disabled={!card.playable}
              selected={isSelected}
              reducedMotion={prefersReduced}
              {...(card.ariaLabel !== undefined ? { ariaLabel: card.ariaLabel } : {})}
              onPlay={
                card.playable && onPlayCard
                  ? () => {
                      onPlayCard(card.id);
                    }
                  : undefined
              }
            />
          </div>
        );
      })}
    </div>
  );
}
