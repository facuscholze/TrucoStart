import { parseServerEnv } from '@truco/shared';
import pino from 'pino';
import { createPostgresDatabase } from './database.provider.js';

async function main(): Promise<void> {
  const logger = pino({ name: 'truco-db-migrate' });
  const env = parseServerEnv(process.env);
  const handle = await createPostgresDatabase({
    databaseUrl: env.DATABASE_URL,
    runMigrations: true,
  });
  await handle.close();
  logger.info('Migraciones SQL y RuleSets oficiales aplicados correctamente');
}

void main();
