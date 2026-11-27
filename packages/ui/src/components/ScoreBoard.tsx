import { designTokens, teamColor } from '../tokens/theme.js';

export interface TeamScoreEntry {
  readonly team: number;
  readonly label: string;
  readonly score: number;
}

export interface TeamScoreBoardProps {
  readonly entries: readonly TeamScoreEntry[];
  readonly targetScore: number;
  readonly ariaLabel?: string;
}

/**
 * Tanteador para mesas de **tres equipos** (truco de 6). Mantiene el mismo dibujo de fósforos
 * que el duelo clásico, pero con una columna por equipo y el color de cada uno.
 */
export function TeamScoreBoard({ entries, targetScore, ariaLabel }: TeamScoreBoardProps) {
  const halfLimit = targetScore === 30 ? 15 : targetScore;
  const label =
    ariaLabel ??
    `Tanteador a ${targetScore}: ${entries
      .map((e) => `${e.label} ${e.score} (${describeStage(e.score, targetScore)})`)
      .join(', ')}`;

  return (
    <section
      aria-label={label}
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${Math.max(1, entries.length)}, minmax(0, 1fr))`,
        gap: '0.6rem',
        padding: '0.7rem 0.8rem',
        borderRadius: '14px',
        backgroundColor: designTokens.colors.surface,
        border: '1px solid rgba(224, 184, 76, 0.32)',
        color: designTokens.colors.textPrimary,
        fontFamily: designTokens.typography.sansFamily,
        fontVariantNumeric: designTokens.typography.scoreNumericVariant,
      }}
    >
      {entries.map((entry, idx) => (
        <div
          key={entry.team}
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '0.35rem',
            minWidth: 0,
            borderLeft: idx === 0 ? undefined : '1px solid rgba(244, 239, 230, 0.14)',
            paddingLeft: idx === 0 ? undefined : '0.6rem',
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'baseline',
              gap: '0.25rem',
            }}
          >
            <span
              style={{
                fontSize: '0.76rem',
                fontWeight: 700,
                color: teamColor(entry.team),
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {entry.label}
            </span>
            <strong style={{ fontSize: '1.1rem', fontVariantNumeric: 'tabular-nums' }}>
              {entry.score}
            </strong>
          </div>
          {renderMatchstickGroups(entry.score, halfLimit)}
          <span style={{ fontSize: '0.68rem', color: designTokens.colors.textMuted }}>
            {describeStage(entry.score, targetScore)}
          </span>
        </div>
      ))}
    </section>
  );
}

export interface ScoreBoardProps {
  readonly usLabel?: string;
  readonly themLabel?: string;
  readonly usScore: number;
  readonly themScore: number;
  readonly targetScore: 15 | 30 | number;
  readonly compact?: boolean;
  readonly ariaLabel?: string;
}

/**
 * Dibuja un cuadradito criollo de hasta 5 fósforos:
 * 1: izquierda vertical | 2: arriba horizontal | 3: derecha vertical | 4: abajo horizontal | 5: diagonal cruzada.
 */
function MatchstickSquareSvg({ count }: { readonly count: number }) {
  const clamped = Math.max(0, Math.min(5, count));
  const sticks: Array<{ x1: number; y1: number; x2: number; y2: number; hx: number; hy: number }> =
    [
      { x1: 4, y1: 18, x2: 4, y2: 4, hx: 4, hy: 4 },
      { x1: 4, y1: 4, x2: 18, y2: 4, hx: 18, hy: 4 },
      { x1: 18, y1: 4, x2: 18, y2: 18, hx: 18, hy: 18 },
      { x1: 18, y1: 18, x2: 4, y2: 18, hx: 4, hy: 18 },
      { x1: 5, y1: 17, x2: 17, y2: 5, hx: 17, hy: 5 },
    ];

  return (
    <svg width="20" height="20" viewBox="0 0 22 22" aria-hidden="true">
      <rect
        x="2"
        y="2"
        width="18"
        height="18"
        rx="2"
        fill="none"
        stroke="rgba(244, 239, 230, 0.12)"
        strokeWidth="1"
      />
      {sticks.slice(0, clamped).map((s, idx) => (
        <g key={idx}>
          <line
            x1={s.x1}
            y1={s.y1}
            x2={s.x2}
            y2={s.y2}
            stroke={designTokens.colors.accentGold}
            strokeWidth="2.1"
            strokeLinecap="round"
          />
          <circle cx={s.hx} cy={s.hy} r="1.9" fill={designTokens.colors.danger} />
        </g>
      ))}
    </svg>
  );
}

function renderMatchstickGroups(score: number, halfLimit: number) {
  const capped = Math.max(0, Math.min(score, halfLimit * 2));
  const malas = Math.min(capped, halfLimit);
  const buenas = Math.max(0, capped - halfLimit);
  const squaresPerHalf = Math.ceil(halfLimit / 5);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
        {Array.from({ length: squaresPerHalf }, (_, idx) => (
          <MatchstickSquareSvg key={`m-${idx}`} count={Math.max(0, Math.min(5, malas - idx * 5))} />
        ))}
      </div>
      {halfLimit === 15 && (
        <div
          style={{
            borderTop: '1px dashed rgba(224, 184, 76, 0.35)',
            paddingTop: '0.22rem',
            display: 'flex',
            alignItems: 'center',
            gap: '0.25rem',
          }}
        >
          {Array.from({ length: squaresPerHalf }, (_, idx) => (
            <MatchstickSquareSvg
              key={`b-${idx}`}
              count={Math.max(0, Math.min(5, buenas - idx * 5))}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function describeStage(score: number, targetScore: number): string {
  if (targetScore === 30) {
    return score >= 15 ? `${score - 15} buenas` : `${score} malas`;
  }
  return `${score} puntos`;
}

export function ScoreBoard({
  usLabel = 'Nosotros',
  themLabel = 'Ellos',
  usScore,
  themScore,
  targetScore,
  compact = false,
  ariaLabel,
}: ScoreBoardProps) {
  const halfLimit = targetScore === 30 ? 15 : targetScore;
  const fullLabel =
    ariaLabel ??
    `Tanteador a ${targetScore}: ${usLabel} ${usScore} (${describeStage(usScore, targetScore)}), ${themLabel} ${themScore} (${describeStage(themScore, targetScore)})`;

  if (compact) {
    return (
      <section
        aria-label={fullLabel}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '0.65rem',
          padding: '0.32rem 0.7rem',
          borderRadius: '12px',
          backgroundColor: designTokens.colors.surface,
          border: '1px solid rgba(224, 184, 76, 0.35)',
          fontFamily: designTokens.typography.sansFamily,
          fontVariantNumeric: designTokens.typography.scoreNumericVariant,
          color: designTokens.colors.textPrimary,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
          <span
            style={{ fontSize: '0.74rem', color: designTokens.colors.accentGold, fontWeight: 700 }}
          >
            {usLabel}
          </span>
          <strong style={{ fontSize: '1rem', fontVariantNumeric: 'tabular-nums' }}>
            {usScore}
          </strong>
        </div>
        <span aria-hidden="true" style={{ opacity: 0.4 }}>
          /
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
          <span
            style={{ fontSize: '0.74rem', color: designTokens.colors.accentSky, fontWeight: 700 }}
          >
            {themLabel}
          </span>
          <strong style={{ fontSize: '1rem', fontVariantNumeric: 'tabular-nums' }}>
            {themScore}
          </strong>
        </div>
        <span
          style={{
            fontSize: '0.68rem',
            color: designTokens.colors.textMuted,
            borderLeft: '1px solid rgba(244, 239, 230, 0.16)',
            paddingLeft: '0.45rem',
          }}
        >
          a {targetScore}
        </span>
      </section>
    );
  }

  return (
    <section
      aria-label={fullLabel}
      style={{
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: '0.75rem',
        padding: '0.75rem 0.85rem',
        borderRadius: '14px',
        backgroundColor: designTokens.colors.surface,
        border: '1px solid rgba(224, 184, 76, 0.32)',
        color: designTokens.colors.textPrimary,
        fontFamily: designTokens.typography.sansFamily,
        fontVariantNumeric: designTokens.typography.scoreNumericVariant,
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <span
            style={{ fontSize: '0.78rem', fontWeight: 700, color: designTokens.colors.accentGold }}
          >
            {usLabel}
          </span>
          <strong style={{ fontSize: '1.15rem', fontVariantNumeric: 'tabular-nums' }}>
            {usScore}
          </strong>
        </div>
        {renderMatchstickGroups(usScore, halfLimit)}
        <span style={{ fontSize: '0.7rem', color: designTokens.colors.textMuted }}>
          {describeStage(usScore, targetScore)}
        </span>
      </div>

      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '0.4rem',
          borderLeft: '1px solid rgba(244, 239, 230, 0.14)',
          paddingLeft: '0.75rem',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <span
            style={{ fontSize: '0.78rem', fontWeight: 700, color: designTokens.colors.accentSky }}
          >
            {themLabel}
          </span>
          <strong style={{ fontSize: '1.15rem', fontVariantNumeric: 'tabular-nums' }}>
            {themScore}
          </strong>
        </div>
        {renderMatchstickGroups(themScore, halfLimit)}
        <span style={{ fontSize: '0.7rem', color: designTokens.colors.textMuted }}>
          {describeStage(themScore, targetScore)}
        </span>
      </div>
    </section>
  );
}
