import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { API_V1_PREFIX } from '@truco/shared';
import { AppModule } from './app.module.js';

export async function createApiApp(): Promise<NestFastifyApplication> {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ logger: false }),
    { logger: false },
  );

  app.setGlobalPrefix(API_V1_PREFIX);
  return app;
}
