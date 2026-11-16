import { Injectable } from '@nestjs/common';
import { LOCKOUT_DURATIONS_MS, LOCKOUT_THRESHOLD_ATTEMPTS } from '@truco/shared';
import { DomainApiException } from '../../../common/api-exception.js';
import { InMemoryRateLimitStore } from '../../../common/rate-limit/in-memory-rate-limit-store.js';
import type {
  ProgressiveLockoutState,
  RateLimitStore,
} from '../../../common/rate-limit/rate-limit-store.interface.js';

export interface AuthRateLimitConfig {
  readonly windowMs: number;
  readonly maxPerIp: number;
  readonly maxPerAccount: number;
  readonly nowFn?: () => number;
}

export const AUTH_RATE_LIMIT_CONFIG = Symbol('AUTH_RATE_LIMIT_CONFIG');

function normalizeIp(ip: string): string {
  return ip.trim() || 'unknown';
}

function normalizeAccount(accountKey: string): string {
  return accountKey.trim().toLowerCase();
}

@Injectable()
export class HttpAuthRateLimiter {
  private readonly store: RateLimitStore;
  private readonly windowMs: number;
  private readonly maxPerIp: number;
  private readonly maxPerAccount: number;

  constructor(config: AuthRateLimitConfig, store?: RateLimitStore) {
    this.windowMs = config.windowMs;
    this.maxPerIp = config.maxPerIp;
    this.maxPerAccount = config.maxPerAccount;
    this.store = store ?? new InMemoryRateLimitStore(config.nowFn ?? Date.now);
  }

  async enforce(params: {
    readonly endpointGroup: string;
    readonly ip: string;
    readonly accountKey?: string | null;
    readonly accountIpKey?: string | null;
  }): Promise<void> {
    const ipNormalized = normalizeIp(params.ip);
    const ipResult = await this.store.consumeWindow(
      `${params.endpointGroup}:ip:${ipNormalized}`,
      this.maxPerIp,
      this.windowMs,
    );
    if (!ipResult.allowed) {
      throw new DomainApiException(
        429,
        'RATE_LIMITED',
        'Demasiadas solicitudes desde esta dirección IP. Intentá nuevamente en unos instantes.',
        { scope: 'ip', retryAfterMs: ipResult.retryAfterMs },
      );
    }

    if (params.accountIpKey && params.accountIpKey.trim().length > 0) {
      const acctNormalized = normalizeAccount(params.accountIpKey);
      const acctIpResult = await this.store.consumeWindow(
        `${params.endpointGroup}:acct_ip:${acctNormalized}:${ipNormalized}`,
        this.maxPerAccount,
        this.windowMs,
      );
      if (!acctIpResult.allowed) {
        throw new DomainApiException(
          429,
          'RATE_LIMITED',
          'Demasiadas solicitudes para esta cuenta desde tu conexión. Esperá antes de reintentar.',
          { scope: 'account_ip', retryAfterMs: acctIpResult.retryAfterMs },
        );
      }
    }

    if (params.accountKey && params.accountKey.trim().length > 0) {
      const acctNormalized = normalizeAccount(params.accountKey);
      const acctResult = await this.store.consumeWindow(
        `${params.endpointGroup}:acct:${acctNormalized}`,
        this.maxPerAccount,
        this.windowMs,
      );
      if (!acctResult.allowed) {
        throw new DomainApiException(
          429,
          'RATE_LIMITED',
          'Demasiadas solicitudes para esta cuenta. Esperá antes de reintentar.',
          { scope: 'account', retryAfterMs: acctResult.retryAfterMs },
        );
      }
    }
  }

  private loginLockoutKey(emailLower: string, ip: string): string {
    return `auth:login:lock:${normalizeAccount(emailLower)}:${normalizeIp(ip)}`;
  }

  private loginAccountFailureKey(emailLower: string): string {
    return `auth:login:acct_failures:${normalizeAccount(emailLower)}`;
  }

  async getLoginLockoutState(emailLower: string, ip: string): Promise<ProgressiveLockoutState> {
    return this.store.getLockoutState(this.loginLockoutKey(emailLower, ip));
  }

  async getAccountLoginFailures(emailLower: string, failureWindowMs: number): Promise<number> {
    return this.store.getFailureCounter(this.loginAccountFailureKey(emailLower), failureWindowMs);
  }

  async recordLoginFailure(
    emailLower: string,
    ip: string,
    nowMs: number,
    failureWindowMs: number,
  ): Promise<{ lockout: ProgressiveLockoutState; accountFailures: number }> {
    const computeLockedUntilMs = (nextFailedCount: number): number | null => {
      if (nextFailedCount < LOCKOUT_THRESHOLD_ATTEMPTS) return null;
      const tierIdx = Math.min(
        nextFailedCount - LOCKOUT_THRESHOLD_ATTEMPTS,
        LOCKOUT_DURATIONS_MS.length - 1,
      );
      return nowMs + LOCKOUT_DURATIONS_MS[tierIdx]!;
    };

    const maxDurationMs = LOCKOUT_DURATIONS_MS[LOCKOUT_DURATIONS_MS.length - 1] ?? 3_600_000;
    const stateTtlMs = Math.max(failureWindowMs, maxDurationMs);

    const lockout = await this.store.recordLockoutFailure(
      this.loginLockoutKey(emailLower, ip),
      computeLockedUntilMs,
      stateTtlMs,
    );
    const accountFailures = await this.store.incrementFailureCounter(
      this.loginAccountFailureKey(emailLower),
      failureWindowMs,
    );
    return { lockout, accountFailures };
  }

  async clearLoginFailuresOnSuccess(emailLower: string, ip: string): Promise<void> {
    await this.store.clearLockoutState(this.loginLockoutKey(emailLower, ip));
    await this.store.clearFailureCounter(this.loginAccountFailureKey(emailLower));
  }
}
