import {
  calculateFaltaPoints,
  type EnvidoBidType,
  type FlorBidType,
  type RuleSet,
  type TrucoBidType,
} from './rulesets.js';
import { ok, type Result, type RuleError, ruleError, type SeatId, type TeamId } from './types.js';

export interface EnvidoChainState {
  readonly bids: readonly EnvidoBidType[];
  readonly lastCallerSeat: SeatId;
  readonly lastCallerTeam: TeamId;
  readonly declinedPoints: number;
  readonly acceptedStaticPoints: number | null;
}

export interface FlorChainState {
  readonly bids: readonly FlorBidType[];
  readonly lastCallerSeat: SeatId;
  readonly lastCallerTeam: TeamId;
  readonly declinedPoints: number;
  readonly acceptedStaticPoints: number | null;
}

export interface PendingTrucoCall {
  readonly bid: TrucoBidType;
  readonly callerSeat: SeatId;
  readonly callerTeam: TeamId;
  readonly declinedPoints: number;
  readonly targetPoints: number;
}

export interface TrucoTrackState {
  readonly acceptedBid: TrucoBidType | null;
  readonly currentPoints: number;
  readonly lastCallerTeam: TeamId | null;
  readonly pending: PendingTrucoCall | null;
  readonly suspendedCaller: { readonly seat: SeatId; readonly team: TeamId } | null;
}

export function createInitialTrucoState(ruleset: RuleSet): TrucoTrackState {
  return {
    acceptedBid: null,
    currentPoints: ruleset.truco.baseHandPoints,
    lastCallerTeam: null,
    pending: null,
    suspendedCaller: null,
  };
}

export function getLegalEnvidoBids(
  ruleset: RuleSet,
  current: EnvidoChainState | null,
): readonly EnvidoBidType[] {
  if (!current) {
    return ['ENVIDO', 'REAL_ENVIDO', 'FALTA_ENVIDO'];
  }
  const lastBid = current.bids[current.bids.length - 1];
  if (lastBid === 'FALTA_ENVIDO') {
    return [];
  }
  if (lastBid === 'REAL_ENVIDO') {
    return ['FALTA_ENVIDO'];
  }
  const envidoRepeats = current.bids.filter((b) => b === 'ENVIDO').length;
  if (envidoRepeats < ruleset.envido.maxEnvidoRepeats) {
    return ['ENVIDO', 'REAL_ENVIDO', 'FALTA_ENVIDO'];
  }
  return ['REAL_ENVIDO', 'FALTA_ENVIDO'];
}

export function pushEnvidoBid(
  ruleset: RuleSet,
  current: EnvidoChainState | null,
  bid: EnvidoBidType,
  callerSeat: SeatId,
  callerTeam: TeamId,
): Result<EnvidoChainState, RuleError> {
  if (current && current.lastCallerTeam === callerTeam) {
    return ruleError('ENVIDO_NOT_ALLOWED', 'El mismo equipo no puede subir su propio envido');
  }
  const allowed = getLegalEnvidoBids(ruleset, current);
  if (!allowed.includes(bid)) {
    return ruleError('INVALID_ENVIDO_CHAIN', `No se permite cantar ${bid} en este punto`);
  }

  if (!current) {
    const acceptedStaticPoints =
      bid === 'ENVIDO'
        ? ruleset.envido.envidoPoints
        : bid === 'REAL_ENVIDO'
          ? ruleset.envido.realEnvidoPoints
          : null;
    return ok({
      bids: [bid],
      lastCallerSeat: callerSeat,
      lastCallerTeam: callerTeam,
      declinedPoints: ruleset.envido.declinedBasePoints,
      acceptedStaticPoints,
    });
  }

  const prevAccepted = current.acceptedStaticPoints ?? ruleset.envido.declinedBasePoints;
  const acceptedStaticPoints =
    bid === 'ENVIDO'
      ? prevAccepted + ruleset.envido.envidoPoints
      : bid === 'REAL_ENVIDO'
        ? prevAccepted + ruleset.envido.realEnvidoPoints
        : null;

  return ok({
    bids: [...current.bids, bid],
    lastCallerSeat: callerSeat,
    lastCallerTeam: callerTeam,
    declinedPoints: prevAccepted,
    acceptedStaticPoints,
  });
}

export function resolveEnvidoAcceptedPoints(
  ruleset: RuleSet,
  chain: EnvidoChainState,
  scoresByTeam: Readonly<Record<TeamId, number>>,
  winningTeam: TeamId,
): number {
  if (chain.acceptedStaticPoints !== null) {
    return chain.acceptedStaticPoints;
  }
  return calculateFaltaPoints(ruleset, scoresByTeam, winningTeam);
}

export function getLegalFlorRaises(
  ruleset: RuleSet,
  current: FlorChainState | null,
): readonly FlorBidType[] {
  if (!ruleset.flor.enabled) return [];
  if (!current) return ['FLOR'];

  const lastBid = current.bids[current.bids.length - 1];
  if (lastBid === 'FLOR') {
    const raises: FlorBidType[] = [];
    if (ruleset.flor.allowContraflor) raises.push('CONTRAFLOR');
    if (ruleset.flor.allowContraflorAlResto) raises.push('CONTRAFLOR_AL_RESTO');
    return raises;
  }
  if (lastBid === 'CONTRAFLOR') {
    return ruleset.flor.allowContraflorAlResto ? ['CONTRAFLOR_AL_RESTO'] : [];
  }
  return [];
}

export function pushFlorBid(
  ruleset: RuleSet,
  current: FlorChainState | null,
  bid: FlorBidType,
  callerSeat: SeatId,
  callerTeam: TeamId,
): Result<FlorChainState, RuleError> {
  if (!ruleset.flor.enabled) {
    return ruleError('FLOR_DISABLED', 'La Flor está desactivada en este RuleSet');
  }
  if (current && current.lastCallerTeam === callerTeam) {
    return ruleError('FLOR_NOT_ALLOWED', 'El mismo equipo no puede subir su propia Flor');
  }

  const allowed = getLegalFlorRaises(ruleset, current);
  if (!allowed.includes(bid)) {
    return ruleError('FLOR_NOT_ALLOWED', `No se permite cantar ${bid} en esta secuencia`);
  }

  if (!current) {
    return ok({
      bids: ['FLOR'],
      lastCallerSeat: callerSeat,
      lastCallerTeam: callerTeam,
      declinedPoints: ruleset.flor.florPoints,
      acceptedStaticPoints: ruleset.flor.conFlorQuieroPoints,
    });
  }

  if (bid === 'CONTRAFLOR') {
    return ok({
      bids: [...current.bids, 'CONTRAFLOR'],
      lastCallerSeat: callerSeat,
      lastCallerTeam: callerTeam,
      declinedPoints: ruleset.flor.contraflorDeclinedPoints,
      acceptedStaticPoints: ruleset.flor.contraflorPoints,
    });
  }

  const declined = current.acceptedStaticPoints ?? ruleset.flor.conFlorQuieroPoints;
  return ok({
    bids: [...current.bids, 'CONTRAFLOR_AL_RESTO'],
    lastCallerSeat: callerSeat,
    lastCallerTeam: callerTeam,
    declinedPoints: declined,
    acceptedStaticPoints: null,
  });
}

export function resolveFlorAcceptedPoints(
  ruleset: RuleSet,
  chain: FlorChainState,
  scoresByTeam: Readonly<Record<TeamId, number>>,
  winningTeam: TeamId,
): number {
  if (chain.acceptedStaticPoints !== null) {
    return chain.acceptedStaticPoints;
  }
  return calculateFaltaPoints(ruleset, scoresByTeam, winningTeam);
}

export function getNextTrucoBid(
  currentAcceptedOrPending: TrucoBidType | null,
): TrucoBidType | null {
  if (currentAcceptedOrPending === null) return 'TRUCO';
  if (currentAcceptedOrPending === 'TRUCO') return 'RETRUCO';
  if (currentAcceptedOrPending === 'RETRUCO') return 'VALE_CUATRO';
  return null;
}

export function getTrucoPointsForBid(ruleset: RuleSet, bid: TrucoBidType): number {
  if (bid === 'TRUCO') return ruleset.truco.trucoPoints;
  if (bid === 'RETRUCO') return ruleset.truco.retrucoPoints;
  return ruleset.truco.valeCuatroPoints;
}

export function canTeamCallTrucoBid(
  ruleset: RuleSet,
  truco: TrucoTrackState,
  callerTeam: TeamId,
  scoresByTeam: Readonly<Record<TeamId, number>>,
): TrucoBidType | null {
  if (
    ruleset.manoDeOnce.enabled &&
    ruleset.manoDeOnce.forbidTrucoByLeadingTeamAtMinusOne &&
    truco.acceptedBid === null &&
    truco.pending === null &&
    (scoresByTeam[callerTeam] ?? 0) >= ruleset.targetScore - 1
  ) {
    return null;
  }

  if (truco.pending) {
    if (truco.pending.callerTeam === callerTeam) return null;
    return getNextTrucoBid(truco.pending.bid);
  }

  if (truco.lastCallerTeam !== null && truco.lastCallerTeam === callerTeam) {
    return null;
  }

  return getNextTrucoBid(truco.acceptedBid);
}

export function applyTrucoBid(
  ruleset: RuleSet,
  truco: TrucoTrackState,
  bid: TrucoBidType,
  callerSeat: SeatId,
  callerTeam: TeamId,
  scoresByTeam: Readonly<Record<TeamId, number>>,
): Result<TrucoTrackState, RuleError> {
  const expectedBid = canTeamCallTrucoBid(ruleset, truco, callerTeam, scoresByTeam);
  if (expectedBid !== bid) {
    return ruleError('TRUCO_NOT_ALLOWED', `No es válido cantar ${bid} en este estado`);
  }

  // Si había un canto pendiente (ej. TRUCO -> RETRUCO), el nivel previo queda implícitamente querido
  const baseAcceptedBid = truco.pending ? truco.pending.bid : truco.acceptedBid;
  const baseAcceptedPoints = truco.pending ? truco.pending.targetPoints : truco.currentPoints;
  const targetPoints = getTrucoPointsForBid(ruleset, bid);

  return ok({
    acceptedBid: baseAcceptedBid,
    currentPoints: baseAcceptedPoints,
    lastCallerTeam: callerTeam,
    pending: {
      bid,
      callerSeat,
      callerTeam,
      declinedPoints: baseAcceptedPoints,
      targetPoints,
    },
    suspendedCaller: null,
  });
}

export function acceptPendingTruco(truco: TrucoTrackState): Result<TrucoTrackState, RuleError> {
  if (!truco.pending) {
    return ruleError('NO_PENDING_CALL', 'No hay canto de truco pendiente para aceptar');
  }
  return ok({
    acceptedBid: truco.pending.bid,
    currentPoints: truco.pending.targetPoints,
    lastCallerTeam: truco.pending.callerTeam,
    pending: null,
    suspendedCaller: null,
  });
}
