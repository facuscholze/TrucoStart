import { Controller, Get, Inject } from '@nestjs/common';
import type { HealthResponse } from '@truco/shared';
import { HealthService } from './health.service.js';

@Controller()
export class HealthController {
  constructor(@Inject(HealthService) private readonly healthService: HealthService) {}

  @Get('health')
  health(): HealthResponse {
    return this.healthService.getLiveness(process.env['APP_NAME']);
  }

  @Get('ready')
  ready(): HealthResponse {
    return this.healthService.getReadiness(process.env['APP_NAME']);
  }
}
