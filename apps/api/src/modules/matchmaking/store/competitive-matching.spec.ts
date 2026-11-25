import { describe, expect, it } from 'vitest';
import { findCompetitiveMatch } from './competitive-matching.js';
import type {
  CompetitiveMatchingOptions,
  QueuedPlayerEntry,
} from './matchmaking-store.interface.js';

const options: CompetitiveMatchingOptions = {
  baseRatingWindow: 100,
  waitGrowthPerTenSeconds: 50,
  maximumRatingWindow: 600,
  candidateScanLimit: 24,
};

function entry(
  userId: string,
  rating: number,
  extra: Partial<QueuedPlayerEntry> = {},
): QueuedPlayerEntry {
  return {
    userId,
    nickname: userId,
    mode: '2v2',
    rulesetCode: 'ar-standard-v1',
    enqueuedAtMs: 10_000,
    expiresAtMs: 1_000_000,
    competitive: true,
    rating,
    ratingDeviation: 100,
    blockedOpponentIds: [],
    ...extra,
  };
}

describe('competitive matchmaking selector', () => {
  it('forms balanced 2v2 teams while keeping a blocked repeat rival on the same team', () => {
    const players = [
      entry('a', 1500, { blockedOpponentIds: ['d'] }),
      entry('b', 1500),
      entry('c', 1500),
      entry('d', 1500),
    ];
    const match = findCompetitiveMatch(players, 4, 10_000, options, 'a');
    expect(match).not.toBeNull();
    expect(match).toHaveLength(4);
    const teamZero = match!.filter((player) => player.team === 0);
    const teamOne = match!.filter((player) => player.team === 1);
    expect(teamZero).toHaveLength(2);
    expect(teamOne).toHaveLength(2);
    expect(teamZero.some((player) => player.userId === 'a')).toBe(true);
    expect(
      teamZero.some((player) => player.userId === 'd') ||
        teamOne.some((player) => player.userId === 'd'),
    ).toBe(true);
    expect(
      teamZero.some((player) => player.userId === 'a') &&
        teamOne.some((player) => player.userId === 'd'),
    ).toBe(false);
    expect(
      teamOne.some((player) => player.userId === 'a') &&
        teamZero.some((player) => player.userId === 'd'),
    ).toBe(false);
  });

  it('assigns 1v1 teams by FIFO queue order, not by which user submitted the final request', () => {
    const match = findCompetitiveMatch(
      [
        entry('first-in-queue', 1500, { enqueuedAtMs: 10_000 }),
        entry('last-in-queue', 1500, { enqueuedAtMs: 20_000 }),
      ],
      2,
      20_000,
      options,
      'last-in-queue',
    );
    expect(match?.map((player) => [player.userId, player.team])).toEqual([
      ['first-in-queue', 0],
      ['last-in-queue', 1],
    ]);
  });

  it('widens the rating window over wait time but does not match beyond the configured cap', () => {
    const players = [entry('a', 1000), entry('b', 1550)];
    expect(findCompetitiveMatch(players, 2, 10_000, options, 'a')).toBeNull();
    expect(findCompetitiveMatch(players, 2, 100_000, options, 'a')).toHaveLength(2);
    expect(
      findCompetitiveMatch([entry('a', 1000), entry('b', 1601)], 2, 10_000_000, options, 'a'),
    ).toBeNull();
  });

  it('uses the request user as an anchor even when it falls outside the candidate scan window', () => {
    const crowd = Array.from({ length: 5 }, (_, index) => entry(`p${index}`, 1500 + index));
    const caller = entry('caller', 1502);
    const match = findCompetitiveMatch(
      [...crowd, caller],
      4,
      10_000,
      { ...options, candidateScanLimit: 3 },
      'caller',
    );
    expect(match).not.toBeNull();
    expect(match!.some((player) => player.userId === 'caller')).toBe(true);
    expect(new Set(match!.map((player) => player.userId)).size).toBe(4);
  });
});
