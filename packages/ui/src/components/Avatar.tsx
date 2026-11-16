import { designTokens } from '../tokens/theme.js';

export interface AvatarProps {
  readonly nickname: string;
  readonly team?: 0 | 1 | number;
  readonly sizePx?: number;
  readonly connected?: boolean;
  readonly connectionLabel?: string;
}

function getInitials(nickname: string): string {
  const clean = nickname.trim();
  if (!clean) return '?';
  const parts = clean.split(/[\s_-]+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0]![0]!}${parts[1]![0]!}`.toUpperCase();
  }
  return clean.slice(0, 2).toUpperCase();
}

export function Avatar({
  nickname,
  team = 0,
  sizePx = 40,
  connected,
  connectionLabel,
}: AvatarProps) {
  const isTeamZero = team % 2 === 0;
  const ringColor = isTeamZero ? designTokens.colors.accentGold : designTokens.colors.accentSky;
  const initials = getInitials(nickname);

  return (
    <div
      style={{
        position: 'relative',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: `${sizePx}px`,
        height: `${sizePx}px`,
        borderRadius: '9999px',
        backgroundColor: designTokens.colors.surfaceElevated,
        border: `2px solid ${ringColor}`,
        color: designTokens.colors.textPrimary,
        fontFamily: designTokens.typography.displayFamily,
        fontWeight: 700,
        fontSize: `${Math.round(sizePx * 0.38)}px`,
        flexShrink: 0,
        userSelect: 'none',
      }}
      aria-label={`Avatar de ${nickname}`}
    >
      <span aria-hidden="true">{initials}</span>
      {connected !== undefined && (
        <span
          role="img"
          aria-label={
            connectionLabel ?? (connected ? `${nickname} conectado` : `${nickname} desconectado`)
          }
          style={{
            position: 'absolute',
            right: '-2px',
            bottom: '-2px',
            width: '12px',
            height: '12px',
            borderRadius: '9999px',
            backgroundColor: connected ? designTokens.colors.success : designTokens.colors.danger,
            border: `2px solid ${designTokens.colors.surface}`,
          }}
        />
      )}
    </div>
  );
}
