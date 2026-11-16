import { eq } from 'drizzle-orm';
import pino from 'pino';
import { PasswordHasher } from '../modules/auth/security/password-hasher.js';
import { type AppDatabase, createPostgresDatabase } from './database.provider.js';
import { profilesTable, usersTable } from './schema/index.js';

export const DEV_SEED_PASSWORD = 'TrucoDev2026!';

export interface DevSeedAccountSpec {
  readonly id: string;
  readonly email: string;
  readonly nickname: string;
  readonly avatarId: string;
  readonly bio: string;
}

export const DEV_SEED_ACCOUNTS: readonly DevSeedAccountSpec[] = [
  {
    id: '019a7e40-0000-7000-8000-00000000d001',
    email: 'facundo@truco.local',
    nickname: 'FacuCordoba',
    avatarId: 'mate-classic',
    bio: 'Mano brava desde Nueva Córdoba.',
  },
  {
    id: '019a7e40-0000-7000-8000-00000000d002',
    email: 'lucia@truco.local',
    nickname: 'LuciaDelSur',
    avatarId: 'sol-dorado',
    bio: 'Envido primero, preguntas después.',
  },
  {
    id: '019a7e40-0000-7000-8000-00000000d003',
    email: 'martin@truco.local',
    nickname: 'TinchoMano',
    avatarId: 'espada-criolla',
    bio: 'Pie de equipo en 2v2 con señas limpias.',
  },
  {
    id: '019a7e40-0000-7000-8000-00000000d004',
    email: 'sofia@truco.local',
    nickname: 'SofiEnvido',
    avatarId: 'copa-bar',
    bio: ' treinta y tres de mano garantizados.',
  },
] as const;

export async function seedDevelopmentUsers(
  db: AppDatabase,
  options: { readonly nodeEnv?: string } = {},
): Promise<{ readonly inserted: number; readonly skipped: number }> {
  const effectiveEnv = options.nodeEnv ?? process.env['NODE_ENV'] ?? 'development';
  if (effectiveEnv === 'production') {
    throw new Error('El seed de usuarios de prueba está prohibido cuando NODE_ENV=production');
  }

  const hasher = new PasswordHasher();
  const passwordHash = await hasher.hashPassword(DEV_SEED_PASSWORD);
  const now = new Date();

  let inserted = 0;
  let skipped = 0;

  for (const spec of DEV_SEED_ACCOUNTS) {
    const existing = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.email, spec.email))
      .limit(1);

    if (existing[0]) {
      skipped += 1;
      continue;
    }

    await db.transaction(async (tx) => {
      const created = await tx
        .insert(usersTable)
        .values({
          id: spec.id,
          email: spec.email,
          emailVerifiedAt: now,
          passwordHash,
          nickname: spec.nickname,
          nicknameLower: spec.nickname.toLowerCase(),
          isGuest: false,
          role: 'PLAYER',
          status: 'ACTIVE',
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoNothing({ target: usersTable.email })
        .returning({ id: usersTable.id });

      if (!created[0]) {
        skipped += 1;
        return;
      }

      await tx
        .insert(profilesTable)
        .values({
          userId: created[0].id,
          avatarId: spec.avatarId,
          level: 1,
          xp: 0,
          bio: spec.bio.trim(),
          settings: {
            soundEnabled: true,
            animationsReduced: false,
            confirmCalls: false,
          },
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoNothing({ target: profilesTable.userId });

      inserted += 1;
    });
  }

  return { inserted, skipped };
}

async function runCli(): Promise<void> {
  const logger = pino({ name: 'truco-seed-dev' });
  const databaseUrl = process.env['DATABASE_URL'];
  if (!databaseUrl) {
    throw new Error('DATABASE_URL es obligatorio para ejecutar db:seed:dev');
  }

  const handle = await createPostgresDatabase({
    databaseUrl,
    runMigrations: true,
  });

  try {
    const summary = await seedDevelopmentUsers(handle.db);
    logger.info(
      {
        ...summary,
        accounts: DEV_SEED_ACCOUNTS.map((a) => ({ email: a.email, nickname: a.nickname })),
      },
      'Seed de desarrollo completado',
    );
  } finally {
    await handle.close();
  }
}

const isMainModule =
  typeof process.argv[1] === 'string' &&
  (process.argv[1].endsWith('seed-dev.ts') || process.argv[1].endsWith('seed-dev.js'));

if (isMainModule) {
  void runCli();
}
