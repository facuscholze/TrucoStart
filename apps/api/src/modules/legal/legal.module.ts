import { Module } from '@nestjs/common';
import { LegalController } from './legal.controller.js';
import { buildLegalRuntimeConfig, LEGAL_RUNTIME_CONFIG } from './legal.config.js';
import { LegalService } from './legal.service.js';

/**
 * Módulo estático a propósito: `AuthModule` y `AppModule` lo importan y Nest
 * deduplica el módulo por referencia, así el controlador no se registra dos
 * veces (lo que hacía fallar el arranque con "route already declared").
 *
 * La edad mínima se lee del entorno en tiempo de arranque. Para tests, se puede
 * instanciar `LegalService` directamente con un config explícito.
 */
@Module({
  controllers: [LegalController],
  providers: [
    { provide: LEGAL_RUNTIME_CONFIG, useFactory: () => buildLegalRuntimeConfig() },
    LegalService,
  ],
  exports: [LegalService, LEGAL_RUNTIME_CONFIG],
})
export class LegalModule {}
