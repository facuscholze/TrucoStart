import { designTokens } from '../tokens/theme.js';
import { Avatar } from './Avatar.js';
import { Badge } from './Badge.js';

export interface PlayerSeatProps {
  readonly seat: number;
  readonly nickname: string;
  readonly team: 0 | 1 | number;
  readonly isSelf?: boolean;
  readonly isMano?: boolean;
  readonly isActiveTurn?: boolean;
  readonly connected?: boolean;
  readonly folded?: boolean;
  readonly remainingCards?: number;
  readonly turnRemainingSeconds?: number | null;
  readonly isTurnWarning?: boolean;
  readonly speechBubbleText?: string | null;
  readonly manoLabel?: string;
  readonly foldedLabel?: string;
  readonly disconnectedLabel?: string;
  readonly selfBadgeLabel?: string;
  /** `true` si el asiento lo ocupa un bot del servidor: se etiqueta siempre, nunca se simula humano. */
  readonly isBot?: boolean;
  readonly botLabel?: string;
  readonly compact?: boolean;
  /** Si se define, el apodo se vuelve un enlace accesible al perfil público. */
  readonly onOpenProfile?: () => void;
}

export function PlayerSeat({
  nickname,
  team,
  isSelf = false,
  isMano = false,
  isActiveTurn = false,
  connected = true,
  folded = false,
  remainingCards = 0,
  turnRemainingSeconds = null,
  isTurnWarning = false,
  speechBubbleText = null,
  manoLabel = 'Mano',
  foldedLabel = 'Al mazo',
  disconnectedLabel = 'Reconectando…',
  selfBadgeLabel = 'Vos',
  isBot = false,
  botLabel = 'Bot',
  compact = false,
  onOpenProfile,
}: PlayerSeatProps) {
  const activeBorder = isActiveTurn
    ? isTurnWarning
      ? designTokens.colors.danger
      : designTokens.colors.accentGold
    : 'rgba(244, 239, 230, 0.18)';

  return (
    <div
      role="region"
      aria-label={`Asiento de ${nickname}`}
      style={{
        position: 'relative',
        display: 'inline-flex',
        flexDirection: 'column',
        gap: '0.32rem',
        padding: compact ? '0.4rem 0.6rem' : '0.52rem 0.78rem',
        borderRadius: '14px',
        backgroundColor: designTokens.colors.surface,
        border: `2px solid ${activeBorder}`,
        color: designTokens.colors.textPrimary,
        fontFamily: designTokens.typography.sansFamily,
        boxShadow: isActiveTurn
          ? '0 0 0 3px rgba(224, 184, 76, 0.22)'
          : '0 4px 12px rgba(0,0,0,0.3)',
        opacity: folded ? 0.72 : 1,
        maxWidth: '240px',
      }}
    >
      {speechBubbleText && (
        <div
          role="status"
          aria-live="polite"
          style={{
            padding: '0.2rem 0.55rem',
            borderRadius: '9999px',
            backgroundColor: designTokens.colors.accentGold,
            color: designTokens.colors.surface,
            fontWeight: 800,
            fontSize: '0.74rem',
            alignSelf: 'flex-start',
          }}
        >
          {speechBubbleText}
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: '0.55rem' }}>
        <Avatar nickname={nickname} team={team} sizePx={compact ? 32 : 38} connected={connected} />

        <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', flexWrap: 'wrap' }}>
            {onOpenProfile ? (
              <button
                type="button"
                onClick={onOpenProfile}
                aria-label={`Ver perfil de ${nickname}`}
                style={{
                  fontSize: compact ? '0.82rem' : '0.9rem',
                  fontWeight: 700,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  textDecoration: 'underline dotted',
                  background: 'none',
                  border: 'none',
                  padding: 0,
                  color: 'inherit',
                  cursor: 'pointer',
                }}
              >
                {nickname}
              </button>
            ) : (
              <strong
                style={{
                  fontSize: compact ? '0.82rem' : '0.9rem',
                  fontWeight: 700,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {nickname}
              </strong>
            )}
            {isBot && <Badge variant="neutral">{botLabel}</Badge>}
            {isSelf && <Badge variant="sky">{selfBadgeLabel}</Badge>}
            {isMano && <Badge variant="gold">{manoLabel}</Badge>}
          </div>

          <div
            style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', marginTop: '0.15rem' }}
          >
            {!connected && <Badge variant="danger">{disconnectedLabel}</Badge>}
            {folded && <Badge variant="neutral">{foldedLabel}</Badge>}

            {!isSelf && remainingCards > 0 && !folded && (
              <span
                role="img"
                aria-label={`${remainingCards} cartas en mano`}
                style={{ display: 'inline-flex', gap: '3px', alignItems: 'center' }}
              >
                {Array.from({ length: remainingCards }, (_, idx) => (
                  <span
                    key={idx}
                    aria-hidden="true"
                    style={{
                      width: '9px',
                      height: '13px',
                      borderRadius: '2px',
                      backgroundColor: designTokens.colors.clothGreen,
                      border: `1px solid ${designTokens.colors.accentGold}`,
                    }}
                  />
                ))}
              </span>
            )}

            {isActiveTurn && turnRemainingSeconds !== null && (
              <span
                aria-label={`Tiempo restante de turno: ${turnRemainingSeconds} segundos`}
                style={{
                  fontSize: '0.75rem',
                  fontWeight: 800,
                  fontVariantNumeric: 'tabular-nums',
                  color: isTurnWarning
                    ? designTokens.colors.dangerTextOnSurface
                    : designTokens.colors.accentGold,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '3px',
                }}
              >
                <svg width="11" height="11" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                  <circle cx="8" cy="8.5" r="6" stroke="currentColor" strokeWidth="1.7" />
                  <path
                    d="M8 5.2V8.6L10.3 10"
                    stroke="currentColor"
                    strokeWidth="1.7"
                    strokeLinecap="round"
                  />
                </svg>
                {turnRemainingSeconds}s
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
