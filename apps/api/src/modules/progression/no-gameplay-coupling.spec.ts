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
const coinWalletRouteScope = /\b(?:wallet|coins?|virtual[_-]?coins?|currency|currencies)\b/i;
const progressionRouteScope = /\bprogression\b/i;
const walletValueActions =
  /\b(?:transfer|send|gift|convert|exchange|cash|cash[-_]?out|withdraw|deposit|payout|purchase|buy|sell|money|fiat)\b/i;
const coinRedeemAction = /\bredeem\b/i;
const forbiddenCoinOperationSymbol =
  /\b(?:transfer|send|gift|convert|exchange|cashOut|withdraw|deposit|payout|purchase|buy|sell|redeem)(?:Virtual)?(?:Coins?|Wallet|Currency)(?:To|For)?(?:Money|Cash|Fiat)?\b|\b(?:Virtual)?(?:Coins?|Wallet|Currency)(?:Transfer|Send|Gift|Convert|Exchange|CashOut|Withdraw|Deposit|Payout|Purchase|Buy|Sell|Redeem)\b/i;

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

function forbiddenCoinOperations(): string[] {
  return sourceFiles(path.join(repoRoot, 'apps/api/src/modules')).flatMap((file) => {
    const source = readFileSync(file, 'utf8');
    const controllerPath = source.match(/@Controller\s*\(\s*['"`]([^'"`]+)['"`]\s*\)/)?.[1] ?? '';
    const writeRoutes = [
      ...source.matchAll(/@(Post|Patch|Put|Delete)\s*\(\s*['"`]([^'"`]+)['"`]\s*\)/g),
    ];
    const findings = writeRoutes.flatMap(([, method, segment]) => {
      const route = `${controllerPath}/${segment}`.replace(/\/+/g, '/');
      const hasWalletScope = coinWalletRouteScope.test(route);
      const hasProgressionScope = progressionRouteScope.test(route);
      const forbiddenAction =
        walletValueActions.test(route) && (hasWalletScope || hasProgressionScope);
      const coinRedemption = hasWalletScope && coinRedeemAction.test(route);
      return forbiddenAction || coinRedemption
        ? [`${path.relative(repoRoot, file)}: @${method} ${route}`]
        : [];
    });
    if (forbiddenCoinOperationSymbol.test(source)) {
      findings.push(`${path.relative(repoRoot, file)}: coin transfer/value-conversion operation`);
    }
    return findings;
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

  it('exposes no coin-transfer or conversion-to-economic-value operation', () => {
    expect(forbiddenCoinOperations()).toEqual([]);
  });
});
