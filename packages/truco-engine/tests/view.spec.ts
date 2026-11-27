import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { getCardById } from '../src/cards.js';
import { applyAction, createGame, createGameWithHands } from '../src/engine.js';
import { formatDomainEvent, formatMatchLog } from '../src/format-log.js';
import { createSeededRng } from '../src/rng.js';
import { AR_STANDARD_V1 } from '../src/rulesets.js';
import type { DomainEvent, GameState } from '../src/state.types.js';
import type { CardId, PlayerSeat, SeatId } from '../src/types.js';
import { projectEventsForSeat, viewFor } from '../src/view.js';

const SEATS_2V2: PlayerSeat[] = [
  { seat: 0, team: 0, playerId: 'u0' },
  { seat: 1, team: 1, playerId: 'u1' },
  { seat: 2, team: 0, playerId: 'u2' },
  { seat: 3, team: 1, playerId: 'u3' },
];

function assertNoCardOrSignalLeak(
  state: GameState,
  recentEvents: readonly DomainEvent[],
  viewerSeat: SeatId,
): void {
  const view = viewFor(state, viewerSeat);
  const projectedEvents = projectEventsForSeat(recentEvents, state.seats, viewerSeat);

  const serializedView = JSON.stringify(view);
  const currentHandEvents = projectedEvents.filter(
    (ev) => !('handNumber' in ev) || ev.handNumber === state.hand.handNumber,
  );
  const serializedCurrentHandEvents = JSON.stringify(currentHandEvents);

  expect(serializedView).not.toContain('internalPrngState');

  // Ninguna carta aún en la mano actual (no jugada) de OTRO asiento puede aparecer en viewFor ni en eventos de esa mano
  for (const s of state.seats) {
    if (s.seat === viewerSeat) continue;
    const unplayedOtherCards = state.hand.remainingHandsBySeat[s.seat] ?? [];
    for (const card of unplayedOtherCards) {
      expect(
        serializedView,
        `Fuga de carta privada ${card.id} del asiento ${s.seat} hacia asiento ${viewerSeat} en viewFor`,
      ).not.toContain(`"${card.id}"`);
      expect(
        serializedCurrentHandEvents,
        `Fuga de carta privada ${card.id} del asiento ${s.seat} hacia asiento ${viewerSeat} en DomainEvent`,
      ).not.toContain(`"${card.id}"`);
    }
  }

  // Ninguna seña de equipo rival puede aparecer en visibleSignals ni en eventos proyectados
  for (const sig of view.hand.visibleSignals) {
    expect(sig.team).toBe(view.myTeam);
  }
  for (const ev of projectedEvents) {
    if (ev.type === 'SIGNAL_SENT') {
      expect(ev.team).toBe(view.myTeam);
    }
  }
}

describe('Strict information-hiding guarantees of viewFor & projectEventsForSeat', () => {
  it('never leaks opponent or partner unplayed cards, nor rival signals, even on Envido/Flor showdowns', () => {
    const hand = (...ids: [CardId, CardId, CardId]) => ids.map((id) => getCardById(id)!);
    let state = createGameWithHands({
      ruleset: AR_STANDARD_V1,
      players: SEATS_2V2,
      handsBySeat: {
        0: hand('7-oros', '6-oros', '4-copas'), // 33 envido
        1: hand('7-bastos', '5-bastos', '1-espadas'), // 32 envido
        2: hand('3-espadas', '2-espadas', '12-copas'),
        3: hand('3-oros', '2-oros', '11-copas'),
      },
      rng: createSeededRng(100),
    });

    for (let s = 0; s < 4; s++) {
      assertNoCardOrSignalLeak(state, [], s);
    }

    // Asiento 0 envía seña a su compañero Asiento 2
    const sigRes = applyAction(state, {
      type: 'SEND_SIGNAL',
      seat: 0,
      signalId: 'muesca_izquierda',
    });
    expect(sigRes.ok).toBe(true);
    if (!sigRes.ok) return;
    state = sigRes.value.state;

    // Compañero (seat 2) la ve; rivales (seats 1 y 3) NO la ven ni en viewFor ni en eventos
    expect(viewFor(state, 2).hand.visibleSignals).toHaveLength(1);
    expect(viewFor(state, 1).hand.visibleSignals).toHaveLength(0);
    expect(projectEventsForSeat(sigRes.value.events, state.seats, 2)).toHaveLength(1);
    expect(projectEventsForSeat(sigRes.value.events, state.seats, 1)).toHaveLength(0);

    // Envido querido: por defecto (NEXT_IN_TURN) responde el asiento 1 (siguiente rival en orden de turno)
    const envCall = applyAction(state, { type: 'CALL_ENVIDO', seat: 0, bid: 'ENVIDO' });
    expect(envCall.ok).toBe(true);
    if (!envCall.ok) return;
    const envAccept = applyAction(envCall.value.state, {
      type: 'RESPOND_ENVIDO',
      seat: 1,
      decision: 'QUIERO',
    });
    expect(envAccept.ok).toBe(true);
    if (!envAccept.ok) return;

    for (let s = 0; s < 4; s++) {
      assertNoCardOrSignalLeak(envAccept.value.state, envAccept.value.events, s);
    }

    expect(() => viewFor(state, 99)).toThrow();
    expect(() => projectEventsForSeat([], state.seats, 99)).toThrow();
  });

  it('projects suspendedCaller, pending florChain and optional playerId cleanly without leaks', () => {
    const hand = (...ids: [CardId, CardId, CardId]) => ids.map((id) => getCardById(id)!);
    const seatsMixed: PlayerSeat[] = [
      { seat: 0, team: 0, playerId: 'u0' },
      { seat: 1, team: 1 }, // sin playerId opcional
    ];
    const rsSuspend = {
      ...AR_STANDARD_V1,
      envido: { ...AR_STANDARD_V1.envido, envidoFirstMode: 'SUSPEND_TRUCO' as const },
    };

    const g1 = createGameWithHands({
      ruleset: rsSuspend,
      players: seatsMixed,
      handsBySeat: {
        0: hand('1-espadas', '2-oros', '3-copas'),
        1: hand('7-oros', '6-oros', '5-oros'), // flor
      },
      rng: createSeededRng(77),
    });
    expect(viewFor(g1, 1).seats[1]?.playerId).toBeUndefined();

    // Seat 0 canta TRUCO -> Seat 1 antepone FLOR con SUSPEND_TRUCO -> suspendedCaller presente en viewFor
    const tCall = applyAction(g1, { type: 'CALL_TRUCO', seat: 0, bid: 'TRUCO' });
    expect(tCall.ok).toBe(true);
    if (!tCall.ok) return;

    const gBothFlor = createGameWithHands({
      ruleset: rsSuspend,
      players: seatsMixed,
      handsBySeat: {
        0: hand('7-bastos', '6-bastos', '5-bastos'),
        1: hand('7-oros', '6-oros', '5-oros'),
      },
      rng: createSeededRng(78),
    });
    const tBoth = applyAction(gBothFlor, { type: 'CALL_TRUCO', seat: 0, bid: 'TRUCO' });
    expect(tBoth.ok).toBe(true);
    if (!tBoth.ok) return;
    const fOverTruco = applyAction(tBoth.value.state, { type: 'CALL_FLOR', seat: 1, bid: 'FLOR' });
    expect(fOverTruco.ok).toBe(true);
    if (!fOverTruco.ok) return;

    const v0 = viewFor(fOverTruco.value.state, 0);
    expect(v0.hand.florChain?.bids).toEqual(['FLOR']);
    expect(v0.hand.truco.suspendedCaller).toEqual({ seat: 0, team: 0 });
    assertNoCardOrSignalLeak(fOverTruco.value.state, fOverTruco.value.events, 0);
  });

  it('property-based (fast-check): zero information leaks across 100 random 2v2 trajectories', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 1_000_000 }), (seed) => {
        const rng = createSeededRng(seed);
        let state = createGame(AR_STANDARD_V1, SEATS_2V2, rng);

        for (let step = 0; step < 30 && state.status === 'IN_PROGRESS'; step++) {
          for (let s = 0; s < 4; s++) {
            assertNoCardOrSignalLeak(state, [], s);
          }

          const active = state.hand.activeSeat;
          const actions = viewFor(state, active).legalActions;
          expect(actions.length).toBeGreaterThan(0);

          const idx = Math.floor(rng.nextFloat() * actions.length);
          const chosen = actions[idx]!;
          const prevState = state;
          const res = applyAction(state, chosen);
          expect(res.ok).toBe(true);
          if (!res.ok) return;

          state = res.value.state;
          for (let s = 0; s < 4; s++) {
            assertNoCardOrSignalLeak(state, res.value.events, s);
            if (prevState.hand.handNumber !== state.hand.handNumber) {
              const prevEventsJson = JSON.stringify(
                projectEventsForSeat(res.value.events, prevState.seats, s).filter(
                  (ev) => 'handNumber' in ev && ev.handNumber === prevState.hand.handNumber,
                ),
              );
              for (const other of prevState.seats) {
                if (other.seat === s) continue;
                for (const c of prevState.hand.remainingHandsBySeat[other.seat] ?? []) {
                  if (chosen.type === 'PLAY_CARD' && chosen.cardId === c.id) continue;
                  expect(prevEventsJson).not.toContain(`"${c.id}"`);
                }
              }
            }
          }
        }
      }),
      { numRuns: 100 },
    );
  });

  it('formats all DomainEvent types into readable Spanish narrative lines', () => {
    const sampleEvents: DomainEvent[] = [
      { type: 'MATCH_STARTED', rulesetCode: 'ar-standard-v1', targetScore: 30, seats: SEATS_2V2 },
      { type: 'HAND_STARTED', handNumber: 1, manoSeat: 0 },
      { type: 'SIGNAL_SENT', handNumber: 1, seat: 0, team: 0, signalId: 'guino_ojo' },
      {
        type: 'ENVIDO_CALLED',
        handNumber: 1,
        seat: 0,
        team: 0,
        bid: 'ENVIDO',
        cancelledPendingTruco: false,
      },
      {
        type: 'ENVIDO_RESOLVED',
        handNumber: 1,
        accepted: false,
        responderSeat: 1,
        winningTeam: 0,
        winningSeat: null,
        winningScore: null,
        pointsAwarded: 1,
      },
      { type: 'FLOR_CALLED', handNumber: 1, seat: 0, team: 0, bid: 'FLOR' },
      {
        type: 'FLOR_RESOLVED',
        handNumber: 1,
        accepted: true,
        winningTeam: 0,
        winningSeat: 0,
        winningScore: 35,
        pointsAwarded: 4,
      },
      {
        type: 'CARD_PLAYED',
        handNumber: 1,
        roundIndex: 0,
        seat: 0,
        team: 0,
        card: getCardById('1-espadas')!,
      },
      {
        type: 'ROUND_ENDED',
        handNumber: 1,
        roundIndex: 0,
        winnerTeam: 0,
        winningSeat: 0,
        isParda: false,
      },
      {
        type: 'ROUND_ENDED',
        handNumber: 1,
        roundIndex: 1,
        winnerTeam: null,
        winningSeat: null,
        isParda: true,
      },
      { type: 'TRUCO_CALLED', handNumber: 1, seat: 0, team: 0, bid: 'TRUCO' },
      { type: 'TRUCO_ACCEPTED', handNumber: 1, responderSeat: 1, bid: 'TRUCO', currentPoints: 2 },
      {
        type: 'TRUCO_DECLINED',
        handNumber: 1,
        responderSeat: 1,
        bid: 'RETRUCO',
        winningTeam: 0,
        pointsAwarded: 2,
      },
      { type: 'PLAYER_FOLDED', handNumber: 1, seat: 1, team: 1 },
      { type: 'SCORE_UPDATED', handNumber: 1, team: 0, delta: 2, newScore: 30, reason: 'HAND_WON' },
      { type: 'HAND_ENDED', handNumber: 1, winnerTeam: 0, pointsAwarded: 2, reason: 'ROUNDS' },
      {
        type: 'SYSTEM_ACTION_APPLIED',
        seat: 1,
        actionKind: 'TIMEOUT',
        resolvedAs: 'FOLD_HAND',
      },
      {
        type: 'MATCH_ENDED',
        winnerTeam: 0,
        scoresByTeam: { 0: 30, 1: 12 },
        reason: 'TARGET_SCORE',
      },
    ];

    const formatted = formatMatchLog(sampleEvents);
    expect(formatted.split('\n')).toHaveLength(sampleEvents.length);
    expect(formatDomainEvent(sampleEvents[0]!)).toContain('ar-standard-v1');
  });
});

/**
 * Truco de 6: con **tres** equipos conviven dos rivales distintos por cada asiento. La regla es
 * la misma que en 2v2 (nadie ve cartas ajenas ni señales de otro equipo), pero el universo de
 * "otros" crece, así que se cubre explícitamente con trayectorias aleatorias de 6 asientos.
 */
describe('Truco de 6 — información oculta entre tres equipos', () => {
  const SEATS_3X2: PlayerSeat[] = [
    { seat: 0, team: 0, playerId: 'p0' },
    { seat: 1, team: 0, playerId: 'p1' },
    { seat: 2, team: 1, playerId: 'p2' },
    { seat: 3, team: 1, playerId: 'p3' },
    { seat: 4, team: 2, playerId: 'p4' },
    { seat: 5, team: 2, playerId: 'p5' },
  ];

  it('property-based: 60 trayectorias de 6 asientos sin una sola carta ni seña filtrada', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 500_000 }), (seed) => {
        const rng = createSeededRng(seed);
        let state = createGame(AR_STANDARD_V1, SEATS_3X2, rng);

        for (let step = 0; step < 25 && state.status === 'IN_PROGRESS'; step++) {
          const events: DomainEvent[] = [];
          // Antes de actuar, cada uno de los 6 asientos solo puede ver lo suyo y lo público.
          for (let seat = 0; seat < 6; seat++) {
            assertNoCardOrSignalLeak(state, events, seat);
          }

          const active = state.hand.activeSeat;
          const actions = viewFor(state, active).legalActions;
          expect(actions.length).toBeGreaterThan(0);
          const chosen = actions[Math.floor(rng.nextFloat() * actions.length)]!;
          const res = applyAction(state, chosen);
          expect(res.ok).toBe(true);
          if (!res.ok) return;
          state = res.value.state;
          for (let seat = 0; seat < 6; seat++) {
            assertNoCardOrSignalLeak(state, res.value.events, seat);
          }
        }
      }),
      { numRuns: 60 },
    );
  }, 60_000);

  it('una seña de un equipo de 6 asientos no aparece en la vista de los otros dos equipos', () => {
    let state = createGame(AR_STANDARD_V1, SEATS_3X2, createSeededRng(4242));
    // Busca el primer momento en que el equipo 0 tenga seña disponible.
    let sent: DomainEvent[] = [];
    for (let step = 0; step < 40 && state.status === 'IN_PROGRESS' && sent.length === 0; step++) {
      const seat = state.hand.activeSeat;
      const signal = viewFor(state, seat).legalActions.find((a) => a.type === 'SEND_SIGNAL');
      if (signal && SEATS_3X2[seat]!.team === 0) {
        const res = applyAction(state, signal);
        expect(res.ok).toBe(true);
        if (!res.ok) return;
        sent = res.value.events;
        state = res.value.state;
        break;
      }
      const actions = viewFor(state, seat).legalActions;
      const play = actions.find((a) => a.type === 'PLAY_CARD') ?? {
        type: 'FOLD_HAND' as const,
        seat,
      };
      const res = applyAction(state, play);
      if (!res.ok) break;
      state = res.value.state;
    }

    expect(sent.some((e) => e.type === 'SIGNAL_SENT')).toBe(true);
    for (let seat = 0; seat < 6; seat++) {
      const projected = projectEventsForSeat(sent, state.seats, seat);
      const team = SEATS_3X2[seat]!.team;
      for (const ev of projected) {
        if (ev.type === 'SIGNAL_SENT') expect(ev.team).toBe(team);
      }
      const view = viewFor(state, seat);
      for (const sig of view.hand.visibleSignals) expect(sig.team).toBe(team);
      if (team !== 0) expect(view.hand.visibleSignals).toHaveLength(0);
    }
  });
});
