import { type DynamicModule, Module } from '@nestjs/common';
import { ADMIN_RUNTIME_CONFIG, buildAdminRuntimeConfig } from '../admin/admin.config.js';
import { AdminAuthService } from '../admin/admin-auth.service.js';
import { AdminRepository } from '../admin/admin.repository.js';
import { PasswordHasher } from '../auth/security/password-hasher.js';
import { AuditModule } from '../audit/audit.module.js';
import { LobbyModule } from '../lobby/lobby.module.js';
import { AdminLeaguesController } from './admin-leagues.controller.js';
import { LeaguesController } from './leagues.controller.js';
import {
  buildLeaguesRuntimeConfig,
  LEAGUES_RUNTIME_CONFIG,
  type LeaguesRuntimeConfig,
} from './leagues.config.js';
import { LeaguesRepository } from './leagues.repository.js';
import { LeaguesService } from './leagues.service.js';

export interface LeaguesModuleOptions {
  readonly runtimeConfig?: Partial<LeaguesRuntimeConfig>;
}

/**
 * Módulo de ligas (M10b, entrega 2).
 *
 * Depende del lobby por la misma razón que torneos: **reutiliza** su aprovisionamiento de salas,
 * su repositorio de RuleSets y su gateway de notificaciones de M9a; no abre un camino paralelo.
 *
 * Las piezas del panel se proveen explícitamente en vez de importar `AdminModule`: importarlo
 * registraría otra vez sus controladores y Fastify rechazaría las rutas duplicadas.
 */
@Module({})
export class LeaguesModule {
  static register(options: LeaguesModuleOptions = {}): DynamicModule {
    const config = buildLeaguesRuntimeConfig(options.runtimeConfig);
    return {
      module: LeaguesModule,
      imports: [LobbyModule, AuditModule],
      controllers: [LeaguesController, AdminLeaguesController],
      providers: [
        { provide: LEAGUES_RUNTIME_CONFIG, useValue: config },
        { provide: ADMIN_RUNTIME_CONFIG, useValue: buildAdminRuntimeConfig({}) },
        AdminRepository,
        PasswordHasher,
        AdminAuthService,
        LeaguesRepository,
        LeaguesService,
      ],
      exports: [LeaguesService, LeaguesRepository, LEAGUES_RUNTIME_CONFIG],
    };
  }
}
