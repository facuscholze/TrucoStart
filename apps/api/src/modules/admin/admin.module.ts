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

export interface AdminModuleOptions {
  readonly runtimeConfig?: AdminRuntimeConfigOverrides;
}

@Module({})
export class AdminModule {
  static register(options: AdminModuleOptions = {}): DynamicModule {
    return {
      module: AdminModule,
      controllers: [AdminAuthController, AdminController],
      providers: [
        { provide: ADMIN_RUNTIME_CONFIG, useValue: buildAdminRuntimeConfig(options.runtimeConfig) },
        AdminRepository,
        AdminAuthService,
        AdminService,
        AdminAuthGuard,
      ],
      exports: [AdminAuthService, AdminService, AdminRepository],
    };
  }
}
