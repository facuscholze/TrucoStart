import type {
  CompetitiveMatchingOptions,
  QueuedPlayerEntry,
} from './matchmaking-store.interface.js';

interface CandidateMatch {
  readonly players: readonly QueuedPlayerEntry[];
  readonly ratingGap: number;
  readonly oldestAt: number;
}

function rating(entry: QueuedPlayerEntry): number {
  return Number.isFinite(entry.rating) ? entry.rating! : 1500;
}

function isRestrictedPair(left: QueuedPlayerEntry, right: QueuedPlayerEntry): boolean {
  return Boolean(
    left.blockedOpponentIds?.includes(right.userId) ||
    right.blockedOpponentIds?.includes(left.userId),
  );
}

function windowFor(
  entries: readonly QueuedPlayerEntry[],
  nowMs: number,
  options: CompetitiveMatchingOptions,
): number {
  const oldestEnqueue = Math.min(...entries.map((entry) => entry.enqueuedAtMs));
  const waitIntervals = Math.floor(Math.max(0, nowMs - oldestEnqueue) / 10_000);
  return Math.min(
    options.maximumRatingWindow,
    options.baseRatingWindow + waitIntervals * options.waitGrowthPerTenSeconds,
  );
}

function compareQueueOrder(left: QueuedPlayerEntry, right: QueuedPlayerEntry): number {
  if (left.enqueuedAtMs !== right.enqueuedAtMs) return left.enqueuedAtMs - right.enqueuedAtMs;
  if (left.userId === right.userId) return 0;
  return left.userId < right.userId ? -1 : 1;
}

function isBetter(candidate: CandidateMatch, current: CandidateMatch | null): boolean {
  if (!current) return true;
  if (candidate.ratingGap !== current.ratingGap) return candidate.ratingGap < current.ratingGap;
  return candidate.oldestAt < current.oldestAt;
}

/**
 * Pure counterpart of the Redis Lua selector. Competitive 2v2 tries all three team splits,
 * rejects capped repeat rivals across teams and prefers the closest average team rating.
 */
export function findCompetitiveMatch(
  entries: readonly QueuedPlayerEntry[],
  quota: number,
  nowMs: number,
  options: CompetitiveMatchingOptions,
  callerUserId: string,
): readonly QueuedPlayerEntry[] | null {
  if (entries.length < quota) return null;
  const callerIndex = entries.findIndex((entry) => entry.userId === callerUserId);
  const caller = entries[callerIndex];
  if (!caller) return null;

  if (quota === 2) {
    let best: CandidateMatch | null = null;
    for (let index = 0; index < entries.length; index += 1) {
      if (index === callerIndex) continue;
      const opponent = entries[index];
      if (!opponent || isRestrictedPair(caller, opponent)) continue;
      const group = [caller, opponent];
      if (Math.abs(rating(caller) - rating(opponent)) > windowFor(group, nowMs, options)) continue;
      const candidate = {
        players: [caller, opponent].sort(compareQueueOrder),
        ratingGap: Math.abs(rating(caller) - rating(opponent)),
        oldestAt: Math.min(caller.enqueuedAtMs, opponent.enqueuedAtMs),
      };
      if (isBetter(candidate, best)) best = candidate;
    }
    if (!best) return null;
    return best.players.map((player, index) => ({ ...player, team: index as 0 | 1 }));
  }

  if (quota !== 4) return null;
  const scanEntries = entries.slice(0, options.candidateScanLimit);
  if (!scanEntries.some((entry) => entry.userId === caller.userId)) scanEntries.push(caller);
  const others = scanEntries.filter((entry) => entry.userId !== caller.userId);
  let best: CandidateMatch | null = null;
  const splits = [
    [
      [0, 1],
      [2, 3],
    ],
    [
      [0, 2],
      [1, 3],
    ],
    [
      [0, 3],
      [1, 2],
    ],
  ] as const;

  for (let i = 0; i < others.length - 2; i += 1) {
    for (let j = i + 1; j < others.length - 1; j += 1) {
      for (let k = j + 1; k < others.length; k += 1) {
        const group = [caller, others[i]!, others[j]!, others[k]!];
        const allowedWindow = windowFor(group, nowMs, options);
        for (const split of splits) {
          const teamZero = [group[split[0][0]]!, group[split[0][1]]!];
          const teamOne = [group[split[1][0]]!, group[split[1][1]]!];
          if (teamZero.some((player) => teamOne.some((rival) => isRestrictedPair(player, rival)))) {
            continue;
          }
          const ratingGap = Math.abs(
            (rating(teamZero[0]!) + rating(teamZero[1]!)) / 2 -
              (rating(teamOne[0]!) + rating(teamOne[1]!)) / 2,
          );
          if (ratingGap > allowedWindow) continue;

          const groupByUser = new Map<string, QueuedPlayerEntry>();
          for (const player of group) groupByUser.set(player.userId, player);
          const teamByUser = new Map<string, 0 | 1>();
          for (const player of teamZero) teamByUser.set(player.userId, 0);
          for (const player of teamOne) teamByUser.set(player.userId, 1);
          const selected = [...groupByUser.values()]
            .sort(compareQueueOrder)
            .map((player) => ({ ...player, team: teamByUser.get(player.userId)! }));
          const candidate = {
            players: selected,
            ratingGap,
            oldestAt: Math.min(...group.map((player) => player.enqueuedAtMs)),
          };
          if (isBetter(candidate, best)) best = candidate;
        }
      }
    }
  }

  return best?.players ?? null;
}
