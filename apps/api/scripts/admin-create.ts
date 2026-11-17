#!/usr/bin/env node
/**
 * CLI para crear el PRIMER operador del panel (no existe endpoint público de alta).
 *
 * Uso:
 *   pnpm --filter @truco/api admin:create -- --email admin@truco.ar --nickname AdminUno \
 *     --password 'ClaveLarga123' --role ADMIN [--seed-db]
 *
 * Imprime el secreto TOTP y los códigos de recuperación por stdout UNA sola vez.
 * Requiere `DATABASE_URL` (o ejecutarse dentro del stack con `--seed-db`).
 */
import { eq } from 'drizzle-orm';
import { AdminAuthService } from '../src/modules/admin/admin-auth.service.js';
import { buildAdminRuntimeConfig } from '../src/modules/admin/admin.config.js';
import { AdminRepository } from '../src/modules/admin/admin.repository.js';
import { AuditRepository } from '../src/modules/audit/audit.repository.js';
import { PasswordHasher } from '../src/modules/auth/security/password-hasher.js';
import { InMemoryRateLimitStore } from '../src/common/rate-limit/in-memory-rate-limit-store.js';
import { generateUuidV7 } from '../src/common/uuidv7.js';
import { createPostgresDatabase } from '../src/db/database.provider.js';
import { profilesTable, usersTable } from '../src/db/schema/index.js';
import type { AdminRole } from '@truco/shared';

interface Args {
  email: string;
  nickname: string;
  password: string;
  role: AdminRole;
}

function parseArgs(argv: string[]): Args {
  const values = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg?.startsWith('--')) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) {
      values.set(key, next);
      i++;
    } else {
      values.set(key, 'true');
    }
  }
  const email = values.get('email');
  const nickname = values.get('nickname');
  const password = values.get('password');
  const role = (values.get('role') ?? 'ADMIN') as AdminRole;
  if (!email || !nickname || !password) {
    throw new Error('Faltan argumentos: --email, --nickname y --password son obligatorios.');
  }
  if (!['SUPPORT', 'MODERATOR', 'ADMIN'].includes(role)) {
    throw new Error('--role debe ser SUPPORT, MODERATOR o ADMIN.');
  }
  if (password.length < 12) {
    throw new Error('La contraseña del panel debe tener al menos 12 caracteres.');
  }
  return { email: email.trim().toLowerCase(), nickname, password, role };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const databaseUrl = process.env['DATABASE_URL'];
  if (!databaseUrl) {
    throw new Error('DATABASE_URL no está definido: no hay base de datos a la que conectarse.');
  }

  const dbHandle = await createPostgresDatabase({ databaseUrl, runMigrations: true });
  try {
    const db = dbHandle.db;
    const [existing] = await db.select().from(usersTable).where(eq(usersTable.email, args.email));
    const passwordHasher = new PasswordHasher();
    const passwordHash = await passwordHasher.hashPassword(args.password);
    const now = new Date();

    let userId: string;
    if (existing) {
      await db
        .update(usersTable)
        .set({ role: args.role, passwordHash, isGuest: false, status: 'ACTIVE', updatedAt: now })
        .where(eq(usersTable.id, existing.id));
      userId = existing.id;
      console.log(`↻ Operador existente actualizado: ${args.email} (${args.role})`);
    } else {
      userId = generateUuidV7(now.getTime());
      await db.insert(usersTable).values({
        id: userId,
        email: args.email,
        emailVerifiedAt: now,
        passwordHash,
        nickname: args.nickname,
        nicknameLower: args.nickname.toLowerCase(),
        isGuest: false,
        role: args.role,
        status: 'ACTIVE',
        createdAt: now,
        updatedAt: now,
      });
      await db.insert(profilesTable).values({ userId, createdAt: now, updatedAt: now });
      console.log(`✓ Operador creado: ${args.email} (${args.role})`);
    }

    const config = buildAdminRuntimeConfig({}, process.env['SESSION_SECRET']);
    const authService = new AdminAuthService(
      config,
      new AdminRepository(db),
      passwordHasher,
      new InMemoryRateLimitStore(),
      new AuditRepository(db),
    );
    const bootstrap = await authService.bootstrapTwoFactor(userId);

    console.log('');
    console.log('══════════════════════════════════════════════════════════════');
    console.log('  Segundo factor (TOTP) — guardá esto, no se vuelve a mostrar');
    console.log('══════════════════════════════════════════════════════════════');
    console.log(`  Secreto base32: ${bootstrap.secret}`);
    console.log(`  URI otpauth:    ${bootstrap.otpauthUri}`);
    console.log('  Códigos de recuperación (un solo uso):');
    for (const code of bootstrap.recoveryCodes) console.log(`    - ${code}`);
    console.log('══════════════════════════════════════════════════════════════');
  } finally {
    await dbHandle.close();
  }
}

main().catch((err) => {
  console.error(`✖ ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
