import { type DynamicModule, Module } from '@nestjs/common';
import {
  RateLimitModule,
  type RateLimitModuleOptions,
} from './common/rate-limit/rate-limit.module.js';
import { DatabaseModule } from './db/database.module.js';
import type { DatabaseConnectionHandle } from './db/database.provider.js';
import { AuditModule } from './modules/audit/audit.module.js';
import { AuthModule, type AuthModuleOptions } from './modules/auth/auth.module.js';
import { HealthModule } from './modules/health/health.module.js';
import { OpenApiModule } from './modules/openapi/openapi.module.js';
import { UsersModule } from './modules/users/users.module.js';

export interface CreateAppModuleOptions {
  readonly dbHandle?: DatabaseConnectionHandle;
  readonly authOptions?: AuthModuleOptions;
  readonly rateLimitOptions?: RateLimitModuleOptions;
}

// TODO(STATE-04): Incorporar LobbyModule en M4.
// TODO(STATE-07): Incorporar ModerationModule y AdminModule en M7.
// TODO(STATE-08): Incorporar MetricsModule (/v1/metrics) y trazas OpenTelemetry en M8.
@Module({})
export class AppModule {
  static register(options: CreateAppModuleOptions = {}): DynamicModule {
    const dbImport = options.dbHandle
      ? DatabaseModule.registerFromHandle(options.dbHandle)
      : DatabaseModule.registerAsyncFromEnv(process.env['DATABASE_URL']);

    const sharedNowFn =
      options.rateLimitOptions?.nowFn ??
      options.authOptions?.rateLimitConfig?.nowFn ??
      options.authOptions?.runtimeConfig?.nowFn;

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
        HealthModule,
        OpenApiModule,
      ],
    };
  }
}
