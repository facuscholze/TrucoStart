import { getTrucoPower } from './cards.js';
import { scoreEnvido, scoreFlor } from './scoring.js';
import type { Action } from './state.types.js';
import type { Card, Rng } from './types.js';
import type { PlayerView } from './view.js';

function estimateTeamStrength(view: PlayerView): number {
  const myPowers = view.hand.myRemainingCards.map((c) => getTrucoPower(c)).sort((a, b) => b - a);
  const top1 = myPowers[0] ?? 0;
  const top2 = myPowers[1] ?? top1;

  let base = (top1 / 14) * 0.65 + (top2 / 14) * 0.35;

  // Bonificación por señas recibidas de compañeros
  for (const sig of view.hand.visibleSignals) {
    if (sig.seat === view.mySeat) continue;
    if (sig.signalId === 'guino_ojo' || sig.signalId === 'cejas_arriba') {
      base = Math.max(base, 0.82);
    } else if (
      sig.signalId === 'muesca_derecha' ||
      sig.signalId === 'muesca_izquierda' ||
      sig.signalId === 'morder_labio'
    ) {
      base = Math.max(base, 0.68);
    }
  }

  // Ajuste por resultado de primera ronda
  const r1 = view.hand.completedRounds[0];
  if (r1) {
    if (r1.winnerTeam === view.myTeam) {
      base += 0.18;
    } else if (!r1.isParda) {
      base -= 0.12;
    }
  }

  return Math.max(0, Math.min(1, base));
}

function partnerSignaledHighEnvido(view: PlayerView): boolean {
  return view.hand.visibleSignals.some(
    (s) => s.seat !== view.mySeat && s.signalId === 'inclinacion_cabeza',
  );
}

function selectTacticalSignal(view: PlayerView): Action | null {
  if (view.hand.currentRoundIndex !== 0 || view.hand.mySignalCount > 0) {
    return null;
  }
  const signalActions = view.legalActions.filter(
    (a): a is Extract<Action, { type: 'SEND_SIGNAL' }> => a.type === 'SEND_SIGNAL',
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

function selectBestCardToPlay(
  view: PlayerView,
  playActions: readonly Extract<Action, { type: 'PLAY_CARD' }>[],
): Extract<Action, { type: 'PLAY_CARD' }> {
  const cardMap = new Map<string, Card>(view.hand.myRemainingCards.map((c) => [c.id, c]));
  const sortedAsc = [...playActions].sort(
    (a, b) => getTrucoPower(cardMap.get(a.cardId)!) - getTrucoPower(cardMap.get(b.cardId)!),
  );
  const lowest = sortedAsc[0]!;
  const highest = sortedAsc[sortedAsc.length - 1]!;

  let bestOpponentPower = 0;
  let bestTeammatePower = 0;
  for (const play of view.hand.currentRoundPlays) {
    const p = getTrucoPower(play.card);
    if (play.team === view.myTeam) {
      bestTeammatePower = Math.max(bestTeammatePower, p);
    } else {
      bestOpponentPower = Math.max(bestOpponentPower, p);
    }
  }

  // Si un compañero ya va ganando con buena carta, acompañar con la más chica
  if (bestTeammatePower > bestOpponentPower && bestTeammatePower >= 9) {
    return lowest;
  }

  // Si hay carta rival en mesa, matar con la menor carta ganadora posible
  if (bestOpponentPower > 0) {
    const cheapestWinner = sortedAsc.find(
      (act) => getTrucoPower(cardMap.get(act.cardId)!) > bestOpponentPower,
    );
    if (cheapestWinner) return cheapestWinner;

    // Si ganamos primera y podemos empatar segunda/tercera, empardar cierra la mano
    const wonFirst = view.hand.completedRounds[0]?.winnerTeam === view.myTeam;
    if (wonFirst) {
      const tieCard = sortedAsc.find(
        (act) => getTrucoPower(cardMap.get(act.cardId)!) === bestOpponentPower,
      );
      if (tieCard) return tieCard;
    }

    return lowest;
  }

  // Saliendo primero: en primera ronda jugar carta fuerte pero reservar el ancho si hay respaldo
  if (view.hand.currentRoundIndex === 0 && sortedAsc.length >= 2) {
    const secondHighest = sortedAsc[sortedAsc.length - 2]!;
    const topPower = getTrucoPower(cardMap.get(highest.cardId)!);
    const secondPower = getTrucoPower(cardMap.get(secondHighest.cardId)!);
    if (topPower >= 13 && secondPower >= 9) {
      return secondHighest;
    }
  }

  return highest;
}

/**
 * IA heurística sin trampa: recibe EXCLUSIVAMENTE `PlayerView` (salida de `viewFor`),
 * sin acceso al estado completo del servidor ni a cartas/señas ocultas.
 */
export function chooseBotActionLegacy(view: PlayerView, rng?: Rng): Action {
  const { legalActions: actions } = view;
  if (actions.length === 0) {
    throw new Error(`No existen acciones legales disponibles para el asiento ${view.mySeat}`);
  }

  const findAction = <T extends Action['type']>(
    type: T,
    predicate?: (act: Extract<Action, { type: T }>) => boolean,
  ): Extract<Action, { type: T }> | undefined =>
    actions.find(
      (a): a is Extract<Action, { type: T }> =>
        a.type === type && (predicate ? predicate(a as Extract<Action, { type: T }>) : true),
    );

  // 1. Si puede cantar FLOR inicial (o matar un envido con FLOR), hacerlo siempre
  const callInitialFlor = findAction('CALL_FLOR', (a) => a.bid === 'FLOR');
  if (callInitialFlor) {
    return callInitialFlor;
  }

  // 2. Respuesta ante Flor pendiente
  if (view.hand.florStatus === 'PENDING') {
    const myFlor = scoreFlor(view.hand.myInitialCards);
    if (myFlor >= 37) {
      const resto = findAction('CALL_FLOR', (a) => a.bid === 'CONTRAFLOR_AL_RESTO');
      if (resto) return resto;
    }
    if (myFlor >= 34) {
      const contra = findAction('CALL_FLOR', (a) => a.bid === 'CONTRAFLOR');
      if (contra) return contra;
    }
    if (myFlor >= 28) {
      const quiero = findAction('RESPOND_FLOR', (a) => a.decision === 'CON_FLOR_QUIERO');
      if (quiero) return quiero;
    }
    const achico = findAction('RESPOND_FLOR', (a) => a.decision === 'ACHICO');
    if (achico) return achico;
  }

  // 3. Respuesta ante Envido pendiente
  if (view.hand.envidoStatus === 'PENDING' && view.hand.envidoChain !== null) {
    const myEnvido = scoreEnvido(view.hand.myInitialCards);
    const effectiveEnvido = Math.max(myEnvido, partnerSignaledHighEnvido(view) ? 29 : 0);
    const lastBid = view.hand.envidoChain.bids[view.hand.envidoChain.bids.length - 1];

    if (lastBid === 'FALTA_ENVIDO') {
      const decision = effectiveEnvido >= 30 ? 'QUIERO' : 'NO_QUIERO';
      const resp = findAction('RESPOND_ENVIDO', (a) => a.decision === decision);
      if (resp) return resp;
    } else {
      if (effectiveEnvido >= 31) {
        const raiseReal = findAction('CALL_ENVIDO', (a) => a.bid === 'REAL_ENVIDO');
        if (raiseReal) return raiseReal;
      }
      if (effectiveEnvido >= 29 && lastBid === 'ENVIDO') {
        const raiseEnv = findAction('CALL_ENVIDO', (a) => a.bid === 'ENVIDO');
        if (raiseEnv) return raiseEnv;
      }
      const threshold = lastBid === 'REAL_ENVIDO' ? 27 : 25;
      const decision = effectiveEnvido >= threshold ? 'QUIERO' : 'NO_QUIERO';
      const resp = findAction('RESPOND_ENVIDO', (a) => a.decision === decision);
      if (resp) return resp;
    }
  }

  // 4. Respuesta ante Truco pendiente (incluyendo "el envido está primero")
  if (view.hand.truco.pending !== null) {
    const myEnvido = scoreEnvido(view.hand.myInitialCards);
    if (myEnvido >= 28) {
      const envFirst = findAction('CALL_ENVIDO', (a) => a.bid === 'ENVIDO');
      if (envFirst) return envFirst;
    }

    const strength = estimateTeamStrength(view);
    const rivalMaxScore = Math.max(
      ...view.teams.filter((t) => t !== view.myTeam).map((t) => view.scoresByTeam[t] ?? 0),
    );
    const mustDefendMatchPoint =
      rivalMaxScore + view.hand.truco.pending.declinedPoints >= view.ruleset.targetScore;

    if (strength >= 0.78) {
      const raise = findAction('CALL_TRUCO');
      if (raise) return raise;
    }
    if (strength >= 0.45 || mustDefendMatchPoint) {
      const quiero = findAction('RESPOND_TRUCO', (a) => a.decision === 'QUIERO');
      if (quiero) return quiero;
    }
    const noQuiero = findAction('RESPOND_TRUCO', (a) => a.decision === 'NO_QUIERO');
    if (noQuiero) return noQuiero;
  }

  // 5. En turno propio en 2v2: enviar a lo sumo 1 seña táctica útil al compañero
  const sigAction = selectTacticalSignal(view);
  if (sigAction) return sigAction;

  // 6. Iniciar Envido en primera ronda si tenemos buen tanto
  if (view.hand.currentRoundIndex === 0) {
    const myEnvido = scoreEnvido(view.hand.myInitialCards);
    if (myEnvido >= 31) {
      const callReal = findAction('CALL_ENVIDO', (a) => a.bid === 'REAL_ENVIDO');
      if (callReal) return callReal;
    }
    if (myEnvido >= 27) {
      const callEnv = findAction('CALL_ENVIDO', (a) => a.bid === 'ENVIDO');
      if (callEnv) return callEnv;
    }
  }

  // 7. Iniciar o subir Truco en segunda/tercera ronda cuando la fuerza lo respalda (o pequeño farol)
  const strength = estimateTeamStrength(view);
  const bluffRoll = rng ? rng.nextFloat() : 1;
  if (view.hand.currentRoundIndex >= 1 && (strength >= 0.72 || bluffRoll < 0.06)) {
    const callTruco = findAction('CALL_TRUCO');
    if (callTruco) return callTruco;
  }

  // 8. Jugar la mejor carta según el contexto de la ronda
  const playActions = actions.filter(
    (a): a is Extract<Action, { type: 'PLAY_CARD' }> => a.type === 'PLAY_CARD',
  );
  if (playActions.length > 0) {
    return selectBestCardToPlay(view, playActions);
  }

  return actions[0]!;
}
