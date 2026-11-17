import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generateUuidV7 } from '../../common/uuidv7.js';
import { createAdaptiveTestDatabase, type DatabaseConnectionHandle } from '../database.provider.js';

/**
 * M7 — `audit_logs` es inmutable a nivel base de datos: no alcanza con no exponer
 * endpoints de borrado, el propio PostgreSQL rechaza UPDATE y DELETE (trigger).
 */
/** Drizzle envuelve el error del driver: buscamos el mensaje en la cadena de `cause`. */
async function rejectionMessage(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    return '';
  } catch (err) {
    const messages: string[] = [];
    let current: unknown = err;
    while (current instanceof Error) {
      messages.push(current.message);
      current = (current as Error & { cause?: unknown }).cause;
    }
    return messages.join(' | ');
  }
}

describe('M7 — inmutabilidad de audit_logs', () => {
  let dbHandle: DatabaseConnectionHandle;

  beforeAll(async () => {
    dbHandle = await createAdaptiveTestDatabase();
    const now = new Date();
    await dbHandle.db.execute(sql`
      INSERT INTO users (id, nickname, nickname_lower, is_guest, role, status)
      VALUES (${generateUuidV7(now.getTime())}, 'AuditTester', 'audittester', false, 'MODERATOR', 'ACTIVE')
    `);
    const rows = await dbHandle.db.execute<{ id: string }>(sql`SELECT id FROM users LIMIT 1`);
    const actorId = (rows as unknown as { rows: Array<{ id: string }> }).rows?.[0]?.id;
    await dbHandle.db.execute(sql`
      INSERT INTO audit_logs (id, actor_id, action, entity, entity_id, reason)
      VALUES (${generateUuidV7(now.getTime() + 1)}, ${actorId ?? null}, 'ADMIN_LOGIN_SUCCESS', 'admin_session', 'sess-1', 'prueba de inmutabilidad')
    `);
  });

  afterAll(async () => {
    await dbHandle.close();
  });

  it('rechaza UPDATE sobre audit_logs', async () => {
    const message = await rejectionMessage(
      dbHandle.db.execute(sql`UPDATE audit_logs SET action = 'TAMPERED'`),
    );
    expect(message).toMatch(/inmutable/i);
  });

  it('rechaza DELETE sobre audit_logs', async () => {
    const message = await rejectionMessage(dbHandle.db.execute(sql`DELETE FROM audit_logs`));
    expect(message).toMatch(/inmutable/i);
  });

  it('el registro original sigue intacto después de los intentos', async () => {
    const result = await dbHandle.db.execute<{ action: string; reason: string }>(
      sql`SELECT action, reason FROM audit_logs`,
    );
    const rows = (result as unknown as { rows: Array<{ action: string; reason: string }> }).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.action).toBe('ADMIN_LOGIN_SUCCESS');
    expect(rows[0]?.reason).toBe('prueba de inmutabilidad');
  });
});
