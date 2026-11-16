import { describe, expect, it } from 'vitest';
import { runMatchup, wilsonInterval } from '../src/benchmark.js';
import { AR_STANDARD_V1 } from '../src/rulesets.js';

const BASE = { ruleset: AR_STANDARD_V1, numSeats: 2, numTeams: 2 };

describe('M6 · benchmark de la IA (BL-010)', () => {
  it('el nivel difícil supera al bot anterior de M1 en más del 60% de las partidas', () => {
    const result = runMatchup(
      { label: 'Difícil vs M1', challenger: 'HARD', opponent: 'LEGACY' },
      BASE,
      400,
      20260101,
    );
    expect(result.challengerWins + result.opponentWins).toBe(400);
    expect(result.winRate).toBeGreaterThan(0.6);
    expect(result.ciLow).toBeGreaterThan(0.55);
  }, 180_000);

  it('la escalera de dificultad es monótona: difícil > medio > fácil', () => {
    const hardVsMedium = runMatchup(
      { label: 'Difícil vs Medio', challenger: 'HARD', opponent: 'MEDIUM' },
      BASE,
      200,
      777_001,
    );
    const mediumVsEasy = runMatchup(
      { label: 'Medio vs Fácil', challenger: 'MEDIUM', opponent: 'EASY' },
      BASE,
      200,
      778_001,
    );
    const hardVsRandom = runMatchup(
      { label: 'Difícil vs Random', challenger: 'HARD', opponent: 'RANDOM' },
      BASE,
      100,
      779_001,
    );
    expect(hardVsMedium.winRate).toBeGreaterThan(0.52);
    expect(mediumVsEasy.winRate).toBeGreaterThan(0.6);
    expect(hardVsRandom.winRate).toBeGreaterThan(0.9);
  }, 240_000);

  it('calcula intervalos de Wilson acotados y consistentes', () => {
    const low = wilsonInterval(0, 10);
    expect(low.low).toBe(0);
    expect(low.high).toBeGreaterThan(0);
    const high = wilsonInterval(10, 10);
    expect(high.high).toBe(1);
    expect(high.low).toBeLessThan(1);
    const mid = wilsonInterval(500, 1000);
    expect(mid.low).toBeLessThan(0.5);
    expect(mid.high).toBeGreaterThan(0.5);
  });
});
