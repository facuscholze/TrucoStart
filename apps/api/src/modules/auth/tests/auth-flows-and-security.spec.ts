import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { ACCESS_COOKIE_NAME, REFRESH_COOKIE_NAME } from '@truco/shared';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApiApp } from '../../../bootstrap.js';
import { generateUuidV7 } from '../../../common/uuidv7.js';
import {
  createAdaptiveTestDatabase,
  type DatabaseConnectionHandle,
} from '../../../db/database.provider.js';
import {
  auditLogsTable,
  matchesTable,
  matchPlayersTable,
  profilesTable,
} from '../../../db/schema/index.js';
import { ConsoleEmailProvider } from '../providers/email.provider.js';
import {
  createSimulatedGoogleIdToken,
  SimulatedGoogleOAuthVerifier,
} from '../providers/google-oauth.verifier.js';
import { buildCookieHeader, extractAuthCookies } from './test-cookie-jar.js';
import { TEST_LEGAL_ACCEPTANCE } from '../../../common/testing/legal-acceptance.fixture.js';

describe('M3 Auth Flows, Security Hardening & Session Family Protection', () => {
  let dbHandle: DatabaseConnectionHandle;
  let app: NestFastifyApplication;
  let emailProvider: ConsoleEmailProvider;
  let clockMs = Date.UTC(2026, 10, 16, 14, 0, 0);

  beforeAll(async () => {
    dbHandle = await createAdaptiveTestDatabase();
    emailProvider = new ConsoleEmailProvider();
    app = await createApiApp({
      dbHandle,
      trustProxyCidrs: ['127.0.0.1/32'],
      authOptions: {
        emailProvider,
        googleVerifier: new SimulatedGoogleOAuthVerifier({ allowSimulatedTokens: true }),
        runtimeConfig: {
          sessionSecret: 'test-session-secret-m3-with-minimum-32-chars!!',
          nicknameBlockedTerms: ['tramposovip'],
          nowFn: () => clockMs,
        },
        rateLimitConfig: {
          windowMs: 60_000,
          maxPerIp: 12,
          maxPerAccount: 7,
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

  it('sets HttpOnly, Secure, SameSite=Lax cookies and executes full register -> verify -> sessions -> reset -> Google flows', async () => {
    const regRes = await app.inject({
      method: 'POST',
      url: '/v1/auth/register',
      headers: { 'x-forwarded-for': '203.0.113.10', 'user-agent': 'Mozilla/5.0 Android' },
      payload: {
        email: 'Lucia@Truco.ar',
        password: 'ClaveFuerte123',
        nickname: 'LuciaCriolla',
        deviceName: 'Celular Lucia',
        legal: TEST_LEGAL_ACCEPTANCE,
      },
    });
    expect(regRes.statusCode).toBe(201);
    const regBody = regRes.json();
    expect(regBody.user.email).toBe('lucia@truco.ar');
    expect(regBody.user.emailVerified).toBe(false);

    const { parsed, map: jar1 } = extractAuthCookies(regRes.headers['set-cookie']);
    const accessCookie = parsed.find((c) => c.name === ACCESS_COOKIE_NAME)!;
    const refreshCookie = parsed.find((c) => c.name === REFRESH_COOKIE_NAME)!;

    expect(accessCookie.attributes['httponly']).toBe(true);
    expect(accessCookie.attributes['secure']).toBe(true);
    expect(accessCookie.attributes['samesite']?.toString().toLowerCase()).toBe('lax');
    expect(accessCookie.attributes['path']).toBe('/');

    expect(refreshCookie.attributes['httponly']).toBe(true);
    expect(refreshCookie.attributes['secure']).toBe(true);
    expect(refreshCookie.attributes['samesite']?.toString().toLowerCase()).toBe('lax');
    expect(refreshCookie.attributes['path']).toBe('/v1/auth');

    // Verificar email mediante token emitido en ConsoleEmailProvider
    const verifyMsg = emailProvider.getLatestMessageFor('lucia@truco.ar', 'EMAIL_VERIFICATION');
    expect(verifyMsg).toBeDefined();

    const verifyRes = await app.inject({
      method: 'POST',
      url: '/v1/auth/verify-email',
      headers: { 'x-forwarded-for': '203.0.113.10' },
      payload: { token: verifyMsg!.token },
    });
    expect(verifyRes.statusCode).toBe(200);

    const meVerified = await app.inject({
      method: 'GET',
      url: '/v1/me',
      headers: { cookie: buildCookieHeader(jar1) },
    });
    expect(meVerified.statusCode).toBe(200);
    expect(meVerified.json().user.emailVerified).toBe(true);

    // Segundo dispositivo inicia sesión -> listar y revocar sesión
    const login2 = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      headers: { 'x-forwarded-for': '203.0.113.11' },
      payload: {
        email: 'lucia@truco.ar',
        password: 'ClaveFuerte123',
        deviceName: 'Notebook Trabajo',
      },
    });
    expect(login2.statusCode).toBe(200);
    const secondSessionId = login2.json().sessionId as string;
    const jar2 = extractAuthCookies(login2.headers['set-cookie']).map;

    const listRes = await app.inject({
      method: 'GET',
      url: '/v1/auth/sessions',
      headers: { cookie: buildCookieHeader(jar1) },
    });
    expect(listRes.statusCode).toBe(200);
    expect(listRes.json().sessions).toHaveLength(2);

    const revokeRes = await app.inject({
      method: 'DELETE',
      url: `/v1/auth/sessions/${secondSessionId}`,
      headers: { cookie: buildCookieHeader(jar1), 'x-forwarded-for': '203.0.113.10' },
    });
    expect(revokeRes.statusCode).toBe(200);

    // La sesión revocada pierde acceso de inmediato aunque su cookie de 15m no haya vencido
    const revokedMe = await app.inject({
      method: 'GET',
      url: '/v1/me',
      headers: { cookie: buildCookieHeader(jar2) },
    });
    expect(revokedMe.statusCode).toBe(401);

    // Recuperación y cambio de contraseña revoca todas las sesiones previas
    await app.inject({
      method: 'POST',
      url: '/v1/auth/forgot',
      headers: { 'x-forwarded-for': '203.0.113.10' },
      payload: { email: 'lucia@truco.ar' },
    });
    const resetMsg = emailProvider.getLatestMessageFor('lucia@truco.ar', 'PASSWORD_RESET');
    expect(resetMsg).toBeDefined();

    const resetRes = await app.inject({
      method: 'POST',
      url: '/v1/auth/reset',
      headers: { 'x-forwarded-for': '203.0.113.10' },
      payload: { token: resetMsg!.token, newPassword: 'NuevaClaveLucia99' },
    });
    expect(resetRes.statusCode).toBe(200);

    const oldCookieAfterReset = await app.inject({
      method: 'GET',
      url: '/v1/me',
      headers: { cookie: buildCookieHeader(jar1) },
    });
    expect(oldCookieAfterReset.statusCode).toBe(401);

    // Login con Google vincula email existente o crea cuenta nueva
    const googleRes = await app.inject({
      method: 'POST',
      url: '/v1/auth/google',
      headers: { 'x-forwarded-for': '203.0.113.12' },
      payload: {
        idToken: createSimulatedGoogleIdToken({
          sub: 'google-sub-lucia-1',
          email: 'lucia@truco.ar',
          name: 'Lucia Google',
        }),
      },
    });
    expect(googleRes.statusCode).toBe(200);
    expect(googleRes.json().user.id).toBe(regBody.user.id);
  });

  it('creates an ephemeral guest account and promotes it preserving exact user.id, XP/level, and match history', async () => {
    const guestRes = await app.inject({
      method: 'POST',
      url: '/v1/auth/guest',
      headers: { 'x-forwarded-for': '203.0.113.20' },
      payload: { deviceName: 'PWA Invitado' },
    });
    expect(guestRes.statusCode).toBe(201);
    const guestUser = guestRes.json().user;
    expect(guestUser.isGuest).toBe(true);
    const guestJar = extractAuthCookies(guestRes.headers['set-cookie']).map;

    // Simular progreso acumulado como invitado (XP/nivel + partida jugada)
    await dbHandle.db
      .update(profilesTable)
      .set({ level: 4, xp: 450 })
      .where(eq(profilesTable.userId, guestUser.id));

    const matchId = generateUuidV7(clockMs);
    await dbHandle.db.insert(matchesTable).values({
      id: matchId,
      mode: '1v1',
      rulesetCode: 'ar-standard-v1',
      seedCommitment: 'a'.repeat(64),
      startedAt: new Date(clockMs - 120_000),
      endedAt: new Date(clockMs),
    });
    await dbHandle.db.insert(matchPlayersTable).values({
      matchId,
      seat: 0,
      userId: guestUser.id,
      team: 0,
      score: 30,
      outcome: 'WIN',
    });

    const promoteRes = await app.inject({
      method: 'POST',
      url: '/v1/auth/promote-guest',
      headers: { cookie: buildCookieHeader(guestJar), 'x-forwarded-for': '203.0.113.20' },
      payload: {
        email: 'invitado.promovido@truco.ar',
        password: 'ClavePromovida2026',
        nickname: 'GauchoPromovido',
        legal: TEST_LEGAL_ACCEPTANCE,
      },
    });
    expect(promoteRes.statusCode).toBe(200);
    const promoted = promoteRes.json().user;
    expect(promoted.id).toBe(guestUser.id);
    expect(promoted.isGuest).toBe(false);
    expect(promoted.nickname).toBe('GauchoPromovido');

    const promotedJar = extractAuthCookies(promoteRes.headers['set-cookie']).map;
    const meAfterPromote = await app.inject({
      method: 'GET',
      url: '/v1/me',
      headers: { cookie: buildCookieHeader(promotedJar) },
    });
    expect(meAfterPromote.statusCode).toBe(200);
    expect(meAfterPromote.json().profile.level).toBe(4);
    expect(meAfterPromote.json().profile.xp).toBe(450);

    const historyAfterPromote = await app.inject({
      method: 'GET',
      url: `/v1/users/${promoted.id}/matches`,
      headers: { cookie: buildCookieHeader(promotedJar) },
    });
    expect(historyAfterPromote.statusCode).toBe(200);
    expect(historyAfterPromote.json().items).toHaveLength(1);
    expect(historyAfterPromote.json().items[0].matchId).toBe(matchId);
  });

  it('rotates refresh tokens and revokes the ENTIRE session family when a consumed refresh token is reused', async () => {
    const reg = await app.inject({
      method: 'POST',
      url: '/v1/auth/register',
      headers: { 'x-forwarded-for': '203.0.113.30' },
      payload: {
        email: 'familia@truco.ar',
        password: 'ClaveFamilia123',
        nickname: 'FamiliaToken',
        legal: TEST_LEGAL_ACCEPTANCE,
      },
    });
    expect(reg.statusCode).toBe(201);
    const jarGen1 = extractAuthCookies(reg.headers['set-cookie']).map;

    // Rotación legítima 1 -> Gen 2
    clockMs += 5_000;
    const rot1 = await app.inject({
      method: 'POST',
      url: '/v1/auth/refresh',
      headers: { cookie: buildCookieHeader(jarGen1), 'x-forwarded-for': '203.0.113.30' },
    });
    expect(rot1.statusCode).toBe(200);
    const jarGen2 = extractAuthCookies(rot1.headers['set-cookie']).map;
    expect(jarGen2[REFRESH_COOKIE_NAME]).not.toBe(jarGen1[REFRESH_COOKIE_NAME]);

    // Rotación legítima 2 -> Gen 3
    clockMs += 5_000;
    const rot2 = await app.inject({
      method: 'POST',
      url: '/v1/auth/refresh',
      headers: { cookie: buildCookieHeader(jarGen2), 'x-forwarded-for': '203.0.113.30' },
    });
    expect(rot2.statusCode).toBe(200);
    const jarGen3 = extractAuthCookies(rot2.headers['set-cookie']).map;

    // Atacante re-presenta el refresh token Gen 1 (ya rotado) -> ¡REUSE DETECTED!
    clockMs += 5_000;
    const reuseAttempt = await app.inject({
      method: 'POST',
      url: '/v1/auth/refresh',
      headers: { cookie: buildCookieHeader(jarGen1), 'x-forwarded-for': '198.51.100.99' },
    });
    expect(reuseAttempt.statusCode).toBe(401);
    expect(reuseAttempt.json().error.details?.reason).toBe('REFRESH_TOKEN_REUSED');

    // Toda la familia queda revocada: tanto el refresh Gen 3 como el access cookie Gen 3 son rechazados
    const gen3RefreshAfterReuse = await app.inject({
      method: 'POST',
      url: '/v1/auth/refresh',
      headers: { cookie: buildCookieHeader(jarGen3), 'x-forwarded-for': '203.0.113.30' },
    });
    expect(gen3RefreshAfterReuse.statusCode).toBe(401);

    const gen3AccessAfterReuse = await app.inject({
      method: 'GET',
      url: '/v1/me',
      headers: { cookie: buildCookieHeader(jarGen3) },
    });
    expect(gen3AccessAfterReuse.statusCode).toBe(401);

    const reuseAudits = await dbHandle.db
      .select()
      .from(auditLogsTable)
      .where(eq(auditLogsTable.action, 'AUTH_REFRESH_REUSE_DETECTED'));
    expect(reuseAudits.length).toBeGreaterThanOrEqual(1);
  });

  it('enforces progressive lockout per (account + IP) and Captcha per account without locking out legitimate third-party IPs', async () => {
    await app.inject({
      method: 'POST',
      url: '/v1/auth/register',
      headers: { 'x-forwarded-for': '203.0.113.40' },
      payload: {
        email: 'lockout@truco.ar',
        password: 'ClaveRealLock123',
        nickname: 'EscudoCriollo',
        legal: TEST_LEGAL_ACCEPTANCE,
      },
    });

    const attackerIp = '203.0.114.10';
    const legitimateOwnerIp = '198.51.100.88';

    // 1..3 intentos fallidos desde la IP atacante -> alcanza el umbral por cuenta para exigir Captcha (3)
    for (let i = 1; i <= 3; i++) {
      const fail = await app.inject({
        method: 'POST',
        url: '/v1/auth/login',
        headers: { 'x-forwarded-for': attackerIp },
        payload: {
          email: 'lockout@truco.ar',
          password: 'ClaveIncorrecta00',
        },
      });
      expect(fail.statusCode).toBe(401);
    }

    // Sin captchaToken, cualquier nuevo intento sobre la cuenta recibe 400 CAPTCHA_FAILED (no bloquea la cuenta)
    const missingCaptcha = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      headers: { 'x-forwarded-for': legitimateOwnerIp },
      payload: {
        email: 'lockout@truco.ar',
        password: 'ClaveRealLock123',
      },
    });
    expect(missingCaptcha.statusCode).toBe(400);
    expect(missingCaptcha.json().error.code).toBe('CAPTCHA_FAILED');
    expect(missingCaptcha.json().error.details?.captchaRequired).toBe(true);

    // 4to y 5to fallo desde attackerIp (resolviendo Captcha pero errando clave) -> gatilla lockout 60s en (cuenta + attackerIp)
    for (let i = 4; i <= 5; i++) {
      const fail = await app.inject({
        method: 'POST',
        url: '/v1/auth/login',
        headers: { 'x-forwarded-for': attackerIp },
        payload: {
          email: 'lockout@truco.ar',
          password: 'ClaveIncorrecta00',
          captchaToken: 'sim-captcha-ok',
        },
      });
      expect(fail.statusCode).toBe(401);
    }

    // La combinación (lockout@truco.ar + attackerIp) queda bloqueada con 423 ACCOUNT_LOCKED incluso con clave real
    const blockedAttacker = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      headers: { 'x-forwarded-for': attackerIp },
      payload: {
        email: 'lockout@truco.ar',
        password: 'ClaveRealLock123',
        captchaToken: 'sim-captcha-ok',
      },
    });
    expect(blockedAttacker.statusCode).toBe(423);
    expect(blockedAttacker.json().error.code).toBe('ACCOUNT_LOCKED');
    expect(blockedAttacker.json().error.details?.scope).toBe('account_ip');
    expect(blockedAttacker.json().error.details?.retryAfterSeconds).toBe(60);

    // El dueño legítimo desde OTRA IP (198.51.100.88) NO sufre bloqueo por terceros: pasa con clave real + Captcha
    const ownerSuccess = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      headers: { 'x-forwarded-for': legitimateOwnerIp },
      payload: {
        email: 'lockout@truco.ar',
        password: 'ClaveRealLock123',
        captchaToken: 'sim-captcha-ok',
      },
    });
    expect(ownerSuccess.statusCode).toBe(200);

    // Entretanto, attackerIp sigue bloqueada hasta que venza su propio lockout
    const stillBlockedAttacker = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      headers: { 'x-forwarded-for': attackerIp },
      payload: {
        email: 'lockout@truco.ar',
        password: 'ClaveRealLock123',
      },
    });
    expect(stillBlockedAttacker.statusCode).toBe(423);

    // Avanzar 65s (vence el primer lockout y la ventana de rate limit) -> 6to fallo desde attackerIp escala a 300s
    clockMs += 65_000;
    const sixthFail = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      headers: { 'x-forwarded-for': attackerIp },
      payload: {
        email: 'lockout@truco.ar',
        password: 'ClaveIncorrecta00',
      },
    });
    expect(sixthFail.statusCode).toBe(401);

    const secondTierCheck = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      headers: { 'x-forwarded-for': attackerIp },
      payload: {
        email: 'lockout@truco.ar',
        password: 'ClaveRealLock123',
      },
    });
    expect(secondTierCheck.statusCode).toBe(423);
    expect(secondTierCheck.json().error.details?.retryAfterSeconds).toBe(300);

    // Avanzar 305s -> login válido desde attackerIp tiene éxito y limpia el estado de fallos
    clockMs += 305_000;
    const recovered = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      headers: { 'x-forwarded-for': attackerIp },
      payload: {
        email: 'lockout@truco.ar',
        password: 'ClaveRealLock123',
      },
    });
    expect(recovered.statusCode).toBe(200);
  });

  it('prevents user enumeration, enforces case-insensitive nickname uniqueness + profanity filter, and enforces IP/account rate limits', async () => {
    emailProvider.clearOutbox();
    const forgotExisting = await app.inject({
      method: 'POST',
      url: '/v1/auth/forgot',
      headers: { 'x-forwarded-for': '203.0.115.1' },
      payload: { email: 'lockout@truco.ar' },
    });
    const forgotUnknown = await app.inject({
      method: 'POST',
      url: '/v1/auth/forgot',
      headers: { 'x-forwarded-for': '203.0.115.2' },
      payload: { email: 'nadie.existe@truco.ar' },
    });
    expect(forgotExisting.statusCode).toBe(200);
    expect(forgotUnknown.statusCode).toBe(200);
    expect(forgotExisting.json()).toEqual(forgotUnknown.json());
    expect(emailProvider.getSentMessages()).toHaveLength(1);

    const loginWrongPw = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      headers: { 'x-forwarded-for': '203.0.115.3' },
      payload: {
        email: 'lockout@truco.ar',
        password: 'MalPassword1',
      },
    });
    const loginNoUser = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      headers: { 'x-forwarded-for': '203.0.115.4' },
      payload: {
        email: 'fantasma@truco.ar',
        password: 'MalPassword1',
      },
    });
    expect(loginWrongPw.statusCode).toBe(401);
    expect(loginNoUser.statusCode).toBe(401);
    expect(loginWrongPw.json()).toEqual(loginNoUser.json());

    // Unicidad case-insensitive: "escudocriollo" choca con "EscudoCriollo"
    const dupNick = await app.inject({
      method: 'POST',
      url: '/v1/auth/register',
      headers: { 'x-forwarded-for': '203.0.115.5' },
      payload: {
        email: 'nuevo1@truco.ar',
        password: 'ClaveValida123',
        nickname: 'escudocriollo',
        legal: TEST_LEGAL_ACCEPTANCE,
      },
    });
    expect(dupNick.statusCode).toBe(409);

    // Filtro ofensivo por defecto (l33t) y término configurable ("tramposovip")
    for (const badNick of ['P3l0tud0_X', 'SoyTramposoVip']) {
      const badRes = await app.inject({
        method: 'POST',
        url: '/v1/auth/register',
        headers: { 'x-forwarded-for': '203.0.115.6' },
        payload: {
          email: `test.${badNick.toLowerCase()}@truco.ar`,
          password: 'ClaveValida123',
          nickname: badNick,
          legal: TEST_LEGAL_ACCEPTANCE,
        },
      });
      expect(badRes.statusCode).toBe(400);
      expect(badRes.json().error.code).toBe('VALIDATION_ERROR');
    }

    // Rate limit por cuenta (maxPerAccount = 7) rotando IPs
    for (let i = 1; i <= 7; i++) {
      const r = await app.inject({
        method: 'POST',
        url: '/v1/auth/forgot',
        headers: { 'x-forwarded-for': `198.51.101.${i}` },
        payload: { email: 'objetivo.ratelimit@truco.ar' },
      });
      expect(r.statusCode).toBe(200);
    }
    const acctLimited = await app.inject({
      method: 'POST',
      url: '/v1/auth/forgot',
      headers: { 'x-forwarded-for': '198.51.101.99' },
      payload: { email: 'objetivo.ratelimit@truco.ar' },
    });
    expect(acctLimited.statusCode).toBe(429);
    expect(acctLimited.json().error.details?.scope).toBe('account');
    expect(acctLimited.headers['retry-after']).toBeDefined();

    // Rate limit por IP (maxPerIp = 12)
    for (let i = 1; i <= 12; i++) {
      const g = await app.inject({
        method: 'POST',
        url: '/v1/auth/guest',
        headers: { 'x-forwarded-for': '198.51.102.77' },
        payload: {},
      });
      expect(g.statusCode).toBe(201);
    }
    const ipLimited = await app.inject({
      method: 'POST',
      url: '/v1/auth/guest',
      headers: { 'x-forwarded-for': '198.51.102.77' },
      payload: {},
    });
    expect(ipLimited.statusCode).toBe(429);
    expect(ipLimited.json().error.details?.scope).toBe('ip');
  });
});
