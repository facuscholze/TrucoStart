import { Injectable } from '@nestjs/common';
import { DomainApiException } from '../../../common/api-exception.js';

export interface AuthRateLimitConfig {
  readonly windowMs: number;
  readonly maxPerIp: number;
  readonly maxPerAccount: number;
  readonly nowFn?: () => number;
}

export const AUTH_RATE_LIMIT_CONFIG = Symbol('AUTH_RATE_LIMIT_CONFIG');

@Injectable()
export class HttpAuthRateLimiter {
  private readonly buckets = new Map<string, number[]>();
  private readonly windowMs: number;
  private readonly maxPerIp: number;
  private readonly maxPerAccount: number;
  private readonly nowFn: () => number;

  constructor(config: AuthRateLimitConfig) {
    this.windowMs = config.windowMs;
    this.maxPerIp = config.maxPerIp;
    this.maxPerAccount = config.maxPerAccount;
    this.nowFn = config.nowFn ?? Date.now;
  }

  private consumeKey(
    key: string,
    limit: number,
    now: number,
  ): { allowed: true } | { allowed: false; retryAfterMs: number } {
    const cutoff = now - this.windowMs;
    const raw = this.buckets.get(key) ?? [];
    const active = raw.filter((ts) => ts > cutoff);
    if (active.length >= limit) {
      this.buckets.set(key, active);
      const oldest = active[0] ?? now;
      return { allowed: false, retryAfterMs: Math.max(100, oldest + this.windowMs - now) };
    }
    active.push(now);
    this.buckets.set(key, active);
    return { allowed: true };
  }

  enforce(params: {
    readonly endpointGroup: string;
    readonly ip: string;
    readonly accountKey?: string | null;
  }): void {
    const now = this.nowFn();
    const ipNormalized = params.ip.trim() || 'unknown';
    const ipResult = this.consumeKey(
      `${params.endpointGroup}:ip:${ipNormalized}`,
      this.maxPerIp,
      now,
    );
    if (!ipResult.allowed) {
      throw new DomainApiException(
        429,
        'RATE_LIMITED',
        'Demasiadas solicitudes desde esta dirección IP. Intentá nuevamente en unos instantes.',
        { scope: 'ip', retryAfterMs: ipResult.retryAfterMs },
      );
    }

    if (params.accountKey && params.accountKey.trim().length > 0) {
      const acctNormalized = params.accountKey.trim().toLowerCase();
      const acctResult = this.consumeKey(
        `${params.endpointGroup}:acct:${acctNormalized}`,
        this.maxPerAccount,
        now,
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
}
