import type { EnvidoChainState, FlorChainState, TrucoTrackState } from './calls.js';
import { legalActions } from './legal-actions.js';
import type { RuleSet } from './rulesets.js';
import type {
  Action,
  CompletedRound,
  DomainEvent,
  GameState,
  RoundPlay,
  SecondaryTrackStatus,
  TeamSignalRecord,
} from './state.types.js';
import type { Card, PlayerSeat, SeatId, TeamId } from './types.js';

export interface PublicSeatSummary {
  readonly seat: SeatId;
  readonly team: TeamId;
  readonly playerId?: string;
  readonly remainingCardCount: number;
  readonly folded: boolean;
}

export interface PlayerHandView {
  readonly handNumber: number;
  readonly manoSeat: SeatId;
  readonly currentRoundIndex: number;
  readonly roundLeadSeat: SeatId;
  readonly turnSeat: SeatId;
  readonly activeSeat: SeatId;
  readonly responderTeam: TeamId | null;
  readonly myInitialCards: readonly Card[];
  readonly myRemainingCards: readonly Card[];
  readonly currentRoundPlays: readonly RoundPlay[];
  readonly completedRounds: readonly CompletedRound[];
  readonly foldedSeats: readonly SeatId[];
  readonly envidoStatus: SecondaryTrackStatus;
  readonly envidoChain: EnvidoChainState | null;
  readonly florStatus: SecondaryTrackStatus;
  readonly florChain: FlorChainState | null;
  readonly announcedFlorSeats: readonly SeatId[];
  readonly truco: TrucoTrackState;
  readonly visibleSignals: readonly TeamSignalRecord[];
  readonly mySignalCount: number;
}

export interface PlayerView {
  readonly status: 'IN_PROGRESS' | 'FINISHED';
  readonly ruleset: RuleSet;
  readonly mySeat: SeatId;
  readonly myTeam: TeamId;
  readonly seats: readonly PublicSeatSummary[];
  readonly teams: readonly TeamId[];
  readonly scoresByTeam: Readonly<Record<TeamId, number>>;
  readonly winnerTeam: TeamId | null;
  readonly abandonedBySeat: SeatId | null;
  readonly hand: PlayerHandView;
  readonly legalActions: readonly Action[];
}

/**
 * ÚNICA proyección autorizada de `GameState` hacia un cliente o agente de IA.
 * Jamás expone cartas no jugadas de otros asientos (ni siquiera de compañeros),
 * ni el estado interno del PRNG, ni señas de equipos rivales.
 */
export function viewFor(state: GameState, seat: SeatId): PlayerView {
  const viewerSeatInfo = state.seats[seat];
  if (!viewerSeatInfo) {
    throw new Error(`Asiento inválido para viewFor: ${seat}`);
  }

  const myTeam = viewerSeatInfo.team;
  const foldedSet = new Set(state.hand.foldedSeats);

  const publicSeats: PublicSeatSummary[] = state.seats.map((s) => ({
    seat: s.seat,
    team: s.team,
    ...(s.playerId !== undefined ? { playerId: s.playerId } : {}),
    remainingCardCount: state.hand.remainingHandsBySeat[s.seat]!.length,
    folded: foldedSet.has(s.seat),
  }));

  return {
    status: state.status,
    ruleset: state.ruleset,
    mySeat: seat,
    myTeam,
    seats: publicSeats,
    teams: [...state.teams],
    scoresByTeam: { ...state.scoresByTeam },
    winnerTeam: state.winnerTeam,
    abandonedBySeat: state.abandonedBySeat,
    hand: {
      handNumber: state.hand.handNumber,
      manoSeat: state.hand.manoSeat,
      currentRoundIndex: state.hand.currentRoundIndex,
      roundLeadSeat: state.hand.roundLeadSeat,
      turnSeat: state.hand.turnSeat,
      activeSeat: state.hand.activeSeat,
      responderTeam: state.hand.responderTeam,
      myInitialCards: [...state.hand.initialHandsBySeat[seat]!],
      myRemainingCards: [...state.hand.remainingHandsBySeat[seat]!],
      currentRoundPlays: [...state.hand.currentRoundPlays],
      completedRounds: state.hand.completedRounds.map((round) => ({
        ...round,
        plays: [...round.plays],
      })),
      foldedSeats: [...state.hand.foldedSeats],
      envidoStatus: state.hand.envidoStatus,
      envidoChain: state.hand.envidoChain
        ? {
            ...state.hand.envidoChain,
            bids: [...state.hand.envidoChain.bids],
          }
        : null,
      florStatus: state.hand.florStatus,
      florChain: state.hand.florChain
        ? {
            ...state.hand.florChain,
            bids: [...state.hand.florChain.bids],
          }
        : null,
      announcedFlorSeats: [...state.hand.announcedFlorSeats],
      truco: {
        ...state.hand.truco,
        pending: state.hand.truco.pending ? { ...state.hand.truco.pending } : null,
        suspendedCaller: state.hand.truco.suspendedCaller
          ? { ...state.hand.truco.suspendedCaller }
          : null,
      },
      visibleSignals: state.hand.signalsSentThisHand.filter((sig) => sig.team === myTeam),
      mySignalCount: state.hand.signalCountBySeat[seat] ?? 0,
    },
    legalActions: legalActions(state, seat),
  };
}

/**
 * Filtra una lista de `DomainEvent` para que pueda enviarse de forma segura a `viewerSeat`:
 * oculta cualquier `SIGNAL_SENT` emitido por equipos rivales.
 */
export function projectEventsForSeat(
  events: readonly DomainEvent[],
  seats: readonly PlayerSeat[],
  viewerSeat: SeatId,
): DomainEvent[] {
  const viewerInfo = seats[viewerSeat];
  if (!viewerInfo) {
    throw new Error(`Asiento inválido para projectEventsForSeat: ${viewerSeat}`);
  }
  return events.filter((event) => {
    if (event.type === 'SIGNAL_SENT') {
      return event.team === viewerInfo.team;
    }
    return true;
  });
}
