import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { Redis } from 'ioredis';

/** Consumo atómico de nonces para las RPC internas firmadas. */
export interface InternalNonceStore {
  /** `true` si el nonce no se había usado; `false` si es un replay. */
  consume(nonce: string, ttlMs: number): Promise<boolean>;
  close?(): Promise<void>;
}

export class InMemoryInternalNonceStore implements InternalNonceStore {
  private readonly seen = new Map<string, number>();

  constructor(private readonly nowFn: () => number = Date.now) {}

  async consume(nonce: string, ttlMs: number): Promise<boolean> {
    const now = this.nowFn();
    const existingExpiry = this.seen.get(nonce);
    if (existingExpiry !== undefined && existingExpiry > now) return false;
    // Poda oportunista para no crecer sin límite.
    if (this.seen.size > 5_000) {
      for (const [key, expiry] of this.seen) {
        if (expiry <= now) this.seen.delete(key);
      }
    }
    this.seen.set(nonce, now + Math.max(1_000, ttlMs));
    return true;
  }
}

/** Implementación Redis (`SET NX PX`), obligatoria con más de una instancia de API. */
export class RedisInternalNonceStore implements InternalNonceStore {
  private readonly redis: Redis;

  constructor(
    redisUrl: string,
    private readonly prefix = 'truco:internal_rpc:nonce:',
  ) {
    this.redis = new Redis(redisUrl, { maxRetriesPerRequest: 2, lazyConnect: false });
  }

  async consume(nonce: string, ttlMs: number): Promise<boolean> {
    const result = await this.redis.set(
      `${this.prefix}${nonce}`,
      '1',
      'PX',
      Math.max(1_000, ttlMs),
      'NX',
    );
    return result === 'OK';
  }

  async close(): Promise<void> {
    await this.redis.quit();
  }
}

@Injectable()
export class InternalNonceStoreService implements InternalNonceStore, OnModuleDestroy {
  private readonly store: InternalNonceStore;

  constructor() {
    const redisUrl = process.env['REDIS_URL'];
    this.store =
      redisUrl && redisUrl.length > 0
        ? new RedisInternalNonceStore(redisUrl)
        : new InMemoryInternalNonceStore();
  }

  consume(nonce: string, ttlMs: number): Promise<boolean> {
    return this.store.consume(nonce, ttlMs);
  }

  async onModuleDestroy(): Promise<void> {
    await this.store.close?.();
  }
}
