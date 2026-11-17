import {
  type Card,
  type CardId,
  err,
  ok,
  RANKS,
  type Result,
  type Rng,
  type RuleError,
  ruleError,
  type SeatId,
  SUITS,
} from './types.js';

export const CARDS_PER_PLAYER = 3;

const TRUCO_POWER_BY_ID: Readonly<Record<CardId, number>> = {
  '1-espadas': 14,
  '1-bastos': 13,
  '7-espadas': 12,
  '7-oros': 11,

  '3-espadas': 10,
  '3-bastos': 10,
  '3-oros': 10,
  '3-copas': 10,

  '2-espadas': 9,
  '2-bastos': 9,
  '2-oros': 9,
  '2-copas': 9,

  '1-copas': 8,
  '1-oros': 8,

  '12-espadas': 7,
  '12-bastos': 7,
  '12-oros': 7,
  '12-copas': 7,

  '11-espadas': 6,
  '11-bastos': 6,
  '11-oros': 6,
  '11-copas': 6,

  '10-espadas': 5,
  '10-bastos': 5,
  '10-oros': 5,
  '10-copas': 5,

  '7-copas': 4,
  '7-bastos': 4,

  '6-espadas': 3,
  '6-bastos': 3,
  '6-oros': 3,
  '6-copas': 3,

  '5-espadas': 2,
  '5-bastos': 2,
  '5-oros': 2,
  '5-copas': 2,

  '4-espadas': 1,
  '4-bastos': 1,
  '4-oros': 1,
  '4-copas': 1,
};

const STANDARD_DECK: readonly Card[] = Object.freeze(
  SUITS.flatMap((suit) =>
    RANKS.map((rank) =>
      Object.freeze({
        id: `${rank}-${suit}` as const,
        rank,
        suit,
      }),
    ),
  ),
);

const CARD_BY_ID: ReadonlyMap<CardId, Card> = new Map(STANDARD_DECK.map((card) => [card.id, card]));

export function createStandardDeck(): readonly Card[] {
  return STANDARD_DECK;
}

export function getCardById(cardId: CardId): Card | undefined {
  return CARD_BY_ID.get(cardId);
}

export function getTrucoPower(card: Card): number {
  return TRUCO_POWER_BY_ID[card.id];
}

/**
 * Compara dos cartas según la jerarquía del truco argentino:
 *  1 si `a` mata a `b`
 * -1 si `b` mata a `a`
 *  0 si empatan (parda)
 */
export function compareCards(a: Card, b: Card): -1 | 0 | 1 {
  const powerA = getTrucoPower(a);
  const powerB = getTrucoPower(b);
  if (powerA > powerB) return 1;
  if (powerA < powerB) return -1;
  return 0;
}

/**
 * Mezcla imparcial Fisher-Yates usando el RNG inyectado.
 */
export function shuffleDeck(deck: readonly Card[], rng: Rng): Result<readonly Card[], RuleError> {
  const copy = [...deck];
  for (let i = copy.length - 1; i > 0; i--) {
    const sample = rng.nextFloat();
    if (!Number.isFinite(sample) || sample < 0 || sample >= 1) {
      return ruleError(
        'INVALID_RNG',
        `El RNG devolvió un valor fuera de [0, 1): ${String(sample)}`,
      );
    }
    const j = Math.floor(sample * (i + 1));
    const current = copy[i];
    const target = copy[j];
    if (!current || !target) {
      return err({ code: 'INVALID_RNG', message: 'Índice inválido durante barajado Fisher-Yates' });
    }
    copy[i] = target;
    copy[j] = current;
  }
  return ok(copy);
}

/**
 * Reparte 3 cartas por asiento en sentido antihorario comenzando desde `manoSeat`
 * (una carta por vuelta, 3 vueltas, igual que el reparto tradicional).
 */
export function dealHands(
  shuffledDeck: readonly Card[],
  numSeats: number,
  manoSeat: SeatId,
): Readonly<Record<SeatId, readonly Card[]>> {
  const buckets: Record<SeatId, Card[]> = {};
  for (let s = 0; s < numSeats; s++) {
    buckets[s] = [];
  }

  let cursor = 0;
  for (let round = 0; round < CARDS_PER_PLAYER; round++) {
    for (let offset = 0; offset < numSeats; offset++) {
      const seat = (manoSeat + offset) % numSeats;
      const card = shuffledDeck[cursor++];
      if (card) {
        buckets[seat]?.push(card);
      }
    }
  }

  return buckets;
}
