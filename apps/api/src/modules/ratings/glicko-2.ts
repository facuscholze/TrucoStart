export const GLICKO2_DEFAULTS = Object.freeze({
  rating: 1500,
  deviation: 350,
  volatility: 0.06,
  tau: 0.5,
  scale: 173.7178,
  minimumDeviation: 30,
  maximumDeviation: 350,
});

export interface GlickoRating {
  readonly rating: number;
  readonly deviation: number;
  readonly volatility: number;
}

export interface GlickoOpponent {
  readonly rating: number;
  readonly deviation: number;
  /** 1 = victoria, 0.5 = empate, 0 = derrota. */
  readonly score: 0 | 0.5 | 1;
}

export interface Glicko2Options {
  readonly tau?: number;
  readonly scale?: number;
  readonly minimumDeviation?: number;
  readonly maximumDeviation?: number;
}

const EPSILON = 1e-7;
const PI_SQUARED = Math.PI ** 2;

function assertValidRating(value: GlickoRating, name: string): void {
  if (
    !Number.isFinite(value.rating) ||
    !Number.isFinite(value.deviation) ||
    !Number.isFinite(value.volatility) ||
    value.rating < 0 ||
    value.deviation <= 0 ||
    value.volatility <= 0
  ) {
    throw new RangeError(`${name} debe contener rating, desviación y volatilidad válidos.`);
  }
}

function g(phi: number): number {
  return 1 / Math.sqrt(1 + (3 * phi * phi) / PI_SQUARED);
}

function expectedScore(mu: number, opponentMu: number, opponentPhi: number): number {
  return 1 / (1 + Math.exp(-g(opponentPhi) * (mu - opponentMu)));
}

function volatilityFunction(
  x: number,
  deltaSquared: number,
  phiSquared: number,
  variance: number,
  a: number,
  tau: number,
): number {
  const expX = Math.exp(x);
  const denominator = 2 * (phiSquared + variance + expX) ** 2;
  return (expX * (deltaSquared - phiSquared - variance - expX)) / denominator - (x - a) / tau ** 2;
}

function updateVolatility(
  phi: number,
  sigma: number,
  variance: number,
  delta: number,
  tau: number,
): number {
  const a = Math.log(sigma ** 2);
  const deltaSquared = delta ** 2;
  const phiSquared = phi ** 2;
  let lower = a;
  let upper: number;

  if (deltaSquared > phiSquared + variance) {
    upper = Math.log(deltaSquared - phiSquared - variance);
  } else {
    let step = 1;
    while (
      volatilityFunction(a - step * tau, deltaSquared, phiSquared, variance, a, tau) < 0 &&
      step < 10_000
    ) {
      step += 1;
    }
    upper = a - step * tau;
  }

  let lowerValue = volatilityFunction(lower, deltaSquared, phiSquared, variance, a, tau);
  let upperValue = volatilityFunction(upper, deltaSquared, phiSquared, variance, a, tau);
  let iterations = 0;

  while (Math.abs(upper - lower) > EPSILON && iterations < 100) {
    const candidate = lower + ((lower - upper) * lowerValue) / (upperValue - lowerValue);
    const candidateValue = volatilityFunction(
      candidate,
      deltaSquared,
      phiSquared,
      variance,
      a,
      tau,
    );

    if (candidateValue * upperValue <= 0) {
      lower = upper;
      lowerValue = upperValue;
    } else {
      lowerValue /= 2;
    }
    upper = candidate;
    upperValue = candidateValue;
    iterations += 1;
  }

  return Math.exp(lower / 2);
}

/**
 * Applies one Glicko-2 rating period. In 2v2, callers pass one opponent entry per opposing
 * player, so both opponents contribute to the player's individual result rather than splitting
 * an arbitrary team-level point change.
 */
export function updateGlicko2(
  current: GlickoRating,
  opponents: readonly GlickoOpponent[],
  options: Glicko2Options = {},
): GlickoRating {
  assertValidRating(current, 'El rating actual');
  const tau = options.tau ?? GLICKO2_DEFAULTS.tau;
  const scale = options.scale ?? GLICKO2_DEFAULTS.scale;
  const minimumDeviation = options.minimumDeviation ?? GLICKO2_DEFAULTS.minimumDeviation;
  const maximumDeviation = options.maximumDeviation ?? GLICKO2_DEFAULTS.maximumDeviation;
  if (!Number.isFinite(tau) || tau <= 0 || !Number.isFinite(scale) || scale <= 0) {
    throw new RangeError('Los parámetros tau y scale deben ser positivos y finitos.');
  }
  if (opponents.length === 0) return { ...current };

  for (const opponent of opponents) {
    assertValidRating(
      { rating: opponent.rating, deviation: opponent.deviation, volatility: 0.06 },
      'El rating rival',
    );
    if (opponent.score !== 0 && opponent.score !== 0.5 && opponent.score !== 1) {
      throw new RangeError('El resultado Glicko-2 debe ser 0, 0.5 o 1.');
    }
  }

  const mu = (current.rating - GLICKO2_DEFAULTS.rating) / scale;
  const phi = current.deviation / scale;
  let varianceInverse = 0;
  let improvement = 0;

  for (const opponent of opponents) {
    const opponentMu = (opponent.rating - GLICKO2_DEFAULTS.rating) / scale;
    const opponentPhi = opponent.deviation / scale;
    const influence = g(opponentPhi);
    const expected = expectedScore(mu, opponentMu, opponentPhi);
    varianceInverse += influence ** 2 * expected * (1 - expected);
    improvement += influence * (opponent.score - expected);
  }

  if (varianceInverse <= 0 || !Number.isFinite(varianceInverse)) return { ...current };
  const variance = 1 / varianceInverse;
  const delta = variance * improvement;
  const volatility = updateVolatility(phi, current.volatility, variance, delta, tau);
  const preRatingPeriodDeviation = Math.sqrt(phi ** 2 + volatility ** 2);
  const nextPhi = 1 / Math.sqrt(1 / preRatingPeriodDeviation ** 2 + 1 / variance);
  const nextMu = mu + nextPhi ** 2 * improvement;
  const rating = GLICKO2_DEFAULTS.rating + scale * nextMu;
  const deviation = Math.min(maximumDeviation, Math.max(minimumDeviation, scale * nextPhi));

  if (!Number.isFinite(rating) || !Number.isFinite(deviation) || !Number.isFinite(volatility)) {
    throw new RangeError('El cálculo Glicko-2 produjo un resultado no finito.');
  }
  return { rating, deviation, volatility };
}

export function initialGlickoRating(): GlickoRating {
  return {
    rating: GLICKO2_DEFAULTS.rating,
    deviation: GLICKO2_DEFAULTS.deviation,
    volatility: GLICKO2_DEFAULTS.volatility,
  };
}

/** Reinicio suave de temporada: conserva el 75% de distancia y aumenta incertidumbre. */
export function softResetGlickoRating(current: GlickoRating): GlickoRating {
  assertValidRating(current, 'El rating actual');
  return {
    rating: GLICKO2_DEFAULTS.rating + (current.rating - GLICKO2_DEFAULTS.rating) * 0.75,
    deviation: Math.min(
      GLICKO2_DEFAULTS.maximumDeviation,
      Math.sqrt(current.deviation ** 2 + 70 ** 2),
    ),
    volatility: current.volatility,
  };
}

export function ratingDivision(rating: number): 'Bronce' | 'Plata' | 'Oro' | 'Diamante' {
  if (!Number.isFinite(rating)) throw new RangeError('El rating debe ser finito.');
  if (rating >= 1800) return 'Diamante';
  if (rating >= 1600) return 'Oro';
  if (rating >= 1400) return 'Plata';
  return 'Bronce';
}
