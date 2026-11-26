import { type DynamicModule, Module } from '@nestjs/common';
import {
  RateLimitModule,
  type RateLimitModuleOptions,
} from './common/rate-limit/rate-limit.module.js';
import { DatabaseModule } from './db/database.module.js';
import type { DatabaseConnectionHandle } from './db/database.provider.js';
import { AdminModule, type AdminModuleOptions } from './modules/admin/admin.module.js';
import { AuditModule } from './modules/audit/audit.module.js';
import { AuthModule, type AuthModuleOptions } from './modules/auth/auth.module.js';
import { HealthModule } from './modules/health/health.module.js';
import { LegalModule } from './modules/legal/legal.module.js';
import { LobbyModule, type LobbyModuleOptions } from './modules/lobby/lobby.module.js';
import { MatchmakingModule } from './modules/matchmaking/matchmaking.module.js';
import {
  ModerationModule,
  type ModerationModuleOptions,
} from './modules/moderation/moderation.module.js';
import {
  ObservabilityModule,
  type ObservabilityModuleOptions,
} from './modules/observability/observability.module.js';
import { OpenApiModule } from './modules/openapi/openapi.module.js';
import { RatingsModule, type RatingsModuleOptions } from './modules/ratings/ratings.module.js';
import { SocialModule } from './modules/social/social.module.js';
import {
  TournamentsModule,
  type TournamentsModuleOptions,
} from './modules/tournaments/tournaments.module.js';
import { UsersModule } from './modules/users/users.module.js';

export interface CreateAppModuleOptions {
  readonly dbHandle?: DatabaseConnectionHandle;
  readonly authOptions?: AuthModuleOptions;
  readonly rateLimitOptions?: RateLimitModuleOptions;
  readonly lobbyOptions?: LobbyModuleOptions;
  readonly moderationOptions?: ModerationModuleOptions;
  readonly adminOptions?: AdminModuleOptions;
  readonly ratingsOptions?: RatingsModuleOptions;
  readonly observabilityOptions?: ObservabilityModuleOptions;
  readonly tournamentsOptions?: TournamentsModuleOptions;
}

@Module({})
export class AppModule {
  static register(options: CreateAppModuleOptions = {}): DynamicModule {
    const dbImport = options.dbHandle
      ? DatabaseModule.registerFromHandle(options.dbHandle)
      : DatabaseModule.registerAsyncFromEnv(process.env['DATABASE_URL']);

    const sharedNowFn =
      options.rateLimitOptions?.nowFn ??
      options.lobbyOptions?.runtimeConfig?.nowFn ??
      options.authOptions?.rateLimitConfig?.nowFn ??
      options.authOptions?.runtimeConfig?.nowFn;

    const sharedSessionSecret =
      options.lobbyOptions?.runtimeConfig?.sessionSecret ??
      options.authOptions?.runtimeConfig?.sessionSecret;

    return {
      module: AppModule,
      imports: [
        dbImport,
        RateLimitModule.register({
          ...options.rateLimitOptions,
          ...(sharedNowFn !== undefined ? { nowFn: sharedNowFn } : {}),
        }),
        AuditModule,
        AuthModule.register(options.authOptions),
        UsersModule,
        RatingsModule.register({
          ...options.ratingsOptions,
          runtimeConfig: {
            ...options.ratingsOptions?.runtimeConfig,
            ...(sharedNowFn !== undefined &&
            options.ratingsOptions?.runtimeConfig?.nowFn === undefined
              ? { nowFn: sharedNowFn }
              : {}),
          },
        }),
        AdminModule.register({
          ...options.adminOptions,
          runtimeConfig: {
            ...options.adminOptions?.runtimeConfig,
            ...(sharedNowFn !== undefined ? { nowFn: sharedNowFn } : {}),
          },
        }),
        LobbyModule.register({
          ...options.lobbyOptions,
          runtimeConfig: {
            ...options.lobbyOptions?.runtimeConfig,
            ...(sharedNowFn !== undefined ? { nowFn: sharedNowFn } : {}),
            ...(sharedSessionSecret !== undefined ? { sessionSecret: sharedSessionSecret } : {}),
          },
        }),
        SocialModule,
        MatchmakingModule,
        TournamentsModule.register({
          ...options.tournamentsOptions,
          runtimeConfig: {
            ...options.tournamentsOptions?.runtimeConfig,
            ...(sharedNowFn !== undefined &&
            options.tournamentsOptions?.runtimeConfig?.nowFn === undefined
              ? { nowFn: sharedNowFn }
              : {}),
          },
        }),
        ModerationModule.register({
          ...options.moderationOptions,
          runtimeConfig: {
            ...options.moderationOptions?.runtimeConfig,
            ...(sharedNowFn !== undefined ? { nowFn: sharedNowFn } : {}),
            // El secreto interno explícito manda; si no, se reutiliza el de sesión.
            ...(options.moderationOptions?.runtimeConfig?.internalSecret === undefined &&
            sharedSessionSecret !== undefined
              ? { internalSecret: sharedSessionSecret }
              : {}),
          },
        }),
        ObservabilityModule.register(options.observabilityOptions),
        HealthModule,
        // Público y sin dependencias de sesión: la web lo consulta antes del alta.
        LegalModule,
        OpenApiModule,
      ],
    };
  }
}
