import { Controller, Get, Inject, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import type { HealthResponse } from '@truco/shared';
import { HealthService } from './health.service.js';

@Controller()
export class HealthController {
  constructor(@Inject(HealthService) private readonly healthService: HealthService) {}

  @Get('health')
  health(@Req() request: FastifyRequest): HealthResponse {
    // `request.ip` es la IP resuelta por Fastify: sólo usa cabeceras de proxy si
    // el socket pertenece a TRUSTED_PROXY_CIDRS (ADR-020/022).
    return this.healthService.getLiveness(process.env['APP_NAME'], request.ip);
  }

  @Get('ready')
  async ready(): Promise<HealthResponse> {
    return this.healthService.getReadiness(process.env['APP_NAME']);
  }
}
