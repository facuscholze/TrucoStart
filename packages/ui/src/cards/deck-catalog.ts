export const SPANISH_SUITS = ['espadas', 'bastos', 'oros', 'copas'] as const;
export type SpanishSuit = (typeof SPANISH_SUITS)[number];

export const SPANISH_RANKS = [1, 2, 3, 4, 5, 6, 7, 10, 11, 12] as const;
export type SpanishRank = (typeof SPANISH_RANKS)[number];

export type SpanishCardId = `${SpanishRank}-${SpanishSuit}`;

export interface SpanishCardSpec {
  readonly id: SpanishCardId;
  readonly rank: SpanishRank;
  readonly suit: SpanishSuit;
  readonly label: string;
  readonly shortLabel: string;
}

export interface SuitVisualIdentity {
  readonly suit: SpanishSuit;
  readonly singularLabel: string;
  readonly pluralLabel: string;
  readonly glyphCode: 'E' | 'B' | 'O' | 'C';
  /** Cortes tradicionales ("pintas") en el marco superior e inferior: Oros=0, Copas=1, Espadas=2, Bastos=3 */
  readonly pintasBreaks: 0 | 1 | 2 | 3;
  readonly primaryHex: string;
  readonly secondaryHex: string;
  readonly shapeKind: 'blade' | 'club' | 'coin' | 'chalice';
}

export const SUIT_IDENTITIES: Readonly<Record<SpanishSuit, SuitVisualIdentity>> = {
  espadas: {
    suit: 'espadas',
    singularLabel: 'espada',
    pluralLabel: 'espadas',
    glyphCode: 'E',
    pintasBreaks: 2,
    primaryHex: '#1D4E78',
    secondaryHex: '#A7C7E7',
    shapeKind: 'blade',
  },
  bastos: {
    suit: 'bastos',
    singularLabel: 'basto',
    pluralLabel: 'bastos',
    glyphCode: 'B',
    pintasBreaks: 3,
    primaryHex: '#255C36',
    secondaryHex: '#8BC49A',
    shapeKind: 'club',
  },
  oros: {
    suit: 'oros',
    singularLabel: 'oro',
    pluralLabel: 'oros',
    glyphCode: 'O',
    pintasBreaks: 0,
    primaryHex: '#9E680C',
    secondaryHex: '#E0B84C',
    shapeKind: 'coin',
  },
  copas: {
    suit: 'copas',
    singularLabel: 'copa',
    pluralLabel: 'copas',
    glyphCode: 'C',
    pintasBreaks: 1,
    primaryHex: '#9E2A25',
    secondaryHex: '#E39A94',
    shapeKind: 'chalice',
  },
};

const RANK_NAMES: Readonly<Record<SpanishRank, string>> = {
  1: 'Uno',
  2: 'Dos',
  3: 'Tres',
  4: 'Cuatro',
  5: 'Cinco',
  6: 'Seis',
  7: 'Siete',
  10: 'Sota',
  11: 'Caballo',
  12: 'Rey',
};

export function describeSpanishCard(rank: SpanishRank, suit: SpanishSuit): string {
  if (rank === 1 && suit === 'espadas') return 'Ancho de espadas (1 de espadas)';
  if (rank === 1 && suit === 'bastos') return 'Ancho de bastos (1 de bastos)';
  if (rank === 7 && suit === 'espadas') return 'Siete de espadas';
  if (rank === 7 && suit === 'oros') return 'Siete de oros';
  if (rank >= 10) {
    return `${RANK_NAMES[rank]} de ${suit} (${rank} de ${suit})`;
  }
  return `${RANK_NAMES[rank]} de ${suit} (${rank} de ${suit})`;
}

export function parseSpanishCardId(
  cardId: string,
): { rank: SpanishRank; suit: SpanishSuit } | null {
  const dash = cardId.indexOf('-');
  if (dash === -1) return null;
  const rawRank = Number(cardId.slice(0, dash));
  const rawSuit = cardId.slice(dash + 1) as SpanishSuit;
  if (!SPANISH_RANKS.includes(rawRank as SpanishRank)) return null;
  if (!SPANISH_SUITS.includes(rawSuit)) return null;
  return { rank: rawRank as SpanishRank, suit: rawSuit };
}

export const ALL_SPANISH_CARDS: readonly SpanishCardSpec[] = SPANISH_SUITS.flatMap((suit) =>
  SPANISH_RANKS.map((rank) => {
    const id: SpanishCardId = `${rank}-${suit}`;
    return {
      id,
      rank,
      suit,
      label: describeSpanishCard(rank, suit),
      shortLabel: `${rank}${SUIT_IDENTITIES[suit].glyphCode}`,
    };
  }),
);

export interface PipCoordinate {
  readonly x: number;
  readonly y: number;
  readonly scale: number;
  readonly rotateDeg?: number;
}

/**
 * Posiciones armónicas en viewBox 120x180 para las cartas numéricas (1 al 7).
 */
export const PIP_LAYOUTS: Readonly<Record<1 | 2 | 3 | 4 | 5 | 6 | 7, readonly PipCoordinate[]>> = {
  1: [{ x: 60, y: 90, scale: 1.55 }],
  2: [
    { x: 60, y: 56, scale: 1.05 },
    { x: 60, y: 124, scale: 1.05, rotateDeg: 180 },
  ],
  3: [
    { x: 60, y: 48, scale: 0.92 },
    { x: 60, y: 90, scale: 0.96 },
    { x: 60, y: 132, scale: 0.92, rotateDeg: 180 },
  ],
  4: [
    { x: 41, y: 56, scale: 0.86 },
    { x: 79, y: 56, scale: 0.86 },
    { x: 41, y: 124, scale: 0.86, rotateDeg: 180 },
    { x: 79, y: 124, scale: 0.86, rotateDeg: 180 },
  ],
  5: [
    { x: 40, y: 52, scale: 0.82 },
    { x: 80, y: 52, scale: 0.82 },
    { x: 60, y: 90, scale: 0.88 },
    { x: 40, y: 128, scale: 0.82, rotateDeg: 180 },
    { x: 80, y: 128, scale: 0.82, rotateDeg: 180 },
  ],
  6: [
    { x: 41, y: 48, scale: 0.78 },
    { x: 79, y: 48, scale: 0.78 },
    { x: 41, y: 90, scale: 0.78 },
    { x: 79, y: 90, scale: 0.78 },
    { x: 41, y: 132, scale: 0.78, rotateDeg: 180 },
    { x: 79, y: 132, scale: 0.78, rotateDeg: 180 },
  ],
  7: [
    { x: 40, y: 46, scale: 0.75 },
    { x: 80, y: 46, scale: 0.75 },
    { x: 60, y: 70, scale: 0.78 },
    { x: 40, y: 95, scale: 0.75 },
    { x: 80, y: 95, scale: 0.75 },
    { x: 40, y: 134, scale: 0.75, rotateDeg: 180 },
    { x: 80, y: 134, scale: 0.75, rotateDeg: 180 },
  ],
};
