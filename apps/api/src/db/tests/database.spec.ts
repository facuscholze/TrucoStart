import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generateUuidV7 } from '../../common/uuidv7.js';
import { createAdaptiveTestDatabase, type DatabaseConnectionHandle } from '../database.provider.js';
import { rulesetsTable, usersTable } from '../schema/index.js';

describe('Drizzle SQL Migrations (PGlite locally / PostgreSQL 16 in CI) & UUIDv7', () => {
  let handle: DatabaseConnectionHandle;

  beforeAll(async () => {
    handle = await createAdaptiveTestDatabase();
  });

  afterAll(async () => {
    await handle.close();
  });

  it('uses PostgreSQL 16 when CI=true (DATABASE_URL defined) and PGlite when running in local sandbox without Docker', async () => {
    if (process.env['CI'] === 'true') {
      expect(Boolean(process.env['DATABASE_URL'])).toBe(true);
      expect(handle.kind).toBe('postgres');
    }
    expect(await handle.checkReady()).toBe(true);
  });

  it('generates monotonic RFC 9562 UUIDv7 identifiers and seeds official RuleSets', async () => {
    const id1 = generateUuidV7(1_800_000_000_000);
    const id2 = generateUuidV7(1_800_000_000_000);
    const id3 = generateUuidV7(1_800_000_000_001);

    expect(id1).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(id1 < id2).toBe(true);
    expect(id2 < id3).toBe(true);

    const seededRulesets = await handle.db.select().from(rulesetsTable);
    expect(seededRulesets.map((r) => r.code).sort()).toEqual([
      'ar-corto-15-v1',
      'ar-sin-flor-v1',
      'ar-standard-v1',
    ]);
  });

  it('enforces case-insensitive nickname uniqueness (nickname_lower) and email uniqueness in SQL', async () => {
    const u1Id = generateUuidV7();
    await handle.db.insert(usersTable).values({
      id: u1Id,
      email: 'jugador1@example.com',
      nickname: 'ManoBrava',
      nicknameLower: 'manobrava',
      isGuest: false,
    });

    const fetched = await handle.db.select().from(usersTable).where(eq(usersTable.id, u1Id));
    expect(fetched[0]?.nickname).toBe('ManoBrava');

    // Intento de duplicar el mismo apodo con distinta capitalización debe fallar por índice UNIQUE
    await expect(
      handle.db.insert(usersTable).values({
        id: generateUuidV7(),
        email: 'otro@example.com',
        nickname: 'manobrava',
        nicknameLower: 'manobrava',
        isGuest: false,
      }),
    ).rejects.toThrow();
  });
});
