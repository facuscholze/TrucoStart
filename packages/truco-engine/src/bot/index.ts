import { getTrucoPower } from '../cards.js';
import { scoreEnvido, scoreFlor } from '../scoring.js';
import type { Action } from '../state.types.js';
import type { Card, Rng } from '../types.js';
import type { PlayerView } from '../view.js';
import { type BotDifficulty, type BotParams, resolveBotParams } from './difficulty.js';
import {
  buildCardKnowledge,
  type CardKnowledge,
  estimateCardWinProbability,
  estimateEnvidoWinProbability,
  estimateHandWinProbability,
  estimateHandWinRate,
} from './knowledge.js';

export type { BotDifficulty, BotParams } from './difficulty.js';
export { BOT_DIFFICULTY_PARAMS, resolveBotParams } from './difficulty.js';
export {
  buildCardKnowledge,
  estimateCardWinProbability,
  estimateEnvidoWinProbability,
  estimateHandWinProbability,
  estimateHandWinRate,
} from './knowledge.js';
export type { CardKnowledge } from './knowledge.js';

type ActionOf<T extends Action['type']> = Extract<Action, { type: T }>;

function findAction<T extends Action['type']>(
  view: PlayerView,
  type: T,
  predicate?: (act: ActionOf<T>) => boolean,
): ActionOf<T> | undefined {
  return view.legalActions.find(
    (a): a is ActionOf<T> => a.type === type && (predicate ? predicate(a as ActionOf<T>) : true),
  );
}

function powerOf(card: Card): number {
  return getTrucoPower(card);
}

/** Ruido determinista (Rng inyectado) para que los niveles flojos no jueguen perfecto. */
function applyNoise(value: number, noise: number, rng: Rng | undefined, salt: number): number {
  if (noise <= 0 || !rng) return value;
  const jitter = (rng.nextFloat() - 0.5) * 2 * noise;
  return Math.min(1, Math.max(0, value + jitter + salt * 0));
}

function rivalMaxScore(view: PlayerView): number {
  return Math.max(
    ...view.teams.filter((t) => t !== view.myTeam).map((t) => view.scoresByTeam[t] ?? 0),
    0,
  );
}

/**
 * ¿El equipo tiene una carta imbatible en la mesa (macho de espadas) o en mano?
 * Regla obligatoria: con carta imbatible nunca se rechaza un Truco/Retruco/Vale Cuatro.
 */
export function hasUnbeatableCard(view: PlayerView, knowledge: CardKnowledge): boolean {
  if (knowledge.myCards.some((card) => powerOf(card) === 14)) return true;
  const machoOnTableByMyTeam = view.hand.currentRoundPlays.some(
    (play) => play.team === view.myTeam && powerOf(play.card) === 14,
  );
  if (machoOnTableByMyTeam) return true;
  // El macho ya salió en una baza ganada por nuestro equipo: la baza está asegurada.
  return view.hand.completedRounds.some(
    (round) => round.winnerTeam === view.myTeam && round.plays.some((p) => powerOf(p.card) === 14),
  );
}

function partnerSignaledHighEnvido(view: PlayerView): boolean {
  return view.hand.visibleSignals.some(
    (s) => s.seat !== view.mySeat && s.signalId === 'inclinacion_cabeza',
  );
}

function selectTacticalSignal(view: PlayerView, params: BotParams): Action | null {
  if (view.hand.currentRoundIndex !== 0 || view.hand.mySignalCount > 0) return null;
  if (params.difficulty === 'EASY') return null;
  const signalActions = view.legalActions.filter(
    (a): a is ActionOf<'SEND_SIGNAL'> => a.type === 'SEND_SIGNAL',
  );
  if (signalActions.length === 0) return null;

  const ids = new Set(view.hand.myRemainingCards.map((c) => c.id));
  const findSig = (id: string) => signalActions.find((a) => a.signalId === id) ?? null;

  if (ids.has('1-espadas')) return findSig('guino_ojo');
  if (ids.has('1-bastos')) return findSig('cejas_arriba');
  if (ids.has('7-espadas')) return findSig('muesca_derecha');
  if (ids.has('7-oros')) return findSig('muesca_izquierda');
  if (scoreEnvido(view.hand.myInitialCards) >= 29) return findSig('inclinacion_cabeza');
  return null;
}

/**
 * Elige la carta a jugar priorizando SIEMPRE la más baja que alcance:
 * - Si el compañero ya asegura la baza, descartar la más chica.
 * - Si hay que matar, usar la menor carta ganadora posible.
 * - Si salimos primeros, guardar las altas cuando la baja alcanza para ganar.
 */
export function selectCardToPlay(
  view: PlayerView,
  knowledge: CardKnowledge,
  params: BotParams,
  rng: Rng | undefined,
): ActionOf<'PLAY_CARD'> {
  const playActions = view.legalActions.filter(
    (a): a is ActionOf<'PLAY_CARD'> => a.type === 'PLAY_CARD',
  );
  const cardMap = new Map<string, Card>(knowledge.myCards.map((c) => [c.id, c]));
  const sortedAsc = [...playActions].sort(
    (a, b) => powerOf(cardMap.get(a.cardId)!) - powerOf(cardMap.get(b.cardId)!),
  );
  const lowest = sortedAsc[0]!;
  const highest = sortedAsc[sortedAsc.length - 1]!;

  const opponentTeams = view.teams.filter((t) => t !== view.myTeam);
  const opponentBest = Math.max(
    0,
    ...opponentTeams.map((team) => knowledge.bestPowerByTeam[team] ?? 0),
  );
  const teammateBest = knowledge.bestPowerByTeam[view.myTeam] ?? 0;

  // Errores ocasionales del nivel fácil: juega la más alta sin necesidad.
  if (params.cardMistakeRate > 0 && rng && rng.nextFloat() < params.cardMistakeRate) {
    return highest;
  }

  // Compañero ganando la baza: acompañar con la más baja.
  if (teammateBest > opponentBest && teammateBest > 0) {
    const cheapestWinnerForRivals = knowledge.unseenCards.filter(
      (c) => powerOf(c) > teammateBest,
    ).length;
    if (cheapestWinnerForRivals > 0 || teammateBest >= 9) return lowest;
  }

  // Hay carta rival en la mesa: matar con la menor carta ganadora posible.
  if (opponentBest > 0) {
    const cheapestWinner = sortedAsc.find(
      (act) => powerOf(cardMap.get(act.cardId)!) > opponentBest,
    );
    if (cheapestWinner) {
      // Con la baza ya asegurada por una carta más alta del equipo, reservar.
      if (teammateBest > opponentBest) return lowest;
      return cheapestWinner;
    }

    const wonFirst = view.hand.completedRounds[0]?.winnerTeam === view.myTeam;
    if (wonFirst) {
      const tieCard = sortedAsc.find((act) => powerOf(cardMap.get(act.cardId)!) === opponentBest);
      if (tieCard) return tieCard;
    }
    // No podemos ganar la baza: descartar la más baja (guardar fuerza para la siguiente).
    return lowest;
  }

  // Somos mano de la baza: usar la carta más baja que alcance para ganar.
  for (const action of sortedAsc) {
    const prob = estimateCardWinProbability(powerOf(cardMap.get(action.cardId)!), knowledge);
    if (prob >= 0.55) return action;
  }

  // Si ninguna carta es confiable, la más alta para intentar asegurar la baza.
  return highest;
}

/** Canto/ respuesta de Envido según tanto, probabilidad estimada y marcador. */
function decideEnvido(
  view: PlayerView,
  knowledge: CardKnowledge,
  params: BotParams,
): Action | null {
  const pending = view.hand.envidoStatus === 'PENDING' && view.hand.envidoChain !== null;
  if (!pending) return null;

  const myEnvido = Math.max(
    scoreEnvido(view.hand.myInitialCards),
    partnerSignaledHighEnvido(view) ? 29 : 0,
  );
  const probability = estimateEnvidoWinProbability(myEnvido, knowledge);
  const chain = view.hand.envidoChain!;
  const lastBid = chain.bids[chain.bids.length - 1];

  if (lastBid === 'FALTA_ENVIDO') {
    const wantsFalta =
      myEnvido >= 30 || probability >= Math.max(0.55, params.envidoAcceptProbability + 0.08);
    const resp = findAction(
      view,
      'RESPOND_ENVIDO',
      (a) => a.decision === (wantsFalta ? 'QUIERO' : 'NO_QUIERO'),
    );
    if (resp) return resp;
  }

  // Subir cuando el tanto es alto y la probabilidad de ganar el envido es clara.
  if (myEnvido >= params.envidoRaiseThreshold && probability >= 0.72) {
    const raiseReal = findAction(view, 'CALL_ENVIDO', (a) => a.bid === 'REAL_ENVIDO');
    if (raiseReal) return raiseReal;
  }
  if (myEnvido >= params.envidoCallThreshold + 3 && probability >= 0.6 && lastBid === 'ENVIDO') {
    const raiseEnv = findAction(view, 'CALL_ENVIDO', (a) => a.bid === 'ENVIDO');
    if (raiseEnv) return raiseEnv;
  }

  const accept = probability >= params.envidoAcceptProbability || myEnvido >= 30;
  const resp = findAction(
    view,
    'RESPOND_ENVIDO',
    (a) => a.decision === (accept ? 'QUIERO' : 'NO_QUIERO'),
  );
  return resp ?? null;
}

/** Respuesta a Truco/Retruco/Vale Cuatro según fuerza real, marcador y cartas imbatibles. */
function decideTrucoResponse(
  view: PlayerView,
  knowledge: CardKnowledge,
  strength: number,
  params: BotParams,
  rng: Rng | undefined,
): Action | null {
  const pending = view.hand.truco.pending;
  if (!pending) return null;

  // "El envido está primero": con tanto alto, cantar envido antes de responder.
  const myEnvido = Math.max(
    scoreEnvido(view.hand.myInitialCards),
    partnerSignaledHighEnvido(view) ? 29 : 0,
  );
  if (myEnvido >= params.envidoCallThreshold) {
    const envFirst = findAction(view, 'CALL_ENVIDO', (a) => a.bid === 'ENVIDO');
    if (envFirst) return envFirst;
  }

  const unbeatable = hasUnbeatableCard(view, knowledge);
  const mustDefend = rivalMaxScore(view) + pending.declinedPoints >= view.ruleset.targetScore;
  const noisyStrength = applyNoise(strength, params.evaluationNoise * 0.5, rng, 1);

  // Con carta imbatible NUNCA se rechaza (regla obligatoria del nivel).
  if (unbeatable) {
    const raise = findAction(view, 'CALL_TRUCO');
    if (raise && (pending.bid === 'TRUCO' || pending.bid === 'RETRUCO') && noisyStrength >= 0.6) {
      return raise;
    }
    const quiero = findAction(view, 'RESPOND_TRUCO', (a) => a.decision === 'QUIERO');
    if (quiero) return quiero;
  }

  if (noisyStrength >= params.trucoAcceptStrength || mustDefend) {
    return findAction(view, 'RESPOND_TRUCO', (a) => a.decision === 'QUIERO') ?? null;
  }
  return findAction(view, 'RESPOND_TRUCO', (a) => a.decision === 'NO_QUIERO') ?? null;
}

/**
 * IA de Truco (BL-010). Recibe EXCLUSIVAMENTE `PlayerView` (salida de `viewFor`):
 * nunca accede al estado completo, a cartas ajenas ni a señales rivales.
 */
export function chooseBotAction(
  view: PlayerView,
  rng?: Rng,
  difficultyOrParams?: BotDifficulty | BotParams,
): Action {
  const { legalActions: actions } = view;
  if (actions.length === 0) {
    throw new Error(`No existen acciones legales disponibles para el asiento ${view.mySeat}`);
  }
  const params = resolveBotParams(difficultyOrParams);
  const knowledge = buildCardKnowledge(view);
  const myEnvido = Math.max(
    scoreEnvido(view.hand.myInitialCards),
    partnerSignaledHighEnvido(view) ? 29 : 0,
  );

  // 1. Flor inicial o contraflor: siempre conveniente.
  const callInitialFlor = findAction(view, 'CALL_FLOR', (a) => a.bid === 'FLOR');
  if (callInitialFlor) return callInitialFlor;

  if (view.hand.florStatus === 'PENDING') {
    const myFlor = scoreFlor(view.hand.myInitialCards);
    if (myFlor >= 37) {
      const resto = findAction(view, 'CALL_FLOR', (a) => a.bid === 'CONTRAFLOR_AL_RESTO');
      if (resto) return resto;
    }
    if (myFlor >= 34) {
      const contra = findAction(view, 'CALL_FLOR', (a) => a.bid === 'CONTRAFLOR');
      if (contra) return contra;
    }
    const wantsFlor = myFlor >= (params.difficulty === 'HARD' ? 26 : 28);
    const florResponse = findAction(
      view,
      'RESPOND_FLOR',
      (a) => a.decision === (wantsFlor ? 'CON_FLOR_QUIERO' : 'ACHICO'),
    );
    if (florResponse) return florResponse;
  }

  // 2. Envido pendiente: aceptar/subir según probabilidad estimada de ganarlo.
  const envidoDecision = decideEnvido(view, knowledge, params);
  if (envidoDecision) return envidoDecision;

  // 3. Fuerza de mano (Monte Carlo si el nivel recuerda cartas), calculada solo si hace falta:
  // el rollout es la parte más costosa y la mayoría de las decisiones son jugadas de carta.
  let cachedStrength: number | null = null;
  const strengthOf = (): number => {
    if (cachedStrength === null) {
      cachedStrength = params.usesCardMemory
        ? estimateHandWinRate(view, knowledge)
        : estimateHandWinProbability(view, knowledge);
    }
    return cachedStrength;
  };

  // 4. Truco pendiente: fuerza real + marcador + carta imbatible.
  if (view.hand.truco.pending !== null) {
    const trucoDecision = decideTrucoResponse(view, knowledge, strengthOf(), params, rng);
    if (trucoDecision) return trucoDecision;
  }

  // 4. Señal táctica al compañero (2v2, primera ronda, una sola vez).
  const sigAction = selectTacticalSignal(view, params);
  if (sigAction) return sigAction;

  // 5. Cantar Envido de entrada con tanto alto (o con probabilidad estimada muy alta).
  if (view.hand.currentRoundIndex === 0 && view.hand.envidoStatus === 'OPEN') {
    const envidoProbability = estimateEnvidoWinProbability(myEnvido, knowledge);
    if (myEnvido >= params.envidoRaiseThreshold && envidoProbability >= 0.7) {
      const callReal = findAction(view, 'CALL_ENVIDO', (a) => a.bid === 'REAL_ENVIDO');
      if (callReal) return callReal;
    }
    if (myEnvido >= params.envidoCallThreshold || envidoProbability >= 0.85) {
      const callEnv = findAction(view, 'CALL_ENVIDO', (a) => a.bid === 'ENVIDO');
      if (callEnv) return callEnv;
    }
  }

  // 6. Cantar/subir Truco con fuerza real, en posición favorable, o con farol moderado.
  const alreadyCalled = view.hand.truco.lastCallerTeam === view.myTeam;
  if (!alreadyCalled && view.hand.currentRoundIndex >= 1) {
    const noisyStrength = applyNoise(strengthOf(), params.evaluationNoise, rng, 0);
    const iAmMano = view.hand.manoSeat === view.mySeat;
    const rivalScore = rivalMaxScore(view);
    const iAmBehind = (view.scoresByTeam[view.myTeam] ?? 0) + 2 < rivalScore;
    const pressureBonus = (iAmMano ? 0.04 : 0) + (iAmBehind ? 0.05 : 0);
    const bluff = params.bluffRate > 0 && rng !== undefined && rng.nextFloat() < params.bluffRate;

    if (noisyStrength + pressureBonus >= params.trucoRaiseStrength || bluff) {
      const callTruco = findAction(view, 'CALL_TRUCO');
      if (callTruco) return callTruco;
    }
  }

  // 7. Jugar carta: la más baja que alcance, recordando lo ya jugado.
  if (actions.some((a) => a.type === 'PLAY_CARD')) {
    return selectCardToPlay(view, knowledge, params, rng);
  }

  // 8. Último recurso: irse al mazo o la primera acción legal.
  const fold = findAction(view, 'FOLD_HAND');
  if (fold) return fold;
  return actions[0]!;
}

export const BOT_DEFAULT_DIFFICULTY: BotDifficulty = 'MEDIUM';
