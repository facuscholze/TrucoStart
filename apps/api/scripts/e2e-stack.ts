import { createGameServer, InMemoryMatchLifecycleBus } from '@truco/game-server';
import { ADMIN_ROLE_PERMISSIONS } from '@truco/shared';
import { eq } from 'drizzle-orm';
import {
  adminTwoFactorTable,
  matchEventsTable,
  matchPlayersTable,
  matchesTable,
  profilesTable,
  usersTable,
} from '../src/db/schema/index.js';
import { PasswordHasher } from '../src/modules/auth/security/password-hasher.js';
import { encryptTotpSecret } from '../src/modules/admin/security/totp.js';
import { generateUuidV7 } from '../src/common/uuidv7.js';
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
/**
 * Administrador sembrado para la suite E2E del panel (`apps/admin/e2e`).
 * Sólo se crea cuando `E2E_ADMIN=1`; usa un secreto TOTP fijo conocido por el test.
 */
const E2E_ADMIN_EMAIL = process.env['E2E_ADMIN_EMAIL'] ?? 'e2e-admin@truco.ar';
const E2E_ADMIN_PASSWORD = process.env['E2E_ADMIN_PASSWORD'] ?? 'E2eAdminPanel2026!';
const E2E_ADMIN_TOTP_SECRET =
  process.env['E2E_ADMIN_TOTP_SECRET'] ?? 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';
/** Clave de cifrado del secreto TOTP: la misma para sembrar y para arrancar la API. */
const E2E_ADMIN_TOTP_KEY = process.env['ADMIN_TOTP_ENCRYPTION_KEY'] ?? SHARED_SECRET;
const E2E_MATCH_ID = '019a7e40-0000-7000-8000-0000000000e1';
const E2E_REPORTER_ID = '019a7e40-0000-7000-8000-0000000000e2';
const E2E_TARGET_ID = '019a7e40-0000-7000-8000-0000000000e3';
const E2E_REPORTER_EMAIL = 'e2e-reporter@truco.ar';
const E2E_TARGET_EMAIL = 'e2e-target@truco.ar';
const E2E_PLAYER_PASSWORD = 'JugadorE2E2026!';
const GAME_PORT = Number(process.env['GAME_SERVER_PORT'] ?? 3002);

/**
 * Topes de producto para el stack de pruebas.
 *
 * Los límites anti-abuso (torneos privados activos por cuenta, altas por cuenta y por IP)
 * existen para el producto real, no para una suite que crea varios torneos seguidos desde
 * la misma IP del runner en pocos minutos. Se elevan acá y no en el E2E: el código que se
 * prueba sigue siendo el de siempre y el producto conserva sus límites.
 */
function raiseTournamentLimitsForE2E(): void {
  process.env['TOURNAMENTS_MAX_ACTIVE_PRIVATE'] =
    process.env['TOURNAMENTS_MAX_ACTIVE_PRIVATE'] ?? '50';
  process.env['TOURNAMENTS_CREATE_PER_ACCOUNT'] =
    process.env['TOURNAMENTS_CREATE_PER_ACCOUNT'] ?? '200';
  process.env['TOURNAMENTS_CREATE_PER_IP'] = process.env['TOURNAMENTS_CREATE_PER_IP'] ?? '500';
  process.env['TOURNAMENTS_REGISTER_PER_ACCOUNT'] =
    process.env['TOURNAMENTS_REGISTER_PER_ACCOUNT'] ?? '200';
}

/** Siembra el admin del panel y una partida terminada con eventos (replay auditable). */
async function seedAdminPanelFixtures(
  dbHandle: Awaited<ReturnType<typeof createAdaptiveTestDatabase>>,
) {
  const now = new Date();
  const hasher = new PasswordHasher();
  const passwordHash = await hasher.hashPassword(E2E_ADMIN_PASSWORD);
  const adminId = generateUuidV7(now.getTime());

  const [existing] = await dbHandle.db
    .select()
    .from(usersTable)
    .where(eq(usersTable.email, E2E_ADMIN_EMAIL));
  if (!existing) {
    await dbHandle.db.insert(usersTable).values({
      id: adminId,
      email: E2E_ADMIN_EMAIL,
      emailVerifiedAt: now,
      passwordHash,
      nickname: 'E2eAdmin',
      nicknameLower: 'e2eadmin',
      isGuest: false,
      role: 'ADMIN',
      status: 'ACTIVE',
      createdAt: now,
      updatedAt: now,
    });
    await dbHandle.db
      .insert(profilesTable)
      .values({ userId: adminId, createdAt: now, updatedAt: now });
    await dbHandle.db.insert(adminTwoFactorTable).values({
      userId: adminId,
      secretEncrypted: encryptTotpSecret(E2E_ADMIN_TOTP_SECRET, E2E_ADMIN_TOTP_KEY),
      recoveryCodes: [],
      confirmedAt: now,
      createdAt: now,
      updatedAt: now,
    });
  }

  // Jugadores con identidad fija: el reportero debe haber jugado la partida reportada.
  const playerHash = await hasher.hashPassword(E2E_PLAYER_PASSWORD);
  for (const player of [
    { id: E2E_REPORTER_ID, email: E2E_REPORTER_EMAIL, nickname: 'E2eReportero' },
    { id: E2E_TARGET_ID, email: E2E_TARGET_EMAIL, nickname: 'E2eSancionable' },
  ]) {
    const [found] = await dbHandle.db.select().from(usersTable).where(eq(usersTable.id, player.id));
    if (found) continue;
    await dbHandle.db.insert(usersTable).values({
      id: player.id,
      email: player.email,
      emailVerifiedAt: now,
      passwordHash: playerHash,
      nickname: player.nickname,
      nicknameLower: player.nickname.toLowerCase(),
      isGuest: false,
      role: 'PLAYER',
      status: 'ACTIVE',
      createdAt: now,
      updatedAt: now,
    });
    await dbHandle.db
      .insert(profilesTable)
      .values({ userId: player.id, createdAt: now, updatedAt: now });
  }

  // Partida terminada con eventos: habilita el replay del reporte en el panel.
  const [existingMatch] = await dbHandle.db
    .select()
    .from(matchesTable)
    .where(eq(matchesTable.id, E2E_MATCH_ID));
  if (!existingMatch) {
    await dbHandle.db.insert(matchesTable).values({
      id: E2E_MATCH_ID,
      mode: '1v1',
      rulesetCode: 'ar-standard-v1',
      seedCommitment: 'e2e-seed-commitment',
      startedAt: new Date(now.getTime() - 300_000),
      endedAt: new Date(now.getTime() - 120_000),
      result: { winnerTeam: 0 },
      createdAt: new Date(now.getTime() - 300_000),
    });
    await dbHandle.db.insert(matchPlayersTable).values([
      {
        matchId: E2E_MATCH_ID,
        seat: 0,
        userId: E2E_REPORTER_ID,
        team: 0,
        score: 15,
        outcome: 'WIN',
        ratingDelta: 0,
        createdAt: new Date(now.getTime() - 300_000),
      },
      {
        matchId: E2E_MATCH_ID,
        seat: 1,
        userId: E2E_TARGET_ID,
        team: 1,
        score: 12,
        outcome: 'LOSS',
        ratingDelta: 0,
        createdAt: new Date(now.getTime() - 300_000),
      },
    ]);
    await dbHandle.db.insert(matchEventsTable).values([
      {
        matchId: E2E_MATCH_ID,
        seq: 1,
        type: 'game.started',
        payload: {},
        createdAt: new Date(now.getTime() - 300_000),
      },
      {
        matchId: E2E_MATCH_ID,
        seq: 2,
        type: 'game.scoreUpdated',
        payload: { team: 0, newScore: 15 },
        createdAt: new Date(now.getTime() - 200_000),
      },
      {
        matchId: E2E_MATCH_ID,
        seq: 3,
        type: 'game.ended',
        payload: { scoresByTeam: { '0': 15, '1': 12 }, winnerTeam: 0 },
        createdAt: new Date(now.getTime() - 120_000),
      },
    ]);
  }

  process.stdout.write(
    `E2E_ADMIN_READY email=${E2E_ADMIN_EMAIL} password=${E2E_ADMIN_PASSWORD} role=ADMIN match=${E2E_MATCH_ID} permissions=${ADMIN_ROLE_PERMISSIONS.ADMIN.length}\n`,
  );
}

async function main() {
  // Antes de crear la app: la configuración de torneos se arma al construir el módulo.
  raiseTournamentLimitsForE2E();
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
    adminOptions: {
      runtimeConfig: {
        totpEncryptionKey: E2E_ADMIN_TOTP_KEY,
        cookieSecure: false,
        loginMaxPerMinute: 60,
      },
      internalSecret: SHARED_SECRET,
      gameServerInternalUrl: gameServerUrl,
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

  if (process.env['E2E_ADMIN'] === '1') {
    await seedAdminPanelFixtures(dbHandle);
  }

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
