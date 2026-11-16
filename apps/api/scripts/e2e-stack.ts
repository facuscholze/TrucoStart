import { createGameServer, InMemoryMatchLifecycleBus } from '@truco/game-server';
import { createApiApp } from '../src/bootstrap.js';
import { createAdaptiveTestDatabase } from '../src/db/database.provider.js';
import { HttpGameRoomProvisioner } from '../src/modules/lobby/ports/game-room-provisioner.js';
import { InMemoryMatchLifecycleConsumer } from '../src/modules/lobby/ports/match-lifecycle-consumer.js';

const SHARED_SECRET = 'm5b-playwright-e2e-shared-secret-min-32-chars!!';
/**
 * Semilla de reparto fija para E2E reproducibles: cada corrida reparte exactamente
 * las mismas cartas (misma partida determinística). Solo entorno de pruebas.
 */
const E2E_DEAL_SEED_HEX =
  process.env['E2E_DEAL_SEED_HEX'] ??
  'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90';
const API_PORT = Number(process.env['API_PORT'] ?? 3001);
const GAME_PORT = Number(process.env['GAME_SERVER_PORT'] ?? 3002);

async function main() {
  const dbHandle = await createAdaptiveTestDatabase();
  const inMemoryBus = new InMemoryMatchLifecycleBus();

  const gameServer = createGameServer({
    sessionSecret: SHARED_SECRET,
    internalSecret: SHARED_SECRET,
    seedEncryptionKey: SHARED_SECRET,
    allowAdHocRooms: false,
    dealSeedHex: E2E_DEAL_SEED_HEX,
    reconnectGraceMs: 45_000,
    defaultTurnTimeoutMs: 45_000,
    lifecyclePublisher: inMemoryBus,
    corsOrigins: ['http://localhost:4173', 'http://127.0.0.1:4173', 'http://localhost:5173'],
    rateLimiter: {
      windowMs: 10_000,
      actionMax: 800,
      chatMax: 100,
      tableMax: 100,
      connectionTotalMax: 1_200,
    },
  });

  const boundGamePort = await gameServer.listen(GAME_PORT, '127.0.0.1');
  const gameServerUrl = `http://127.0.0.1:${boundGamePort}`;

  const lifecycleConsumer = new InMemoryMatchLifecycleConsumer(inMemoryBus);

  const apiApp = await createApiApp({
    dbHandle,
    corsOrigins: ['http://localhost:4173', 'http://127.0.0.1:4173', 'http://localhost:5173'],
    authOptions: {
      runtimeConfig: {
        sessionSecret: SHARED_SECRET,
      },
      rateLimitConfig: {
        windowMs: 60_000,
        maxPerIp: 1_000,
        maxPerAccount: 500,
      },
    },
    lobbyOptions: {
      gameRoomProvisioner: new HttpGameRoomProvisioner({
        baseUrl: gameServerUrl,
        internalSecret: SHARED_SECRET,
      }),
      matchLifecycleConsumer: lifecycleConsumer,
      runtimeConfig: {
        sessionSecret: SHARED_SECRET,
        internalSecret: SHARED_SECRET,
        cleanupIntervalMs: 0,
        joinCodeIpMax: 300,
        joinCodeAccountMax: 300,
        listTablesIpMax: 500,
        lobbyWsConnectIpMax: 500,
        lobbyWsEventIpMax: 500,
      },
    },
  });

  await apiApp.listen(API_PORT, '127.0.0.1');
  process.stdout.write(`E2E_STACK_READY api=http://127.0.0.1:${API_PORT} game=${gameServerUrl}\n`);

  const shutdown = async () => {
    await apiApp.close().catch(() => undefined);
    await gameServer.close().catch(() => undefined);
    await dbHandle.close().catch(() => undefined);
    process.exit(0);
  };

  process.once('SIGINT', () => void shutdown());
  process.once('SIGTERM', () => void shutdown());
}

void main().catch((err) => {
  process.stderr.write(`Fatal E2E stack error: ${String(err)}\n`);
  process.exit(1);
});
