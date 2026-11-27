import type {
  HandCardItem,
  SpanishCardId,
  SpanishRank,
  SpanishSuit,
  TableRoundSummary,
} from '@truco/ui';
import { messagesEsAr } from '../../i18n/messages.es-AR.js';

export type ServerEnvidoBid = 'ENVIDO' | 'REAL_ENVIDO' | 'FALTA_ENVIDO';
export type ServerTrucoBid = 'TRUCO' | 'RETRUCO' | 'VALE_CUATRO';
export type ServerFlorBid = 'FLOR' | 'CONTRAFLOR' | 'CONTRAFLOR_AL_RESTO';
export type ServerCallDecision = 'QUIERO' | 'NO_QUIERO' | 'CON_FLOR_QUIERO' | 'ACHICO';

export type ServerLegalAction =
  | { readonly type: 'PLAY_CARD'; readonly seat: number; readonly cardId: SpanishCardId }
  | { readonly type: 'CALL_ENVIDO'; readonly seat: number; readonly bid: ServerEnvidoBid }
  | {
      readonly type: 'RESPOND_ENVIDO';
      readonly seat: number;
      readonly decision: 'QUIERO' | 'NO_QUIERO';
    }
  | { readonly type: 'CALL_FLOR'; readonly seat: number; readonly bid: ServerFlorBid }
  | {
      readonly type: 'RESPOND_FLOR';
      readonly seat: number;
      readonly decision: 'CON_FLOR_QUIERO' | 'ACHICO';
    }
  | { readonly type: 'CALL_TRUCO'; readonly seat: number; readonly bid: ServerTrucoBid }
  | {
      readonly type: 'RESPOND_TRUCO';
      readonly seat: number;
      readonly decision: 'QUIERO' | 'NO_QUIERO';
    }
  | { readonly type: 'FOLD_HAND'; readonly seat: number }
  | { readonly type: 'SEND_SIGNAL'; readonly seat: number; readonly signalId: string };

export interface ServerWireCard {
  readonly id: SpanishCardId;
  readonly rank: SpanishRank;
  readonly suit: SpanishSuit;
}

export interface ServerRoundPlay {
  readonly seat: number;
  readonly team: number;
  readonly card: ServerWireCard;
}

export interface ServerCompletedRound {
  readonly roundIndex: number;
  readonly plays: readonly ServerRoundPlay[];
  readonly winnerTeam: number | null;
  readonly winningSeat: number | null;
  readonly isParda: boolean;
}

export interface ServerPublicSeat {
  readonly seat: number;
  readonly team: number;
  readonly remainingCardCount: number;
  readonly folded: boolean;
}

/**
 * Vista sanitizada `viewFor(state, mySeat)` emitida por el servidor autoritativo.
 * El cliente jamás recalcula reglas ni reconstruye estados ocultos; solo proyecta estos datos.
 */
export interface ServerPlayerView {
  readonly status: 'IN_PROGRESS' | 'FINISHED';
  readonly ruleset: {
    readonly code: string;
    readonly targetScore: number;
    readonly flor: { readonly enabled: boolean };
  };
  readonly mySeat: number;
  readonly myTeam: number;
  readonly seats: readonly ServerPublicSeat[];
  /** Los equipos de la mesa, en orden de asiento. Con 3 equipos (3v3) hay tres entradas. */
  readonly teams?: readonly number[];
  readonly scoresByTeam: Readonly<Record<string, number>>;
  readonly winnerTeam: number | null;
  readonly abandonedBySeat: number | null;
  readonly hand: {
    readonly handNumber: number;
    readonly manoSeat: number;
    readonly currentRoundIndex: number;
    readonly turnSeat: number;
    readonly activeSeat: number;
    readonly responderTeam: number | null;
    readonly myRemainingCards: readonly ServerWireCard[];
    readonly currentRoundPlays: readonly ServerRoundPlay[];
    readonly completedRounds: readonly ServerCompletedRound[];
  };
  readonly legalActions: readonly ServerLegalAction[];
}

export interface PendingResponseOption {
  readonly family: 'ENVIDO' | 'TRUCO' | 'FLOR';
  readonly decision: ServerCallDecision;
}

export interface GroupedServerLegalCalls {
  readonly playableCardIds: ReadonlySet<SpanishCardId>;
  readonly pendingResponses: readonly PendingResponseOption[];
  readonly pendingFamily: 'ENVIDO' | 'TRUCO' | 'FLOR' | null;
  readonly envidoBids: readonly ServerEnvidoBid[];
  readonly trucoBids: readonly ServerTrucoBid[];
  readonly florBids: readonly ServerFlorBid[];
  readonly canFoldHand: boolean;
  readonly signalIds: readonly string[];
  readonly totalCallCount: number;
}

export function groupServerLegalActions(
  legalActions: readonly ServerLegalAction[],
): GroupedServerLegalCalls {
  const playableCardIds = new Set<SpanishCardId>();
  const pendingResponses: PendingResponseOption[] = [];
  const envidoBids: ServerEnvidoBid[] = [];
  const trucoBids: ServerTrucoBid[] = [];
  const florBids: ServerFlorBid[] = [];
  const signalIds: string[] = [];
  let canFoldHand = false;

  for (const act of legalActions) {
    switch (act.type) {
      case 'PLAY_CARD':
        playableCardIds.add(act.cardId);
        break;
      case 'CALL_ENVIDO':
        envidoBids.push(act.bid);
        break;
      case 'CALL_TRUCO':
        trucoBids.push(act.bid);
        break;
      case 'CALL_FLOR':
        florBids.push(act.bid);
        break;
      case 'RESPOND_ENVIDO':
        pendingResponses.push({ family: 'ENVIDO', decision: act.decision });
        break;
      case 'RESPOND_TRUCO':
        pendingResponses.push({ family: 'TRUCO', decision: act.decision });
        break;
      case 'RESPOND_FLOR':
        pendingResponses.push({ family: 'FLOR', decision: act.decision });
        break;
      case 'FOLD_HAND':
        canFoldHand = true;
        break;
      case 'SEND_SIGNAL':
        signalIds.push(act.signalId);
        break;
    }
  }

  const pendingFamily = pendingResponses[0]?.family ?? null;
  const totalCallCount =
    pendingResponses.length + envidoBids.length + trucoBids.length + florBids.length;

  return {
    playableCardIds,
    pendingResponses,
    pendingFamily,
    envidoBids,
    trucoBids,
    florBids,
    canFoldHand,
    signalIds,
    totalCallCount,
  };
}

export function projectHandCardsFromView(
  view: ServerPlayerView,
  playableCardIds: ReadonlySet<SpanishCardId>,
): HandCardItem[] {
  return view.hand.myRemainingCards.map((c) => ({
    id: c.id,
    rank: c.rank,
    suit: c.suit,
    playable: playableCardIds.has(c.id),
  }));
}

export function projectRoundsForTable(
  view: ServerPlayerView,
  nicknameBySeat: ReadonlyMap<number, string>,
): TableRoundSummary[] {
  const summaries: TableRoundSummary[] = [];

  for (const done of view.hand.completedRounds) {
    const label = messagesEsAr.mesa.roundLabels[done.roundIndex] ?? `${done.roundIndex + 1}.ª baza`;
    const statusLabel = done.isParda
      ? messagesEsAr.mesa.roundParda
      : done.winnerTeam === view.myTeam
        ? messagesEsAr.mesa.roundWonUs
        : messagesEsAr.mesa.roundWonThem;

    summaries.push({
      roundIndex: done.roundIndex,
      label,
      statusLabel,
      plays: done.plays.map((p) => ({
        seat: p.seat,
        team: p.team,
        playerNickname: nicknameBySeat.get(p.seat) ?? `Asiento ${p.seat + 1}`,
        rank: p.card.rank,
        suit: p.card.suit,
      })),
    });
  }

  if (view.hand.currentRoundPlays.length > 0) {
    const idx = view.hand.currentRoundIndex;
    summaries.push({
      roundIndex: idx,
      label: messagesEsAr.mesa.roundLabels[idx] ?? `${idx + 1}.ª baza`,
      plays: view.hand.currentRoundPlays.map((p) => ({
        seat: p.seat,
        team: p.team,
        playerNickname: nicknameBySeat.get(p.seat) ?? `Asiento ${p.seat + 1}`,
        rank: p.card.rank,
        suit: p.card.suit,
      })),
    });
  }

  return summaries;
}

export interface RelativeSeatLayout {
  readonly bottomSeat: number;
  readonly topSeat: number;
  readonly leftSeat: number | null;
  readonly rightSeat: number | null;
  /**
   * Asientos que no entran en la mesa de 4 posiciones. Sólo el truco de 6 (3v3) los usa: se
   * dibujan en una tira extra debajo de la mesa, con su equipo y su turno bien visibles.
   */
  readonly extraSeats: readonly number[];
}

/**
 * Posiciones de la mesa relativas a mi asiento, con el orden de turnos (antihorario) a la vista.
 *
 * - 2 asientos (1v1): yo abajo, el rival arriba.
 * - 4 asientos (2v2): yo abajo, el de mi izquierda... es decir el siguiente en el orden de
 *   turnos a mi derecha, el compañero arriba y el otro rival a la izquierda.
 * - 6 asientos (3v3): yo abajo, el compañero arriba y los dos rivales a los costados (el que
 *   juega después de mí a la derecha). Los dos asientos que sobran van a la tira inferior.
 */
export function resolveRelativeSeats(mySeat: number, totalSeats: number): RelativeSeatLayout {
  const total = Math.max(2, totalSeats);
  const at = (offset: number) => (mySeat + offset) % total;

  if (total >= 6) {
    return {
      bottomSeat: mySeat,
      rightSeat: at(1),
      topSeat: at(3),
      leftSeat: at(5),
      extraSeats: [at(2), at(4)],
    };
  }
  if (total === 4) {
    return {
      bottomSeat: mySeat,
      rightSeat: at(1),
      topSeat: at(2),
      leftSeat: at(3),
      extraSeats: [],
    };
  }
  return {
    bottomSeat: mySeat,
    topSeat: at(1),
    leftSeat: null,
    rightSeat: null,
    extraSeats: [],
  };
}
