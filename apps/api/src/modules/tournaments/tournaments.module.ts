import { type DynamicModule, Module } from '@nestjs/common';
import { ADMIN_RUNTIME_CONFIG, buildAdminRuntimeConfig } from '../admin/admin.config.js';
import { AdminAuthService } from '../admin/admin-auth.service.js';
import { AdminRepository } from '../admin/admin.repository.js';
import { PasswordHasher } from '../auth/security/password-hasher.js';
import { AuditModule } from '../audit/audit.module.js';
import { LobbyModule } from '../lobby/lobby.module.js';
import { AdminTournamentsController } from './admin-tournaments.controller.js';
import { TournamentsController } from './tournaments.controller.js';
import {
  buildTournamentsRuntimeConfig,
  TOURNAMENTS_RUNTIME_CONFIG,
  type TournamentsRuntimeConfig,
} from './tournaments.config.js';
import { TournamentsRepository } from './tournaments.repository.js';
import { TournamentsService } from './tournaments.service.js';

export interface TournamentsModuleOptions {
  readonly runtimeConfig?: Partial<TournamentsRuntimeConfig>;
}

/**
 * Módulo de torneos (M10a).
 *
 * Depende del lobby porque **reutiliza** su aprovisionamiento de salas y su repositorio
 * de RuleSets; no lo duplica. Las notificaciones van por el gateway del lobby, que ya
 * conoce el namespace `/lobby` y el canal por usuario de M9a.
 *
 * Las piezas del panel (configuración, guard, servicio de sesión admin) se proveen acá
 * de forma explícita en vez de importar `AdminModule`: importarlo registraría otra vez
 * sus controladores y Fastify rechazaría las rutas duplicadas del panel.
 */
@Module({})
export class TournamentsModule {
  static register(options: TournamentsModuleOptions = {}): DynamicModule {
    const config = buildTournamentsRuntimeConfig(options.runtimeConfig);
    return {
      module: TournamentsModule,
      imports: [LobbyModule, AuditModule],
      controllers: [TournamentsController, AdminTournamentsController],
      providers: [
        { provide: TOURNAMENTS_RUNTIME_CONFIG, useValue: config },
        // El controlador administrativo de torneos corre en este módulo, así que
        // `AdminAuthGuard` necesita acá su servicio, su repositorio y su configuración.
        // No se importa `AdminModule`: eso volvería a registrar sus controladores y
        // Fastify rechazaría las rutas del panel por duplicadas.
        { provide: ADMIN_RUNTIME_CONFIG, useValue: buildAdminRuntimeConfig({}) },
        AdminRepository,
        PasswordHasher,
        AdminAuthService,
        TournamentsRepository,
        TournamentsService,
      ],
      exports: [TournamentsService, TournamentsRepository, TOURNAMENTS_RUNTIME_CONFIG],
    };
  }
}
