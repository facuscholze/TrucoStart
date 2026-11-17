import { describe, expect, it } from 'vitest';
import {
  buildLoggerOptions,
  buildRequestLogFields,
  CORRELATION_ID_HEADER,
  CORRELATION_ID_PATTERN,
  createCorrelationId,
  LOG_REDACT_PATHS,
  pickCorrelationId,
  redactLogPayload,
  redactLogText,
} from '../src/observability/logging.js';
import {
  API_METRIC_DEFINITIONS,
  GAME_SERVER_METRIC_DEFINITIONS,
  isValidMetricsToken,
  MetricsRegistry,
} from '../src/observability/metrics.js';
import {
  adminSecurityHeaders,
  apiSecurityHeaders,
  webSecurityHeaders,
} from '../src/observability/security-headers.js';
import { buildTracingConfig, initializeTracing } from '../src/observability/tracing.js';

describe('logging estructurado', () => {
  it('redacta emails, cartas y tokens en texto libre', () => {
    const text =
      'reporte de jugador@ejemplo.com con 7-espadas y token abcdefghijklmnopqrstuvwxyz0123456789';
    const redacted = redactLogText(text);
    expect(redacted).not.toContain('jugador@ejemplo.com');
    expect(redacted).not.toContain('7-espadas');
    expect(redacted).not.toContain('abcdefghijklmnopqrstuvwxyz0123456789');
    expect(redacted).toContain('[email]');
    expect(redacted).toContain('[carta]');
    expect(redacted).toContain('[redactado]');
  });

  it('redacta claves sensibles de forma recursiva sin perder ids', () => {
    const payload = {
      userId: '019a7e40-0000-7000-8000-0000000000e2',
      email: 'e2e-reporter@truco.ar',
      nested: { password: 'secreto', hand: ['7-espadas'], note: 'habló por fuera' },
      list: [{ email: 'otro@truco.ar' }],
    };
    const redacted = redactLogPayload(payload) as Record<string, unknown>;
    expect(redacted['userId']).toBe('019a7e40-0000-7000-8000-0000000000e2');
    expect(redacted['email']).toBe('[redactado]');
    const nested = redacted['nested'] as Record<string, unknown>;
    expect(nested['password']).toBe('[redactado]');
    expect(nested['hand']).toBe('[redactado]');
    expect(nested['note']).toBe('habló por fuera');
    expect(JSON.stringify(redacted)).not.toContain('@truco.ar');
  });

  it('arma opciones de pino con redacción y servicio', () => {
    const options = buildLoggerOptions({ service: 'api', level: 'warn' });
    expect(options.name).toBe('truco-api');
    expect(options.level).toBe('warn');
    expect(options.base['service']).toBe('api');
    expect(options.redact.paths).toContain('req.headers.authorization');
    expect(LOG_REDACT_PATHS).toContain('*.totpCode');
  });

  it('valida y propaga el id de correlación', () => {
    expect(pickCorrelationId('abcdef0123456789', () => 'fallback-id-01')).toBe('abcdef0123456789');
    expect(pickCorrelationId('corto', () => 'fallback-id-01')).toBe('fallback-id-01');
    expect(pickCorrelationId(undefined, () => 'fallback-id-01')).toBe('fallback-id-01');
    expect(pickCorrelationId('id con espacios', () => 'fallback-id-01')).toBe('fallback-id-01');
    expect(CORRELATION_ID_PATTERN.test(createCorrelationId())).toBe(true);
    expect(createCorrelationId(() => 'deadbeefdeadbeef')).toBe('deadbeefdeadbeef');
    expect(CORRELATION_ID_HEADER).toBe('x-correlation-id');
  });

  it('construye campos de log de request sin query string', () => {
    const fields = buildRequestLogFields({
      service: 'api',
      correlationId: 'abcdef0123456789',
      method: 'GET',
      path: '/v1/admin/users?email=alguien@truco.ar',
      status: 200,
      durationMs: 12,
      userId: '019a7e40-0000-7000-8000-0000000000e2',
    });
    expect(fields['path']).toBe('/v1/admin/users');
    expect(fields['correlationId']).toBe('abcdef0123456789');
    expect(JSON.stringify(fields)).not.toContain('@truco.ar');
  });
});

describe('métricas Prometheus', () => {
  it('expone contadores, gauges e histogramas con el formato esperado', () => {
    const registry = new MetricsRegistry();
    registry.increment('truco_http_requests_total', {
      method: 'GET',
      route: '/v1/health',
      status: '200',
    });
    registry.set('truco_active_matches', 3);
    registry.set('truco_rooms_by_status', 2, { status: 'IN_GAME' });
    registry.observe('truco_http_request_duration_seconds', 0.03, {
      method: 'GET',
      route: '/v1/health',
    });

    const text = registry.render();
    expect(text).toContain('# TYPE truco_http_requests_total counter');
    expect(text).toContain(
      'truco_http_requests_total{method="GET",route="/v1/health",status="200"} 1',
    );
    expect(text).toContain('truco_active_matches 3');
    expect(text).toContain('truco_rooms_by_status{status="IN_GAME"} 2');
    expect(text).toContain(
      'truco_http_request_duration_seconds_bucket{method="GET",route="/v1/health",le="0.05"} 1',
    );
    expect(text).toContain(
      'truco_http_request_duration_seconds_bucket{method="GET",route="/v1/health",le="+Inf"} 1',
    );
    expect(text.endsWith('\n')).toBe(true);
  });

  it('cubre las métricas pedidas en el MVP', () => {
    const names = API_METRIC_DEFINITIONS.map((definition) => definition.name);
    for (const expected of [
      'truco_active_matches',
      'truco_ws_connections',
      'truco_action_duration_seconds',
      'truco_http_errors_total',
      'truco_ws_reconnections_total',
      'truco_jobs_pending',
      'truco_jobs_failed_total',
      'truco_rooms_by_status',
    ]) {
      expect(names).toContain(expected);
    }
    expect(GAME_SERVER_METRIC_DEFINITIONS.map((definition) => definition.name)).toContain(
      'truco_ws_connections',
    );
  });

  it('valida el token de /metrics', () => {
    expect(isValidMetricsToken('x'.repeat(31))).toBe(true);
    expect(isValidMetricsToken('corto')).toBe(false);
    expect(isValidMetricsToken(undefined)).toBe(false);
  });
});

describe('cabeceras de seguridad', () => {
  it('la API no permite HTML ni frames y suma HSTS en producción', () => {
    const dev = apiSecurityHeaders({ production: false });
    const prod = apiSecurityHeaders({ production: true });
    expect(dev['content-security-policy']).toContain("default-src 'none'");
    expect(dev['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(dev['strict-transport-security']).toBeUndefined();
    expect(prod['strict-transport-security']).toContain('max-age=31536000');
    expect(prod['x-content-type-options']).toBe('nosniff');
    expect(prod['referrer-policy']).toBe('no-referrer');
    expect(prod['permissions-policy']).toContain('geolocation=()');
  });

  it('la web permite conectar sólo a la API y al game-server', () => {
    const headers = webSecurityHeaders({
      production: true,
      apiOrigin: 'https://api.truco.ar',
      gameServerOrigin: 'https://game.truco.ar',
    });
    const csp = headers['content-security-policy'] ?? '';
    expect(csp).toContain('connect-src');
    expect(csp).toContain('https://api.truco.ar');
    expect(csp).toContain('wss://game.truco.ar');
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).not.toContain('unsafe-eval');
  });

  it('el panel admin no se cachea ni se embebe', () => {
    const headers = adminSecurityHeaders({
      production: true,
      apiOrigin: 'https://api.truco.ar',
    });
    expect(headers['cache-control']).toBe('no-store');
    expect(headers['x-frame-options']).toBe('DENY');
    expect(headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(headers['content-security-policy']).toContain("default-src 'self'");
    expect(headers['referrer-policy']).toBe('no-referrer');
  });
});

describe('trazas y errores por entorno', () => {
  it('queda apagado sin variables', () => {
    const config = buildTracingConfig({}, 'api', { otel: false, sentry: false });
    expect(config.otelEnabled).toBe(false);
    expect(config.sentryEnabled).toBe(false);
    expect(config.missingDependencies).toEqual([]);
    expect(config.sampleRate).toBe(0.1);
  });

  it('avisa si hay endpoint pero falta el paquete', () => {
    const config = buildTracingConfig(
      { OTEL_EXPORTER_OTLP_ENDPOINT: 'http://collector:4318', SENTRY_DSN: 'https://k@sentry.io/1' },
      'game-server',
      { otel: false, sentry: false },
    );
    expect(config.otelEnabled).toBe(false);
    expect(config.missingDependencies).toEqual(['@opentelemetry/sdk-node', '@sentry/node']);
  });

  it('se activa con endpoint válido y paquete presente', () => {
    const config = buildTracingConfig(
      {
        OTEL_EXPORTER_OTLP_ENDPOINT: 'https://otlp.truco.ar/',
        OTEL_TRACES_SAMPLER_ARG: '0.25',
        OTEL_SERVICE_NAME: 'truco-api',
        SENTRY_DSN: 'https://k@sentry.io/1',
      },
      'api',
      { otel: true, sentry: true },
    );
    expect(config.otelEnabled).toBe(true);
    expect(config.otlpEndpoint).toBe('https://otlp.truco.ar');
    expect(config.serviceName).toBe('truco-api');
    expect(config.sampleRate).toBe(0.25);
    expect(config.sentryEnabled).toBe(true);
  });

  it('inicializar sin paquetes no lanza y devuelve avisos', async () => {
    const result = await initializeTracing(
      { OTEL_EXPORTER_OTLP_ENDPOINT: 'http://collector:4318' },
      'api',
    );
    expect(result.otelEnabled).toBe(false);
    expect(result.warnings.join(' ')).toContain('@opentelemetry/sdk-node');
  });
});
