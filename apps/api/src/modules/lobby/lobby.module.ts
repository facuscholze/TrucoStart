import {
  type DynamicModule,
  Inject,
  Injectable,
  Module,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { InMemoryMatchmakingStore } from '../matchmaking/store/in-memory-matchmaking-store.js';
import {
  MATCHMAKING_STORE,
  type MatchmakingStore,
} from '../matchmaking/store/matchmaking-store.interface.js';
import { RedisMatchmakingStore } from '../matchmaking/store/redis-matchmaking-store.js';
import {
  buildLobbyRuntimeConfigFromEnv,
  LOBBY_RUNTIME_CONFIG,
  type LobbyRuntimeConfig,
} from './lobby.config.js';
import { LobbyController } from './lobby.controller.js';
import { LobbyRepository } from './lobby.repository.js';
import { LobbyService } from './lobby.service.js';
import { LobbyRealtimeGateway } from './lobby-realtime.gateway.js';
import { MatchPersistenceService } from './match-persistence.service.js';
import {
  GAME_ROOM_PROVISIONER,
  type GameRoomProvisioner,
  HttpGameRoomProvisioner,
  InMemoryGameRoomProvisioner,
} from './ports/game-room-provisioner.js';
import {
  BullMqMatchLifecycleConsumer,
  MATCH_LIFECYCLE_CONSUMER,
  type MatchLifecycleConsumer,
  NoopMatchLifecycleConsumer,
} from './ports/match-lifecycle-consumer.js';

export interface LobbyModuleOptions {
  readonly runtimeConfig?: Partial<LobbyRuntimeConfig>;
  readonly gameRoomProvisioner?: GameRoomProvisioner;
  readonly matchLifecycleConsumer?: MatchLifecycleConsumer;
  readonly matchmakingStore?: MatchmakingStore;
  readonly redisUrl?: string;
}

@Injectable()
class MatchmakingStoreShutdownHook implements OnApplicationShutdown {
  constructor(@Inject(MATCHMAKING_STORE) private readonly store: MatchmakingStore) {}

  async onApplicationShutdown(): Promise<void> {
    await this.store.close();
  }
}

@Module({})
export class LobbyModule {
  static register(options: LobbyModuleOptions = {}): DynamicModule {
    const config = buildLobbyRuntimeConfigFromEnv(options.runtimeConfig);
    const effectiveRedisUrl = options.redisUrl ?? process.env['REDIS_URL'];

    return {
      module: LobbyModule,
      global: true,
      controllers: [LobbyController],
      providers: [
        { provide: LOBBY_RUNTIME_CONFIG, useValue: config },
        {
          provide: GAME_ROOM_PROVISIONER,
          useFactory: (): GameRoomProvisioner => {
            if (options.gameRoomProvisioner) return options.gameRoomProvisioner;
            if (config.gameServerInternalUrl) {
              return new HttpGameRoomProvisioner({
                baseUrl: config.gameServerInternalUrl,
                internalSecret: config.internalSecret,
              });
            }
            return new InMemoryGameRoomProvisioner();
          },
        },
        {
          provide: MATCH_LIFECYCLE_CONSUMER,
          useFactory: (): MatchLifecycleConsumer => {
            if (options.matchLifecycleConsumer) return options.matchLifecycleConsumer;
            if (effectiveRedisUrl) {
              return new BullMqMatchLifecycleConsumer(effectiveRedisUrl);
            }
            return new NoopMatchLifecycleConsumer();
          },
        },
        {
          provide: MATCHMAKING_STORE,
          useFactory: (): MatchmakingStore => {
            if (options.matchmakingStore) return options.matchmakingStore;
            if (effectiveRedisUrl) {
              return new RedisMatchmakingStore(effectiveRedisUrl);
            }
            return new InMemoryMatchmakingStore();
          },
        },
        MatchmakingStoreShutdownHook,
        LobbyRepository,
        LobbyRealtimeGateway,
        MatchPersistenceService,
        LobbyService,
      ],
      exports: [
        LOBBY_RUNTIME_CONFIG,
        GAME_ROOM_PROVISIONER,
        MATCH_LIFECYCLE_CONSUMER,
        MATCHMAKING_STORE,
        LobbyRepository,
        LobbyRealtimeGateway,
        MatchPersistenceService,
        LobbyService,
      ],
    };
  }
}
