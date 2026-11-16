import { randomUUID } from 'node:crypto';
import {
  type DynamicModule,
  Global,
  Inject,
  Injectable,
  Module,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { InMemoryRateLimitStore } from './in-memory-rate-limit-store.js';
import { RATE_LIMIT_STORE, type RateLimitStore } from './rate-limit-store.interface.js';
import { RedisRateLimitStore } from './redis-rate-limit-store.js';

export interface RateLimitModuleOptions {
  readonly store?: RateLimitStore;
  readonly redisUrl?: string;
  readonly keyPrefix?: string;
  readonly nowFn?: () => number;
}

@Injectable()
class RateLimitStoreShutdownHook implements OnApplicationShutdown {
  constructor(@Inject(RATE_LIMIT_STORE) private readonly store: RateLimitStore) {}

  async onApplicationShutdown(): Promise<void> {
    await this.store.close();
  }
}

export function createAdaptiveRateLimitStore(options: RateLimitModuleOptions = {}): RateLimitStore {
  if (options.store) {
    return options.store;
  }
  const redisUrl = options.redisUrl ?? process.env['REDIS_URL'];
  const nowFn = options.nowFn ?? Date.now;
  if (redisUrl && redisUrl.trim().length > 0) {
    const defaultPrefix =
      process.env['VITEST'] || process.env['NODE_ENV'] === 'test'
        ? `truco:rl:test:${randomUUID().slice(0, 8)}:`
        : 'truco:rl:';
    return new RedisRateLimitStore(redisUrl, {
      keyPrefix: options.keyPrefix ?? defaultPrefix,
      nowFn,
    });
  }
  return new InMemoryRateLimitStore(nowFn);
}

@Global()
@Module({})
export class RateLimitModule {
  static register(options: RateLimitModuleOptions = {}): DynamicModule {
    const store = createAdaptiveRateLimitStore(options);
    return {
      module: RateLimitModule,
      global: true,
      providers: [{ provide: RATE_LIMIT_STORE, useValue: store }, RateLimitStoreShutdownHook],
      exports: [RATE_LIMIT_STORE],
    };
  }
}
