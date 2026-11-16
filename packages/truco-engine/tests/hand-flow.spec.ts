import { describe, expect, it } from 'vitest';
import { getCardById } from '../src/cards.js';
import { applyAction, createGame, createGameWithHands } from '../src/engine.js';
import { legalActions } from '../src/legal-actions.js';
import { createSeededRng } from '../src/rng.js';
import { AR_SIN_FLOR_V1, AR_STANDARD_V1, createRuleSetVariant } from '../src/rulesets.js';
import type { Action, GameState } from '../src/state.types.js';
import type { Card, CardId, PlayerSeat } from '../src/types.js';

const SEATS_1V1: PlayerSeat[] = [
  { seat: 0, team: 0 },
  { seat: 1, team: 1 },
];

const SEATS_2V2: PlayerSeat[] = [
  { seat: 0, team: 0 },
  { seat: 1, team: 1 },
  { seat: 2, team: 0 },
  { seat: 3, team: 1 },
];

function hand(...ids: [CardId, CardId, CardId]): readonly Card[] {
  return ids.map((id) => getCardById(id)!);
}

function runSequence(initial: GameState, actions: readonly Action[]) {
  let state = initial;
  const allEvents = [];
  for (const act of actions) {
    const res = applyAction(state, act);
    expect(res.ok, `Acción falló inesperadamente: ${JSON.stringify(act)}`).toBe(true);
    if (!res.ok) throw new Error(res.error.message);
    state = res.value.state;
    allEvents.push(...res.value.events);
  }
  return { state, events: allEvents };
}

describe('Complete N-seat hand flow: Pardas, Envido, Flor, Truco, Fold, Signals & System', () => {
  it('resolves all 5 Parda scenarios accurately', () => {
    // 1) Parda en 1ª -> define la 2ª
    const s1 = createGameWithHands({
      ruleset: AR_SIN_FLOR_V1,
      players: SEATS_1V1,
      handsBySeat: {
        0: hand('3-oros', '2-espadas', '4-copas'),
        1: hand('3-copas', '12-bastos', '4-oros'),
      },
      rng: createSeededRng(1),
    });
    const r1 = runSequence(s1, [
      { type: 'PLAY_CARD', seat: 0, cardId: '3-oros' },
      { type: 'PLAY_CARD', seat: 1, cardId: '3-copas' }, // Parda 1ª -> sale mano (seat 0)
      { type: 'PLAY_CARD', seat: 0, cardId: '2-espadas' },
      { type: 'PLAY_CARD', seat: 1, cardId: '12-bastos' },
    ]);
    expect(r1.state.scoresByTeam[0]).toBe(1);
    expect(r1.state.hand.handNumber).toBe(2);
    expect(r1.state.hand.manoSeat).toBe(1);

    // 2) Ganada 1ª por Seat 1 + Parda en 2ª -> gana Seat 1 (equipo 1)
    const s2 = createGameWithHands({
      ruleset: AR_SIN_FLOR_V1,
      players: SEATS_1V1,
      handsBySeat: {
        0: hand('12-oros', '2-oros', '4-copas'),
        1: hand('1-espadas', '2-copas', '4-oros'),
      },
      rng: createSeededRng(2),
    });
    const r2 = runSequence(s2, [
      { type: 'PLAY_CARD', seat: 0, cardId: '12-oros' },
      { type: 'PLAY_CARD', seat: 1, cardId: '1-espadas' }, // Gana 1ª Seat 1 -> sale Seat 1 en 2ª
      { type: 'PLAY_CARD', seat: 1, cardId: '2-copas' },
      { type: 'PLAY_CARD', seat: 0, cardId: '2-oros' }, // Parda 2ª -> define para ganador de 1ª
    ]);
    expect(r2.state.scoresByTeam[1]).toBe(1);
    expect(r2.state.hand.handNumber).toBe(2);

    // 3) 1ª Equipo 1, 2ª Equipo 0, 3ª Parda -> gana Equipo 1 (quien ganó la 1ª)
    const s3 = createGameWithHands({
      ruleset: AR_SIN_FLOR_V1,
      players: SEATS_1V1,
      handsBySeat: {
        0: hand('6-oros', '1-bastos', '5-espadas'),
        1: hand('7-oros', '5-copas', '5-oros'),
      },
      rng: createSeededRng(3),
    });
    const r3 = runSequence(s3, [
      { type: 'PLAY_CARD', seat: 0, cardId: '6-oros' },
      { type: 'PLAY_CARD', seat: 1, cardId: '7-oros' }, // R1: Team 1
      { type: 'PLAY_CARD', seat: 1, cardId: '5-copas' },
      { type: 'PLAY_CARD', seat: 0, cardId: '1-bastos' }, // R2: Team 0 -> sale Seat 0 en R3
      { type: 'PLAY_CARD', seat: 0, cardId: '5-espadas' },
      { type: 'PLAY_CARD', seat: 1, cardId: '5-oros' }, // R3: Parda -> gana Team 1
    ]);
    expect(r3.state.scoresByTeam[1]).toBe(1);

    // 4) Parda 1ª + Parda 2ª -> define 3ª
    const s4 = createGameWithHands({
      ruleset: AR_SIN_FLOR_V1,
      players: SEATS_1V1,
      handsBySeat: {
        0: hand('12-oros', '11-oros', '4-espadas'),
        1: hand('12-copas', '11-copas', '6-bastos'),
      },
      rng: createSeededRng(4),
    });
    const r4 = runSequence(s4, [
      { type: 'PLAY_CARD', seat: 0, cardId: '12-oros' },
      { type: 'PLAY_CARD', seat: 1, cardId: '12-copas' },
      { type: 'PLAY_CARD', seat: 0, cardId: '11-oros' },
      { type: 'PLAY_CARD', seat: 1, cardId: '11-copas' },
      { type: 'PLAY_CARD', seat: 0, cardId: '4-espadas' },
      { type: 'PLAY_CARD', seat: 1, cardId: '6-bastos' },
    ]);
    expect(r4.state.scoresByTeam[1]).toBe(1);

    // 5) Triple Parda -> gana el equipo del manoSeat (manoSeat = 1 -> Team 1)
    const s5 = createGameWithHands({
      ruleset: AR_SIN_FLOR_V1,
      players: SEATS_1V1,
      manoSeat: 1,
      handsBySeat: {
        0: hand('12-oros', '11-oros', '4-espadas'),
        1: hand('12-copas', '11-copas', '4-bastos'),
      },
      rng: createSeededRng(5),
    });
    const r5 = runSequence(s5, [
      { type: 'PLAY_CARD', seat: 1, cardId: '12-copas' },
      { type: 'PLAY_CARD', seat: 0, cardId: '12-oros' },
      { type: 'PLAY_CARD', seat: 1, cardId: '11-copas' },
      { type: 'PLAY_CARD', seat: 0, cardId: '11-oros' },
      { type: 'PLAY_CARD', seat: 1, cardId: '4-bastos' },
      { type: 'PLAY_CARD', seat: 0, cardId: '4-espadas' },
    ]);
    expect(r5.state.scoresByTeam[1]).toBe(1);
  });

  it('supports "El envido está primero" in both CANCEL_TRUCO and SUSPEND_TRUCO modes', () => {
    const baseHands = {
      0: hand('7-oros', '6-oros', '4-copas'), // 33 de envido
      1: hand('7-bastos', '5-bastos', '1-espadas'), // 32 de envido
    };

    // CANCEL_TRUCO (por defecto en ar-standard-v1)
    const gCancel = createGameWithHands({
      ruleset: AR_STANDARD_V1,
      players: SEATS_1V1,
      handsBySeat: baseHands,
      rng: createSeededRng(10),
    });
    const afterCancel = runSequence(gCancel, [
      { type: 'CALL_TRUCO', seat: 0, bid: 'TRUCO' },
      { type: 'CALL_ENVIDO', seat: 1, bid: 'ENVIDO' }, // El envido está primero -> anula el Truco
      { type: 'RESPOND_ENVIDO', seat: 0, decision: 'QUIERO' },
    ]);
    expect(afterCancel.state.scoresByTeam[0]).toBe(2);
    expect(afterCancel.state.hand.truco.pending).toBeNull();
    expect(afterCancel.state.hand.truco.currentPoints).toBe(1);
    expect(afterCancel.state.hand.activeSeat).toBe(0);

    // SUSPEND_TRUCO: reanuda automáticamente el TRUCO pendiente al terminar el Envido
    const rsSuspend = createRuleSetVariant(AR_STANDARD_V1, {
      envido: { envidoFirstMode: 'SUSPEND_TRUCO' },
    });
    const gSuspend = createGameWithHands({
      ruleset: rsSuspend,
      players: SEATS_1V1,
      handsBySeat: baseHands,
      rng: createSeededRng(11),
    });
    const afterSuspend = runSequence(gSuspend, [
      { type: 'CALL_TRUCO', seat: 0, bid: 'TRUCO' },
      { type: 'CALL_ENVIDO', seat: 1, bid: 'ENVIDO' },
      { type: 'RESPOND_ENVIDO', seat: 0, decision: 'NO_QUIERO' },
    ]);
    expect(afterSuspend.state.scoresByTeam[1]).toBe(1);
    expect(afterSuspend.state.hand.truco.pending?.bid).toBe('TRUCO');
    expect(afterSuspend.state.hand.activeSeat).toBe(1);
  });

  it('ends the match immediately when Envido or Flor reaches targetScore mid-hand', () => {
    const g = createGameWithHands({
      ruleset: AR_STANDARD_V1,
      players: SEATS_1V1,
      scoresByTeam: { 0: 29, 1: 28 },
      handsBySeat: {
        0: hand('7-oros', '6-oros', '4-bastos'),
        1: hand('5-copas', '4-copas', '12-espadas'),
      },
      rng: createSeededRng(20),
    });

    const res = runSequence(g, [
      { type: 'CALL_ENVIDO', seat: 0, bid: 'ENVIDO' },
      { type: 'RESPOND_ENVIDO', seat: 1, decision: 'NO_QUIERO' },
    ]);

    expect(res.state.status).toBe('FINISHED');
    expect(res.state.winnerTeam).toBe(0);
    expect(res.state.scoresByTeam[0]).toBe(30);
    expect(legalActions(res.state, 0)).toEqual([]);
    expect(applyAction(res.state, { type: 'FOLD_HAND', seat: 0 }).ok).toBe(false);
  });

  it('handles Flor unopposed, Flor overriding Envido, Flor vs Flor showdown/achico, and sin-flor ruleset', () => {
    // 1) Flor sin flor rival -> +3 inmediato y sigue el turno
    const gUnopposed = createGameWithHands({
      ruleset: AR_STANDARD_V1,
      players: SEATS_1V1,
      handsBySeat: {
        0: hand('7-oros', '6-oros', '5-oros'), // Flor 38
        1: hand('1-espadas', '1-bastos', '7-espadas'),
      },
      rng: createSeededRng(30),
    });
    const rUnopposed = runSequence(gUnopposed, [{ type: 'CALL_FLOR', seat: 0, bid: 'FLOR' }]);
    expect(rUnopposed.state.scoresByTeam[0]).toBe(3);
    expect(rUnopposed.state.hand.activeSeat).toBe(0);

    // 2) Rival canta Envido -> Jugador con Flor mata el Envido cantando Flor
    const gOverride = createGameWithHands({
      ruleset: AR_STANDARD_V1,
      players: SEATS_1V1,
      handsBySeat: {
        0: hand('7-copas', '6-copas', '1-espadas'),
        1: hand('7-oros', '6-oros', '5-oros'),
      },
      rng: createSeededRng(31),
    });
    const rOverride = runSequence(gOverride, [
      { type: 'CALL_ENVIDO', seat: 0, bid: 'ENVIDO' },
      { type: 'CALL_FLOR', seat: 1, bid: 'FLOR' },
    ]);
    expect(rOverride.state.scoresByTeam[1]).toBe(3);
    expect(rOverride.state.scoresByTeam[0]).toBe(0);
    expect(rOverride.state.hand.envidoStatus).toBe('CLOSED');

    // 3) Flor vs Contraflor -> Con Flor Quiero (showdown 38 vs 35 -> +6 pts)
    const gDuel = createGameWithHands({
      ruleset: AR_STANDARD_V1,
      players: SEATS_1V1,
      handsBySeat: {
        0: hand('7-oros', '6-oros', '5-oros'), // 38
        1: hand('7-copas', '6-copas', '2-copas'), // 35
      },
      rng: createSeededRng(32),
    });
    const rDuel = runSequence(gDuel, [
      { type: 'CALL_FLOR', seat: 0, bid: 'FLOR' },
      { type: 'CALL_FLOR', seat: 1, bid: 'CONTRAFLOR' },
      { type: 'RESPOND_FLOR', seat: 0, decision: 'CON_FLOR_QUIERO' },
    ]);
    expect(rDuel.state.scoresByTeam[0]).toBe(6);

    // 4) Flor vs Achico -> +3 pts
    const rAchico = runSequence(gDuel, [
      { type: 'CALL_FLOR', seat: 0, bid: 'FLOR' },
      { type: 'RESPOND_FLOR', seat: 1, decision: 'ACHICO' },
    ]);
    expect(rAchico.state.scoresByTeam[0]).toBe(3);

    // 5) ar-sin-flor-v1: prohibido cantar Flor aunque tenga 3 del mismo palo
    const gSinFlor = createGameWithHands({
      ruleset: AR_SIN_FLOR_V1,
      players: SEATS_1V1,
      handsBySeat: {
        0: hand('7-oros', '6-oros', '5-oros'),
        1: hand('1-espadas', '1-bastos', '7-espadas'),
      },
      rng: createSeededRng(33),
    });
    expect(legalActions(gSinFlor, 0).some((a) => a.type === 'CALL_FLOR')).toBe(false);
    const errFlor = applyAction(gSinFlor, { type: 'CALL_FLOR', seat: 0, bid: 'FLOR' });
    expect(errFlor.ok).toBe(false);
    if (!errFlor.ok) expect(errFlor.error.code).toBe('FLOR_DISABLED');
  });

  it('handles 2v2 partial fold mid-round, pending-envido fold, and signal rate limits', () => {
    const g2v2 = createGameWithHands({
      ruleset: AR_SIN_FLOR_V1,
      players: SEATS_2V2,
      handsBySeat: {
        0: hand('1-espadas', '3-oros', '4-copas'),
        1: hand('4-oros', '1-bastos', '5-copas'),
        2: hand('5-oros', '2-oros', '6-copas'),
        3: hand('4-bastos', '6-bastos', '7-bastos'),
      },
      rng: createSeededRng(40),
    });

    // Señal en 1v1 rechazada; en 2v2 permitida hasta maxSignalsPerHandPerPlayer (3)
    const s1 = runSequence(g2v2, [
      { type: 'SEND_SIGNAL', seat: 2, signalId: 'morder_labio' },
      { type: 'SEND_SIGNAL', seat: 2, signalId: 'fruncir_labios' },
      { type: 'SEND_SIGNAL', seat: 2, signalId: 'cerrar_ambos_ojos' },
    ]);
    const fourthSignal = applyAction(s1.state, {
      type: 'SEND_SIGNAL',
      seat: 2,
      signalId: 'guino_ojo',
    });
    expect(fourthSignal.ok).toBe(false);
    if (!fourthSignal.ok) expect(fourthSignal.error.code).toBe('SIGNAL_LIMIT_EXCEEDED');

    // Seat 0, 1, 2 juegan; Seat 3 se va al mazo cerrando la Ronda 1 (Seat 1 sigue solo en Equipo 1)
    const afterR1 = runSequence(s1.state, [
      { type: 'PLAY_CARD', seat: 0, cardId: '1-espadas' },
      { type: 'PLAY_CARD', seat: 1, cardId: '4-oros' },
      { type: 'PLAY_CARD', seat: 2, cardId: '5-oros' },
      { type: 'FOLD_HAND', seat: 3 },
    ]);
    expect(afterR1.state.hand.currentRoundIndex).toBe(1);
    expect(afterR1.state.hand.turnSeat).toBe(0);
    // Seat 3 ya plegado no puede actuar
    expect(applyAction(afterR1.state, { type: 'FOLD_HAND', seat: 3 }).ok).toBe(false);

    // Ahora Seat 1 (último activo de Equipo 1) se va al mazo en su turno -> gana Equipo 0
    const afterTeam1Fold = runSequence(afterR1.state, [
      { type: 'PLAY_CARD', seat: 0, cardId: '3-oros' },
      { type: 'FOLD_HAND', seat: 1 },
    ]);
    expect(afterTeam1Fold.state.scoresByTeam[0]).toBe(1);
    expect(afterTeam1Fold.state.hand.handNumber).toBe(2);

    // Irse al mazo con Envido pendiente suma envido no querido + mazo (1 + 1 = 2)
    const gPendingFold = createGameWithHands({
      ruleset: AR_SIN_FLOR_V1,
      players: SEATS_1V1,
      handsBySeat: {
        0: hand('7-oros', '6-oros', '4-copas'),
        1: hand('4-oros', '5-copas', '6-espadas'),
      },
      rng: createSeededRng(41),
    });
    const rPendingFold = runSequence(gPendingFold, [
      { type: 'CALL_ENVIDO', seat: 0, bid: 'ENVIDO' },
      { type: 'FOLD_HAND', seat: 1 },
    ]);
    expect(rPendingFold.state.scoresByTeam[0]).toBe(2);
  });

  it('handles SYSTEM_TIMEOUT (pending call, FOLD_HAND, PLAY_LOWEST_CARD) and SYSTEM_ABANDON', () => {
    const g = createGame(AR_SIN_FLOR_V1, SEATS_1V1, createSeededRng(50));

    // Timeout fuera de turno rechazado
    expect(applyAction(g, { type: 'SYSTEM_TIMEOUT', seat: 1 }).ok).toBe(false);

    // Timeout en turno normal con política por defecto FOLD_HAND
    const tFold = applyAction(g, { type: 'SYSTEM_TIMEOUT', seat: 0 });
    expect(tFold.ok).toBe(true);
    if (tFold.ok) {
      expect(tFold.value.state.scoresByTeam[1]).toBe(1);
    }

    // Timeout con política PLAY_LOWEST_CARD
    const rsLowest = createRuleSetVariant(AR_SIN_FLOR_V1, {
      system: { timeoutOnTurn: 'PLAY_LOWEST_CARD' },
    });
    const gLow = createGameWithHands({
      ruleset: rsLowest,
      players: SEATS_1V1,
      handsBySeat: {
        0: hand('1-espadas', '4-copas', '3-oros'),
        1: hand('7-oros', '6-oros', '5-oros'),
      },
      rng: createSeededRng(51),
    });
    const tLow = applyAction(gLow, { type: 'SYSTEM_TIMEOUT', seat: 0 });
    expect(tLow.ok).toBe(true);
    if (tLow.ok) {
      expect(tLow.value.state.hand.currentRoundPlays[0]?.card.id).toBe('4-copas');
    }

    // Timeout ante canto pendiente -> declina automáticamente
    const afterTruco = runSequence(g, [{ type: 'CALL_TRUCO', seat: 0, bid: 'TRUCO' }]);
    const tDecline = applyAction(afterTruco.state, { type: 'SYSTEM_TIMEOUT', seat: 1 });
    expect(tDecline.ok).toBe(true);
    if (tDecline.ok) {
      expect(tDecline.value.state.scoresByTeam[0]).toBe(1);
    }

    // SYSTEM_ABANDON -> rival gana la partida completa
    const ab = applyAction(g, { type: 'SYSTEM_ABANDON', seat: 0 });
    expect(ab.ok).toBe(true);
    if (ab.ok) {
      expect(ab.value.state.status).toBe('FINISHED');
      expect(ab.value.state.winnerTeam).toBe(1);
      expect(ab.value.state.abandonedBySeat).toBe(0);
      expect(ab.value.state.scoresByTeam[1]).toBe(30);
    }
  });

  it('supports 6-seat configurations (2 teams of 3 and 3 teams of 2) and validates bad seat configs', () => {
    const seats6_2teams: PlayerSeat[] = [
      { seat: 0, team: 0 },
      { seat: 1, team: 1 },
      { seat: 2, team: 0 },
      { seat: 3, team: 1 },
      { seat: 4, team: 0 },
      { seat: 5, team: 1 },
    ];
    const g6 = createGame(AR_STANDARD_V1, seats6_2teams, createSeededRng(60));
    expect(g6.seats).toHaveLength(6);
    expect(g6.teams).toEqual([0, 1]);

    const seats6_3teams: PlayerSeat[] = [
      { seat: 0, team: 0 },
      { seat: 1, team: 1 },
      { seat: 2, team: 2 },
      { seat: 3, team: 0 },
      { seat: 4, team: 1 },
      { seat: 5, team: 2 },
    ];
    const g6t3 = createGame(AR_SIN_FLOR_V1, seats6_3teams, createSeededRng(61));
    expect(g6t3.teams).toEqual([0, 1, 2]);

    // Validaciones de asientos inválidos
    expect(() => createGame(AR_STANDARD_V1, [{ seat: 0, team: 0 }], createSeededRng(1))).toThrow();
    expect(() =>
      createGame(
        AR_STANDARD_V1,
        [
          { seat: 0, team: 0 },
          { seat: 2, team: 1 },
        ],
        createSeededRng(1),
      ),
    ).toThrow();
    expect(() =>
      createGame(
        AR_STANDARD_V1,
        [
          { seat: 0, team: 0 },
          { seat: 1, team: 0 },
        ],
        createSeededRng(1),
      ),
    ).toThrow();
    expect(() =>
      createGame(
        AR_STANDARD_V1,
        [
          { seat: 0, team: 0 },
          { seat: 1, team: 1 },
          { seat: 2, team: 0 },
        ],
        createSeededRng(1),
      ),
    ).toThrow();
  });
});
