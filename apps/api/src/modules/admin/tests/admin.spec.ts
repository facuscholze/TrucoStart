import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { ADMIN_ROLE_PERMISSIONS, ADMIN_SESSION_COOKIE_NAME } from '@truco/shared';
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApiApp } from '../../../bootstrap.js';
import { generateUuidV7 } from '../../../common/uuidv7.js';
import {
  createAdaptiveTestDatabase,
  type DatabaseConnectionHandle,
} from '../../../db/database.provider.js';
import {
  adminTwoFactorTable,
  auditLogsTable,
  matchEventsTable,
  matchPlayersTable,
  matchesTable,
  profilesTable,
  sanctionsTable,
  competitiveReviewCasesTable,
  usersTable,
  walletAccountsTable,
  walletTransactionsTable,
} from '../../../db/schema/index.js';
import { PasswordHasher } from '../../auth/security/password-hasher.js';
import { buildCookieHeader, extractAuthCookies } from '../../auth/tests/test-cookie-jar.js';
import {
  decryptTotpSecret,
  encryptTotpSecret,
  generateTotpCode,
  generateTotpSecret,
} from '../security/totp.js';

const SESSION_SECRET = 'm7-admin-panel-secret-minimo-32-chars!!!!';
const TOTP_KEY = 'm7-admin-totp-encryption-key-32-chars!!';
const ADMIN_PASSWORD = 'ClavePanel2026!';

describe('M7 — panel administrativo: RBAC, 2FA, sanciones, replay y auditoría', () => {
  let dbHandle: DatabaseConnectionHandle;
  let app: NestFastifyApplication;
  const clockMs = Date.UTC(2026, 10, 21, 15, 0, 0);
  const hasher = new PasswordHasher();
  const secrets = new Map<string, string>();
  const evictions: Array<{ userId: string; reason: string; disconnect: boolean }> = [];

  beforeAll(async () => {
    dbHandle = await createAdaptiveTestDatabase();
    app = await createApiApp({
      dbHandle,
      trustProxyCidrs: ['127.0.0.1/32'],
      authOptions: {
        runtimeConfig: { sessionSecret: SESSION_SECRET, nowFn: () => clockMs },
        rateLimitConfig: { maxPerIp: 900, maxPerAccount: 900, nowFn: () => clockMs },
      },
      adminOptions: {
        userEviction: {
          evict: (request) => {
            evictions.push(request);
            return Promise.resolve({
              evicted: true,
              rooms: ['019a7e40-0000-7000-8000-000000000e01'],
            });
          },
        },
        runtimeConfig: {
          totpEncryptionKey: TOTP_KEY,
          nowFn: () => clockMs,
          cookieSecure: false,
          loginMaxPerMinute: 500,
        },
      },
      moderationOptions: { runtimeConfig: { nowFn: () => clockMs } },
    });
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    await dbHandle.close();
  });

  async function createUser(input: {
    email: string;
    nickname: string;
    role?: 'PLAYER' | 'SUPPORT' | 'MODERATOR' | 'ADMIN';
    withTotp?: boolean;
    status?: 'ACTIVE' | 'SUSPENDED' | 'BANNED';
  }) {
    const now = new Date(clockMs);
    const id = generateUuidV7(clockMs);
    await dbHandle.db.insert(usersTable).values({
      id,
      email: input.email,
      emailVerifiedAt: now,
      passwordHash: await hasher.hashPassword(ADMIN_PASSWORD),
      nickname: input.nickname,
      nicknameLower: input.nickname.toLowerCase(),
      isGuest: false,
      role: input.role ?? 'PLAYER',
      status: input.status ?? 'ACTIVE',
      createdAt: now,
      updatedAt: now,
    });
    await dbHandle.db.insert(profilesTable).values({ userId: id, createdAt: now, updatedAt: now });
    if (input.withTotp) {
      const secret = generateTotpSecret();
      secrets.set(id, secret);
      await dbHandle.db.insert(adminTwoFactorTable).values({
        userId: id,
        secretEncrypted: encryptTotpSecret(secret, TOTP_KEY),
        recoveryCodes: [],
        confirmedAt: now,
        createdAt: now,
        updatedAt: now,
      });
    }
    return id;
  }

  async function adminCookie(userId: string, email: string): Promise<string> {
    const secret = secrets.get(userId)!;
    const res = await app.inject({
      method: 'POST',
      url: '/v1/admin/auth/login',
      payload: {
        email,
        password: ADMIN_PASSWORD,
        totpCode: generateTotpCode(secret, clockMs),
      },
    });
    expect(res.statusCode, JSON.stringify(res.json())).toBe(200);
    return buildCookieHeader(extractAuthCookies(res.headers['set-cookie']).map);
  }

  it('guarda el secreto TOTP cifrado en la base (nunca en claro)', async () => {
    const userId = await createUser({
      email: 'cifrado@truco.ar',
      nickname: 'SecretoCifrado',
      role: 'SUPPORT',
      withTotp: true,
    });
    const secret = secrets.get(userId)!;
    const [row] = await dbHandle.db
      .select()
      .from(adminTwoFactorTable)
      .where(eq(adminTwoFactorTable.userId, userId));

    expect(row).toBeDefined();
    expect(row!.secretEncrypted).not.toContain(secret);
    expect(row!.secretEncrypted).toMatch(/^[A-Za-z0-9+/=]+\.[A-Za-z0-9+/=]+\.[A-Za-z0-9+/=]+$/);
    expect(decryptTotpSecret(row!.secretEncrypted, TOTP_KEY)).toBe(secret);
    // El secreto cifrado con otra clave no se puede leer.
    expect(() =>
      decryptTotpSecret(row!.secretEncrypted, 'otra-clave-de-32-caracteres!!!!!!!!'),
    ).toThrow();
  });

  it('rechaza la reutilización del mismo código TOTP', async () => {
    const email = 'reuso@truco.ar';
    const userId = await createUser({
      email,
      nickname: 'ReusoCodigo',
      role: 'MODERATOR',
      withTotp: true,
    });
    const code = generateTotpCode(secrets.get(userId)!, clockMs);

    const first = await app.inject({
      method: 'POST',
      url: '/v1/admin/auth/login',
      payload: { email, password: ADMIN_PASSWORD, totpCode: code },
    });
    expect(first.statusCode).toBe(200);

    const second = await app.inject({
      method: 'POST',
      url: '/v1/admin/auth/login',
      payload: { email, password: ADMIN_PASSWORD, totpCode: code },
    });
    expect(second.statusCode).toBe(401);
    const body = second.json() as { message?: string; error?: { message?: string } };
    expect(body.error?.message ?? body.message ?? '').toMatch(/código|2FA|inválid/i);

    // Un código del paso siguiente sí se acepta (ventana en avance, no en retroceso).
    const nextStepCode = generateTotpCode(secrets.get(userId)!, clockMs + 30_000);
    const third = await app.inject({
      method: 'POST',
      url: '/v1/admin/auth/login',
      payload: { email, password: ADMIN_PASSWORD, totpCode: nextStepCode },
    });
    expect(third.statusCode).toBe(200);
  });

  it('exige 2FA configurado y código válido, y rechaza a jugadores', async () => {
    await createUser({ email: 'no2fa@truco.ar', nickname: 'SinDos' + 'Fa', role: 'MODERATOR' });
    const without2fa = await app.inject({
      method: 'POST',
      url: '/v1/admin/auth/login',
      payload: { email: 'no2fa@truco.ar', password: ADMIN_PASSWORD, totpCode: '123456' },
    });
    expect(without2fa.statusCode).toBe(403);
    expect(without2fa.json().error.details.reason).toBe('ADMIN_2FA_NOT_CONFIGURED');

    const playerId = await createUser({
      email: 'jugador@truco.ar',
      nickname: 'JugadorComun',
      role: 'PLAYER',
      withTotp: true,
    });
    void playerId;
    const player = await app.inject({
      method: 'POST',
      url: '/v1/admin/auth/login',
      payload: {
        email: 'jugador@truco.ar',
        password: ADMIN_PASSWORD,
        totpCode: generateTotpCode(secrets.get(playerId)!, clockMs),
      },
    });
    expect(player.statusCode).toBe(401);

    const modId = await createUser({
      email: 'mod@truco.ar',
      nickname: 'ModeradorUno',
      role: 'MODERATOR',
      withTotp: true,
    });
    const badCode = await app.inject({
      method: 'POST',
      url: '/v1/admin/auth/login',
      payload: { email: 'mod@truco.ar', password: ADMIN_PASSWORD, totpCode: '000000' },
    });
    expect(badCode.statusCode).toBe(401);

    const res = await app.inject({
      method: 'POST',
      url: '/v1/admin/auth/login',
      payload: {
        email: 'mod@truco.ar',
        password: ADMIN_PASSWORD,
        totpCode: generateTotpCode(secrets.get(modId)!, clockMs),
      },
    });
    expect(res.statusCode).toBe(200);
    const cookie = extractAuthCookies(res.headers['set-cookie']);
    const adminCookieHeader = cookie.parsed.find((c) => c.name === ADMIN_SESSION_COOKIE_NAME)!;
    expect(adminCookieHeader).toBeDefined();
    expect(adminCookieHeader.attributes['httponly']).toBe(true);
    expect(String(adminCookieHeader.attributes['samesite']).toLowerCase()).toBe('strict');
    expect(adminCookieHeader.attributes['path']).toBe('/v1/admin');
    // La cookie de jugador no se emite en el login del panel.
    expect(cookie.map['truco_access']).toBeUndefined();

    // Un código ya usado no se puede reutilizar (anti-replay del TOTP).
    const replayCode = await app.inject({
      method: 'POST',
      url: '/v1/admin/auth/login',
      payload: {
        email: 'mod@truco.ar',
        password: ADMIN_PASSWORD,
        totpCode: generateTotpCode(secrets.get(modId)!, clockMs),
      },
    });
    expect(replayCode.statusCode).toBe(401);
  });

  it('valida permisos por rol en el servidor (no solo en la UI)', async () => {
    const supportId = await createUser({
      email: 'soporte@truco.ar',
      nickname: 'SoporteUno',
      role: 'SUPPORT',
      withTotp: true,
    });
    const modId = await createUser({
      email: 'moderador2@truco.ar',
      nickname: 'ModeradorDos',
      role: 'MODERATOR',
      withTotp: true,
    });
    const adminId = await createUser({
      email: 'admin@truco.ar',
      nickname: 'AdminUno',
      role: 'ADMIN',
      withTotp: true,
    });
    const supportCookie = await adminCookie(supportId, 'soporte@truco.ar');
    const modCookie = await adminCookie(modId, 'moderador2@truco.ar');
    const adminCookieHeader = await adminCookie(adminId, 'admin@truco.ar');

    const targetId = await createUser({ email: 'target@truco.ar', nickname: 'ReportadoUno' });

    const dashboard = await app.inject({
      method: 'GET',
      url: '/v1/admin/dashboard',
      headers: { cookie: supportCookie },
    });
    expect(dashboard.statusCode).toBe(200);
    expect(dashboard.json().usersTotal).toBeGreaterThan(0);

    const supportSanction = await app.inject({
      method: 'POST',
      url: `/v1/admin/users/${targetId}/sanctions`,
      headers: { cookie: supportCookie },
      payload: { type: 'WARNING', reason: 'Primera advertencia formal' },
    });
    expect(supportSanction.statusCode).toBe(403);
    expect(supportSanction.json().error.details.requiredPermission).toBe('sanctions:issue');

    const modBan = await app.inject({
      method: 'POST',
      url: `/v1/admin/users/${targetId}/sanctions`,
      headers: { cookie: modCookie },
      payload: { type: 'BAN', reason: 'Reincidencia grave de abandono', durationHours: 720 },
    });
    expect(modBan.statusCode).toBe(403);
    expect(modBan.json().error.details.requiredPermission).toBe('sanctions:issue_ban');

    const adminBan = await app.inject({
      method: 'POST',
      url: `/v1/admin/users/${targetId}/sanctions`,
      headers: { cookie: adminCookieHeader },
      payload: { type: 'BAN', reason: 'Reincidencia grave de abandono', durationHours: 720 },
    });
    expect(adminBan.statusCode).toBe(201);
    expect(adminBan.json().appliedStatus).toBe('BANNED');

    // El jugador no puede usar endpoints del panel.
    const guest = await app.inject({ method: 'POST', url: '/v1/auth/guest', payload: {} });
    const playerCookie = buildCookieHeader(extractAuthCookies(guest.headers['set-cookie']).map);
    const asPlayer = await app.inject({
      method: 'GET',
      url: '/v1/admin/dashboard',
      headers: { cookie: playerCookie },
    });
    expect(asPlayer.statusCode).toBe(401);

    // La matriz compartida es la fuente de verdad de lo que cada rol puede hacer.
    expect(ADMIN_ROLE_PERMISSIONS.SUPPORT).not.toContain('sanctions:issue');
    expect(ADMIN_ROLE_PERMISSIONS.MODERATOR).toContain('sanctions:issue');
    expect(ADMIN_ROLE_PERMISSIONS.MODERATOR).not.toContain('users:read_pii');
    expect(ADMIN_ROLE_PERMISSIONS.ADMIN).toContain('users:read_pii');
    expect(ADMIN_ROLE_PERMISSIONS.SUPPORT).not.toContain('competitive:review');
    expect(ADMIN_ROLE_PERMISSIONS.MODERATOR).toContain('competitive:review');
    expect(ADMIN_ROLE_PERMISSIONS.SUPPORT).not.toContain('gamification:configure');
    expect(ADMIN_ROLE_PERMISSIONS.MODERATOR).not.toContain('gamification:configure');
    expect(ADMIN_ROLE_PERMISSIONS.ADMIN).toContain('gamification:configure');

    for (const cookie of [supportCookie, modCookie]) {
      const denied = await app.inject({
        method: 'GET',
        url: '/v1/admin/progression/config',
        headers: { cookie },
      });
      expect(denied.statusCode).toBe(403);
      expect(denied.json().error.details.requiredPermission).toBe('gamification:configure');
      const deniedReversal = await app.inject({
        method: 'POST',
        url: `/v1/admin/progression/wallet-transactions/${generateUuidV7(clockMs + 2)}/reverse`,
        headers: { cookie },
        payload: { reason: 'Intento de reversión sin permiso' },
      });
      expect(deniedReversal.statusCode).toBe(403);
      expect(deniedReversal.json().error.details.requiredPermission).toBe('gamification:configure');
    }
    const config = await app.inject({
      method: 'GET',
      url: '/v1/admin/progression/config',
      headers: { cookie: adminCookieHeader },
    });
    expect(config.statusCode).toBe(200);
    expect(config.json().dailyXpCap).toBe(200);
  });

  it('actualiza config y crea reversión de wallet con auditoría de actor, sesión, IP y motivo', async () => {
    const adminId = await createUser({
      email: 'gamification-admin@truco.ar',
      nickname: 'AdminProgreso',
      role: 'ADMIN',
      withTotp: true,
    });
    const userId = await createUser({ email: 'wallet-user@truco.ar', nickname: 'JugadorWallet' });
    const cookie = await adminCookie(adminId, 'gamification-admin@truco.ar');

    const configResponse = await app.inject({
      method: 'GET',
      url: '/v1/admin/progression/config',
      headers: { cookie },
    });
    expect(configResponse.statusCode).toBe(200);
    const config = configResponse.json();
    const updatedResponse = await app.inject({
      method: 'PATCH',
      url: '/v1/admin/progression/config',
      headers: { cookie },
      payload: {
        reason: 'Ajuste de balance validado por operación',
        config: { ...config, humanMatchXp: config.humanMatchXp + 1 },
      },
    });
    expect(updatedResponse.statusCode).toBe(200);
    expect(updatedResponse.json()).toMatchObject({
      config: { humanMatchXp: config.humanMatchXp + 1 },
      audited: true,
    });

    await dbHandle.db.insert(walletAccountsTable).values({
      userId,
      currencyType: 'VIRTUAL_COIN',
      hasEconomicValue: false,
      playerTransfersEnabled: false,
    });
    const creditId = generateUuidV7(clockMs + 100);
    await dbHandle.db.insert(walletTransactionsTable).values({
      id: creditId,
      userId,
      amount: 5,
      kind: 'MATCH_REWARD',
      idempotencyKey: `admin-test:${creditId}`,
      referenceType: 'test_credit',
      referenceId: creditId,
      createdAt: new Date(clockMs),
    });
    const reversal = await app.inject({
      method: 'POST',
      url: `/v1/admin/progression/wallet-transactions/${creditId}/reverse`,
      headers: { cookie },
      payload: { reason: 'Corrección del crédito de prueba' },
    });
    expect(reversal.statusCode).toBe(200);
    expect(reversal.json()).toMatchObject({ reversed: true });

    const configAudits = await dbHandle.db
      .select()
      .from(auditLogsTable)
      .where(eq(auditLogsTable.action, 'PROGRESSION_CONFIG_UPDATED'));
    expect(configAudits.some((entry) => entry.actorId === adminId)).toBe(true);
    const reversalAudits = await dbHandle.db
      .select()
      .from(auditLogsTable)
      .where(eq(auditLogsTable.action, 'WALLET_TRANSACTION_REVERSED'));
    const audit = reversalAudits.at(-1);
    expect(audit?.actorId).toBe(adminId);
    expect(audit?.adminSessionId).toBeTruthy();
    expect(audit?.reason).toBe('Corrección del crédito de prueba');
    expect(audit?.ip).toBeTruthy();
    const walletEntries = await dbHandle.db
      .select({
        amount: walletTransactionsTable.amount,
        kind: walletTransactionsTable.kind,
        reversesTransactionId: walletTransactionsTable.reversesTransactionId,
      })
      .from(walletTransactionsTable)
      .where(eq(walletTransactionsTable.userId, userId));
    expect(walletEntries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ amount: 5, kind: 'MATCH_REWARD' }),
        expect.objectContaining({
          amount: -5,
          kind: 'ADMIN_REVERSAL',
          reversesTransactionId: creditId,
        }),
      ]),
    );
    const [balance] = await dbHandle.db
      .select({ balance: sql<number>`COALESCE(SUM(${walletTransactionsTable.amount}), 0)` })
      .from(walletTransactionsTable)
      .where(eq(walletTransactionsTable.userId, userId));
    expect(Number(balance?.balance ?? 0)).toBe(0);
  });

  it('protege la cola de revisión competitiva por RBAC y audita claim/resolución sin sancionar', async () => {
    const supportId = await createUser({
      email: 'review-support@truco.ar',
      nickname: 'ReviewSupport',
      role: 'SUPPORT',
      withTotp: true,
    });
    const reviewerId = await createUser({
      email: 'review-mod@truco.ar',
      nickname: 'ReviewModerator',
      role: 'MODERATOR',
      withTotp: true,
    });
    const secondReviewerId = await createUser({
      email: 'review-mod-two@truco.ar',
      nickname: 'ReviewModeratorTwo',
      role: 'MODERATOR',
      withTotp: true,
    });
    const supportCookie = await adminCookie(supportId, 'review-support@truco.ar');
    const reviewerCookie = await adminCookie(reviewerId, 'review-mod@truco.ar');
    const secondReviewerCookie = await adminCookie(secondReviewerId, 'review-mod-two@truco.ar');
    const targetId = await createUser({
      email: 'review-target@truco.ar',
      nickname: 'ReviewTarget',
    });
    const caseId = generateUuidV7(clockMs + 100);
    const matchId = generateUuidV7(clockMs + 101);
    const createdAt = new Date(clockMs);

    await dbHandle.db.insert(competitiveReviewCasesTable).values({
      id: caseId,
      fingerprint: `admin-test-${caseId}`,
      status: 'OPEN',
      severity: 'MEDIUM',
      signals: ['REPEATED_OPPONENTS'],
      userIds: [targetId],
      matchIds: [matchId],
      evidence: { message: 'Indicio para revisar manualmente.' },
      createdAt,
      updatedAt: createdAt,
    });

    const forbidden = await app.inject({
      method: 'GET',
      url: '/v1/admin/competitive-reviews?status=OPEN',
      headers: { cookie: supportCookie },
    });
    expect(forbidden.statusCode).toBe(403);
    expect(forbidden.json().error.details.requiredPermission).toBe('competitive:review');

    const queue = await app.inject({
      method: 'GET',
      url: '/v1/admin/competitive-reviews?status=OPEN',
      headers: { cookie: reviewerCookie },
    });
    expect(queue.statusCode).toBe(200);
    expect(queue.json().items[0]).toMatchObject({ id: caseId, version: 0, status: 'OPEN' });

    const claimed = await app.inject({
      method: 'POST',
      url: `/v1/admin/competitive-reviews/${caseId}/claim`,
      headers: { cookie: reviewerCookie },
      payload: { expectedVersion: 0 },
    });
    expect(claimed.statusCode).toBe(200);
    expect(claimed.json()).toMatchObject({ status: 'IN_REVIEW', version: 1 });

    const competingClaim = await app.inject({
      method: 'POST',
      url: `/v1/admin/competitive-reviews/${caseId}/claim`,
      headers: { cookie: secondReviewerCookie },
      payload: { expectedVersion: 0 },
    });
    expect(competingClaim.statusCode).toBe(409);

    const wrongReviewer = await app.inject({
      method: 'POST',
      url: `/v1/admin/competitive-reviews/${caseId}/resolve`,
      headers: { cookie: secondReviewerCookie },
      payload: { expectedVersion: 1, resolutionNote: 'La evidencia no es concluyente.' },
    });
    expect(wrongReviewer.statusCode).toBe(409);

    const resolved = await app.inject({
      method: 'POST',
      url: `/v1/admin/competitive-reviews/${caseId}/resolve`,
      headers: { cookie: reviewerCookie },
      payload: {
        expectedVersion: 1,
        resolutionNote: 'Se revisó la evidencia y no corresponde aplicar una medida.',
      },
    });
    expect(resolved.statusCode).toBe(200);
    expect(resolved.json()).toMatchObject({ status: 'RESOLVED', version: 2 });

    const [storedCase] = await dbHandle.db
      .select()
      .from(competitiveReviewCasesTable)
      .where(eq(competitiveReviewCasesTable.id, caseId));
    expect(storedCase?.resolvedBy).toBe(reviewerId);
    expect(storedCase?.resolutionNote).toContain('no corresponde');
    expect(
      await dbHandle.db.select().from(sanctionsTable).where(eq(sanctionsTable.userId, targetId)),
    ).toHaveLength(0);
    const reviewAudit = await dbHandle.db
      .select()
      .from(auditLogsTable)
      .where(eq(auditLogsTable.entityId, caseId));
    expect(reviewAudit).toHaveLength(2);
    expect(reviewAudit.map((entry) => entry.action)).toEqual(
      expect.arrayContaining(['COMPETITIVE_REVIEW_CLAIMED', 'COMPETITIVE_REVIEW_RESOLVED']),
    );
  });

  it('impide sancionarse a sí mismo y sancionar a un admin desde un moderador', async () => {
    const modId = await createUser({
      email: 'moderador3@truco.ar',
      nickname: 'ModeradorTres',
      role: 'MODERATOR',
      withTotp: true,
    });
    const adminId = await createUser({
      email: 'admin2@truco.ar',
      nickname: 'AdminDos',
      role: 'ADMIN',
      withTotp: true,
    });
    const modCookieHeader = await adminCookie(modId, 'moderador3@truco.ar');

    const self = await app.inject({
      method: 'POST',
      url: `/v1/admin/users/${modId}/sanctions`,
      headers: { cookie: modCookieHeader },
      payload: { type: 'WARNING', reason: 'Auto sanción de prueba' },
    });
    expect(self.statusCode).toBe(403);
    expect(self.json().error.details.reason).toBe('SELF_SANCTION_FORBIDDEN');

    const toAdmin = await app.inject({
      method: 'POST',
      url: `/v1/admin/users/${adminId}/sanctions`,
      headers: { cookie: modCookieHeader },
      payload: { type: 'SUSPEND', reason: 'No corresponde', durationHours: 24 },
    });
    expect(toAdmin.statusCode).toBe(403);
    expect(toAdmin.json().error.details.reason).toBe('ADMIN_TARGET_FORBIDDEN');
  });

  it('aplica sanción de suspensión con revocación de sesiones y la audita', async () => {
    const playerId = await createUser({
      email: 'sancionado@truco.ar',
      nickname: 'SancionadoUno',
      withTotp: false,
    });
    const modId = await createUser({
      email: 'moderador4@truco.ar',
      nickname: 'ModeradorCuatro',
      role: 'MODERATOR',
      withTotp: true,
    });
    const modCookieHeader = await adminCookie(modId, 'moderador4@truco.ar');

    const playerLogin = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { email: 'sancionado@truco.ar', password: ADMIN_PASSWORD },
    });
    expect(playerLogin.statusCode).toBe(200);

    const sanction = await app.inject({
      method: 'POST',
      url: `/v1/admin/users/${playerId}/sanctions`,
      headers: { cookie: modCookieHeader },
      payload: {
        type: 'SUSPEND',
        reason: 'Abandono reiterado en tres partidas',
        durationHours: 48,
      },
    });
    expect(sanction.statusCode).toBe(201);
    expect(sanction.json().appliedStatus).toBe('SUSPENDED');
    expect(sanction.json().sessionsRevoked).toBeGreaterThanOrEqual(1);

    // La suspensión avisa al game-server para expulsar al jugador sin esperar al caché.
    const eviction = evictions.find((entry) => entry.userId === playerId);
    expect(eviction).toBeDefined();
    expect(eviction?.disconnect).toBe(true);
    expect(eviction?.reason).toMatch(/Suspensión temporal/);

    // La sesión de jugador quedó revocada al instante y no puede unirse a mesas.
    const playerCookie = buildCookieHeader(
      extractAuthCookies(playerLogin.headers['set-cookie']).map,
    );
    const me = await app.inject({
      method: 'GET',
      url: '/v1/me',
      headers: { cookie: playerCookie },
    });
    expect(me.statusCode).toBe(401);

    const login = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { email: 'sancionado@truco.ar', password: ADMIN_PASSWORD },
    });
    expect(login.statusCode).toBe(403);
    expect(login.json().error.details.reason).toBe('ACCOUNT_SUSPENDED');

    const audit = await app.inject({
      method: 'GET',
      url: `/v1/admin/users/${playerId}?reason=Revisi%C3%B3n%20de%20caso%20reportado`,
      headers: { cookie: modCookieHeader },
    });
    expect(audit.statusCode).toBe(200);
    expect(audit.json().sanctions[0].type).toBe('SUSPEND');
    expect(audit.json().email).toBeNull();

    const logs = await dbHandle.db
      .select()
      .from(auditLogsTable)
      .where(
        and(
          eq(auditLogsTable.action, 'ADMIN_SANCTION_ISSUED'),
          eq(auditLogsTable.entityId, playerId),
        ),
      );
    expect(logs.length).toBeGreaterThan(0);
    expect(logs[0]?.reason).toContain('Abandono reiterado');
  });

  it('resuelve reportes con control de concurrencia y audita el replay', async () => {
    const modA = await createUser({
      email: 'moderadora@truco.ar',
      nickname: 'ModeradoraCinco',
      role: 'MODERATOR',
      withTotp: true,
    });
    const modB = await createUser({
      email: 'moderadorb@truco.ar',
      nickname: 'ModeradorSeis',
      role: 'MODERATOR',
      withTotp: true,
    });
    const cookieA = await adminCookie(modA, 'moderadora@truco.ar');
    const cookieB = await adminCookie(modB, 'moderadorb@truco.ar');

    const reporter = await createUser({ email: 'denunciante@truco.ar', nickname: 'Denunciante' });
    const target = await createUser({ email: 'denunciado@truco.ar', nickname: 'Denunciado' });
    const guest = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: {
        email: 'denunciante@truco.ar',
        password: ADMIN_PASSWORD,
      },
    });
    expect(guest.statusCode).toBe(200);
    const reporterCookie = buildCookieHeader(extractAuthCookies(guest.headers['set-cookie']).map);

    const created = await app.inject({
      method: 'POST',
      url: '/v1/me/reports',
      headers: { cookie: reporterCookie },
      payload: { targetUserId: target, reasonCode: 'ABUSIVE_BEHAVIOR', details: 'Insultos' },
    });
    expect(created.statusCode).toBe(201);
    const reportId = created.json().id as string;
    void reporter;

    const reportDetail = await app.inject({
      method: 'GET',
      url: `/v1/admin/reports/${reportId}`,
      headers: { cookie: cookieA },
    });
    expect(reportDetail.statusCode).toBe(200);
    expect(reportDetail.json().replayAvailable).toBe(false);

    const queue = await app.inject({
      method: 'GET',
      url: '/v1/admin/reports?status=OPEN',
      headers: { cookie: cookieA },
    });
    expect(queue.statusCode).toBe(200);
    const item = queue.json().items.find((entry: { id: string }) => entry.id === reportId);
    expect(item).toBeDefined();

    const claimA = await app.inject({
      method: 'POST',
      url: `/v1/admin/reports/${reportId}/claim`,
      headers: { cookie: cookieA },
      payload: { expectedVersion: item.version },
    });
    expect(claimA.statusCode, JSON.stringify(claimA.json())).toBe(200);

    const claimB = await app.inject({
      method: 'POST',
      url: `/v1/admin/reports/${reportId}/claim`,
      headers: { cookie: cookieB },
      payload: { expectedVersion: item.version },
    });
    expect(claimB.statusCode).toBe(409);

    const resolveA = await app.inject({
      method: 'POST',
      url: `/v1/admin/reports/${reportId}/resolve`,
      headers: { cookie: cookieA },
      payload: {
        outcome: 'RESOLVED_ACTIONED',
        note: 'Se aplicó advertencia y seguimiento',
        expectedVersion: claimA.json().version,
      },
    });
    expect(resolveA.statusCode).toBe(200);

    // Segundo moderador con la versión vieja: no puede volver a resolver.
    const resolveB = await app.inject({
      method: 'POST',
      url: `/v1/admin/reports/${reportId}/resolve`,
      headers: { cookie: cookieB },
      payload: {
        outcome: 'RESOLVED_DISMISSED',
        note: 'Sin mérito suficiente',
        expectedVersion: claimA.json().version,
      },
    });
    expect(resolveB.statusCode).toBe(409);
    expect(resolveB.json().error.details.reason).toBe('REPORT_VERSION_CONFLICT');
  });

  it('audita cada acceso a replay y solo permite partidas terminadas', async () => {
    const modId = await createUser({
      email: 'moderador7@truco.ar',
      nickname: 'ModeradorSiete',
      role: 'MODERATOR',
      withTotp: true,
    });
    const cookie = await adminCookie(modId, 'moderador7@truco.ar');
    const p1 = await createUser({ email: 'p1@truco.ar', nickname: 'JugadorP1' });
    const p2 = await createUser({ email: 'p2@truco.ar', nickname: 'JugadorP2' });
    const finishedId = generateUuidV7(clockMs);
    const liveId = generateUuidV7(clockMs + 1);
    const now = new Date(clockMs);

    for (const [id, ended] of [
      [finishedId, now],
      [liveId, null],
    ] as const) {
      await dbHandle.db.insert(matchesTable).values({
        id,
        mode: '1v1',
        rulesetCode: 'ar-standard-v1',
        seedCommitment: 'a'.repeat(64),
        startedAt: now,
        endedAt: ended,
        result: ended ? { winnerTeam: 0 } : null,
        createdAt: now,
      });
      for (const [seat, userId] of [
        [0, p1],
        [1, p2],
      ] as const) {
        await dbHandle.db.insert(matchPlayersTable).values({
          matchId: id,
          seat,
          userId,
          team: seat,
          score: seat === 0 ? 30 : 18,
          outcome: seat === 0 ? 'WIN' : 'LOSS',
          createdAt: now,
        });
      }
    }
    await dbHandle.db.insert(matchEventsTable).values([
      { matchId: finishedId, seq: 1, type: 'game.started', payload: {}, createdAt: now },
      {
        matchId: finishedId,
        seq: 2,
        type: 'game.handEnded',
        payload: { handNumber: 1 },
        createdAt: now,
      },
      {
        matchId: finishedId,
        seq: 3,
        type: 'game.scoreUpdated',
        payload: { team: 0, newScore: 30 },
        createdAt: now,
      },
      {
        matchId: finishedId,
        seq: 4,
        type: 'game.ended',
        payload: { winnerTeam: 0, scoresByTeam: { '0': 30, '1': 18 } },
        createdAt: now,
      },
    ]);

    const live = await app.inject({
      method: 'GET',
      url: `/v1/admin/matches/${liveId}/replay?reason=Chequeo%20de%20partida%20en%20curso`,
      headers: { cookie },
    });
    expect(live.statusCode).toBe(409);

    const withoutReason = await app.inject({
      method: 'GET',
      url: `/v1/admin/matches/${finishedId}/replay`,
      headers: { cookie },
    });
    expect(withoutReason.statusCode).toBe(400);

    const replay = await app.inject({
      method: 'GET',
      url: `/v1/admin/matches/${finishedId}/replay?reason=Investigar%20reporte%20de%20colusi%C3%B3n`,
      headers: { cookie },
    });
    expect(replay.statusCode).toBe(200);
    expect(replay.json().players).toHaveLength(2);
    expect(replay.json().events).toHaveLength(4);
    expect(replay.json().reconstructed.handsPlayed).toBe(1);
    expect(replay.json().reconstructed.finalScores['0']).toBe(30);
    expect(replay.json().reconstructed.valid).toBe(true);

    const replayAudit = await dbHandle.db
      .select()
      .from(auditLogsTable)
      .where(
        and(
          eq(auditLogsTable.action, 'ADMIN_REPLAY_ACCESSED'),
          eq(auditLogsTable.entityId, finishedId),
        ),
      );
    expect(replayAudit).toHaveLength(1);
    expect(replayAudit[0]?.reason).toContain('colusión');
    expect(replayAudit[0]?.actorId).toBe(modId);
  });

  it('enmascara datos personales salvo permiso explícito y cierra la sesión con logout', async () => {
    const supportId = await createUser({
      email: 'soporte2@truco.ar',
      nickname: 'SoporteDos',
      role: 'SUPPORT',
      withTotp: true,
    });
    const adminId = await createUser({
      email: 'admin3@truco.ar',
      nickname: 'AdminTres',
      role: 'ADMIN',
      withTotp: true,
    });
    await createUser({ email: 'persona@truco.ar', nickname: 'PersonaComun' });

    const supportCookieHeader = await adminCookie(supportId, 'soporte2@truco.ar');
    const adminCookieHeader = await adminCookie(adminId, 'admin3@truco.ar');

    const supportList = await app.inject({
      method: 'GET',
      url: '/v1/admin/users?query=persona',
      headers: { cookie: supportCookieHeader },
    });
    expect(supportList.statusCode).toBe(200);
    expect(supportList.json().items[0].emailMasked).toMatch(/^p\*\*\*a@truco\.ar$/);

    const adminList = await app.inject({
      method: 'GET',
      url: '/v1/admin/users?query=persona',
      headers: { cookie: adminCookieHeader },
    });
    expect(adminList.statusCode).toBe(200);
    expect(adminList.json().items[0].emailMasked).toBe('persona@truco.ar');

    const auditList = await app.inject({
      method: 'GET',
      url: '/v1/admin/audit?limit=5',
      headers: { cookie: supportCookieHeader },
    });
    expect(auditList.statusCode).toBe(200);
    expect(auditList.json().items.length).toBeGreaterThan(0);

    const logout = await app.inject({
      method: 'POST',
      url: '/v1/admin/auth/logout',
      headers: { cookie: supportCookieHeader },
    });
    expect(logout.statusCode).toBe(200);

    const afterLogout = await app.inject({
      method: 'GET',
      url: '/v1/admin/dashboard',
      headers: { cookie: supportCookieHeader },
    });
    expect(afterLogout.statusCode).toBe(401);
  });
});
