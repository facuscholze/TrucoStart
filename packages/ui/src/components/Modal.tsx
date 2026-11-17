import { useEffect, useId, useRef, type ReactNode } from 'react';
import { designTokens } from '../tokens/theme.js';

export interface ModalProps {
  readonly open: boolean;
  readonly title: string;
  readonly children: ReactNode;
  readonly footer?: ReactNode;
  readonly closeLabel?: string;
  readonly onClose?: () => void;
}

export function Modal({
  open,
  title,
  children,
  footer,
  closeLabel = 'Cerrar ventana',
  onClose,
}: ModalProps) {
  const headingId = useId();
  const dialogRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    dialogRef.current?.focus();

    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape' && onClose) {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 50,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '1rem',
        backgroundColor: 'rgba(10, 18, 15, 0.78)',
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && onClose) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        tabIndex={-1}
        style={{
          width: '100%',
          maxWidth: '460px',
          borderRadius: '18px',
          backgroundColor: designTokens.colors.surfaceElevated,
          color: designTokens.colors.textPrimary,
          border: `1.5px solid ${designTokens.colors.accentGold}`,
          boxShadow: '0 20px 44px rgba(0, 0, 0, 0.62)',
          padding: '1.15rem',
          fontFamily: designTokens.typography.sansFamily,
          outline: 'none',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '0.75rem',
            marginBottom: '0.75rem',
          }}
        >
          <h2
            id={headingId}
            style={{
              margin: 0,
              fontFamily: designTokens.typography.displayFamily,
              fontSize: '1.35rem',
              fontWeight: 700,
              color: designTokens.colors.textPrimary,
            }}
          >
            {title}
          </h2>
          {onClose && (
            <button
              type="button"
              aria-label={closeLabel}
              onClick={onClose}
              style={{
                minWidth: `${designTokens.touchTargetMinPx}px`,
                minHeight: `${designTokens.touchTargetMinPx}px`,
                borderRadius: '10px',
                backgroundColor: designTokens.colors.surface,
                color: designTokens.colors.textPrimary,
                border: '1px solid rgba(244, 239, 230, 0.2)',
                cursor: 'pointer',
                fontWeight: 700,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path
                  d="M4 4L12 12M12 4L4 12"
                  stroke="currentColor"
                  strokeWidth="1.9"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          )}
        </div>

        <div style={{ fontSize: '0.9rem', lineHeight: 1.5 }}>{children}</div>

        {footer && (
          <div
            style={{
              marginTop: '1rem',
              paddingTop: '0.8rem',
              borderTop: '1px solid rgba(244, 239, 230, 0.14)',
              display: 'flex',
              justifyContent: 'flex-end',
              gap: '0.6rem',
              flexWrap: 'wrap',
            }}
          >
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
