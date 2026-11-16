import { parseServerEnv } from '@truco/shared';
import pino from 'pino';
import { createApiApp } from './bootstrap.js';

async function main(): Promise<void> {
  const logger = pino({ name: 'truco-api' });
  const env = parseServerEnv(process.env);
  const app = await createApiApp({
    corsOrigins: env.CORS_ORIGINS,
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
    { host: env.API_HOST, port: env.API_PORT, appName: env.APP_NAME },
    'API HTTP iniciada correctamente',
  );
}

void main();
