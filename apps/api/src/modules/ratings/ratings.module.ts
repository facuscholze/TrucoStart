import { type DynamicModule, Module } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { UsersModule } from '../users/users.module.js';
import { InMemoryLeaderboardStore } from './in-memory-leaderboard-store.js';
import { LEADERBOARD_STORE, type LeaderboardStore } from './leaderboard-store.interface.js';
import { RatingsController } from './ratings.controller.js';
import {
  RATING_RUNTIME_CONFIG,
  buildRatingRuntimeConfig,
  type RatingRuntimeConfig,
} from './ratings.config.js';
import { RatingsService } from './ratings.service.js';
import { RedisLeaderboardStore } from './redis-leaderboard-store.js';

export interface RatingsModuleOptions {
  readonly runtimeConfig?: Partial<RatingRuntimeConfig>;
}

@Module({})
export class RatingsModule {
  static register(options: RatingsModuleOptions = {}): DynamicModule {
    const config = buildRatingRuntimeConfig(options.runtimeConfig);
    return {
      module: RatingsModule,
      global: true,
      imports: [UsersModule],
      controllers: [RatingsController],
      providers: [
        { provide: RATING_RUNTIME_CONFIG, useValue: config },
        {
          provide: LEADERBOARD_STORE,
          useFactory: (): LeaderboardStore => {
            if (config.redisUrl) {
              const keyPrefix =
                process.env['NODE_ENV'] === 'test'
                  ? `truco:ratings:test:${process.pid}:${randomUUID()}:`
                  : 'truco:ratings:';
              return new RedisLeaderboardStore(config.redisUrl, { keyPrefix });
            }
            return new InMemoryLeaderboardStore();
          },
        },
        RatingsService,
      ],
      exports: [RATING_RUNTIME_CONFIG, LEADERBOARD_STORE, RatingsService],
    };
  }
}
