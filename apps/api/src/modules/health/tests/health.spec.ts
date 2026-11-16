import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { HealthResponseSchema } from '@truco/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApiApp } from '../../../bootstrap.js';

describe('API HealthModule (/v1/health & /v1/ready)', () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    app = await createApiApp();
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /v1/health returns validated HealthResponse payload', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/v1/health',
    });

    expect(response.statusCode).toBe(200);
    const parsed = HealthResponseSchema.parse(response.json());
    expect(parsed.status).toBe('ok');
    expect(parsed.service).toBe('api');
  });

  it('GET /v1/ready returns validated readiness status', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/v1/ready',
    });

    expect(response.statusCode).toBe(200);
    const parsed = HealthResponseSchema.parse(response.json());
    expect(parsed.status).toBe('ok');
  });
});
