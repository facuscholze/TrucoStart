import { parseServerEnv } from '@truco/shared';
import pino from 'pino';
import { createGameServer } from './server.js';

async function main(): Promise<void> {
  const logger = pino({ name: 'truco-game-server' });
  const env = parseServerEnv(process.env);
  const server = createGameServer({
    appName: env.APP_NAME,
    corsOrigins: env.CORS_ORIGINS,
  });

  const port = await server.listen(env.GAME_SERVER_PORT, env.GAME_SERVER_HOST);
  logger.info(
    { host: env.GAME_SERVER_HOST, port, appName: env.APP_NAME },
    'Game Server Socket.IO iniciado correctamente',
  );
}

void main();
