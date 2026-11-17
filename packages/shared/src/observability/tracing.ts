/**
 * Configuración de trazas (OpenTelemetry) y errores (Sentry) por variable de entorno.
 *
 * Decisión de M8a: el repo NO trae `@opentelemetry/*` ni `@sentry/*` como dependencias
 * obligatorias (peso y superficie de ataque). `initializeTracing` intenta cargarlas de
 * forma dinámica; si no están instaladas avisa una vez y sigue sin trazas. La activación
 * real se documenta en `docs/RUNBOOKS.md` (instalar el paquete + exportar variables).
 */

export interface TracingEnv {
  readonly OTEL_EXPORTER_OTLP_ENDPOINT?: string | undefined;
  readonly OTEL_SERVICE_NAME?: string | undefined;
  readonly OTEL_TRACES_SAMPLER_ARG?: string | undefined;
  readonly OTEL_SDK_DISABLED?: string | undefined;
  readonly SENTRY_DSN?: string | undefined;
  readonly SENTRY_TRACES_SAMPLE_RATE?: string | undefined;
}

export interface TracingConfig {
  readonly otelEnabled: boolean;
  readonly otlpEndpoint: string | null;
  readonly serviceName: string;
  readonly sampleRate: number;
  readonly sentryEnabled: boolean;
  readonly sentryDsn: string | null;
  readonly missingDependencies: readonly string[];
}

const DEFAULT_SAMPLE_RATE = 0.1;

function parseRate(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === '') return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) return fallback;
  return parsed;
}

function isHttpUrl(raw: string | undefined): raw is string {
  if (!raw) return false;
  try {
    const url = new URL(raw);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

export function buildTracingConfig(
  env: TracingEnv,
  service: string,
  installed: { readonly otel: boolean; readonly sentry: boolean },
): TracingConfig {
  const otelDisabled = env.OTEL_SDK_DISABLED === 'true' || env.OTEL_SDK_DISABLED === '1';
  const otlpEndpoint = isHttpUrl(env.OTEL_EXPORTER_OTLP_ENDPOINT)
    ? env.OTEL_EXPORTER_OTLP_ENDPOINT.replace(/\/$/, '')
    : null;
  const sentryDsn = isHttpUrl(env.SENTRY_DSN) ? env.SENTRY_DSN : null;

  const missingDependencies: string[] = [];
  if (!otelDisabled && otlpEndpoint && !installed.otel) {
    missingDependencies.push('@opentelemetry/sdk-node');
  }
  if (sentryDsn && !installed.sentry) missingDependencies.push('@sentry/node');

  return {
    otelEnabled: !otelDisabled && otlpEndpoint !== null && installed.otel,
    otlpEndpoint,
    serviceName: env.OTEL_SERVICE_NAME?.trim() || service,
    sampleRate: parseRate(env.OTEL_TRACES_SAMPLER_ARG, DEFAULT_SAMPLE_RATE),
    sentryEnabled: sentryDsn !== null && installed.sentry,
    sentryDsn,
    missingDependencies,
  };
}

const OTEL_MODULE = '@opentelemetry/sdk-node';
const SENTRY_MODULE = '@sentry/node';

async function isInstalled(moduleName: string): Promise<boolean> {
  try {
    await import(/* @vite-ignore */ moduleName);
    return true;
  } catch {
    return false;
  }
}

export interface TracingInitResult extends TracingConfig {
  readonly warnings: readonly string[];
}

/**
 * Inicializa trazas/errores si hay variables y paquetes. Nunca lanza: la observabilidad
 * no puede tumbar el arranque del servicio.
 */
export async function initializeTracing(
  env: TracingEnv,
  service: string,
  log: (message: string, fields?: Record<string, unknown>) => void = () => {},
): Promise<TracingInitResult> {
  const [otelInstalled, sentryInstalled] = await Promise.all([
    isInstalled(OTEL_MODULE),
    isInstalled(SENTRY_MODULE),
  ]);
  const config = buildTracingConfig(env, service, {
    otel: otelInstalled,
    sentry: sentryInstalled,
  });
  const warnings: string[] = [];

  if (config.otelEnabled && config.otlpEndpoint) {
    try {
      const otel = (await import(/* @vite-ignore */ OTEL_MODULE)) as {
        NodeSDK?: new (options: Record<string, unknown>) => { start(): void };
      };
      if (otel.NodeSDK) {
        new otel.NodeSDK({ serviceName: config.serviceName }).start();
        log('otel_iniciado', { service: config.serviceName, sampleRate: config.sampleRate });
      }
    } catch (error) {
      warnings.push(`No se pudo iniciar OpenTelemetry: ${(error as Error).message}`);
    }
  }

  if (config.sentryEnabled && config.sentryDsn) {
    try {
      const sentry = (await import(/* @vite-ignore */ SENTRY_MODULE)) as {
        init?: (options: Record<string, unknown>) => void;
      };
      sentry.init?.({
        dsn: config.sentryDsn,
        tracesSampleRate: config.sampleRate,
        environment: process.env['NODE_ENV'] ?? 'development',
      });
      log('sentry_iniciado', { service: config.serviceName });
    } catch (error) {
      warnings.push(`No se pudo iniciar Sentry: ${(error as Error).message}`);
    }
  }

  for (const dependency of config.missingDependencies) {
    warnings.push(
      `Falta ${dependency}: las trazas quedan desactivadas (ver docs/RUNBOOKS.md#trazas).`,
    );
  }
  for (const warning of warnings) log('observabilidad_aviso', { detail: warning });

  return { ...config, warnings };
}
