import { type DynamicModule, Module } from '@nestjs/common';
import { ModerationController } from './moderation.controller.js';
import { ModerationRepository } from './moderation.repository.js';
import {
  DEFAULT_MODERATION_CONFIG,
  MODERATION_RUNTIME_CONFIG,
  ModerationService,
  type ModerationRuntimeConfig,
} from './moderation.service.js';

export interface ModerationModuleOptions {
  readonly runtimeConfig?: Partial<Omit<ModerationRuntimeConfig, 'nowFn'>> & {
    readonly nowFn?: () => number;
  };
}

@Module({})
export class ModerationModule {
  static register(options: ModerationModuleOptions = {}): DynamicModule {
    const nowFn = options.runtimeConfig?.nowFn ?? Date.now;
    const config: ModerationRuntimeConfig = {
      nowFn,
      maxOpenReportsPerReporter:
        options.runtimeConfig?.maxOpenReportsPerReporter ??
        DEFAULT_MODERATION_CONFIG.maxOpenReportsPerReporter,
      reportsPerWindow:
        options.runtimeConfig?.reportsPerWindow ?? DEFAULT_MODERATION_CONFIG.reportsPerWindow,
      rateLimitWindowMs:
        options.runtimeConfig?.rateLimitWindowMs ?? DEFAULT_MODERATION_CONFIG.rateLimitWindowMs,
    };

    return {
      module: ModerationModule,
      controllers: [ModerationController],
      providers: [
        ModerationRepository,
        ModerationService,
        { provide: MODERATION_RUNTIME_CONFIG, useValue: config },
      ],
      exports: [ModerationService, ModerationRepository],
    };
  }
}
