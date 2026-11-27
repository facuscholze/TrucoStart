import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { getCardById } from '../src/cards.js';
import { applyAction, createGame, createGameWithHands } from '../src/engine.js';
import { legalActions } from '../src/legal-actions.js';
import { createSeededRng } from '../src/rng.js';
import {
  AR_CORTO_15_V1,
  AR_SIN_FLOR_V1,
  AR_STANDARD_V1,
  createRuleSetVariant,
} from '../src/rulesets.js';
import { buildSeats, simulateBatch, simulateMatch } from '../src/simulator.js';
import * as PublicBarrel from '../src/index.js';
import type { CardId } from '../src/types.js';

describe('Property-based invariants (fast-check) & Massive Multi-Seat Simulations', () => {
  it('fast-check: determinism, immutability, score monotonicity and strict legalActions <-> applyAction equivalence', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 500_000 }),
        fc.constantFrom(2, 4, 6),
        // Con 6 asientos se cubren las dos variantes: 3v3 (dos equipos de 3) y 3 equipos de 2.
        fc.constantFrom(2, 3),
        (seed, numSeats, numTeams) => {
          const teams = numSeats === 6 ? numTeams : 2;
          const seats = buildSeats(numSeats, teams);
          let stateA = createGame(AR_CORTO_15_V1, seats, createSeededRng(seed));
          let stateB = createGame(AR_CORTO_15_V1, seats, createSeededRng(seed));
          expect(stateA).toEqual(stateB);
          expect(stateA.teams).toHaveLength(teams);

          const actionRng = createSeededRng(seed ^ 0x55aa55aa);
          for (let step = 0; step < 35 && stateA.status === 'IN_PROGRESS'; step++) {
            const snapshotBefore = structuredClone(stateA);
            const activeSeat = stateA.hand.activeSeat;

            // Invariante estricto: para cada asiento s, toda acción en legalActions(stateA, s) es aceptada por applyAction
            for (const s of seats) {
              const seatActions = legalActions(stateA, s.seat);
              for (const candidate of seatActions) {
                expect(applyAction(stateA, candidate).ok).toBe(true);
              }
              if (s.seat !== activeSeat) {
                // Ningún asiento fuera de activeSeat puede jugar carta
                expect(seatActions.some((a) => a.type === 'PLAY_CARD')).toBe(false);
              }
            }

            const legal = legalActions(stateA, activeSeat);
            expect(legal.length).toBeGreaterThan(0);

            const chosen = legal[Math.floor(actionRng.nextFloat() * legal.length)]!;
            const resA = applyAction(stateA, chosen);
            const resB = applyAction(stateB, chosen);

            // Inmutabilidad: stateA previo jamás muta
            expect(stateA).toEqual(snapshotBefore);
            // Determinismo estricto
            expect(resA).toEqual(resB);
            expect(resA.ok).toBe(true);
            if (!resA.ok || !resB.ok) return;

            // Monotonicidad de puntajes
            for (const team of stateA.teams) {
              expect(resA.value.state.scoresByTeam[team]!).toBeGreaterThanOrEqual(
                stateA.scoresByTeam[team]!,
              );
            }

            stateA = resA.value.state;
            stateB = resB.value.state;
          }
        },
      ),
      { numRuns: 120 },
    );
  });

  it('simulates 3,000 full matches across 2, 4 and 6 seats (Heuristic & Random) with 0 deadlocks or errors', () => {
    // 1) 1,000 partidas 1v1 en AR_STANDARD_V1 (30 pts con flor)
    const stats1v1Std = simulateBatch(1_000, { ruleset: AR_STANDARD_V1, numSeats: 2 }, 100_000);
    expect(stats1v1Std.matchesPlayed).toBe(1_000);
    expect(stats1v1Std.eventCounts['MATCH_ENDED']).toBe(1_000);

    // 2) 1,000 partidas 2v2 en AR_STANDARD_V1 (30 pts con flor y señas)
    const stats2v2Std = simulateBatch(1_000, { ruleset: AR_STANDARD_V1, numSeats: 4 }, 200_000);
    expect(stats2v2Std.matchesPlayed).toBe(1_000);
    expect(stats2v2Std.eventCounts['SIGNAL_SENT']).toBeGreaterThan(0);
    expect(stats2v2Std.eventCounts['FLOR_CALLED']).toBeGreaterThan(0);

    // 3) 400 partidas 2v2 en AR_SIN_FLOR_V1 (30 pts sin flor)
    const stats2v2NoFlor = simulateBatch(400, { ruleset: AR_SIN_FLOR_V1, numSeats: 4 }, 300_000);
    expect(stats2v2NoFlor.eventCounts['FLOR_CALLED'] ?? 0).toBe(0);

    // 4) 300 partidas 3v3 (6 asientos nativos) en AR_CORTO_15_V1
    const stats3v3 = simulateBatch(300, { ruleset: AR_CORTO_15_V1, numSeats: 6 }, 400_000);
    expect(stats3v3.matchesPlayed).toBe(300);
    expect(stats3v3.eventCounts['MATCH_ENDED']).toBe(300);

    // 4b) 1,000 partidas del truco de 6 con TRES equipos de 2 (la variante que suma M10b):
    // cada partida debe terminar con un equipo ganador entre los tres y sin acciones infinitas.
    const stats3x2 = simulateBatch(
      1_000,
      { ruleset: AR_CORTO_15_V1, numSeats: 6, numTeams: 3 },
      600_000,
    );
    expect(stats3x2.matchesPlayed).toBe(1_000);
    expect(stats3x2.eventCounts['MATCH_ENDED']).toBe(1_000);
    const wins3x2 = stats3x2.winsByTeam;
    expect((wins3x2[0] ?? 0) + (wins3x2[1] ?? 0) + (wins3x2[2] ?? 0)).toBe(1_000);
    for (const team of [0, 1, 2]) {
      expect(wins3x2[team] ?? 0).toBeGreaterThan(150);
    }
    expect(stats3x2.maxActionsInSingleMatch).toBeLessThan(1_500);

    // 5) 300 partidas Random-vs-Random (stress de terminación ante agentes caóticos)
    const statsRandom = simulateBatch(
      300,
      {
        ruleset: AR_CORTO_15_V1,
        numSeats: 4,
        agentByTeam: { 0: 'RANDOM', 1: 'RANDOM' },
      },
      500_000,
    );
    expect(statsRandom.matchesPlayed).toBe(300);
    expect(statsRandom.maxActionsInSingleMatch).toBeLessThan(1_000);
  });

  it('validates game creation guards, Contraflor al Resto, Flor timeout and Mano de Once variants', () => {
    const hand = (...ids: [CardId, CardId, CardId]) => ids.map((id) => getCardById(id)!);
    const seats2 = buildSeats(2, 2);

    // Validaciones de createGame
    expect(() => createGame(AR_STANDARD_V1, [{ seat: 0, team: 0 }], createSeededRng(1))).toThrow();
    expect(() => createGame(AR_STANDARD_V1, buildSeats(14, 2), createSeededRng(1))).toThrow();
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

    // Validaciones de createGameWithHands (cartas duplicadas o faltantes)
    expect(() =>
      createGameWithHands({
        ruleset: AR_STANDARD_V1,
        players: seats2,
        handsBySeat: {
          0: hand('1-espadas', '1-bastos', '7-espadas'),
          1: hand('1-espadas', '4-copas', '5-copas'),
        },
        rng: createSeededRng(1),
      }),
    ).toThrow(/duplicada/);

    // Contraflor y Contraflor al Resto + SYSTEM_TIMEOUT sobre Flor pendiente
    const gFlor = createGameWithHands({
      ruleset: AR_STANDARD_V1,
      players: seats2,
      handsBySeat: {
        0: hand('7-oros', '6-oros', '5-oros'), // 38 flor
        1: hand('7-bastos', '6-bastos', '4-bastos'), // 37 flor
      },
      scoresByTeam: { 0: 10, 1: 12 },
      rng: createSeededRng(9),
    });

    const f1 = applyAction(gFlor, { type: 'CALL_FLOR', seat: 0, bid: 'FLOR' });
    expect(f1.ok).toBe(true);
    if (!f1.ok) return;

    // Timeout de Seat 1 cuando hay Flor pendiente pero aún puede anunciar su flor / achicar:
    const fContra = applyAction(f1.value.state, {
      type: 'CALL_FLOR',
      seat: 1,
      bid: 'CONTRAFLOR_AL_RESTO',
    });
    expect(fContra.ok).toBe(true);
    if (!fContra.ok) return;

    // Timeout de Seat 0 ante CONTRAFLOR_AL_RESTO -> se resuelve como ACHICO (4 pts a Eq. 1)
    const fTimeout = applyAction(fContra.value.state, { type: 'SYSTEM_TIMEOUT', seat: 0 });
    expect(fTimeout.ok).toBe(true);
    if (!fTimeout.ok) return;
    expect(fTimeout.value.state.scoresByTeam[1]).toBe(16);

    // Mano de Once habilitado: prohíbe cantar TRUCO al equipo a 1 punto de ganar
    const rsOnce = createRuleSetVariant(AR_CORTO_15_V1, {
      code: 'test-mano-de-once',
      manoDeOnce: { enabled: true, forbidTrucoByLeadingTeamAtMinusOne: true },
    });
    const gOnce = createGameWithHands({
      ruleset: rsOnce,
      players: seats2,
      handsBySeat: {
        0: hand('1-espadas', '1-bastos', '7-espadas'),
        1: hand('4-copas', '5-copas', '6-espadas'),
      },
      scoresByTeam: { 0: 14, 1: 10 },
      rng: createSeededRng(10),
    });
    expect(legalActions(gOnce, 0).some((a) => a.type === 'CALL_TRUCO')).toBe(false);
    const onceForbidden = applyAction(gOnce, { type: 'CALL_TRUCO', seat: 0, bid: 'TRUCO' });
    expect(onceForbidden.ok).toBe(false);

    // simulateMatch con recordEvents=true devuelve secuencia completa
    const single = simulateMatch({
      ruleset: AR_CORTO_15_V1,
      numSeats: 2,
      seed: 42,
      recordEvents: true,
    });
    expect(single.events[0]?.type).toBe('MATCH_STARTED');
    expect(single.events[single.events.length - 1]?.type).toBe('MATCH_ENDED');
    expect(typeof PublicBarrel.createGame).toBe('function');
    expect(typeof PublicBarrel.chooseBotAction).toBe('function');
  });

  it('returns exact typed RuleError codes for every category of illegal action', () => {
    const hand = (...ids: [CardId, CardId, CardId]) => ids.map((id) => getCardById(id)!);
    const seats2 = buildSeats(2, 2);
    const seats4 = buildSeats(4, 2);

    const gSinFlor = createGameWithHands({
      ruleset: AR_SIN_FLOR_V1,
      players: seats2,
      handsBySeat: {
        0: hand('7-oros', '6-oros', '5-oros'),
        1: hand('4-copas', '5-bastos', '6-espadas'),
      },
      rng: createSeededRng(20),
    });

    const expectErrCode = (res: ReturnType<typeof applyAction>, code: string) => {
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error.code).toBe(code);
    };

    expectErrCode(
      applyAction(gSinFlor, { type: 'PLAY_CARD', seat: 99, cardId: '7-oros' }),
      'INVALID_SEAT',
    );
    expectErrCode(
      applyAction(gSinFlor, { type: 'CALL_FLOR', seat: 0, bid: 'FLOR' }),
      'FLOR_DISABLED',
    );
    expectErrCode(
      applyAction(gSinFlor, { type: 'SEND_SIGNAL', seat: 0, signalId: 'guino_ojo' }),
      'SIGNALS_DISABLED',
    );
    expectErrCode(
      applyAction(gSinFlor, { type: 'PLAY_CARD', seat: 1, cardId: '4-copas' }),
      'NOT_YOUR_TURN',
    );
    expectErrCode(
      applyAction(gSinFlor, { type: 'PLAY_CARD', seat: 0, cardId: '1-espadas' }),
      'CARD_NOT_IN_HAND',
    );
    expectErrCode(
      applyAction(gSinFlor, { type: 'RESPOND_ENVIDO', seat: 0, decision: 'QUIERO' }),
      'ENVIDO_NOT_ALLOWED',
    );
    expectErrCode(
      applyAction(gSinFlor, { type: 'RESPOND_TRUCO', seat: 0, decision: 'QUIERO' }),
      'TRUCO_NOT_ALLOWED',
    );
    expectErrCode(applyAction(gSinFlor, { type: 'FOLD_HAND', seat: 1 }), 'NOT_YOUR_TURN');
    expectErrCode(applyAction(gSinFlor, { type: 'SYSTEM_TIMEOUT', seat: 1 }), 'NOT_YOUR_TURN');

    // Con canto pendiente, PLAY_CARD devuelve PENDING_CALL_ACTIVE
    const envCalled = applyAction(gSinFlor, { type: 'CALL_ENVIDO', seat: 0, bid: 'ENVIDO' });
    if (envCalled.ok) {
      expectErrCode(
        applyAction(envCalled.value.state, { type: 'PLAY_CARD', seat: 1, cardId: '4-copas' }),
        'PENDING_CALL_ACTIVE',
      );
      // Timeout sobre envido pendiente y sobre truco pendiente
      const envTo = applyAction(envCalled.value.state, { type: 'SYSTEM_TIMEOUT', seat: 1 });
      expect(envTo.ok).toBe(true);
    }

    const trucoCalled = applyAction(gSinFlor, { type: 'CALL_TRUCO', seat: 0, bid: 'TRUCO' });
    if (trucoCalled.ok) {
      const trucoTo = applyAction(trucoCalled.value.state, { type: 'SYSTEM_TIMEOUT', seat: 1 });
      expect(trucoTo.ok).toBe(true);
    }

    // 2v2: FLOR_NOT_HELD, FLOR_NOT_ALLOWED, SIGNAL_INVALID, PLAYER_FOLDED, MATCH_ALREADY_FINISHED
    const g2v2 = createGameWithHands({
      ruleset: AR_STANDARD_V1,
      players: seats4,
      handsBySeat: {
        0: hand('7-oros', '6-oros', '5-oros'),
        1: hand('4-copas', '5-bastos', '6-espadas'),
        2: hand('1-espadas', '2-oros', '3-copas'),
        3: hand('7-bastos', '6-bastos', '4-bastos'),
      },
      rng: createSeededRng(21),
    });

    expectErrCode(applyAction(g2v2, { type: 'CALL_FLOR', seat: 1, bid: 'FLOR' }), 'FLOR_NOT_HELD');
    expectErrCode(
      applyAction(g2v2, { type: 'CALL_FLOR', seat: 0, bid: 'CONTRAFLOR' }),
      'FLOR_NOT_ALLOWED',
    );
    expectErrCode(
      applyAction(g2v2, { type: 'SEND_SIGNAL', seat: 0, signalId: 'inexistente' }),
      'SIGNAL_INVALID',
    );

    const folded0 = applyAction(g2v2, { type: 'FOLD_HAND', seat: 0 });
    if (folded0.ok) {
      expectErrCode(
        applyAction(folded0.value.state, { type: 'SEND_SIGNAL', seat: 0, signalId: 'guino_ojo' }),
        'PLAYER_FOLDED',
      );
    }

    const abandoned = applyAction(g2v2, { type: 'SYSTEM_ABANDON', seat: 0 });
    if (abandoned.ok) {
      expectErrCode(
        applyAction(abandoned.value.state, { type: 'FOLD_HAND', seat: 1 }),
        'MATCH_ALREADY_FINISHED',
      );
    }
  });
});
