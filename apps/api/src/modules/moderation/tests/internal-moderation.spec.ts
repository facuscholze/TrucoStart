import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { signInternalRequestHeaders } from '@truco/shared';
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
      trustProxyCidrs: ['127.0.0.1/32'],
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

  function signedHeaders(method: string, path: string, rawBody = '') {
    return signInternalRequestHeaders({
      method,
      path,
      rawBody,
      secret: INTERNAL_SECRET,
      nowMs: clockMs,
    });
  }

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

  it('rechaza llamadas sin firma, con firma inválida o fuera de la ventana de reloj', async () => {
    const user = await registerUser('interna1@truco.ar', 'InternoUno');
    const path = `/v1/internal/moderation/${user.id}`;

    const unsigned = await app.inject({ method: 'GET', url: path });
    expect(unsigned.statusCode).toBe(401);

    const wrongSecret = await app.inject({
      method: 'GET',
      url: path,
      headers: signInternalRequestHeaders({
        method: 'GET',
        path,
        secret: 'secreto-incorrecto-de-32-caracteres!!',
        nowMs: clockMs,
      }),
    });
    expect(wrongSecret.statusCode).toBe(401);

    // Timestamp fuera de la ventana de ±30 s.
    const stale = await app.inject({
      method: 'GET',
      url: path,
      headers: signInternalRequestHeaders({
        method: 'GET',
        path,
        secret: INTERNAL_SECRET,
        nowMs: clockMs - 120_000,
      }),
    });
    expect(stale.statusCode).toBe(401);
    expect(stale.json().error?.message ?? '').toMatch(/Timestamp|ventana/i);
  });

  it('rechaza la reutilización de un nonce (anti-replay)', async () => {
    const user = await registerUser('interna4@truco.ar', 'InternoCuatro');
    const path = `/v1/internal/moderation/${user.id}`;
    const headers = signInternalRequestHeaders({
      method: 'GET',
      path,
      secret: INTERNAL_SECRET,
      nowMs: clockMs,
    });

    const first = await app.inject({ method: 'GET', url: path, headers });
    expect(first.statusCode).toBe(200);

    const replay = await app.inject({ method: 'GET', url: path, headers });
    expect(replay.statusCode).toBe(401);
    expect(replay.json().error?.message ?? '').toMatch(/Replay|nonce/i);
  });

  it('devuelve el estado ACTIVE y refleja un silencio vigente', async () => {
    const user = await registerUser('interna2@truco.ar', 'InternoDos');

    const initial = await app.inject({
      method: 'GET',
      url: `/v1/internal/moderation/${user.id}`,
      headers: signedHeaders('GET', `/v1/internal/moderation/${user.id}`),
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
      headers: signedHeaders('GET', `/v1/internal/moderation/${user.id}`),
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
      headers: signedHeaders('GET', `/v1/internal/moderation/${user.id}`),
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
      headers: signedHeaders('GET', '/v1/internal/moderation/019a7e40-0000-7000-8000-0000000000ff'),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().accountStatus).toBe('DELETED');
  });
});
