import { type KeyboardEvent, useState } from 'react';
import { designTokens } from '../tokens/theme.js';

export interface QuickChatPhraseItem {
  readonly id: string;
  readonly text: string;
}

export interface QuickChatProps {
  readonly phrases: readonly QuickChatPhraseItem[];
  readonly triggerLabel?: string;
  readonly panelLabel?: string;
  readonly disabled?: boolean;
  readonly defaultOpen?: boolean;
  readonly onSelectPhrase: (phraseId: string) => void;
}

export function QuickChat({
  phrases,
  triggerLabel = 'Frases rápidas',
  panelLabel = 'Seleccionar frase rápida',
  disabled = false,
  defaultOpen = false,
  onSelectPhrase,
}: QuickChatProps) {
  const [open, setOpen] = useState<boolean>(defaultOpen);

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape' && open) {
      event.stopPropagation();
      setOpen(false);
    }
  };

  return (
    <div onKeyDown={handleKeyDown} style={{ position: 'relative', display: 'inline-block' }}>
      <button
        type="button"
        disabled={disabled}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((prev) => !prev)}
        style={{
          minHeight: `${designTokens.touchTargetMinPx}px`,
          minWidth: `${designTokens.touchTargetMinPx}px`,
          padding: '0.45rem 0.85rem',
          borderRadius: '12px',
          backgroundColor: designTokens.colors.surfaceElevated,
          color: designTokens.colors.textPrimary,
          border: '1px solid rgba(244, 239, 230, 0.28)',
          fontFamily: designTokens.typography.sansFamily,
          fontWeight: 600,
          fontSize: '0.82rem',
          cursor: disabled ? 'not-allowed' : 'pointer',
          display: 'inline-flex',
          alignItems: 'center',
          gap: '0.35rem',
        }}
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path
            d="M2.5 3.5H13.5V10.5H6L3 13V10.5H2.5V3.5Z"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinejoin="round"
          />
        </svg>
        <span>{triggerLabel}</span>
      </button>

      {open && (
        <div
          role="dialog"
          aria-label={panelLabel}
          style={{
            position: 'absolute',
            bottom: 'calc(100% + 8px)',
            right: 0,
            zIndex: 30,
            width: '260px',
            maxHeight: '260px',
            overflowY: 'auto',
            display: 'flex',
            flexDirection: 'column',
            gap: '0.35rem',
            padding: '0.6rem',
            borderRadius: '14px',
            backgroundColor: designTokens.colors.surfaceElevated,
            border: `1px solid ${designTokens.colors.accentGold}`,
            boxShadow: '0 12px 28px rgba(0, 0, 0, 0.5)',
          }}
        >
          {phrases.map((phrase) => (
            <button
              key={phrase.id}
              type="button"
              onClick={() => {
                onSelectPhrase(phrase.id);
                setOpen(false);
              }}
              style={{
                minHeight: `${designTokens.touchTargetMinPx}px`,
                textAlign: 'left',
                padding: '0.4rem 0.65rem',
                borderRadius: '10px',
                backgroundColor: designTokens.colors.surface,
                color: designTokens.colors.textPrimary,
                border: '1px solid rgba(244, 239, 230, 0.14)',
                fontFamily: designTokens.typography.sansFamily,
                fontSize: '0.82rem',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              {phrase.text}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
