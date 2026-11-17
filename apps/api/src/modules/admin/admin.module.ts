import { type DynamicModule, Module } from '@nestjs/common';
import { AdminAuthController } from './admin-auth.controller.js';
import { AdminAuthService } from './admin-auth.service.js';
import { AdminController } from './admin.controller.js';
import { AdminRepository } from './admin.repository.js';
import { AdminService } from './admin.service.js';
import {
  ADMIN_RUNTIME_CONFIG,
  type AdminRuntimeConfigOverrides,
  buildAdminRuntimeConfig,
} from './admin.config.js';
import { AdminAuthGuard } from './guards/admin-auth.guard.js';
import {
  HttpUserEvictionClient,
  USER_EVICTION,
  type UserEvictionPort,
} from './ports/user-eviction.js';

export interface AdminModuleOptions {
  readonly runtimeConfig?: AdminRuntimeConfigOverrides;
  /** Permite inyectar un doble de prueba en lugar del cliente HTTP real. */
  readonly userEviction?: UserEvictionPort;
  readonly gameServerInternalUrl?: string;
  readonly internalSecret?: string;
}

@Module({})
export class AdminModule {
  static register(options: AdminModuleOptions = {}): DynamicModule {
    return {
      module: AdminModule,
      controllers: [AdminAuthController, AdminController],
      providers: [
        { provide: ADMIN_RUNTIME_CONFIG, useValue: buildAdminRuntimeConfig(options.runtimeConfig) },
        {
          provide: USER_EVICTION,
          useValue:
            options.userEviction ??
            new HttpUserEvictionClient({
              baseUrl:
                options.gameServerInternalUrl ??
                process.env['GAME_SERVER_INTERNAL_URL'] ??
                'http://127.0.0.1:3002',
              internalSecret:
                options.internalSecret ??
                process.env['INTERNAL_RPC_SECRET'] ??
                process.env['SESSION_SECRET'] ??
                '',
            }),
        },
        AdminRepository,
        AdminAuthService,
        AdminService,
        AdminAuthGuard,
      ],
      exports: [AdminAuthService, AdminService, AdminRepository],
    };
  }
}
