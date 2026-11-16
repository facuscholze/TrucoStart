import { chooseBotAction } from './bot.js';
import { applyAction, createGame } from './engine.js';
import { createSeededRng } from './rng.js';
import type { RuleSet } from './rulesets.js';
import type { Action, DomainEvent, GameState } from './state.types.js';
import type { PlayerSeat, Rng, TeamId } from './types.js';
import { viewFor } from './view.js';

export type AgentKind = 'HEURISTIC' | 'RANDOM';

export interface SimulateMatchOptions {
  readonly ruleset: RuleSet;
  readonly numSeats: number;
  readonly numTeams?: number;
  readonly seed: number;
  readonly agentByTeam?: Readonly<Record<TeamId, AgentKind>>;
  readonly maxSteps?: number;
  readonly recordEvents?: boolean;
}

export interface SimulatedMatchResult {
  readonly finalState: GameState;
  readonly winnerTeam: TeamId;
  readonly handsPlayed: number;
  readonly actionsApplied: number;
  readonly events: readonly DomainEvent[];
}

export interface BatchSimulationStats {
  readonly matchesPlayed: number;
  readonly totalHands: number;
  readonly totalActions: number;
  readonly maxActionsInSingleMatch: number;
  readonly winsByTeam: Readonly<Record<TeamId, number>>;
  readonly eventCounts: Readonly<Record<string, number>>;
}

export function buildSeats(numSeats: number, numTeams = 2): PlayerSeat[] {
  const seats: PlayerSeat[] = [];
  for (let s = 0; s < numSeats; s++) {
    seats.push({
      seat: s,
      team: s % numTeams,
      playerId: `bot-seat-${s}`,
    });
  }
  return seats;
}

function chooseAgentAction(kind: AgentKind, state: GameState, seat: number, rng: Rng): Action {
  const view = viewFor(state, seat);
  if (kind === 'HEURISTIC') {
    return chooseBotAction(view, rng);
  }
  const idx = Math.floor(rng.nextFloat() * view.legalActions.length);
  return view.legalActions[idx]!;
}

export function simulateMatch(options: SimulateMatchOptions): SimulatedMatchResult {
  const {
    ruleset,
    numSeats,
    numTeams = 2,
    seed,
    agentByTeam = {},
    maxSteps = 5_000,
    recordEvents = false,
  } = options;

  const rng = createSeededRng(seed);
  const seats = buildSeats(numSeats, numTeams);
  let state = createGame(ruleset, seats, rng);

  const events: DomainEvent[] = [];
  if (recordEvents) {
    events.push(
      {
        type: 'MATCH_STARTED',
        rulesetCode: ruleset.code,
        targetScore: ruleset.targetScore,
        seats,
      },
      {
        type: 'HAND_STARTED',
        handNumber: 1,
        manoSeat: 0,
      },
    );
  }

  let actionsApplied = 0;
  while (state.status === 'IN_PROGRESS') {
    if (actionsApplied >= maxSteps) {
      throw new Error(
        `Posible loop detectado en seed=${seed} tras ${actionsApplied} acciones (mano #${state.hand.handNumber})`,
      );
    }

    const activeSeat = state.hand.activeSeat;
    const team = state.seats[activeSeat]!.team;
    const kind: AgentKind = agentByTeam[team] ?? 'HEURISTIC';
    const action = chooseAgentAction(kind, state, activeSeat, rng);

    const result = applyAction(state, action);
    if (!result.ok) {
      throw new Error(
        `Acción ilegal elegida en simulación (seed=${seed}): ${JSON.stringify(action)} -> ${result.error.message}`,
      );
    }

    state = result.value.state;
    actionsApplied++;
    if (recordEvents) {
      events.push(...result.value.events);
    }
  }

  if (state.winnerTeam === null) {
    throw new Error(`Partida finalizó sin winnerTeam en seed=${seed}`);
  }

  return {
    finalState: state,
    winnerTeam: state.winnerTeam,
    handsPlayed: state.hand.handNumber,
    actionsApplied,
    events,
  };
}

export function simulateBatch(
  count: number,
  baseOptions: Omit<SimulateMatchOptions, 'seed'>,
  baseSeed = 1,
): BatchSimulationStats {
  let totalHands = 0;
  let totalActions = 0;
  let maxActionsInSingleMatch = 0;
  const winsByTeam: Record<TeamId, number> = {};
  const eventCounts: Record<string, number> = {};

  for (let i = 0; i < count; i++) {
    const res = simulateMatch({
      ...baseOptions,
      seed: baseSeed + i,
      recordEvents: true,
    });
    totalHands += res.handsPlayed;
    totalActions += res.actionsApplied;
    if (res.actionsApplied > maxActionsInSingleMatch) {
      maxActionsInSingleMatch = res.actionsApplied;
    }
    winsByTeam[res.winnerTeam] = (winsByTeam[res.winnerTeam] ?? 0) + 1;
    for (const ev of res.events) {
      eventCounts[ev.type] = (eventCounts[ev.type] ?? 0) + 1;
    }
  }

  return {
    matchesPlayed: count,
    totalHands,
    totalActions,
    maxActionsInSingleMatch,
    winsByTeam,
    eventCounts,
  };
}
