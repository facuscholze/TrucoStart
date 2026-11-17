import { type DynamicModule, Module } from '@nestjs/common';
import { MetricsRegistry } from '@truco/shared';
import { MetricsController } from './metrics.controller.js';
import {
  METRICS,
  MetricsService,
  OBSERVABILITY_CONFIG,
  REQUEST_LOGGER,
  type ApiLoggerLike,
  type ApiObservabilityConfig,
} from './metrics.service.js';

export type { ApiLoggerLike, ApiObservabilityConfig } from './metrics.service.js';

export interface ObservabilityModuleOptions {
  readonly config?: Partial<ApiObservabilityConfig>;
  readonly logger?: ApiLoggerLike;
  /** Registro compartido con los hooks de Fastify (mismas series). */
  readonly registry?: MetricsRegistry;
}

const NOOP_LOGGER: ApiLoggerLike = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

/**
 * Módulo global de observabilidad: expone `/v1/metrics` y comparte el mismo
 * `MetricsRegistry` que instrumenta el bootstrap HTTP de Fastify.
 */
@Module({})
export class ObservabilityModule {
  static register(options: ObservabilityModuleOptions = {}): DynamicModule {
    const config: ApiObservabilityConfig = {
      metricsToken: options.config?.metricsToken ?? null,
      gameServerInternalUrl: options.config?.gameServerInternalUrl ?? null,
      internalSecret: options.config?.internalSecret ?? null,
    };

    return {
      module: ObservabilityModule,
      global: true,
      controllers: [MetricsController],
      providers: [
        { provide: OBSERVABILITY_CONFIG, useValue: config },
        { provide: METRICS, useValue: options.registry ?? new MetricsRegistry() },
        { provide: REQUEST_LOGGER, useValue: options.logger ?? NOOP_LOGGER },
        MetricsService,
      ],
      exports: [METRICS, OBSERVABILITY_CONFIG, REQUEST_LOGGER, MetricsService],
    };
  }
}
