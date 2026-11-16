import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { INITIAL_RULESETS } from '@truco/engine';
import { sql } from 'drizzle-orm';
import { drizzle as drizzleNodePg } from 'drizzle-orm/node-postgres';
import { migrate as migrateNodePg } from 'drizzle-orm/node-postgres/migrator';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import pg from 'pg';
import { generateUuidV7 } from '../common/uuidv7.js';
import * as schema from './schema/index.js';

export const DRIZZLE_DB = Symbol('DRIZZLE_DB');
export const DB_CONNECTION_HANDLE = Symbol('DB_CONNECTION_HANDLE');

export type AppDatabase = PgDatabase<PgQueryResultHKT, typeof schema>;

export interface DatabaseConnectionHandle {
  readonly kind: 'postgres' | 'pglite';
  readonly db: AppDatabase;
  checkReady(): Promise<boolean>;
  close(): Promise<void>;
}

const currentDir = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_MIGRATIONS_FOLDER = path.resolve(currentDir, '../../drizzle');

export async function seedInitialRulesets(db: AppDatabase): Promise<void> {
  for (const rs of INITIAL_RULESETS) {
    await db
      .insert(schema.rulesetsTable)
      .values({
        id: generateUuidV7(),
        code: rs.code,
        version: rs.version,
        config: rs as unknown as Record<string, unknown>,
      })
      .onConflictDoNothing({ target: schema.rulesetsTable.code });
  }
}

export interface CreatePostgresConnectionOptions {
  readonly databaseUrl: string;
  readonly runMigrations?: boolean;
  readonly migrationsFolder?: string;
  readonly isolatedSchema?: string;
}

export async function createPostgresDatabase(
  options: CreatePostgresConnectionOptions,
): Promise<DatabaseConnectionHandle> {
  const migrationsFolder = options.migrationsFolder ?? DEFAULT_MIGRATIONS_FOLDER;
  const schemaName = options.isolatedSchema;

  if (schemaName && !/^[a-z0-9_]+$/.test(schemaName)) {
    throw new Error(`Nombre de esquema aislado inválido: ${schemaName}`);
  }

  if (schemaName) {
    const bootstrapClient = new pg.Client({ connectionString: options.databaseUrl });
    await bootstrapClient.connect();
    try {
      await bootstrapClient.query(`CREATE SCHEMA IF NOT EXISTS "${schemaName}"`);
    } finally {
      await bootstrapClient.end();
    }
  }

  const pool = new pg.Pool({
    connectionString: options.databaseUrl,
    max: schemaName ? 4 : 15,
    ...(schemaName ? { options: `-c search_path=${schemaName},public` } : {}),
  });

  const db = drizzleNodePg(pool, { schema }) as unknown as AppDatabase;

  if (options.runMigrations ?? true) {
    await migrateNodePg(pool ? drizzleNodePg(pool, { schema }) : (db as never), {
      migrationsFolder,
      ...(schemaName ? { migrationsSchema: schemaName } : {}),
    });
    await seedInitialRulesets(db);
  }

  let closed = false;
  return {
    kind: 'postgres',
    db,
    async checkReady(): Promise<boolean> {
      if (closed) return false;
      try {
        await db.execute(sql`SELECT 1`);
        return true;
      } catch {
        return false;
      }
    },
    async close(): Promise<void> {
      if (closed) return;
      closed = true;
      if (schemaName) {
        try {
          await pool.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
        } catch {
          // Ignorar errores de limpieza de esquema efímero al cerrar
        }
      }
      await pool.end();
    },
  };
}

export async function createPgliteDatabase(
  migrationsFolder = DEFAULT_MIGRATIONS_FOLDER,
): Promise<DatabaseConnectionHandle> {
  const [{ PGlite }, { drizzle: drizzlePglite }, { migrate: migratePglite }] = await Promise.all([
    import('@electric-sql/pglite'),
    import('drizzle-orm/pglite'),
    import('drizzle-orm/pglite/migrator'),
  ]);

  const pglite = new PGlite();
  const rawDb = drizzlePglite(pglite, { schema });
  await migratePglite(rawDb, { migrationsFolder });
  const db = rawDb as unknown as AppDatabase;
  await seedInitialRulesets(db);

  let closed = false;
  return {
    kind: 'pglite',
    db,
    async checkReady(): Promise<boolean> {
      if (closed) return false;
      try {
        await db.execute(sql`SELECT 1`);
        return true;
      } catch {
        return false;
      }
    },
    async close(): Promise<void> {
      if (closed) return;
      closed = true;
      await pglite.close();
    },
  };
}

/**
 * Crea una base migrada con las MISMAS migraciones SQL de Drizzle:
 * - Si `DATABASE_URL` está definido (p. ej. PostgreSQL 16 real en GitHub Actions CI), usa `pg.Pool` en un esquema aislado.
 * - Si no está definido (sandbox local sin Docker), usa `PGlite` (PostgreSQL real WASM en memoria).
 */
export async function createAdaptiveTestDatabase(): Promise<DatabaseConnectionHandle> {
  const dbUrl = process.env['DATABASE_URL'];
  if (dbUrl && dbUrl.trim().length > 0) {
    const isolatedSchema = `test_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    return createPostgresDatabase({
      databaseUrl: dbUrl,
      runMigrations: true,
      isolatedSchema,
    });
  }
  return createPgliteDatabase();
}
