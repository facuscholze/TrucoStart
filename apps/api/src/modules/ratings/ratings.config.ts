export const RATING_RUNTIME_CONFIG = Symbol('RATING_RUNTIME_CONFIG');

export interface RatingRuntimeConfig {
  readonly redisUrl: string | null;
  readonly minimumMatches: number;
  readonly minimumOpponents: number;
  readonly repeatRivalLimit: number;
  readonly queueBaseRatingWindow: number;
  readonly queueWindowGrowthPerTenSeconds: number;
  readonly queueMaximumRatingWindow: number;
  readonly queueCandidateScanLimit: number;
  readonly shortMatchThresholdMs: number;
  readonly repeatedPairSignalCount: number;
  readonly coordinatedAbandonSignalCount: number;
  readonly newAccountAgeMs: number;
  readonly newAccountFeedLossCount: number;
  readonly seasonDurationDays: number;
  readonly reviewPageSize: number;
  readonly nowFn: () => number;
}

function intEnv(name: string, fallback: number, minimum: number, maximum: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isInteger(parsed) ? Math.min(maximum, Math.max(minimum, parsed)) : fallback;
}

export function buildRatingRuntimeConfig(
  overrides: Partial<RatingRuntimeConfig> = {},
): RatingRuntimeConfig {
  return {
    redisUrl:
      overrides.redisUrl !== undefined ? overrides.redisUrl : (process.env['REDIS_URL'] ?? null),
    minimumMatches: overrides.minimumMatches ?? intEnv('RANKING_MIN_MATCHES', 5, 1, 1000),
    minimumOpponents: overrides.minimumOpponents ?? intEnv('RANKING_MIN_OPPONENTS', 3, 1, 1000),
    repeatRivalLimit:
      overrides.repeatRivalLimit ?? intEnv('COMPETITIVE_REPEAT_RIVAL_LIMIT', 5, 1, 100),
    queueBaseRatingWindow:
      overrides.queueBaseRatingWindow ?? intEnv('COMPETITIVE_RATING_WINDOW_BASE', 150, 50, 1000),
    queueWindowGrowthPerTenSeconds:
      overrides.queueWindowGrowthPerTenSeconds ??
      intEnv('COMPETITIVE_RATING_WINDOW_GROWTH', 50, 1, 500),
    queueMaximumRatingWindow:
      overrides.queueMaximumRatingWindow ?? intEnv('COMPETITIVE_RATING_WINDOW_MAX', 800, 100, 2000),
    queueCandidateScanLimit:
      overrides.queueCandidateScanLimit ?? intEnv('COMPETITIVE_QUEUE_SCAN_LIMIT', 24, 4, 64),
    shortMatchThresholdMs:
      overrides.shortMatchThresholdMs ??
      intEnv('ANTI_ABUSE_SHORT_MATCH_MS', 90_000, 10_000, 600_000),
    repeatedPairSignalCount:
      overrides.repeatedPairSignalCount ?? intEnv('ANTI_ABUSE_REPEAT_PAIR_COUNT', 5, 2, 100),
    coordinatedAbandonSignalCount:
      overrides.coordinatedAbandonSignalCount ?? intEnv('ANTI_ABUSE_ABANDON_PAIR_COUNT', 2, 2, 100),
    newAccountAgeMs:
      overrides.newAccountAgeMs ??
      intEnv('ANTI_ABUSE_NEW_ACCOUNT_DAYS', 7, 1, 90) * 24 * 60 * 60 * 1000,
    newAccountFeedLossCount:
      overrides.newAccountFeedLossCount ?? intEnv('ANTI_ABUSE_FEED_LOSS_COUNT', 3, 2, 100),
    seasonDurationDays: overrides.seasonDurationDays ?? intEnv('RATING_SEASON_DAYS', 90, 7, 365),
    reviewPageSize: overrides.reviewPageSize ?? intEnv('COMPETITIVE_REVIEW_PAGE_SIZE', 25, 1, 100),
    nowFn: overrides.nowFn ?? Date.now,
  };
}
