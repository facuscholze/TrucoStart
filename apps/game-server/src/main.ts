import { parseServerEnv } from '@truco/shared';
import pino from 'pino';
import { BullMqMatchLifecyclePublisher } from './events/match-lifecycle-publisher.js';
import { createGameServer } from './server.js';
import { RedisGameStore } from './store/redis-game-store.js';

async function main(): Promise<void> {
  const logger = pino({ name: 'truco-game-server' });
  const env = parseServerEnv(process.env);
  const store = new RedisGameStore(env.REDIS_URL);
  const lifecyclePublisher = new BullMqMatchLifecyclePublisher(env.REDIS_URL);

  const server = createGameServer({
    appName: env.APP_NAME,
    corsOrigins: env.CORS_ORIGINS,
    store,
    lifecyclePublisher,
    allowAdHocRooms: false,
    sessionSecret: env.SESSION_SECRET,
    internalSecret: env.INTERNAL_RPC_SECRET || env.SESSION_SECRET,
    seedEncryptionKey: env.SEED_ENCRYPTION_KEY,
    defaultTurnTimeoutMs: env.TURN_TIMEOUT_MS,
    reconnectGraceMs: env.RECONNECT_GRACE_MS,
    rateLimiter: {
      actionMax: env.RATE_LIMIT_WS_ACTION_MAX,
      chatMax: env.RATE_LIMIT_WS_CHAT_MAX,
    },
  });

  const port = await server.listen(env.GAME_SERVER_PORT, env.GAME_SERVER_HOST);
  logger.info(
    {
      host: env.GAME_SERVER_HOST,
      port,
      appName: env.APP_NAME,
      serverId: server.roomManager.serverId,
    },
    'Game Server Socket.IO iniciado correctamente',
  );

  const handleShutdown = async (signal: string) => {
    logger.info({ signal }, 'Iniciando drenaje y apagado controlado del Game Server');
    server.roomManager.setDraining(true);
    await server.close();
    await store.close();
    process.exit(0);
  };

  process.once('SIGTERM', () => void handleShutdown('SIGTERM'));
  process.once('SIGINT', () => void handleShutdown('SIGINT'));
}

void main();
