import type { AgentKind, SimulateMatchOptions } from './simulator.js';
import { simulateMatch } from './simulator.js';

export interface BenchmarkMatchup {
  /** Agente que ocupa el equipo 0. */
  readonly challenger: AgentKind;
  /** Agente que ocupa el equipo 1. */
  readonly opponent: AgentKind;
  readonly label: string;
}

export interface BenchmarkResult {
  readonly label: string;
  readonly challenger: AgentKind;
  readonly opponent: AgentKind;
  readonly matches: number;
  readonly challengerWins: number;
  readonly opponentWins: number;
  /** Proporción de victorias del retador en [0,1]. */
  readonly winRate: number;
  /** Intervalo de confianza 95% (Wilson) del win rate. */
  readonly ciLow: number;
  readonly ciHigh: number;
  readonly avgActionsPerMatch: number;
}

type BenchmarkBaseOptions = Omit<SimulateMatchOptions, 'seed' | 'agentByTeam'>;

/**
 * Intervalo de confianza de Wilson para una proporción binomial.
 * Se usa en lugar del intervalo normal porque es estable con n grande y p cerca de 0/1.
 */
export function wilsonInterval(
  successes: number,
  total: number,
  z = 1.96,
): { low: number; high: number } {
  if (total === 0) return { low: 0, high: 1 };
  const p = successes / total;
  const z2 = z * z;
  const denominator = 1 + z2 / total;
  const center = (p + z2 / (2 * total)) / denominator;
  const margin = (z * Math.sqrt((p * (1 - p)) / total + z2 / (4 * total * total))) / denominator;
  return { low: Math.max(0, center - margin), high: Math.min(1, center + margin) };
}

/**
 * Enfrenta dos agentes alternando el lado de la mesa (par/impar) para cancelar
 * la ventaja de ser mano y de la semilla de reparto.
 */
export function runMatchup(
  matchup: BenchmarkMatchup,
  baseOptions: BenchmarkBaseOptions,
  matches: number,
  baseSeed = 1,
): BenchmarkResult {
  let challengerWins = 0;
  let opponentWins = 0;
  let totalActions = 0;

  for (let i = 0; i < matches; i++) {
    const challengerIsTeam0 = i % 2 === 0;
    const agentByTeam = challengerIsTeam0
      ? { 0: matchup.challenger, 1: matchup.opponent }
      : { 0: matchup.opponent, 1: matchup.challenger };
    const result = simulateMatch({ ...baseOptions, seed: baseSeed + i, agentByTeam });
    totalActions += result.actionsApplied;
    const challengerTeam = challengerIsTeam0 ? 0 : 1;
    if (result.winnerTeam === challengerTeam) challengerWins++;
    else opponentWins++;
  }

  const played = challengerWins + opponentWins;
  const { low, high } = wilsonInterval(challengerWins, played);

  return {
    label: matchup.label,
    challenger: matchup.challenger,
    opponent: matchup.opponent,
    matches: played,
    challengerWins,
    opponentWins,
    winRate: played === 0 ? 0 : challengerWins / played,
    ciLow: low,
    ciHigh: high,
    avgActionsPerMatch: played === 0 ? 0 : totalActions / played,
  };
}

export function runBenchmark(
  matchups: readonly BenchmarkMatchup[],
  baseOptions: BenchmarkBaseOptions,
  matches: number,
  baseSeed = 1,
): BenchmarkResult[] {
  return matchups.map((matchup, index) =>
    runMatchup(matchup, baseOptions, matches, baseSeed + index * 1_000_003),
  );
}

export const M6_BENCHMARK_MATCHUPS: readonly BenchmarkMatchup[] = Object.freeze([
  { label: 'Difícil vs Medio', challenger: 'HARD', opponent: 'MEDIUM' },
  { label: 'Difícil vs Fácil', challenger: 'HARD', opponent: 'EASY' },
  { label: 'Difícil vs Bot anterior (M1)', challenger: 'HARD', opponent: 'LEGACY' },
  { label: 'Medio vs Bot anterior (M1)', challenger: 'MEDIUM', opponent: 'LEGACY' },
  { label: 'Difícil vs Random', challenger: 'HARD', opponent: 'RANDOM' },
]);

export function formatBenchmarkTable(results: readonly BenchmarkResult[]): string {
  const header = [
    '| Enfrentamiento | Partidas | Victorias | Win rate | IC 95% | Acciones/partida |',
    '| --- | ---: | ---: | ---: | --- | ---: |',
  ];
  const rows = results.map(
    (r) =>
      `| ${r.label} | ${r.matches} | ${r.challengerWins} | ${(r.winRate * 100).toFixed(1)}% | ${(r.ciLow * 100).toFixed(1)}% – ${(r.ciHigh * 100).toFixed(1)}% | ${r.avgActionsPerMatch.toFixed(0)} |`,
  );
  return [...header, ...rows].join('\n');
}
