import { designTokens } from '../tokens/theme.js';
import {
  PIP_LAYOUTS,
  type SpanishRank,
  type SpanishSuit,
  SUIT_IDENTITIES,
} from './deck-catalog.js';
import { CardFrameWithPintasSvg, CourtFigureSvg, SuitEmblemSvg } from './suit-emblems.js';

export interface SpanishCardSvgProps {
  readonly rank: SpanishRank;
  readonly suit: SpanishSuit;
  readonly className?: string;
}

export function SpanishCardSvg({ rank, suit, className }: SpanishCardSvgProps) {
  const identity = SUIT_IDENTITIES[suit];
  const isAnchoBravo = rank === 1 && (suit === 'espadas' || suit === 'bastos');

  return (
    <svg
      viewBox="0 0 120 180"
      width="100%"
      height="100%"
      className={className}
      aria-hidden="true"
      focusable="false"
      data-card-id={`${rank}-${suit}`}
      data-suit={suit}
      data-suit-glyph={identity.glyphCode}
    >
      {/* Cartulina marfil cálida */}
      <rect
        x="2"
        y="2"
        width="116"
        height="176"
        rx="11"
        fill={designTokens.colors.cardParchment}
        stroke={designTokens.colors.cardInk}
        strokeWidth="2.2"
      />

      {/* Marco tradicional con pintas (0/1/2/3 cortes por palo) */}
      <CardFrameWithPintasSvg suit={suit} />

      {/* Halo ornamental sutil para los dos Anchos mayores */}
      {isAnchoBravo && (
        <circle
          cx="60"
          cy="90"
          r="34"
          fill="none"
          stroke={designTokens.colors.accentGold}
          strokeWidth="1.6"
          strokeDasharray="3 3"
          opacity="0.85"
        />
      )}

      {/* Índices esquina superior izquierda (número + glifo de letra + mini silueta) */}
      <g transform="translate(18, 28)">
        <text
          x="0"
          y="0"
          fontSize="14"
          fontWeight="800"
          fill={designTokens.colors.cardInk}
          fontFamily={designTokens.typography.displayFamily}
        >
          {rank}
        </text>
        <text
          x="0"
          y="11"
          fontSize="8.5"
          fontWeight="700"
          fill={identity.primaryHex}
          fontFamily={designTokens.typography.sansFamily}
        >
          {identity.glyphCode}
        </text>
      </g>
      <g transform="translate(100, 27)">
        <SuitEmblemSvg suit={suit} scale={0.34} />
      </g>

      {/* Índices esquina inferior derecha invertidos */}
      <g transform="translate(102, 152) rotate(180)">
        <text
          x="0"
          y="0"
          fontSize="14"
          fontWeight="800"
          fill={designTokens.colors.cardInk}
          fontFamily={designTokens.typography.displayFamily}
        >
          {rank}
        </text>
        <text
          x="0"
          y="11"
          fontSize="8.5"
          fontWeight="700"
          fill={identity.primaryHex}
          fontFamily={designTokens.typography.sansFamily}
        >
          {identity.glyphCode}
        </text>
      </g>

      {/* Cuerpo central: Pips numéricos (1..7) o Figura Cortesana (10, 11, 12) */}
      {rank <= 7 ? (
        <g>
          {PIP_LAYOUTS[rank as 1 | 2 | 3 | 4 | 5 | 6 | 7].map((pip, idx) => (
            <g key={idx} transform={`translate(${pip.x}, ${pip.y}) rotate(${pip.rotateDeg ?? 0})`}>
              <SuitEmblemSvg suit={suit} scale={pip.scale} />
            </g>
          ))}
        </g>
      ) : (
        <CourtFigureSvg rank={rank as 10 | 11 | 12} suit={suit} />
      )}
    </svg>
  );
}

/**
 * Dorso original del mazo con guarda geométrica pampeana en paño esmeralda y dorado.
 */
export function SpanishCardBackSvg({ className }: { readonly className?: string }) {
  return (
    <svg
      viewBox="0 0 120 180"
      width="100%"
      height="100%"
      className={className}
      aria-hidden="true"
      focusable="false"
      data-card-back="true"
    >
      <rect
        x="2"
        y="2"
        width="116"
        height="176"
        rx="11"
        fill={designTokens.colors.surface}
        stroke={designTokens.colors.accentGold}
        strokeWidth="2.2"
      />
      <rect
        x="10"
        y="10"
        width="100"
        height="160"
        rx="7"
        fill={designTokens.colors.clothGreen}
        stroke={designTokens.colors.accentGold}
        strokeWidth="1.4"
      />
      {/* Guarda pampa romboidal central */}
      <polygon
        points="60,34 90,90 60,146 30,90"
        fill="none"
        stroke={designTokens.colors.accentGold}
        strokeWidth="2"
      />
      <polygon
        points="60,52 79,90 60,128 41,90"
        fill={designTokens.colors.surface}
        stroke={designTokens.colors.accentSky}
        strokeWidth="1.5"
      />
      <circle cx="60" cy="90" r="8" fill={designTokens.colors.accentGold} />
      <circle cx="60" cy="90" r="3.5" fill={designTokens.colors.surface} />
    </svg>
  );
}
