import 'reflect-metadata';
import fastifyCookie from '@fastify/cookie';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import {
  API_V1_PREFIX,
  apiSecurityHeaders,
  buildRequestLogFields,
  CORRELATION_ID_HEADER,
  createCorrelationId,
  MetricsRegistry,
  pickCorrelationId,
} from '@truco/shared';
import { AppModule, type CreateAppModuleOptions } from './app.module.js';
import { ApiExceptionFilter } from './common/api-exception.filter.js';
import type {
  ApiLoggerLike,
  ObservabilityModuleOptions,
} from './modules/observability/observability.module.js';

export interface CreateApiAppOptions extends CreateAppModuleOptions {
  readonly trustProxy?: boolean;
  readonly corsOrigins?: string[];
  /** Logger estructurado (pino). Sin logger no se emiten líneas de request. */
  readonly logger?: ApiLoggerLike;
  /** Registro de métricas compartido con `/v1/metrics`. */
  readonly metricsRegistry?: MetricsRegistry;
  readonly observability?: Omit<ObservabilityModuleOptions, 'logger' | 'registry'>;
}

/**
 * Etiqueta de ruta con cardinalidad acotada: sin query string, sin prefijo `/v1` y con
 * ids reemplazados por `:id` para que un atacante no infle las series de Prometheus.
 */
function routeLabel(url: string | undefined): string {
  const path = (url ?? '/').split('?')[0] ?? '/';
  const withoutPrefix = path.startsWith(API_V1_PREFIX) ? path.slice(API_V1_PREFIX.length) : path;
  const normalized = (withoutPrefix || '/')
    .replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '/:id')
    .replace(/\/\d{4,}/g, '/:n');
  return normalized.startsWith('/') ? normalized : `/${normalized}`;
}

export async function createApiApp(
  options: CreateApiAppOptions = {},
): Promise<NestFastifyApplication> {
  // Un único registro compartido entre el módulo (`/v1/metrics`) y los hooks de Fastify.
  const registry = options.metricsRegistry ?? new MetricsRegistry();

  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule.register({
      ...options,
      observabilityOptions: {
        ...options.observability,
        ...(options.logger ? { logger: options.logger } : {}),
        registry,
      },
    }),
    new FastifyAdapter({
      logger: false,
      trustProxy: options.trustProxy ?? false,
    }),
    { logger: false },
  );

  // Fastify plugin registration para parseo/serialización de cookies HttpOnly
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await app.register(fastifyCookie as any);

  if (options.corsOrigins && options.corsOrigins.length > 0) {
    app.enableCors({
      origin: options.corsOrigins,
      credentials: true,
    });
  }

  app.useGlobalFilters(new ApiExceptionFilter());
  app.setGlobalPrefix(API_V1_PREFIX);
  app.enableShutdownHooks();

  registerObservabilityHooks(app, { ...options, metricsRegistry: registry });
  return app;
}

function registerObservabilityHooks(
  app: NestFastifyApplication,
  options: CreateApiAppOptions,
): void {
  const registry = options.metricsRegistry ?? new MetricsRegistry();
  const logger = options.logger;
  const securityHeaders = apiSecurityHeaders({
    production: process.env['NODE_ENV'] === 'production',
  });

  const fastify = app.getHttpAdapter().getInstance();
  const startedAt = new WeakMap<object, number>();

  fastify.addHook('onRequest', async (request, reply) => {
    const correlationId = pickCorrelationId(request.headers[CORRELATION_ID_HEADER], () =>
      createCorrelationId(),
    );
    (request as unknown as { correlationId: string }).correlationId = correlationId;
    startedAt.set(request as unknown as object, Date.now());
    void reply.header(CORRELATION_ID_HEADER, correlationId);
  });

  fastify.addHook('onSend', async (_request, reply, payload) => {
    for (const [name, value] of Object.entries(securityHeaders)) {
      void reply.header(name, value);
    }
    return payload;
  });

  fastify.addHook('onResponse', async (request, reply) => {
    const requestCast = request as unknown as {
      correlationId?: string;
      routeOptions?: { url?: string };
    };
    const route = routeLabel(requestCast.routeOptions?.url ?? request.url);
    const status = String(reply.statusCode);
    const durationMs = Date.now() - (startedAt.get(request as unknown as object) ?? Date.now());

    registry.increment('truco_http_requests_total', {
      method: request.method,
      route,
      status,
    });
    registry.observe('truco_http_request_duration_seconds', Math.max(durationMs, 0) / 1000, {
      method: request.method,
      route,
    });

    logger?.info(
      buildRequestLogFields({
        service: 'api',
        correlationId: requestCast.correlationId ?? 'sin-correlacion',
        method: request.method,
        // Sólo el patrón de ruta: evita ids reales y query strings en las métricas.
        path: route,
        status: reply.statusCode,
        durationMs,
      }),
      'http_request',
    );
  });

  fastify.addHook('onError', async (request, reply, error) => {
    const requestCast = request as unknown as {
      correlationId?: string;
      routeOptions?: { url?: string };
    };
    const route = routeLabel(requestCast.routeOptions?.url ?? request.url);
    const status = String(reply.statusCode >= 400 ? reply.statusCode : 500);
    registry.increment('truco_http_errors_total', { error_code: error.code ?? 'UNKNOWN' });
    registry.increment('truco_http_requests_total', {
      method: request.method,
      route,
      status,
    });
    logger?.error(
      {
        service: 'api',
        correlationId: requestCast.correlationId ?? 'sin-correlacion',
        method: request.method,
        path: route,
        status: reply.statusCode,
        errorCode: error.code ?? 'UNKNOWN',
        // Sólo el nombre del error: el mensaje puede arrastrar datos del request.
        errorName: error.name,
      },
      'http_error',
    );
  });
}
