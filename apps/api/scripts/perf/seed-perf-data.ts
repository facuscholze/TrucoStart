/**
 * Siembra datos mínimos para el escenario k6 HTTP:
 *   - 1 ruleset canónico `ar-standard-v1` (lo hace migrate).
 *   - 100 usuarios pre-registrados para que el benchmark de login no dependa
 *     del registro del mismo VU.
 *
 * No se usa para el escenario de WS (el game-server crea salas por RPC interna).
 */
import { parseServerEnv } from '@truco/shared';
import { createPostgresDatabase } from '../../src/db/database.provider.js';

async function main() {
  const env = parseServerEnv(process.env);
  const handle = await createPostgresDatabase({
    databaseUrl: env.DATABASE_URL,
    runMigrations: true,
  });
  const db = handle.db;
  const { usersTable, profilesTable, rulesetsTable } = await import('../../src/db/schema/index.js');
  const { generateUuidV7 } = await import('../../src/common/uuidv7.js');
  const { PasswordHasher } = await import('../../src/modules/auth/security/password-hasher.js');
  const { AR_STANDARD_V1 } = await import('@truco/engine');

  // Ruleset
  await db
    .insert(rulesetsTable)
    .values({
      id: generateUuidV7(),
      code: AR_STANDARD_V1.code,
      version: AR_STANDARD_V1.version,
      config: AR_STANDARD_V1 as unknown as Record<string, unknown>,
    })
    .onConflictDoNothing({ target: rulesetsTable.code });

  const hasher = new PasswordHasher();
  const passwordHash = await hasher.hashPassword('perfPass-123');
  const now = new Date();

  // Create 100 users for perf tests
  for (let i = 0; i < 100; i++) {
    const id = generateUuidV7();
    const nickname = `perf${String(i).padStart(4, '0')}`;
    await db
      .insert(usersTable)
      .values({
        id,
        email: `${nickname}@perftest.truco.ar`,
        passwordHash,
        nickname,
        nicknameLower: nickname.toLowerCase(),
        isGuest: false,
        role: 'PLAYER',
        status: 'ACTIVE',
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing({ target: usersTable.nicknameLower });
    await db
      .insert(profilesTable)
      .values({ userId: id, createdAt: now, updatedAt: now })
      .onConflictDoNothing();
  }

  await handle.close();
  console.log('Perf seed listo: ruleset + 100 usuarios.');
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
