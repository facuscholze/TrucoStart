import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RedisLeaderboardStore } from './redis-leaderboard-store.js';

const redisUrl = process.env['REDIS_URL'];

describe('Redis leaderboard integration prerequisites', () => {
  it('requires the real Redis service in CI', () => {
    if (process.env['CI'] === 'true') expect(redisUrl).toBeTruthy();
  });
});

const redisDescribe = redisUrl ? describe : describe.skip;

redisDescribe('RedisLeaderboardStore — real Redis sorted-set projection', () => {
  let store: RedisLeaderboardStore | undefined;
  const key = `integration:${process.pid}:${randomUUID()}`;

  beforeAll(() => {
    if (!redisUrl) throw new Error('REDIS_URL is required for this integration suite.');
    store = new RedisLeaderboardStore(redisUrl, {
      keyPrefix: `truco:ratings:integration:${process.pid}:${randomUUID()}:`,
    });
  });

  afterAll(async () => {
    await store?.close();
  });

  it('writes ordered pages, reports ranks, projects absolute changes, and removes ineligible players', async () => {
    if (!store) throw new Error('Redis leaderboard store was not initialized.');
    await store.replaceLeaderboard(
      key,
      [
        { userId: 'player-alpha', score: 1800 },
        { userId: 'player-bravo', score: 1600 },
        { userId: 'player-charlie', score: 1400 },
      ],
      600,
    );

    expect(await store.readPage(key, 0, 2)).toEqual([
      { userId: 'player-alpha', score: 1800 },
      { userId: 'player-bravo', score: 1600 },
    ]);
    expect(await store.rankOf(key, 'player-bravo')).toBe(2);

    await store.projectLeaderboard(
      key,
      [
        { userId: 'player-bravo', score: 1850, eligible: true },
        { userId: 'player-alpha', score: 1450, eligible: true },
        { userId: 'player-charlie', score: 1400, eligible: false },
      ],
      600,
    );

    expect(await store.readPage(key, 0, 10)).toEqual([
      { userId: 'player-bravo', score: 1850 },
      { userId: 'player-alpha', score: 1450 },
    ]);
    expect(await store.rankOf(key, 'player-bravo')).toBe(1);
    expect(await store.rankOf(key, 'player-charlie')).toBeNull();
  });
});
