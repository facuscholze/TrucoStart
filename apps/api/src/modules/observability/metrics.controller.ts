import { timingSafeEqual } from 'node:crypto';
import { Controller, Get, Headers, Inject, Res } from '@nestjs/common';
import { isValidMetricsToken } from '@truco/shared';
import { DomainApiException } from '../../common/api-exception.js';
import type { FastifyReply } from 'fastify';
import {
  MetricsService,
  OBSERVABILITY_CONFIG,
  type ApiObservabilityConfig,
} from './metrics.service.js';

/**
 * `/v1/metrics` en formato Prometheus.
 *
 * Protegido con `Authorization: Bearer $METRICS_TOKEN`: sin token configurado el endpoint
 * responde 503 (falla cerrado) para que una exposición accidental no filtre topología.
 */
@Controller()
export class MetricsController {
  constructor(
    @Inject(MetricsService) private readonly metrics: MetricsService,
    @Inject(OBSERVABILITY_CONFIG) private readonly config: ApiObservabilityConfig,
  ) {}

  @Get('metrics')
  async scrape(
    @Headers('authorization') authorization: string | undefined,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<string> {
    const expected = this.config.metricsToken;
    if (!expected) {
      throw new DomainApiException(
        503,
        'INTERNAL_ERROR',
        'Métricas deshabilitadas: falta METRICS_TOKEN.',
        { reason: 'METRICS_NOT_CONFIGURED' },
      );
    }

    const provided = /^Bearer\s+(.+)$/i.exec(authorization ?? '')?.[1]?.trim() ?? '';
    if (!isValidMetricsToken(provided) || !safeEqual(provided, expected)) {
      throw new DomainApiException(401, 'UNAUTHORIZED', 'Token de métricas inválido.');
    }

    const body = await this.metrics.render();
    void reply.header('content-type', 'text/plain; version=0.0.4; charset=utf-8');
    void reply.header('cache-control', 'no-store');
    return body;
  }
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) {
    // Comparación de longitud constante aunque difieran los tamaños.
    timingSafeEqual(Buffer.alloc(32), Buffer.alloc(32));
    return false;
  }
  return timingSafeEqual(left, right);
}
