import { designTokens } from '../tokens/theme.js';
import { Avatar } from './Avatar.js';

export interface RankRowProps {
  readonly position: number;
  readonly nickname: string;
  readonly metricLabel: string;
  readonly metricValue: string | number;
  readonly highlighted?: boolean;
}

export function RankRow({
  position,
  nickname,
  metricLabel,
  metricValue,
  highlighted = false,
}: RankRowProps) {
  return (
    <div
      role="listitem"
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '0.75rem',
        padding: '0.5rem 0.75rem',
        borderRadius: '12px',
        backgroundColor: highlighted
          ? designTokens.colors.surfaceElevated
          : designTokens.colors.surface,
        border: highlighted
          ? `1px solid ${designTokens.colors.accentGold}`
          : '1px solid rgba(244, 239, 230, 0.12)',
        color: designTokens.colors.textPrimary,
        fontFamily: designTokens.typography.sansFamily,
        fontVariantNumeric: 'tabular-nums',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
        <span
          style={{
            minWidth: '1.6rem',
            fontWeight: 800,
            color: position <= 3 ? designTokens.colors.accentGold : designTokens.colors.textMuted,
          }}
        >
          #{position}
        </span>
        <Avatar nickname={nickname} sizePx={32} team={position % 2} />
        <strong style={{ fontSize: '0.88rem' }}>{nickname}</strong>
      </div>
      <div style={{ textAlign: 'right' }}>
        <strong style={{ fontSize: '0.92rem' }}>{metricValue}</strong>
        <span
          style={{
            display: 'block',
            fontSize: '0.68rem',
            color: designTokens.colors.textMuted,
          }}
        >
          {metricLabel}
        </span>
      </div>
    </div>
  );
}
