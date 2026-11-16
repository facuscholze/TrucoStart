import { designTokens } from '../tokens/theme.js';

export type ToastTone = 'info' | 'success' | 'warning' | 'danger';

export interface ToastProps {
  readonly message: string;
  readonly tone?: ToastTone;
  readonly dismissLabel?: string;
  readonly onDismiss?: () => void;
}

const TOAST_BORDER: Readonly<Record<ToastTone, string>> = {
  info: designTokens.colors.accentSky,
  success: designTokens.colors.success,
  warning: designTokens.colors.accentGold,
  danger: designTokens.colors.danger,
};

export function Toast({
  message,
  tone = 'info',
  dismissLabel = 'Cerrar aviso',
  onDismiss,
}: ToastProps) {
  return (
    <div
      role={tone === 'danger' ? 'alert' : 'status'}
      aria-live={tone === 'danger' ? 'assertive' : 'polite'}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '0.75rem',
        padding: '0.55rem 0.85rem',
        borderRadius: '12px',
        backgroundColor: designTokens.colors.surfaceElevated,
        color: designTokens.colors.textPrimary,
        borderLeft: `4px solid ${TOAST_BORDER[tone]}`,
        borderTop: '1px solid rgba(244, 239, 230, 0.16)',
        borderRight: '1px solid rgba(244, 239, 230, 0.16)',
        borderBottom: '1px solid rgba(244, 239, 230, 0.16)',
        fontFamily: designTokens.typography.sansFamily,
        fontSize: '0.84rem',
        fontWeight: 600,
        boxShadow: '0 8px 20px rgba(0, 0, 0, 0.42)',
      }}
    >
      <span>{message}</span>
      {onDismiss && (
        <button
          type="button"
          aria-label={dismissLabel}
          onClick={onDismiss}
          style={{
            minWidth: `${designTokens.touchTargetMinPx}px`,
            minHeight: `${designTokens.touchTargetMinPx}px`,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: '8px',
            backgroundColor: 'transparent',
            color: designTokens.colors.textMuted,
            border: 'none',
            cursor: 'pointer',
            fontWeight: 700,
          }}
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path
              d="M4 4L12 12M12 4L4 12"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
            />
          </svg>
        </button>
      )}
    </div>
  );
}
