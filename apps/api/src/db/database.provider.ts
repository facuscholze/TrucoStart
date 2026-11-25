import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { INITIAL_RULESETS } from '@truco/engine';
import { sql, type ExtractTablesWithRelations } from 'drizzle-orm';
import { drizzle as drizzleNodePg } from 'drizzle-orm/node-postgres';
import { migrate as migrateNodePg } from 'drizzle-orm/node-postgres/migrator';
import type { PgDatabase, PgQueryResultHKT, PgTransaction } from 'drizzle-orm/pg-core';
import pg from 'pg';
import { generateUuidV7 } from '../common/uuidv7.js';
import * as schema from './schema/index.js';

export const DRIZZLE_DB = Symbol('DRIZZLE_DB');
export const DB_CONNECTION_HANDLE = Symbol('DB_CONNECTION_HANDLE');

export type AppDatabase = PgDatabase<PgQueryResultHKT, typeof schema>;
export type AppTransaction = PgTransaction<
  PgQueryResultHKT,
  typeof schema,
  ExtractTablesWithRelations<typeof schema>
>;

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
  readonly isolatedDatabaseName?: string;
}

function replaceDatabaseNameInUrl(rawUrl: string, dbName: string): string {
  const parsed = new URL(rawUrl);
  parsed.pathname = `/${dbName}`;
  return parsed.toString();
}

export async function createPostgresDatabase(
  options: CreatePostgresConnectionOptions,
): Promise<DatabaseConnectionHandle> {
  const migrationsFolder = options.migrationsFolder ?? DEFAULT_MIGRATIONS_FOLDER;
  const ephemeralDb = options.isolatedDatabaseName;

  if (ephemeralDb && !/^[a-z0-9_]+$/.test(ephemeralDb)) {
    throw new Error(`Nombre de base efímera inválido: ${ephemeralDb}`);
  }

  let effectiveUrl = options.databaseUrl;
  if (ephemeralDb) {
    const adminClient = new pg.Client({ connectionString: options.databaseUrl });
    await adminClient.connect();
    try {
      await adminClient.query(`CREATE DATABASE "${ephemeralDb}"`);
    } finally {
      await adminClient.end();
    }
    effectiveUrl = replaceDatabaseNameInUrl(options.databaseUrl, ephemeralDb);
  }

  const pool = new pg.Pool({
    connectionString: effectiveUrl,
    max: ephemeralDb ? 4 : 15,
  });

  const nodePgDb = drizzleNodePg(pool, { schema });
  const db = nodePgDb as unknown as AppDatabase;

  try {
    if (options.runMigrations ?? true) {
      await migrateNodePg(nodePgDb, { migrationsFolder });
      await seedInitialRulesets(db);
    }
  } catch (err) {
    await pool.end().catch(() => undefined);
    if (ephemeralDb) {
      const cleanupClient = new pg.Client({ connectionString: options.databaseUrl });
      await cleanupClient
        .connect()
        .then(() => cleanupClient.query(`DROP DATABASE IF EXISTS "${ephemeralDb}" WITH (FORCE)`))
        .catch(() => undefined)
        .finally(() => cleanupClient.end().catch(() => undefined));
    }
    throw err;
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
      await pool.end();
      if (ephemeralDb) {
        const adminClient = new pg.Client({ connectionString: options.databaseUrl });
        try {
          await adminClient.connect();
          await adminClient.query(`DROP DATABASE IF EXISTS "${ephemeralDb}" WITH (FORCE)`);
        } catch {
          // Ignorar errores de limpieza de base efímera al cerrar
        } finally {
          await adminClient.end().catch(() => undefined);
        }
      }
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
 * - Si `DATABASE_URL` está definido (p. ej. PostgreSQL 16 real en GitHub Actions CI), crea una base efímera aislada
 *   y ejecuta las migraciones sin modificar sobre el esquema real `public`.
 * - Si no está definido (sandbox local sin Docker), usa `PGlite` (PostgreSQL real WASM en memoria).
 */
export async function createAdaptiveTestDatabase(): Promise<DatabaseConnectionHandle> {
  const dbUrl = process.env['DATABASE_URL'];
  if (dbUrl && dbUrl.trim().length > 0) {
    const isolatedDatabaseName = `truco_test_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    return createPostgresDatabase({
      databaseUrl: dbUrl,
      runMigrations: true,
      isolatedDatabaseName,
    });
  }
  return createPgliteDatabase();
}
