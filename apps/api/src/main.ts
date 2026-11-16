import { parseServerEnv } from '@truco/shared';
import pino from 'pino';
import { createApiApp } from './bootstrap.js';

async function main(): Promise<void> {
  const logger = pino({ name: 'truco-api' });
  const env = parseServerEnv(process.env);
  const app = await createApiApp();

  await app.listen({ host: env.API_HOST, port: env.API_PORT });
  logger.info(
    { host: env.API_HOST, port: env.API_PORT, appName: env.APP_NAME },
    'API HTTP iniciada correctamente',
  );
}

void main();
