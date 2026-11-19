import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApiApp, type CreateApiAppOptions } from '../../../bootstrap.js';
import {
  createAdaptiveTestDatabase,
  type DatabaseConnectionHandle,
} from '../../../db/database.provider.js';

const SESSION_SECRET = 'm8a-metrics-secret-minimo-32-caracteres!!';
const METRICS_TOKEN = 'metrics-token-de-prueba-con-32-chars!!';

interface CapturedLine {
  readonly fields: Record<string, unknown>;
  readonly message: string;
}

function buildLogger(lines: CapturedLine[]) {
  const push = (fields: Record<string, unknown>, message: string) => {
    lines.push({ fields, message });
  };
  return {
    info: push,
    warn: push,
    error: push,
  };
}

function buildOptions(
  dbHandle: DatabaseConnectionHandle,
  lines: CapturedLine[],
  overrides: Partial<CreateApiAppOptions> = {},
): CreateApiAppOptions {
  return {
    dbHandle,
    trustProxyCidrs: ['127.0.0.1/32'],
    logger: buildLogger(lines),
    observability: { config: { metricsToken: METRICS_TOKEN } },
    authOptions: {
      runtimeConfig: {
        sessionSecret: SESSION_SECRET,
        nowFn: () => Date.UTC(2026, 10, 30, 12, 0, 0),
      },
      rateLimitConfig: {
        maxPerIp: 900,
        maxPerAccount: 900,
        nowFn: () => Date.UTC(2026, 10, 30, 12, 0, 0),
      },
    },
    ...overrides,
  };
}

describe('M8a — métricas, cabeceras y logs correlacionados', () => {
  let dbHandle: DatabaseConnectionHandle;
  let app: NestFastifyApplication;
  let appWithoutToken: NestFastifyApplication;
  const lines: CapturedLine[] = [];

  beforeAll(async () => {
    dbHandle = await createAdaptiveTestDatabase();
    app = await createApiApp(buildOptions(dbHandle, lines));
    await app.init();
    await app.getHttpAdapter().getInstance().ready();

    appWithoutToken = await createApiApp(
      buildOptions(dbHandle, [], { observability: { config: { metricsToken: null } } }),
    );
    await appWithoutToken.init();
    await appWithoutToken.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app.close();
    await appWithoutToken.close();
    await dbHandle.close();
  });

  it('rechaza /v1/metrics sin token y con token inválido', async () => {
    const noToken = await app.inject({ method: 'GET', url: '/v1/metrics' });
    expect(noToken.statusCode).toBe(401);

    const wrong = await app.inject({
      method: 'GET',
      url: '/v1/metrics',
      headers: { authorization: 'Bearer token-que-no-es-el-correcto-32chars' },
    });
    expect(wrong.statusCode).toBe(401);
  });

  it('expone el formato Prometheus con las métricas del MVP', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/v1/metrics',
      headers: { authorization: `Bearer ${METRICS_TOKEN}` },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/plain');
    expect(response.headers['cache-control']).toBe('no-store');
    const body = response.body;
    for (const metric of [
      'truco_active_matches',
      'truco_ws_connections',
      'truco_action_duration_seconds',
      'truco_http_errors_total',
      'truco_ws_reconnections_total',
      'truco_jobs_pending',
      'truco_jobs_failed_total',
      'truco_rooms_by_status',
      'truco_open_reports',
    ]) {
      expect(body).toContain(metric);
    }
    expect(body).toContain('truco_active_matches 0');
  });

  it('falla cerrado si no hay METRICS_TOKEN configurado', async () => {
    const response = await appWithoutToken.inject({
      method: 'GET',
      url: '/v1/metrics',
      headers: { authorization: `Bearer ${METRICS_TOKEN}` },
    });
    expect(response.statusCode).toBe(503);
  });

  it('agrega cabeceras de seguridad a las respuestas de la API', async () => {
    const response = await app.inject({ method: 'GET', url: '/v1/health' });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-security-policy']).toContain("default-src 'none'");
    expect(response.headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['referrer-policy']).toBe('no-referrer');
    expect(response.headers['permissions-policy']).toContain('microphone=()');
    expect(response.headers['x-frame-options']).toBe('DENY');
  });

  it('propaga un id de correlación válido y genera uno si es inválido', async () => {
    const correlationId = 'abcdef0123456789';
    const response = await app.inject({
      method: 'GET',
      url: '/v1/health',
      headers: { 'x-correlation-id': correlationId },
    });
    expect(response.headers['x-correlation-id']).toBe(correlationId);

    const invalid = await app.inject({
      method: 'GET',
      url: '/v1/health',
      headers: { 'x-correlation-id': 'corto' },
    });
    expect(invalid.headers['x-correlation-id']).not.toBe('corto');
    expect(String(invalid.headers['x-correlation-id'])).toMatch(/^[a-f0-9]{24}$/);
  });

  it('loguea requests con correlación, sin query string ni datos personales', async () => {
    lines.length = 0;
    await app.inject({
      method: 'GET',
      url: '/v1/health?email=alguien@truco.ar&token=abc',
      headers: { 'x-correlation-id': 'corr-test-0001' },
    });

    const entry = lines.find((line) => line.message === 'http_request');
    expect(entry).toBeDefined();
    const serialized = JSON.stringify(entry?.fields ?? {});
    expect(serialized).toContain('corr-test-0001');
    expect(serialized).not.toContain('@truco.ar');
    expect(serialized).not.toContain('?email=');
    expect(entry?.fields['path']).toBe('/health');
    expect(entry?.fields['service']).toBe('api');
  });

  it('cuenta requests y errores por ruta declarada', async () => {
    const before = await app.inject({
      method: 'GET',
      url: '/v1/metrics',
      headers: { authorization: `Bearer ${METRICS_TOKEN}` },
    });
    const countFor = (body: string, route: string): number => {
      const matches = body
        .split('\n')
        .filter(
          (line) =>
            line.startsWith(`truco_http_requests_total{`) && line.includes(`route="${route}"`),
        );
      return matches.reduce((total, line) => total + Number(line.split(' ').pop() ?? 0), 0);
    };
    const healthBefore = countFor(before.body, '/health');

    await app.inject({ method: 'GET', url: '/v1/health' });
    await app.inject({ method: 'GET', url: '/v1/health' });

    const after = await app.inject({
      method: 'GET',
      url: '/v1/metrics',
      headers: { authorization: `Bearer ${METRICS_TOKEN}` },
    });
    expect(countFor(after.body, '/health')).toBeGreaterThanOrEqual(healthBefore + 2);
    // La ruta se etiqueta con el patrón declarado, no con la URL concreta.
    expect(after.body).not.toContain('route="/health?');
  });
});
