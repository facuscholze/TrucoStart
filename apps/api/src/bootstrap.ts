import 'reflect-metadata';
import fastifyCookie from '@fastify/cookie';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { API_V1_PREFIX } from '@truco/shared';
import { AppModule, type CreateAppModuleOptions } from './app.module.js';
import { ApiExceptionFilter } from './common/api-exception.filter.js';

export interface CreateApiAppOptions extends CreateAppModuleOptions {
  readonly trustProxy?: boolean;
  readonly corsOrigins?: string[];
}

export async function createApiApp(
  options: CreateApiAppOptions = {},
): Promise<NestFastifyApplication> {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule.register(options),
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
  return app;
}
