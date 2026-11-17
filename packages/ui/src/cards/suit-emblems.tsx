import { designTokens } from '../tokens/theme.js';
import { type SpanishSuit, SUIT_IDENTITIES } from './deck-catalog.js';

export interface SuitEmblemProps {
  readonly suit: SpanishSuit;
  readonly scale?: number;
}

/**
 * Emblemas vectoriales originales de los 4 palos españoles.
 * Cada palo posee silueta geométrica, textura interna y trazo propios para distinguirlos sin depender del color:
 * - Espadas: hoja recta forjada con acanaladura central, arriaz curvo y pomo romboidal.
 * - Bastos: garrote nudoso asimétrico con vetas diagonales y dos brotes laterales de laurel.
 * - Oros: moneda solar circular con anillo perlado y estrella radiante interior de 8 puntas.
 * - Copas: cáliz ceremonial con pie escalonado, doble asa curva y faja grabada horizontal.
 */
export function SuitEmblemSvg({ suit, scale = 1 }: SuitEmblemProps) {
  const identity = SUIT_IDENTITIES[suit];

  if (suit === 'espadas') {
    return (
      <g transform={`scale(${scale})`} data-suit-shape="blade">
        <polygon
          points="0,-22 5,-10 3,8 -3,8 -5,-10"
          fill={identity.secondaryHex}
          stroke={identity.primaryHex}
          strokeWidth="2"
          strokeLinejoin="round"
        />
        <line x1="0" y1="-17" x2="0" y2="6" stroke={identity.primaryHex} strokeWidth="1.4" />
        <path
          d="M -11,8 Q 0,4 11,8 Q 6,12 0,11 Q -6,12 -11,8 Z"
          fill={designTokens.colors.accentGold}
          stroke={designTokens.colors.cardInk}
          strokeWidth="1.4"
        />
        <rect x="-2.4" y="10.5" width="4.8" height="6.5" rx="1.2" fill={identity.primaryHex} />
        <polygon
          points="0,17 4,20.5 0,23.5 -4,20.5"
          fill={designTokens.colors.accentGold}
          stroke={designTokens.colors.cardInk}
          strokeWidth="1.2"
        />
      </g>
    );
  }

  if (suit === 'bastos') {
    return (
      <g transform={`scale(${scale})`} data-suit-shape="club">
        <path
          d="M -4,-20 C -9,-19 -10,-9 -7,1 C -5,9 -4,16 -3,21 L 3,21 C 4,15 5,8 7,0 C 10,-10 8,-19 3,-20 Z"
          fill={identity.primaryHex}
          stroke={designTokens.colors.cardInk}
          strokeWidth="1.8"
        />
        {/* Vetas internas para textura distinguible en monocromo */}
        <line x1="-5" y1="-11" x2="4" y2="-5" stroke={identity.secondaryHex} strokeWidth="1.6" />
        <line x1="-4" y1="-2" x2="4" y2="4" stroke={identity.secondaryHex} strokeWidth="1.6" />
        <line x1="-2.5" y1="8" x2="2.5" y2="13" stroke={identity.secondaryHex} strokeWidth="1.4" />
        {/* Brotes laterales característicos del basto */}
        <path
          d="M 6,-7 C 13,-12 15,-6 9,-2 Z"
          fill={identity.secondaryHex}
          stroke={identity.primaryHex}
          strokeWidth="1.3"
        />
        <path
          d="M -6,2 C -13,-2 -14,5 -8,7 Z"
          fill={identity.secondaryHex}
          stroke={identity.primaryHex}
          strokeWidth="1.3"
        />
      </g>
    );
  }

  if (suit === 'oros') {
    return (
      <g transform={`scale(${scale})`} data-suit-shape="coin">
        <circle
          cx="0"
          cy="0"
          r="16.5"
          fill={identity.secondaryHex}
          stroke={identity.primaryHex}
          strokeWidth="2.2"
        />
        <circle
          cx="0"
          cy="0"
          r="12.5"
          fill="none"
          stroke={identity.primaryHex}
          strokeWidth="1.3"
          strokeDasharray="2.2 2.2"
        />
        <polygon
          points="0,-9.5 2.5,-2.5 9.5,0 2.5,2.5 0,9.5 -2.5,2.5 -9.5,0 -2.5,-2.5"
          fill={identity.primaryHex}
        />
        <circle cx="0" cy="0" r="2.8" fill={designTokens.colors.cardParchment} />
      </g>
    );
  }

  return (
    <g transform={`scale(${scale})`} data-suit-shape="chalice">
      {/* Asas gemelas curvas de la copa */}
      <path
        d="M -10,-12 C -17,-11 -17,-1 -9,0"
        fill="none"
        stroke={identity.primaryHex}
        strokeWidth="2.1"
        strokeLinecap="round"
      />
      <path
        d="M 10,-12 C 17,-11 17,-1 9,0"
        fill="none"
        stroke={identity.primaryHex}
        strokeWidth="2.1"
        strokeLinecap="round"
      />
      {/* Cáliz principal */}
      <path
        d="M -11,-15 L 11,-15 C 11,-2 6,4 0,5 C -6,4 -11,-2 -11,-15 Z"
        fill={identity.primaryHex}
        stroke={designTokens.colors.cardInk}
        strokeWidth="1.6"
      />
      {/* Faja grabada horizontal */}
      <line x1="-9.2" y1="-9" x2="9.2" y2="-9" stroke={identity.secondaryHex} strokeWidth="2" />
      <rect x="-2.5" y="5" width="5" height="9" rx="1.5" fill={identity.primaryHex} />
      <path
        d="M -10,18 Q 0,13 10,18 L 11,20.5 L -11,20.5 Z"
        fill={identity.secondaryHex}
        stroke={identity.primaryHex}
        strokeWidth="1.6"
      />
    </g>
  );
}

/**
 * Marco interno tradicional español con las "pintas" (cortes superiores e inferiores):
 * Oros: línea continua (0 cortes) | Copas: 1 corte | Espadas: 2 cortes | Bastos: 3 cortes.
 */
export function CardFrameWithPintasSvg({ suit }: { readonly suit: SpanishSuit }) {
  const { pintasBreaks, primaryHex } = SUIT_IDENTITIES[suit];
  const segments = pintasBreaks + 1;
  const xStart = 12;
  const xEnd = 108;
  const gapWidth = 6;
  const totalSpan = xEnd - xStart;
  const segWidth = (totalSpan - pintasBreaks * gapWidth) / segments;

  const horizontalBars: Array<{ x1: number; x2: number }> = [];
  for (let i = 0; i < segments; i++) {
    const x1 = xStart + i * (segWidth + gapWidth);
    horizontalBars.push({ x1, x2: x1 + segWidth });
  }

  return (
    <g data-pintas={pintasBreaks}>
      {/* Líneas laterales del recuadro */}
      <line
        x1={xStart}
        y1={14}
        x2={xStart}
        y2={166}
        stroke={primaryHex}
        strokeWidth="1.5"
        opacity="0.72"
      />
      <line
        x1={xEnd}
        y1={14}
        x2={xEnd}
        y2={166}
        stroke={primaryHex}
        strokeWidth="1.5"
        opacity="0.72"
      />
      {/* Líneas superior e inferior con pintas */}
      {horizontalBars.map((seg, idx) => (
        <g key={idx}>
          <line
            x1={seg.x1}
            y1={14}
            x2={seg.x2}
            y2={14}
            stroke={primaryHex}
            strokeWidth="2.1"
            strokeLinecap="round"
          />
          <line
            x1={seg.x1}
            y1={166}
            x2={seg.x2}
            y2={166}
            stroke={primaryHex}
            strokeWidth="2.1"
            strokeLinecap="round"
          />
        </g>
      ))}
    </g>
  );
}

/**
 * Figuras cortesanas originales (10 Sota, 11 Caballo, 12 Rey) con atributo heráldico + emblema del palo.
 */
export function CourtFigureSvg({
  rank,
  suit,
}: {
  readonly rank: 10 | 11 | 12;
  readonly suit: SpanishSuit;
}) {
  const identity = SUIT_IDENTITIES[suit];
  const roleLabel = rank === 10 ? 'SOTA' : rank === 11 ? 'CABALLO' : 'REY';

  return (
    <g transform="translate(60, 92)">
      <rect
        x="-31"
        y="-48"
        width="62"
        height="92"
        rx="10"
        fill={designTokens.colors.cardParchment}
        stroke={identity.primaryHex}
        strokeWidth="1.6"
        strokeDasharray={rank === 11 ? '4 2' : undefined}
      />
      {/* Insignia superior según rango cortesano */}
      {rank === 12 && (
        <path
          d="M -16,-28 L -11,-39 L -4,-31 L 0,-41 L 4,-31 L 11,-39 L 16,-28 Z"
          fill={designTokens.colors.accentGold}
          stroke={designTokens.colors.cardInk}
          strokeWidth="1.4"
        />
      )}
      {rank === 11 && (
        <path
          d="M -12,-25 C -12,-37 -2,-42 8,-39 L 13,-34 L 7,-31 L 10,-25 Z"
          fill={identity.secondaryHex}
          stroke={identity.primaryHex}
          strokeWidth="1.6"
        />
      )}
      {rank === 10 && (
        <polygon
          points="0,-40 12,-31 7,-24 -7,-24 -12,-31"
          fill={identity.secondaryHex}
          stroke={identity.primaryHex}
          strokeWidth="1.6"
        />
      )}

      <g transform="translate(0, 0)">
        <SuitEmblemSvg suit={suit} scale={1.15} />
      </g>

      <rect x="-24" y="25" width="48" height="13" rx="4" fill={identity.primaryHex} />
      <text
        x="0"
        y="34.2"
        textAnchor="middle"
        fontSize="7.5"
        fontWeight="700"
        letterSpacing="0.9"
        fill={designTokens.colors.textPrimary}
        fontFamily={designTokens.typography.sansFamily}
      >
        {roleLabel}
      </text>
    </g>
  );
}
