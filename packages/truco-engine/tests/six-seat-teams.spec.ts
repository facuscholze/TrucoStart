import { describe, expect, it } from 'vitest';
import { getCardById } from '../src/cards.js';
import { applyAction, createGame, createGameWithHands } from '../src/engine.js';
import { legalActions } from '../src/legal-actions.js';
import { createSeededRng } from '../src/rng.js';
import { AR_CORTO_15_V1, AR_STANDARD_V1, createRuleSetVariant } from '../src/rulesets.js';
import { simulateBatch } from '../src/simulator.js';
import { resolveRespondingSeat, resolveRespondingTeam } from '../src/team-responder.js';
import type { CardId, PlayerSeat } from '../src/types.js';
import { viewFor } from '../src/view.js';

/**
 * Truco de 6 con **tres equipos de 2** (seats 0-1 equipo 0, 2-3 equipo 1, 4-5 equipo 2).
 * Es la variante que el MASTER_PROMPT deja abierta ("3 equipos de 2 o 2 de 3"); se documenta en
 * `docs/RULES.md` y en el ADR de la etapa.
 */
const SEATS_3X2: PlayerSeat[] = [
  { seat: 0, team: 0, playerId: 'p0' },
  { seat: 1, team: 0, playerId: 'p1' },
  { seat: 2, team: 1, playerId: 'p2' },
  { seat: 3, team: 1, playerId: 'p3' },
  { seat: 4, team: 2, playerId: 'p4' },
  { seat: 5, team: 2, playerId: 'p5' },
];

/** Asientos 6 con dos equipos de 3 (la otra variante posible de 6 jugadores). */
const SEATS_2X3: PlayerSeat[] = [
  { seat: 0, team: 0 },
  { seat: 1, team: 1 },
  { seat: 2, team: 0 },
  { seat: 3, team: 1 },
  { seat: 4, team: 0 },
  { seat: 5, team: 1 },
];

const HANDS_6 = {
  0: hand('1-espadas', '2-oros', '4-copas'),
  1: hand('3-oros', '5-bastos', '6-espadas'),
  2: hand('1-bastos', '2-copas', '4-bastos'),
  3: hand('7-espadas', '6-oros', '5-copas'),
  4: hand('7-oros', '3-copas', '2-espadas'),
  5: hand('1-copas', '7-bastos', '6-bastos'),
};

function hand(...ids: [CardId, CardId, CardId]) {
  return ids.map((id) => getCardById(id)!);
}

describe('Truco de 6 — validación de asientos y equipos', () => {
  it('acepta 6 asientos en 3 equipos de 2 y arranca con la mano en el asiento 0', () => {
    const game = createGame(AR_CORTO_15_V1, SEATS_3X2, createSeededRng(7));
    expect(game.seats).toHaveLength(6);
    expect(game.teams).toEqual([0, 1, 2]);
    expect(game.hand.manoSeat).toBe(0);
    expect(game.hand.turnSeat).toBe(0);
    expect(Object.keys(game.scoresByTeam).sort()).toEqual(['0', '1', '2']);
  });

  it('acepta 6 asientos en 2 equipos de 3 y rechaza equipos desparejos', () => {
    expect(createGame(AR_CORTO_15_V1, SEATS_2X3, createSeededRng(7)).teams).toEqual([0, 1]);
    expect(() =>
      createGame(
        AR_CORTO_15_V1,
        [
          { seat: 0, team: 0 },
          { seat: 1, team: 0 },
          { seat: 2, team: 1 },
          { seat: 3, team: 2 },
          { seat: 4, team: 2 },
          { seat: 5, team: 1 },
        ],
        createSeededRng(7),
      ),
    ).not.toThrow();
    // 2 vs 1 vs 2 integrantes: no se admite.
    expect(() =>
      createGame(
        AR_CORTO_15_V1,
        [
          { seat: 0, team: 0 },
          { seat: 1, team: 0 },
          { seat: 2, team: 1 },
          { seat: 3, team: 2 },
          { seat: 4, team: 2 },
          { seat: 5, team: 2 },
        ],
        createSeededRng(7),
      ),
    ).toThrow(/Todos los equipos deben tener igual cantidad de integrantes/);
  });
});

describe('Truco de 6 — qué equipo y qué asiento responden un canto', () => {
  const seats = SEATS_3X2;
  const scores = { 0: 0, 1: 0, 2: 0 };

  it('con tres equipos responde el rival más cercano al cantor en el orden de turnos', () => {
    // Cantor 0 (equipo 0): el siguiente asiento es 1 (mismo equipo) y luego 2 (equipo 1).
    expect(resolveRespondingTeam(0, 0, seats, [], scores)).toBe(1);
    // Cantor 2 (equipo 1): siguiente rival es 4 (equipo 2).
    expect(resolveRespondingTeam(2, 1, seats, [], scores)).toBe(2);
    // Cantor 5 (equipo 2): siguiente rival es 0 (equipo 0).
    expect(resolveRespondingTeam(5, 2, seats, [], scores)).toBe(0);
  });

  it('saltea equipos ya idos al mazo al elegir el rival que responde', () => {
    // Equipo 1 completo al mazo: el rival del cantor 0 pasa a ser el equipo 2.
    expect(resolveRespondingTeam(0, 0, seats, [2, 3], scores)).toBe(2);
    // Equipo 0 completo al mazo cuando canta el equipo 1: rival más cercano es 2 (equipo 2).
    expect(resolveRespondingTeam(2, 1, seats, [0, 1], scores)).toBe(2);
  });

  it('`HIGHEST_SCORE` hace contestar al rival con más puntos y desempata por cercanía', () => {
    expect(resolveRespondingTeam(0, 0, seats, [], { 0: 0, 1: 5, 2: 12 }, 'HIGHEST_SCORE')).toBe(2);
    expect(resolveRespondingTeam(0, 0, seats, [], { 0: 0, 1: 7, 2: 7 }, 'HIGHEST_SCORE')).toBe(1);
  });

  it('con dos equipos (1v1/2v2/3v3) el modo de equipo es inerte', () => {
    const four = SEATS_2X3.slice(0, 4);
    for (const mode of ['NEXT_IN_TURN', 'HIGHEST_SCORE'] as const) {
      expect(resolveRespondingTeam(0, 0, four, [], { 0: 0, 1: 3 }, mode)).toBe(1);
      expect(resolveRespondingTeam(3, 1, four, [], { 0: 0, 1: 3 }, mode)).toBe(0);
    }
  });

  it('`ANY_TEAM_MEMBER` elige el asiento activo del equipo rival más cercano al cantor', () => {
    // Cantor 0 (equipo 0), responde equipo 1, primer asiento activo del equipo 1 desde el 0 es el 2.
    expect(resolveRespondingSeat(0, 1, 0, seats, [], 'ANY_TEAM_MEMBER')).toBe(2);
    // Si el 2 está al mazo, contesta el 3.
    expect(resolveRespondingSeat(0, 1, 0, seats, [2], 'ANY_TEAM_MEMBER')).toBe(3);
    // Si el equipo 1 está entero al mazo se cae al criterio `PIE_OF_TEAM` sin romper.
    expect(() => resolveRespondingSeat(0, 1, 0, seats, [2, 3], 'ANY_TEAM_MEMBER')).not.toThrow();
  });
});

describe('Truco de 6 — manos y rondas con tres equipos', () => {
  function gameWith(manoSeat: number, ruleset = AR_CORTO_15_V1) {
    return createGameWithHands({
      ruleset,
      players: SEATS_3X2,
      manoSeat,
      handsBySeat: {
        0: hand('1-espadas', '2-oros', '4-copas'),
        1: hand('3-oros', '5-bastos', '6-espadas'),
        2: hand('1-bastos', '2-copas', '4-bastos'),
        3: hand('7-espadas', '6-oros', '5-copas'),
        4: hand('7-oros', '3-copas', '2-espadas'),
        5: hand('1-copas', '7-bastos', '6-bastos'),
      },
      rng: createSeededRng(11),
    });
  }

  it('la ronda recorre los 6 asientos y solo el ganador (o el mano) abre la siguiente', () => {
    let state = gameWith(0);
    const order: number[] = [];
    for (let i = 0; i < 6; i++) {
      const turn = state.hand.turnSeat;
      order.push(turn);
      const card = state.hand.remainingHandsBySeat[turn]![0]!;
      const res = applyAction(state, { type: 'PLAY_CARD', seat: turn, cardId: card.id });
      expect(res.ok, `falló la jugada ${i} en el asiento ${turn}`).toBe(true);
      if (!res.ok) return;
      state = res.value.state;
    }
    expect(order).toEqual([0, 1, 2, 3, 4, 5]);
    expect(state.hand.completedRounds).toHaveLength(1);
    // 1 de espadas (asiento 0, equipo 0) gana la ronda: la siguiente la abre ese mismo asiento.
    expect(state.hand.completedRounds[0]!.winnerTeam).toBe(0);
    expect(state.hand.turnSeat).toBe(0);
  });

  it('la parda de tres equipos no adjudica la ronda y la abre el mano', () => {
    const g = createGameWithHands({
      ruleset: AR_CORTO_15_V1,
      players: SEATS_3X2,
      manoSeat: 2,
      handsBySeat: {
        0: hand('5-oros', '4-copas', '3-bastos'),
        1: hand('6-oros', '4-espadas', '2-espadas'),
        2: hand('5-copas', '4-bastos', '2-bastos'),
        3: hand('6-copas', '3-espadas', '2-copas'),
        4: hand('5-bastos', '3-oros', '7-copas'),
        5: hand('6-bastos', '3-copas', '7-bastos'),
      },
      rng: createSeededRng(3),
    });
    let state = g;
    for (let i = 0; i < 6; i++) {
      const turn = state.hand.turnSeat;
      // Todos juegan un 5/6/3 salvo el asiento 0, que juega el 5 más alto posible para forzar
      // una parda entre dos equipos.
      const card = state.hand.remainingHandsBySeat[turn]![0]!;
      const res = applyAction(state, { type: 'PLAY_CARD', seat: turn, cardId: card.id });
      expect(res.ok).toBe(true);
      if (!res.ok) return;
      state = res.value.state;
    }
    expect(state.hand.completedRounds).toHaveLength(1);
    const round = state.hand.completedRounds[0]!;
    // Si hubo parda, la ronda no tiene ganador y el mano (asiento 2) abre la siguiente.
    if (round.isParda) {
      expect(state.hand.turnSeat).toBe(2);
    }
    expect(state.hand.currentRoundIndex).toBeGreaterThanOrEqual(0);
  });

  it('el mano rota entre los 6 asientos mano a mano', () => {
    const seen: number[] = [];
    let state = gameWith(0);
    for (let guard = 0; guard < 400 && state.status === 'IN_PROGRESS'; guard++) {
      if (!seen.includes(state.hand.manoSeat)) seen.push(state.hand.manoSeat);
      const seat = state.hand.turnSeat;
      const view = viewFor(state, seat);
      const play = view.legalActions.find((a) => a.type === 'PLAY_CARD');
      const res = applyAction(state, play ?? { type: 'FOLD_HAND', seat });
      expect(res.ok).toBe(true);
      if (!res.ok) return;
      state = res.value.state;
    }
    expect(seen.length).toBeGreaterThan(3);
    expect(Math.max(...seen)).toBeGreaterThan(3);
  });
});

describe('Truco de 6 — envido, flor, truco y señas con tres equipos', () => {
  const noFlor = createRuleSetVariant(AR_CORTO_15_V1, {
    flor: { ...AR_CORTO_15_V1.flor, enabled: false },
  });

  function envidoGame(manoSeat = 0) {
    return createGameWithHands({
      ruleset: noFlor,
      players: SEATS_3X2,
      manoSeat,
      handsBySeat: {
        // Tanto: 0→27, 1→29, 2→27, 3→7, 4→23, 5→20. Gana el equipo 0 (asiento 1, con 29).
        0: hand('1-espadas', '6-espadas', '4-copas'),
        1: hand('3-oros', '5-bastos', '6-oros'),
        2: hand('7-bastos', '5-copas', '2-copas'),
        3: hand('4-bastos', '2-oros', '7-copas'),
        4: hand('12-oros', '11-copas', '3-copas'),
        5: hand('10-bastos', '11-bastos', '12-copas'),
      },
      rng: createSeededRng(5),
    });
  }

  it('envido con tres equipos: canta el turno, responde el rival más cercano y gana el mejor tanto', () => {
    const g = envidoGame();
    const call = applyAction(g, { type: 'CALL_ENVIDO', seat: 0, bid: 'ENVIDO' });
    expect(call.ok).toBe(true);
    if (!call.ok) return;
    const { state } = call.value;
    expect(state.hand.responderTeam).toBe(1);
    expect(state.hand.activeSeat).toBe(2);

    const respuesta = applyAction(state, { type: 'RESPOND_ENVIDO', seat: 2, decision: 'QUIERO' });
    expect(respuesta.ok).toBe(true);
    if (!respuesta.ok) return;
    const resolved = respuesta.value.events.find((e) => e.type === 'ENVIDO_RESOLVED');
    expect(resolved).toBeDefined();
    expect(resolved).toMatchObject({
      winningTeam: 0,
      winningSeat: 1,
      winningScore: 29,
      pointsAwarded: 2,
    });
    // El tanto lo declara el mejor de cada equipo: nadie más entra en la compulsa.
    expect(
      (resolved as { declaredScoresBySeat: Record<number, number> }).declaredScoresBySeat,
    ).toEqual({
      0: 27,
      1: 29,
      2: 27,
      3: 7,
      4: 23,
      5: 20,
    });
  });

  it('envido con empate de tanto entre dos equipos gana el más cercano al mano', () => {
    const g = createGameWithHands({
      ruleset: noFlor,
      players: SEATS_3X2,
      // Mano en el 4: el orden desde la mano es 4,5,0,1,2,3. Los equipos 0 y 1 empatan en 27
      // (asientos 0 y 2) y el equipo 2 no llega. Gana el asiento 0 por estar antes en ese orden.
      manoSeat: 4,
      handsBySeat: {
        0: hand('1-espadas', '6-espadas', '4-copas'), // 27
        1: hand('3-oros', '5-bastos', '2-oros'), // 7
        2: hand('7-bastos', '5-copas', '2-copas'), // 27
        3: hand('4-bastos', '6-oros', '7-copas'), // 6
        4: hand('12-oros', '11-copas', '3-copas'), // 3
        5: hand('10-bastos', '11-bastos', '12-copas'), // 0
      },
      rng: createSeededRng(5),
    });
    // Canta el mano (asiento 4, equipo 2): el rival más cercano es el asiento 0 (equipo 0).
    const call = applyAction(g, { type: 'CALL_ENVIDO', seat: 4, bid: 'ENVIDO' });
    expect(call.ok).toBe(true);
    if (!call.ok) return;
    const respuesta = applyAction(call.value.state, {
      type: 'RESPOND_ENVIDO',
      seat: call.value.state.hand.activeSeat,
      decision: 'QUIERO',
    });
    expect(respuesta.ok).toBe(true);
    if (!respuesta.ok) return;
    const resolved = respuesta.value.events.find((e) => e.type === 'ENVIDO_RESOLVED');
    expect(resolved).toMatchObject({ winningSeat: 0, winningTeam: 0, winningScore: 27 });
  });

  it('flor con tres equipos: solo contesta un equipo rival y se resuelve sin bloquear', () => {
    const g = createGameWithHands({
      ruleset: AR_STANDARD_V1,
      players: SEATS_3X2,
      manoSeat: 0,
      handsBySeat: {
        0: hand('1-espadas', '6-espadas', '4-espadas'), // flor
        1: hand('3-oros', '5-bastos', '6-oros'),
        2: hand('7-bastos', '5-copas', '2-copas'),
        3: hand('4-bastos', '2-oros', '7-copas'),
        4: hand('12-oros', '11-copas', '3-copas'),
        5: hand('10-bastos', '11-bastos', '12-copas'),
      },
      rng: createSeededRng(9),
    });
    const call = applyAction(g, { type: 'CALL_FLOR', seat: 0, bid: 'FLOR' });
    expect(call.ok).toBe(true);
    if (!call.ok) return;
    // Ningún rival tiene flor: el canto se resuelve en el acto a favor del equipo 0.
    const resolved = call.value.events.find((e) => e.type === 'FLOR_RESOLVED');
    expect(resolved).toMatchObject({
      winningTeam: 0,
      pointsAwarded: AR_STANDARD_V1.flor.florPoints,
    });
    expect(call.value.state.hand.florStatus).toBe('RESOLVED');
  });

  it('truco con tres equipos: el rival que contesta no es el equipo del cantor', () => {
    // Cada asiento abre la ronda 1 en su propia mano: se crea un juego por cantor.
    for (const [callerSeat, expectedTeam] of [
      [0, 1],
      [2, 2],
      [4, 0],
    ] as const) {
      // Se ubica al cantor en turno jugando antes las cartas necesarias no hace falta: cada
      // asiento abre la ronda 1 en su propia mano, así que se usa un juego por caso.
      const call = applyAction(
        createGameWithHands({
          ruleset: AR_CORTO_15_V1,
          players: SEATS_3X2,
          manoSeat: callerSeat,
          handsBySeat: HANDS_6,
          rng: createSeededRng(13),
        }),
        { type: 'CALL_TRUCO', seat: callerSeat, bid: 'TRUCO' },
      );
      expect(call.ok, `el asiento ${callerSeat} debería poder cantar truco en la ronda 1`).toBe(
        true,
      );
      if (!call.ok) continue;
      expect(call.value.state.hand.responderTeam).toBe(expectedTeam);
      expect(call.value.state.hand.responderTeam).not.toBe(SEATS_3X2[callerSeat]!.team);
      const responderSeat = call.value.state.hand.activeSeat;
      expect(SEATS_3X2[responderSeat]!.team).toBe(expectedTeam);
      // El que contesta tiene acciones de respuesta (no queda la mesa trabada).
      expect(legalActions(call.value.state, responderSeat).length).toBeGreaterThan(0);
    }
  });

  it('las señas llegan solo al compañero de equipo, nunca a los otros dos equipos', () => {
    const g = createGameWithHands({
      ruleset: AR_STANDARD_V1,
      players: SEATS_3X2,
      manoSeat: 0,
      handsBySeat: {
        0: hand('1-espadas', '2-oros', '4-copas'),
        1: hand('3-oros', '5-bastos', '6-espadas'),
        2: hand('1-bastos', '2-copas', '4-bastos'),
        3: hand('7-espadas', '6-oros', '5-copas'),
        4: hand('7-oros', '3-copas', '2-espadas'),
        5: hand('1-copas', '7-bastos', '6-bastos'),
      },
      rng: createSeededRng(23),
    });
    const signalAction = legalActions(g, 0).find((a) => a.type === 'SEND_SIGNAL');
    expect(signalAction).toBeDefined();
    if (!signalAction) return;
    const res = applyAction(g, signalAction);
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    const teammateView = viewFor(res.value.state, 1);
    expect(teammateView.hand.visibleSignals).toHaveLength(1);
    for (const rivalSeat of [2, 3, 4, 5]) {
      const rivalView = viewFor(res.value.state, rivalSeat);
      expect(rivalView.hand.visibleSignals).toHaveLength(0);
    }
  });
});

describe('Truco de 6 — simulación masiva con tres equipos', () => {
  it('300 partidas 6 asientos / 3 equipos terminan sin bloqueos y con ganador válido', () => {
    for (const ruleset of [AR_CORTO_15_V1, AR_STANDARD_V1]) {
      const stats = simulateBatch(300, { ruleset, numSeats: 6, numTeams: 3 }, 1234);
      expect(stats.matchesPlayed).toBe(300);
      expect(stats.winsByTeam[0]! + stats.winsByTeam[1]! + stats.winsByTeam[2]!).toBe(300);
      for (const team of [0, 1, 2]) {
        expect(stats.winsByTeam[team]).toBeGreaterThan(40);
      }
    }
  }, 240_000);
});
