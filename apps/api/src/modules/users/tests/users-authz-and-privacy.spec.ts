import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { TUTORIAL_LESSON_IDS } from '@truco/shared';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApiApp } from '../../../bootstrap.js';
import { generateUuidV7 } from '../../../common/uuidv7.js';
import {
  createAdaptiveTestDatabase,
  type DatabaseConnectionHandle,
} from '../../../db/database.provider.js';
import { matchesTable, matchPlayersTable, usersTable } from '../../../db/schema/index.js';
import { buildCookieHeader, extractAuthCookies } from '../../auth/tests/test-cookie-jar.js';
import { TEST_LEGAL_ACCEPTANCE } from '../../../common/testing/legal-acceptance.fixture.js';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const COMMITTED_OPENAPI_PATH = path.resolve(currentDir, '../../../../../../docs/openapi.v1.json');

describe('M3 Resource Authorization (User A vs User B), Privacy, Export, Deletion & OpenAPI', () => {
  let dbHandle: DatabaseConnectionHandle;
  let app: NestFastifyApplication;
  let clockMs = Date.UTC(2026, 10, 16, 16, 0, 0);

  beforeAll(async () => {
    dbHandle = await createAdaptiveTestDatabase();
    app = await createApiApp({
      dbHandle,
      trustProxyCidrs: ['127.0.0.1/32'],
      authOptions: {
        runtimeConfig: {
          sessionSecret: 'users-authz-secret-minimum-32-characters!!',
          nowFn: () => clockMs,
        },
      },
    });
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    await dbHandle.close();
  });

  it('exposes own-account mutations/exports exclusively under /v1/me, enforces 403 on cross-user sessions, and strips PII from public endpoints', async () => {
    const resA = await app.inject({
      method: 'POST',
      url: '/v1/auth/register',
      headers: { 'x-forwarded-for': '192.0.2.10' },
      payload: {
        email: 'user.a@truco.ar',
        password: 'ClaveUserA123',
        nickname: 'JugadorAlfa',
        legal: TEST_LEGAL_ACCEPTANCE,
      },
    });
    const resB = await app.inject({
      method: 'POST',
      url: '/v1/auth/register',
      headers: { 'x-forwarded-for': '192.0.2.11' },
      payload: {
        email: 'privado.b@truco.ar',
        password: 'ClaveUserB123',
        nickname: 'JugadorBeta',
        legal: TEST_LEGAL_ACCEPTANCE,
      },
    });

    const userA = resA.json().user;
    const userB = resB.json().user;
    const sessionBId = resB.json().sessionId as string;
    const jarA = extractAuthCookies(resA.headers['set-cookie']).map;

    // 1. Las rutas PATCH /v1/users/:id, GET /v1/users/:id/export y DELETE /v1/users/:id NO existen (404 NOT_FOUND)
    const patchUsersRoute = await app.inject({
      method: 'PATCH',
      url: `/v1/users/${userB.id}`,
      headers: { cookie: buildCookieHeader(jarA) },
      payload: { bio: 'Ruta eliminada' },
    });
    expect(patchUsersRoute.statusCode).toBe(404);

    const exportUsersRoute = await app.inject({
      method: 'GET',
      url: `/v1/users/${userB.id}/export`,
      headers: { cookie: buildCookieHeader(jarA) },
    });
    expect(exportUsersRoute.statusCode).toBe(404);

    const deleteUsersRoute = await app.inject({
      method: 'DELETE',
      url: `/v1/users/${userB.id}`,
      headers: { cookie: buildCookieHeader(jarA) },
      payload: { password: 'ClaveUserB123' },
    });
    expect(deleteUsersRoute.statusCode).toBe(404);

    // 2. User A intenta revocar la sesión activa de User B -> 403 FORBIDDEN
    const revokeBAttempt = await app.inject({
      method: 'DELETE',
      url: `/v1/auth/sessions/${sessionBId}`,
      headers: { cookie: buildCookieHeader(jarA) },
    });
    expect(revokeBAttempt.statusCode).toBe(403);
    expect(revokeBAttempt.json().error.code).toBe('FORBIDDEN');

    // 3. GET /v1/users/:id solo devuelve campos públicos (jamás email, passwordHash, googleSub ni settings)
    const publicB = await app.inject({
      method: 'GET',
      url: `/v1/users/${userB.id}`,
    });
    expect(publicB.statusCode).toBe(200);
    const pubJson = publicB.json();
    expect(pubJson.nickname).toBe('JugadorBeta');
    expect('email' in pubJson).toBe(false);
    expect('passwordHash' in pubJson).toBe(false);
    expect('googleSub' in pubJson).toBe(false);
    expect('settings' in pubJson).toBe(false);

    // 4. User A actualiza exclusivamente su propio perfil vía PATCH /v1/me
    const ownPatch = await app.inject({
      method: 'PATCH',
      url: '/v1/me',
      headers: { cookie: buildCookieHeader(jarA) },
      payload: {
        nickname: 'AlfaRenovado',
        bio: 'Juego sin flor los domingos',
        settings: { confirmCalls: true },
      },
    });
    expect(ownPatch.statusCode).toBe(200);
    expect(ownPatch.json().user.nickname).toBe('AlfaRenovado');
    expect(ownPatch.json().profile.settings.confirmCalls).toBe(true);
    expect(ownPatch.json().user.id).toBe(userA.id);

    const tutorialUpdate = await app.inject({
      method: 'PUT',
      url: '/v1/me/tutorial',
      headers: { cookie: buildCookieHeader(jarA) },
      payload: { completedLessons: TUTORIAL_LESSON_IDS },
    });
    expect(tutorialUpdate.statusCode).toBe(200);
    expect(tutorialUpdate.json().completedLessons).toEqual(TUTORIAL_LESSON_IDS);

    const progression = await app.inject({
      method: 'GET',
      url: '/v1/me/progression',
      headers: { cookie: buildCookieHeader(jarA) },
    });
    expect(progression.statusCode).toBe(200);
    expect(progression.json().wallet).toMatchObject({
      currencyType: 'VIRTUAL_COIN',
      hasEconomicValue: false,
      playerTransfersEnabled: false,
      moneyPurchasesEnabled: false,
    });
    expect(progression.json().missions).toEqual(expect.any(Array));
    expect(progression.json().achievements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'tutorial_graduate', unlockedAt: expect.any(String) }),
      ]),
    );
    expect((await app.inject({ method: 'GET', url: '/v1/me/progression' })).statusCode).toBe(401);

    const missingMission = await app.inject({
      method: 'POST',
      url: `/v1/me/progression/missions/${generateUuidV7(clockMs)}/claim`,
      headers: { cookie: buildCookieHeader(jarA) },
    });
    expect(missingMission.statusCode).toBe(404);
  });

  it('computes stats, cursor-paginates match history, exports account data, and anonymizes PII on deletion', async () => {
    const reg = await app.inject({
      method: 'POST',
      url: '/v1/auth/register',
      headers: { 'x-forwarded-for': '192.0.2.50' },
      payload: {
        email: 'export.delete@truco.ar',
        password: 'ClaveBorrar123',
        nickname: 'ExportadorSur',
        legal: TEST_LEGAL_ACCEPTANCE,
      },
    });
    const userId = reg.json().user.id as string;
    const jar = extractAuthCookies(reg.headers['set-cookie']).map;

    // Insertar 3 partidas ordenadas por UUIDv7 para verificar stats y paginación por cursor
    const outcomes = ['WIN', 'LOSS', 'WIN'] as const;
    for (let i = 0; i < outcomes.length; i++) {
      clockMs += 10_000;
      const mId = generateUuidV7(clockMs);
      await dbHandle.db.insert(matchesTable).values({
        id: mId,
        mode: '1v1',
        rulesetCode: 'ar-standard-v1',
        seedCommitment: 'b'.repeat(64),
        startedAt: new Date(clockMs - 5_000),
        endedAt: new Date(clockMs),
      });
      await dbHandle.db.insert(matchPlayersTable).values({
        matchId: mId,
        seat: 0,
        userId,
        team: 0,
        score: outcomes[i] === 'WIN' ? 30 : 18,
        outcome: outcomes[i]!,
      });
    }

    // Los encuentros con bots pueden aparecer en el historial, pero no alteran estadísticas públicas.
    clockMs += 10_000;
    const botMatchId = generateUuidV7(clockMs);
    await dbHandle.db.insert(matchesTable).values({
      id: botMatchId,
      mode: '1v1',
      rulesetCode: 'ar-standard-v1',
      seedCommitment: 'c'.repeat(64),
      startedAt: new Date(clockMs - 5_000),
      endedAt: new Date(clockMs),
      hasBots: true,
      isPractice: false,
    });
    await dbHandle.db.insert(matchPlayersTable).values({
      matchId: botMatchId,
      seat: 0,
      userId,
      team: 0,
      score: 30,
      outcome: 'WIN',
    });

    // La práctica se excluye también del historial y de las estadísticas públicas.
    clockMs += 10_000;
    const practiceMatchId = generateUuidV7(clockMs);
    await dbHandle.db.insert(matchesTable).values({
      id: practiceMatchId,
      mode: '1v1',
      rulesetCode: 'ar-standard-v1',
      seedCommitment: 'd'.repeat(64),
      startedAt: new Date(clockMs - 5_000),
      endedAt: new Date(clockMs),
      hasBots: false,
      isPractice: true,
    });
    await dbHandle.db.insert(matchPlayersTable).values({
      matchId: practiceMatchId,
      seat: 0,
      userId,
      team: 0,
      score: 30,
      outcome: 'WIN',
    });

    const authHeaders = { cookie: buildCookieHeader(jar) };
    const statsRes = await app.inject({
      method: 'GET',
      url: `/v1/users/${userId}/stats`,
      headers: authHeaders,
    });
    expect(statsRes.statusCode).toBe(200);
    expect(statsRes.json()).toEqual({
      userId,
      matchesPlayed: 3,
      wins: 2,
      losses: 1,
      abandons: 0,
      winRate: 0.6667,
      byMode: {
        '1v1': {
          matchesPlayed: 3,
          wins: 2,
          losses: 1,
          abandons: 0,
          winRate: 0.6667,
          currentStreak: 1,
          envido: { resolved: 0, won: 0, winRate: 0 },
          truco: { resolved: 0, won: 0, winRate: 0 },
        },
        '2v2': {
          matchesPlayed: 0,
          wins: 0,
          losses: 0,
          abandons: 0,
          winRate: 0,
          currentStreak: 0,
          envido: { resolved: 0, won: 0, winRate: 0 },
          truco: { resolved: 0, won: 0, winRate: 0 },
        },
        '3v3': {
          matchesPlayed: 0,
          wins: 0,
          losses: 0,
          abandons: 0,
          winRate: 0,
          currentStreak: 0,
          envido: { resolved: 0, won: 0, winRate: 0 },
          truco: { resolved: 0, won: 0, winRate: 0 },
        },
      },
    });

    const page1 = await app.inject({
      method: 'GET',
      url: `/v1/users/${userId}/matches?limit=2`,
      headers: authHeaders,
    });
    expect(page1.statusCode).toBe(200);
    expect(page1.json().items).toHaveLength(2);
    expect(page1.json().items.some((item: { hasBots: boolean }) => item.hasBots)).toBe(true);
    expect(page1.json().nextCursor).toBeTruthy();

    const page2 = await app.inject({
      method: 'GET',
      url: `/v1/users/${userId}/matches?limit=2&cursor=${page1.json().nextCursor}`,
      headers: authHeaders,
    });
    expect(page2.statusCode).toBe(200);
    expect(page2.json().items).toHaveLength(2);
    expect(page2.json().nextCursor).toBeNull();

    // Exportación propia (GET /v1/me/export)
    const exportRes = await app.inject({
      method: 'GET',
      url: '/v1/me/export',
      headers: { cookie: buildCookieHeader(jar) },
    });
    expect(exportRes.statusCode).toBe(200);
    expect(exportRes.json().user.email).toBe('export.delete@truco.ar');
    expect(exportRes.json().recentMatches).toHaveLength(4);
    expect(
      exportRes.json().recentMatches.some((match: { hasBots: boolean }) => match.hasBots),
    ).toBe(true);
    expect(
      exportRes
        .json()
        .recentMatches.some((match: { matchId: string }) => match.matchId === practiceMatchId),
    ).toBe(false);

    // Intento de borrar con clave errónea -> 401
    const badDel = await app.inject({
      method: 'DELETE',
      url: '/v1/me',
      headers: { cookie: buildCookieHeader(jar) },
      payload: { password: 'Equivocada99' },
    });
    expect(badDel.statusCode).toBe(401);

    // Eliminación válida anonimiza PII, revoca sesiones y oculta perfil público
    const okDel = await app.inject({
      method: 'DELETE',
      url: '/v1/me',
      headers: { cookie: buildCookieHeader(jar) },
      payload: { password: 'ClaveBorrar123' },
    });
    expect(okDel.statusCode).toBe(200);
    expect(okDel.json()).toEqual({ deleted: true, userId });

    const [rawRow] = await dbHandle.db.select().from(usersTable).where(eq(usersTable.id, userId));
    expect(rawRow?.email).toBeNull();
    expect(rawRow?.passwordHash).toBeNull();
    expect(rawRow?.status).toBe('DELETED');
    expect(rawRow?.deletedAt).not.toBeNull();

    const afterMe = await app.inject({
      method: 'GET',
      url: '/v1/me',
      headers: { cookie: buildCookieHeader(jar) },
    });
    expect(afterMe.statusCode).toBe(401);

    const afterPublic = await app.inject({ method: 'GET', url: `/v1/users/${userId}` });
    expect(afterPublic.statusCode).toBe(404);
  });

  it('serves GET /v1/openapi.json in exact parity with docs/openapi.v1.json', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/openapi.json' });
    expect(res.statusCode).toBe(200);
    const committed = JSON.parse(readFileSync(COMMITTED_OPENAPI_PATH, 'utf8'));
    expect(res.json()).toEqual(committed);
  });
});
