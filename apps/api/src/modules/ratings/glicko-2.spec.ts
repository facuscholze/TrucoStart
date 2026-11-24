import { describe, expect, it } from 'vitest';
import {
  initialGlickoRating,
  ratingDivision,
  softResetGlickoRating,
  updateGlicko2,
} from './glicko-2.js';

describe('Glicko-2', () => {
  it('matches the published three-opponent example within rounding tolerance', () => {
    const result = updateGlicko2({ rating: 1500, deviation: 200, volatility: 0.06 }, [
      { rating: 1400, deviation: 30, score: 1 },
      { rating: 1550, deviation: 100, score: 0 },
      { rating: 1700, deviation: 300, score: 0 },
    ]);

    expect(result.rating).toBeCloseTo(1464.06, 1);
    expect(result.deviation).toBeCloseTo(151.52, 1);
    expect(result.volatility).toBeCloseTo(0.059996, 4);
  });

  it('moves ratings in the direction of outcomes and uses every opponent in a 2v2 result', () => {
    const current = initialGlickoRating();
    const opponents = [
      { rating: 1500, deviation: 100, score: 1 as const },
      { rating: 1500, deviation: 100, score: 1 as const },
    ];
    const win = updateGlicko2(current, opponents);
    const loss = updateGlicko2(
      current,
      opponents.map((opponent) => ({ ...opponent, score: 0 })),
    );

    expect(win.rating).toBeGreaterThan(current.rating);
    expect(loss.rating).toBeLessThan(current.rating);
    expect(win.deviation).toBeLessThan(current.deviation);
  });

  it('keeps every value valid and converges toward the stable skill in a long simulation', () => {
    let rating = initialGlickoRating();
    const actualSkill = 1650;
    let randomState = 123_456_789;

    for (let game = 0; game < 5_000; game += 1) {
      const opponentRating = game % 2 === 0 ? 1500 : 1550;
      const expected = 1 / (1 + Math.exp(-(actualSkill - opponentRating) / 240));
      // Seeded LCG keeps the long simulation deterministic and well mixed.
      randomState = (1_664_525 * randomState + 1_013_904_223) >>> 0;
      const score = randomState / 4_294_967_296 < expected ? 1 : 0;
      rating = updateGlicko2(rating, [{ rating: opponentRating, deviation: 80, score }]);
      expect(Number.isFinite(rating.rating)).toBe(true);
      expect(Number.isFinite(rating.deviation)).toBe(true);
      expect(Number.isFinite(rating.volatility)).toBe(true);
      expect(rating.deviation).toBeGreaterThanOrEqual(30);
      expect(rating.deviation).toBeLessThanOrEqual(350);
      expect(rating.volatility).toBeGreaterThan(0);
    }

    expect(Math.abs(rating.rating - actualSkill)).toBeLessThan(160);
    expect(rating.deviation).toBeLessThan(80);
  });

  it('soft-resets without erasing skill and maps ratings into documented divisions', () => {
    const reset = softResetGlickoRating({ rating: 1800, deviation: 200, volatility: 0.06 });
    expect(reset.rating).toBe(1725);
    expect(reset.deviation).toBeCloseTo(Math.sqrt(44_900), 8);
    expect(reset.volatility).toBe(0.06);
    expect(ratingDivision(1399.9)).toBe('Bronce');
    expect(ratingDivision(1400)).toBe('Plata');
    expect(ratingDivision(1600)).toBe('Oro');
    expect(ratingDivision(1800)).toBe('Diamante');
  });

  it('rejects invalid inputs instead of persisting corrupt ratings', () => {
    expect(() =>
      updateGlicko2({ rating: Number.NaN, deviation: 80, volatility: 0.06 }, [
        { rating: 1500, deviation: 80, score: 1 },
      ]),
    ).toThrow(RangeError);
    expect(() => ratingDivision(Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });
});
