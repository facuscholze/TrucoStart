import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApiApp } from '../../../bootstrap.js';
import {
  createAdaptiveTestDatabase,
  type DatabaseConnectionHandle,
} from '../../../db/database.provider.js';
import { usersTable } from '../../../db/schema/index.js';
import { buildCookieHeader, extractAuthCookies } from '../../auth/tests/test-cookie-jar.js';

const SESSION_SECRET = 'm7-internal-secret-minimo-32-chars!!!!!!!!!';
const INTERNAL_SECRET = 'm7-internal-rpc-secret-32-chars!!!!!!!!';

describe('M7 — endpoint interno de moderación para el game-server', () => {
  let dbHandle: DatabaseConnectionHandle;
  let app: NestFastifyApplication;
  const clockMs = Date.UTC(2026, 10, 25, 12, 0, 0);

  beforeAll(async () => {
    dbHandle = await createAdaptiveTestDatabase();
    app = await createApiApp({
      dbHandle,
      trustProxy: true,
      authOptions: {
        runtimeConfig: { sessionSecret: SESSION_SECRET, nowFn: () => clockMs },
        rateLimitConfig: { maxPerIp: 500, maxPerAccount: 500, nowFn: () => clockMs },
      },
      moderationOptions: {
        runtimeConfig: { nowFn: () => clockMs, internalSecret: INTERNAL_SECRET },
      },
    });
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    await dbHandle.close();
  });

  async function registerUser(email: string, nickname: string) {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/auth/register',
      payload: { email, password: 'ClaveFuerte123', nickname },
    });
    expect(res.statusCode).toBe(201);
    return {
      id: res.json().user.id as string,
      cookie: buildCookieHeader(extractAuthCookies(res.headers['set-cookie']).map),
    };
  }

  it('rechaza el acceso sin secreto interno o con uno inválido', async () => {
    const user = await registerUser('interna1@truco.ar', 'InternoUno');

    const noSecret = await app.inject({
      method: 'GET',
      url: `/v1/internal/moderation/${user.id}`,
    });
    expect(noSecret.statusCode).toBe(401);

    const wrong = await app.inject({
      method: 'GET',
      url: `/v1/internal/moderation/${user.id}`,
      headers: { 'x-internal-secret': 'secreto-incorrecto-de-32-caracteres!!' },
    });
    expect(wrong.statusCode).toBe(401);
  });

  it('devuelve el estado ACTIVE y refleja un silencio vigente', async () => {
    const user = await registerUser('interna2@truco.ar', 'InternoDos');

    const initial = await app.inject({
      method: 'GET',
      url: `/v1/internal/moderation/${user.id}`,
      headers: { 'x-internal-secret': INTERNAL_SECRET },
    });
    expect(initial.statusCode).toBe(200);
    expect(initial.json().accountStatus).toBe('ACTIVE');
    expect(initial.json().mutedUntil).toBeNull();

    const mutedUntilDate = new Date(clockMs + 3_600_000);
    const until = mutedUntilDate.toISOString();
    await dbHandle.db
      .update(usersTable)
      .set({ mutedUntil: mutedUntilDate })
      .where(eq(usersTable.id, user.id));

    const muted = await app.inject({
      method: 'GET',
      url: `/v1/internal/moderation/${user.id}`,
      headers: { 'x-internal-secret': INTERNAL_SECRET },
    });
    expect(muted.json().mutedUntil).toBe(until);

    // El jugador silenciado sigue viendo su propio estado desde el endpoint público.
    const me = await app.inject({
      method: 'GET',
      url: '/v1/me/moderation',
      headers: { cookie: user.cookie },
    });
    expect(me.statusCode).toBe(200);
    expect(me.json().mutedUntil).toBe(until);
  });

  it('reporta una cuenta suspendida con motivo y vencimiento', async () => {
    const user = await registerUser('interna3@truco.ar', 'InternoTres');
    const expiresAtDate = new Date(clockMs + 86_400_000);
    const expiresAt = expiresAtDate.toISOString();
    await dbHandle.db
      .update(usersTable)
      .set({
        status: 'SUSPENDED',
        statusReason: 'Abandono reiterado',
        statusExpiresAt: expiresAtDate,
      })
      .where(eq(usersTable.id, user.id));

    const res = await app.inject({
      method: 'GET',
      url: `/v1/internal/moderation/${user.id}`,
      headers: { 'x-internal-secret': INTERNAL_SECRET },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      accountStatus: 'SUSPENDED',
      statusReason: 'Abandono reiterado',
      statusExpiresAt: expiresAt,
    });
  });

  it('una cuenta inexistente se informa como no habilitada', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/internal/moderation/019a7e40-0000-7000-8000-0000000000ff',
      headers: { 'x-internal-secret': INTERNAL_SECRET },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().accountStatus).toBe('DELETED');
  });
});
