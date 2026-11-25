import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../..');
const gameplayRoots = [
  'apps/api/src/modules/matchmaking',
  'apps/api/src/modules/ratings',
  'apps/game-server/src',
  'packages/truco-engine/src',
];
const forbiddenProgressionReads =
  /\b(?:profilesTable\.(?:level|xp)|profiles\.(?:level|xp)|progressionConfigTable|progressionXpEntriesTable|walletAccountsTable|walletTransactionsTable|cosmeticCatalogTable|userCosmeticsTable|progression_config|progression_xp_entries|wallet_accounts|wallet_transactions|cosmetic_catalog|user_cosmetics)\b/;

function sourceFiles(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(root, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'tests' || entry.name === '__tests__') return [];
      return sourceFiles(absolute);
    }
    if (!entry.isFile() || !entry.name.endsWith('.ts') || entry.name.endsWith('.spec.ts'))
      return [];
    return [absolute];
  });
}

describe('M9c — progression has no gameplay or competitive advantage', () => {
  it('rules, matchmaking and rating never read level, XP, coins or cosmetic ownership', () => {
    const findings = gameplayRoots.flatMap((relativeRoot) =>
      sourceFiles(path.join(repoRoot, relativeRoot)).flatMap((file) => {
        const lines = readFileSync(file, 'utf8').split('\n');
        return lines.flatMap((line, index) =>
          forbiddenProgressionReads.test(line)
            ? [`${path.relative(repoRoot, file)}:${index + 1}: ${line.trim()}`]
            : [],
        );
      }),
    );
    expect(findings).toEqual([]);
  });
});
