import { describe, expect, it } from 'vitest';
import { applyAction, createGame } from '../src/engine.js';
import { createSeededRng } from '../src/rng.js';
import {
  AR_CORTO_15_FLOR_V1,
  AR_CORTO_15_V1,
  AR_STANDARD_V1,
  createRuleSetVariant,
} from '../src/rulesets.js';
import { buildSeats, simulateBatch, simulateMatch } from '../src/simulator.js';
import { resolveRespondingSeat, resolveRespondingTeam } from '../src/team-responder.js';
import type { RuleSet } from '../src/rulesets.js';
import type { DomainEvent, GameState } from '../src/state.types.js';
import type { PlayerSeat, TeamId } from '../src/types.js';
import { viewFor } from '../src/view.js';

/**
 * `teamResponderMode` (`NEXT_IN_TURN` por defecto, `HIGHEST_SCORE` configurable) existe porque el
 * truco de 6 tiene **tres** equipos y un canto involucra a dos rivales. Con **dos** equipos el
 * rival es uno solo, así que la elección no tiene nada que elegir: la decisión del ADR-033 no
 * puede cambiar una partida de 1v1, de 2v2 ni de un torneo 2v2.
 *
 * Este archivo fija esa equivalencia en los dos niveles que importan:
 *
 * 1. **Función pura** (`resolveRespondingTeam`): misma respuesta en todas las posiciones, con y
 *    sin asientos al mazo, y con cualquier marcador.
 * 2. **Partida completa**: dos partidas de 2v2 con la misma semilla y la misma secuencia de
 *    acciones (misma RNG, mismos agentes) tienen que terminar en el mismo estado y emitir los
 *    mismos eventos **acción por acción**, no sólo el mismo ganador. Un test que sólo comparase el
 *    campeón pasaría aunque el modo cambiara quién contestaba un envido intermedio.
 */

const TEAMS_2V2 = buildSeats(4, 2);

/**
 * El modo no es un *override* anidado: vive en la raíz del `RuleSet` (el truco de 6 lo lee de
 * ahí), así que se compone con `createRuleSetVariant` para conservar el resto del conjunto y se
 * fija encima. Pasarlo dentro de los overrides no compila, y ése era el error de este archivo.
 */
function rulesetWith(mode: 'NEXT_IN_TURN' | 'HIGHEST_SCORE', base: RuleSet = AR_STANDARD_V1) {
  return { ...createRuleSetVariant(base, {}), teamResponderMode: mode };
}

/** Huella estable de un estado: sin ella, un estado distinto podría colarse en un empate de cartas. */
function fingerprint(state: GameState): string {
  return JSON.stringify({
    scores: state.scoresByTeam,
    status: state.status,
    winnerTeam: state.winnerTeam,
    handNumber: state.hand.handNumber,
    manoSeat: state.hand.manoSeat,
    turnSeat: state.hand.turnSeat,
    activeSeat: state.hand.activeSeat,
    foldedSeats: state.hand.foldedSeats,
    truco: state.hand.truco,
    envidoStatus: state.hand.envidoStatus,
    envidoChain: state.hand.envidoChain,
    florStatus: state.hand.florStatus,
    florChain: state.hand.florChain,
    // Las cartas jugadas de la mano: las de la vuelta en curso y las de las vueltas cerradas.
    currentRoundPlays: state.hand.currentRoundPlays,
    completedRounds: state.hand.completedRounds,
    remaining: state.hand.remainingHandsBySeat,
    responderTeam: state.hand.responderTeam,
  });
}

function describeEvent(event: DomainEvent): string {
  return JSON.stringify(event);
}

/**
 * Juega una partida de 2v2 con un agente determinista guiado por la vista del asiento activo,
 * registrando el estado y los eventos resultantes de **cada** acción.
 */
function playRecording(
  ruleset: RuleSet,
  seed: number,
): { readonly states: string[]; readonly events: string[]; readonly final: GameState } {
  let state = createGame(ruleset, TEAMS_2V2, createSeededRng(seed));
  const chooser = createSeededRng(seed * 7 + 1);
  const states: string[] = [fingerprint(state)];
  const events: string[] = [];
  let steps = 0;

  while (state.status === 'IN_PROGRESS' && steps < 5_000) {
    const view = viewFor(state, state.hand.activeSeat);
    const legal = view.legalActions;
    expect(legal.length).toBeGreaterThan(0);
    // Agente determinista: rota entre las acciones legales según la RNG sembrada. Lo que importa no
    // es que juegue "bien", sino que las dos partidas reciban exactamente las mismas decisiones.
    const action = legal[Math.floor(chooser.nextFloat() * legal.length)]!;
    const result = applyAction(state, action);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    state = result.value.state;
    for (const event of result.value.events) events.push(describeEvent(event));
    states.push(fingerprint(state));
    steps += 1;
  }

  return { states, events, final: state };
}

describe('teamResponderMode es inerte con dos equipos — función pura', () => {
  const modes = ['NEXT_IN_TURN', 'HIGHEST_SCORE'] as const;

  it('devuelve el mismo equipo rival para cada cantor, sin nadie al mazo', () => {
    const scores: Record<TeamId, number> = { 0: 12, 1: 30 };
    for (const callerSeat of [0, 1, 2, 3]) {
      const callerTeam = TEAMS_2V2[callerSeat]!.team;
      const answers = modes.map((mode) =>
        resolveRespondingTeam(callerSeat, callerTeam, TEAMS_2V2, [], scores, mode),
      );
      expect(answers[1]).toBe(answers[0]);
      expect(answers[0]).not.toBe(callerTeam);
    }
  });

  it('coincide también con marcadores invertidos, empatados y con asientos al mazo', () => {
    const scoreboards: Record<TeamId, number>[] = [
      { 0: 0, 1: 0 },
      { 0: 30, 1: 5 },
      { 0: 5, 1: 30 },
      { 0: 15, 1: 15 },
    ];
    const foldedCases = [[], [0], [1], [2], [3], [0, 1], [2, 3], [1, 2]];
    for (const scores of scoreboards) {
      for (const folded of foldedCases) {
        for (const callerSeat of [0, 1, 2, 3]) {
          if (folded.includes(callerSeat)) continue;
          const callerTeam = TEAMS_2V2[callerSeat]!.team;
          const answers = modes.map((mode) =>
            resolveRespondingTeam(callerSeat, callerTeam, TEAMS_2V2, folded, scores, mode),
          );
          expect({ folded, scores, callerSeat, answer: answers[1] }).toEqual({
            folded,
            scores,
            callerSeat,
            answer: answers[0],
          });
        }
      }
    }
  });

  it('elige el mismo asiento habilitado para contestar en los tres modos de asiento', () => {
    const seats: PlayerSeat[] = TEAMS_2V2;
    for (const selection of ['NEXT_IN_TURN', 'PIE_OF_TEAM', 'ANY_TEAM_MEMBER'] as const) {
      for (const callerSeat of [0, 1, 2, 3]) {
        const callerTeam = seats[callerSeat]!.team;
        for (const mode of modes) {
          const team = resolveRespondingTeam(
            callerSeat,
            callerTeam,
            seats,
            [],
            { 0: 0, 1: 0 },
            mode,
          );
          const seat = resolveRespondingSeat(callerSeat, team, 0, seats, [], selection);
          // El asiento elegido pertenece al equipo que respondió y no es el cantor.
          expect(seats[seat]!.team).toBe(team);
          expect(seat).not.toBe(callerSeat);
        }
      }
    }
  });

  it('el defecto del RuleSet de producción es NEXT_IN_TURN', () => {
    for (const base of [AR_STANDARD_V1, AR_CORTO_15_V1, AR_CORTO_15_FLOR_V1]) {
      expect(base.teamResponderMode ?? 'NEXT_IN_TURN').toBe('NEXT_IN_TURN');
    }
  });
});

describe('teamResponderMode es inerte con dos equipos — partidas completas de 2v2', () => {
  it('dos partidas de 2v2 con la misma semilla terminan igual acción por acción', () => {
    for (const base of [AR_STANDARD_V1, AR_CORTO_15_V1, AR_CORTO_15_FLOR_V1]) {
      for (const seed of [1, 7, 23, 99, 1_234]) {
        const next = playRecording(rulesetWith('NEXT_IN_TURN', base), seed);
        const highest = playRecording(rulesetWith('HIGHEST_SCORE', base), seed);

        expect({ ruleset: base.code, seed, events: highest.events }).toEqual({
          ruleset: base.code,
          seed,
          events: next.events,
        });
        expect({ ruleset: base.code, seed, states: highest.states }).toEqual({
          ruleset: base.code,
          seed,
          states: next.states,
        });
        expect(highest.final.winnerTeam).toBe(next.final.winnerTeam);
        // La partida tiene que haberse jugado de verdad, no cortado por el tope de pasos.
        expect(next.final.status).toBe('FINISHED');
        expect(next.states.length).toBeGreaterThan(10);
      }
    }
  });

  it('40 partidas de 2v2 por lote dan las mismas estadísticas con los dos modos', () => {
    for (const base of [AR_STANDARD_V1, AR_CORTO_15_V1]) {
      const next = simulateBatch(
        40,
        { ruleset: rulesetWith('NEXT_IN_TURN', base), numSeats: 4, numTeams: 2 },
        500,
      );
      const highest = simulateBatch(
        40,
        { ruleset: rulesetWith('HIGHEST_SCORE', base), numSeats: 4, numTeams: 2 },
        500,
      );
      // El lote tiene que haber jugado partidas de verdad: si no, la igualdad sería vacía.
      expect(next.matchesPlayed).toBe(40);
      expect(next.totalHands).toBeGreaterThan(next.matchesPlayed);
      expect(highest).toEqual(next);
    }
  });

  it('una partida suelta de 2v2 con HIGHEST_SCORE emite exactamente los mismos eventos', () => {
    const next = simulateMatch({
      ruleset: rulesetWith('NEXT_IN_TURN'),
      numSeats: 4,
      numTeams: 2,
      seed: 42,
      recordEvents: true,
    });
    const highest = simulateMatch({
      ruleset: rulesetWith('HIGHEST_SCORE'),
      numSeats: 4,
      numTeams: 2,
      seed: 42,
      recordEvents: true,
    });
    expect(highest.events).toEqual(next.events);
    expect(highest.finalState.scoresByTeam).toEqual(next.finalState.scoresByTeam);
  });
});

/**
 * Control negativo del arnés: la misma comparación con **tres** equipos tiene que fallar.
 *
 * Sin esto, la equivalencia de arriba podría estar pasando porque el arnés no mira nada (dos
 * grabaciones vacías también son iguales). Con tres equipos y un marcador desparejo, elegir por
 * cercanía y elegir por puntaje dan equipos distintos, y la grabación completa tiene que diferir.
 */
describe('control negativo — con tres equipos el modo sí cambia la partida', () => {
  it('NEXT_IN_TURN y HIGHEST_SCORE divergen en el 3v3', () => {
    const three = buildSeats(6, 3);
    // Canta el asiento 0 (equipo 0). Más cercano en turnos: asiento 1 (equipo 1). Con más puntos:
    // el equipo 2. Los dos modos no pueden coincidir.
    const scores: Record<TeamId, number> = { 0: 0, 1: 3, 2: 20 };
    const next = resolveRespondingTeam(0, 0, three, [], scores, 'NEXT_IN_TURN');
    const highest = resolveRespondingTeam(0, 0, three, [], scores, 'HIGHEST_SCORE');
    expect(next).toBe(1);
    expect(highest).toBe(2);
    expect(highest).not.toBe(next);

    // Y en una partida completa de 3v3 las grabaciones difieren.
    const rulesets = [
      rulesetWith('NEXT_IN_TURN', AR_CORTO_15_V1),
      rulesetWith('HIGHEST_SCORE', AR_CORTO_15_V1),
    ];
    const recordings = rulesets.map((ruleset) => {
      const rng = createSeededRng(5);
      const chooser = createSeededRng(5 * 7 + 1);
      let state = createGame(ruleset, three, rng);
      const events: string[] = [];
      let steps = 0;
      while (state.status === 'IN_PROGRESS' && steps < 5_000) {
        const legal = viewFor(state, state.hand.activeSeat).legalActions;
        const action = legal[Math.floor(chooser.nextFloat() * legal.length)]!;
        const result = applyAction(state, action);
        if (!result.ok) throw new Error(result.error.message);
        state = result.value.state;
        for (const event of result.value.events) events.push(describeEvent(event));
        steps += 1;
      }
      return events;
    });
    expect(recordings[0]).not.toEqual(recordings[1]);
  });
});
