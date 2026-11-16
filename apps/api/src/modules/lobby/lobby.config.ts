import {
  AR_CORTO_15_FLOR_V1,
  AR_CORTO_15_V1,
  AR_SIN_FLOR_V1,
  AR_STANDARD_V1,
  type RuleSet,
  validateRuleSet,
} from '@truco/engine';
import {
  DEFAULT_ABANDONED_TABLE_TTL_MS,
  DEFAULT_MATCHMAKING_TIMEOUT_MS,
  DEFAULT_TABLE_IDLE_TTL_MS,
  DEFAULT_TABLE_INVITE_TTL_MS,
  DEFAULT_TURN_TIMEOUT_MS,
  type RulesetCode,
} from '@truco/shared';
import { DomainApiException } from '../../common/api-exception.js';

export const LOBBY_RUNTIME_CONFIG = Symbol('LOBBY_RUNTIME_CONFIG');

export interface LobbyRuntimeConfig {
  readonly sessionSecret: string;
  readonly internalSecret: string;
  readonly gameServerInternalUrl: string | null;
  readonly tableTtlMs: number;
  readonly abandonedTableTtlMs: number;
  readonly cleanupIntervalMs: number;
  readonly inviteTtlMs: number;
  readonly matchmakingTimeoutMs: number;
  readonly defaultTurnTimeoutMs: number;
  readonly joinCodeIpMax: number;
  readonly joinCodeAccountMax: number;
  readonly joinCodeWindowMs: number;
  readonly nowFn: () => number;
}

export function buildLobbyRuntimeConfigFromEnv(
  overrides: Partial<LobbyRuntimeConfig> = {},
): LobbyRuntimeConfig {
  const sessionSecret =
    overrides.sessionSecret ??
    process.env['SESSION_SECRET'] ??
    'dev-only-placeholder-secret-minimum-32-chars!!';
  const internalSecret =
    overrides.internalSecret ?? process.env['INTERNAL_RPC_SECRET'] ?? sessionSecret;

  return {
    sessionSecret,
    internalSecret,
    gameServerInternalUrl:
      overrides.gameServerInternalUrl !== undefined
        ? overrides.gameServerInternalUrl
        : (process.env['GAME_SERVER_INTERNAL_URL'] ?? null),
    tableTtlMs: overrides.tableTtlMs ?? DEFAULT_TABLE_IDLE_TTL_MS,
    abandonedTableTtlMs: overrides.abandonedTableTtlMs ?? DEFAULT_ABANDONED_TABLE_TTL_MS,
    cleanupIntervalMs: overrides.cleanupIntervalMs ?? 30_000,
    inviteTtlMs: overrides.inviteTtlMs ?? DEFAULT_TABLE_INVITE_TTL_MS,
    matchmakingTimeoutMs: overrides.matchmakingTimeoutMs ?? DEFAULT_MATCHMAKING_TIMEOUT_MS,
    defaultTurnTimeoutMs: overrides.defaultTurnTimeoutMs ?? DEFAULT_TURN_TIMEOUT_MS,
    joinCodeIpMax: overrides.joinCodeIpMax ?? 10,
    joinCodeAccountMax: overrides.joinCodeAccountMax ?? 8,
    joinCodeWindowMs: overrides.joinCodeWindowMs ?? 60_000,
    nowFn: overrides.nowFn ?? Date.now,
  };
}

const CANONICAL_RULESETS: Readonly<Record<RulesetCode, RuleSet>> = {
  'ar-standard-v1': AR_STANDARD_V1,
  'ar-sin-flor-v1': AR_SIN_FLOR_V1,
  'ar-corto-15-v1': AR_CORTO_15_V1,
  'ar-corto-15-flor-v1': AR_CORTO_15_FLOR_V1,
};

export function resolveRuleSetByCode(code: RulesetCode): RuleSet {
  const found = CANONICAL_RULESETS[code];
  const validation = validateRuleSet(found);
  if (!validation.ok) {
    throw new DomainApiException(
      400,
      'VALIDATION_ERROR',
      `RuleSet inválido: ${validation.error.message}`,
    );
  }
  return found;
}

export function resolveRuleSetSelection(input: {
  readonly rulesetCode?: RulesetCode | undefined;
  readonly targetScore?: 15 | 30 | undefined;
  readonly flor?: boolean | undefined;
}): RuleSet {
  if (input.rulesetCode) {
    const rs = resolveRuleSetByCode(input.rulesetCode);
    if (input.targetScore !== undefined && rs.targetScore !== input.targetScore) {
      throw new DomainApiException(
        400,
        'VALIDATION_ERROR',
        `El ruleset '${rs.code}' define ${rs.targetScore} puntos y no coincide con targetScore=${input.targetScore}.`,
      );
    }
    if (input.flor !== undefined && rs.flor.enabled !== input.flor) {
      throw new DomainApiException(
        400,
        'VALIDATION_ERROR',
        `El ruleset '${rs.code}' define flor=${rs.flor.enabled} y no coincide con flor=${input.flor}.`,
      );
    }
    return rs;
  }

  const pts = input.targetScore ?? 30;
  const flor = input.flor ?? pts === 30;
  if (pts === 30 && flor) return resolveRuleSetByCode('ar-standard-v1');
  if (pts === 30 && !flor) return resolveRuleSetByCode('ar-sin-flor-v1');
  if (pts === 15 && flor) return resolveRuleSetByCode('ar-corto-15-flor-v1');
  return resolveRuleSetByCode('ar-corto-15-v1');
}
