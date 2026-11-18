import { buildLoggerOptions, initializeTracing, parseServerEnv } from '@truco/shared';
import pino from 'pino';
import { createApiApp } from './bootstrap.js';

async function main(): Promise<void> {
  const env = parseServerEnv(process.env);
  const logger = pino(buildLoggerOptions({ service: 'api', level: env.LOG_LEVEL }));

  // Trazas/errores: sólo se activan si están las variables y los paquetes instalados.
  await initializeTracing(
    {
      OTEL_EXPORTER_OTLP_ENDPOINT: env.OTEL_EXPORTER_OTLP_ENDPOINT,
      OTEL_SERVICE_NAME: env.OTEL_SERVICE_NAME,
      OTEL_TRACES_SAMPLER_ARG: env.OTEL_TRACES_SAMPLER_ARG,
      SENTRY_DSN: env.SENTRY_DSN,
      SENTRY_TRACES_SAMPLE_RATE: env.SENTRY_TRACES_SAMPLE_RATE,
    },
    'truco-api',
    (message, fields) => logger.info(fields ?? {}, message),
  );

  const corsOrigins: string[] = [
    ...env.CORS_ORIGINS,
    ...(env.ADMIN_ORIGIN.trim() ? [env.ADMIN_ORIGIN.trim()] : []),
  ];

  const app = await createApiApp({
    corsOrigins,
    trustProxyCidrs: env.TRUSTED_PROXY_CIDRS,
    logger,
    observability: {
      config: {
        metricsToken: env.METRICS_TOKEN.trim() || null,
        gameServerInternalUrl: env.GAME_SERVER_INTERNAL_URL,
        internalSecret: env.INTERNAL_RPC_SECRET || env.SESSION_SECRET,
      },
    },
    adminOptions: {
      allowedNetworks: env.ADMIN_ALLOWED_NETWORKS,
    },
    lobbyOptions: {
      runtimeConfig: {
        sessionSecret: env.SESSION_SECRET,
        internalSecret: env.INTERNAL_RPC_SECRET || env.SESSION_SECRET,
        gameServerInternalUrl: env.GAME_SERVER_INTERNAL_URL,
      },
      redisUrl: env.REDIS_URL,
    },
  });

  await app.listen({ host: env.API_HOST, port: env.API_PORT });
  logger.info(
    {
      host: env.API_HOST,
      port: env.API_PORT,
      appName: env.APP_NAME,
      metricsEnabled: env.METRICS_TOKEN.trim().length > 0,
      adminNetworks: env.ADMIN_ALLOWED_NETWORKS.length,
    },
    'API HTTP iniciada correctamente',
  );
}

void main();
