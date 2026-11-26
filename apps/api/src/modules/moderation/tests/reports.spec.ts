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
import { TEST_LEGAL_ACCEPTANCE } from '../../../common/testing/legal-acceptance.fixture.js';

const SESSION_SECRET = 'm7-moderation-secret-minimo-32-chars!!!!!';

describe('M7 — reportes del jugador, límites y estado de moderación', () => {
  let dbHandle: DatabaseConnectionHandle;
  let app: NestFastifyApplication;
  let clockMs = Date.UTC(2026, 10, 20, 12, 0, 0);

  let rateLimitApp: NestFastifyApplication;

  async function createApp(moderation: {
    reportsPerWindow: number;
    maxOpenReportsPerReporter: number;
  }): Promise<NestFastifyApplication> {
    const created = await createApiApp({
      dbHandle,
      trustProxyCidrs: ['127.0.0.1/32'],
      authOptions: {
        runtimeConfig: { sessionSecret: SESSION_SECRET, nowFn: () => clockMs },
        rateLimitConfig: { maxPerIp: 500, maxPerAccount: 500, nowFn: () => clockMs },
      },
      moderationOptions: { runtimeConfig: { nowFn: () => clockMs, ...moderation } },
    });
    await created.init();
    return created;
  }

  beforeAll(async () => {
    dbHandle = await createAdaptiveTestDatabase();
    app = await createApp({ reportsPerWindow: 10, maxOpenReportsPerReporter: 3 });
    // Segunda instancia con límite de abiertos alto, para aislar el rate limit por ventana.
    rateLimitApp = await createApp({ reportsPerWindow: 3, maxOpenReportsPerReporter: 50 });
  });

  afterAll(async () => {
    await app.close();
    await rateLimitApp.close();
    await dbHandle.close();
  });

  async function registerUser(email: string, nickname: string) {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/auth/register',
      payload: { email, password: 'ClaveFuerte123', nickname, legal: TEST_LEGAL_ACCEPTANCE },
    });
    expect(res.statusCode).toBe(201);
    const cookies = extractAuthCookies(res.headers['set-cookie']).map;
    return {
      id: res.json().user.id as string,
      cookie: buildCookieHeader(cookies),
      cookies,
    };
  }

  it('crea un reporte con motivo y rechaza reportarse a sí mismo', async () => {
    const a = await registerUser('a@truco.ar', 'ReportadorUno');
    const b = await registerUser('b@truco.ar', 'ReportadoUno');

    const self = await app.inject({
      method: 'POST',
      url: '/v1/me/reports',
      headers: { cookie: a.cookie },
      payload: { targetUserId: a.id, reasonCode: 'OTHER', details: 'prueba' },
    });
    expect(self.statusCode).toBe(400);

    const created = await app.inject({
      method: 'POST',
      url: '/v1/me/reports',
      headers: { cookie: a.cookie },
      payload: {
        targetUserId: b.id,
        reasonCode: 'ABANDONMENT',
        details: 'Se fue tres veces seguidas',
      },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().status).toBe('OPEN');
    expect(created.json().mergedWithExisting).toBe(false);

    // Duplicado exacto (mismo denunciante, denunciado, motivo y sin partida) -> se fusiona.
    const again = await app.inject({
      method: 'POST',
      url: '/v1/me/reports',
      headers: { cookie: a.cookie },
      payload: { targetUserId: b.id, reasonCode: 'ABANDONMENT' },
    });
    expect(again.statusCode).toBe(201);
    expect(again.json().mergedWithExisting).toBe(true);
    expect(again.json().id).toBe(created.json().id);
  });

  it('aplica rate limit por cuenta y límite de reportes abiertos', async () => {
    const reporter = await registerUser('c@truco.ar', 'ReportadorDos');
    const targets: Array<{ id: string }> = [];
    for (let i = 0; i < 6; i++) {
      targets.push(await registerUser(`t${i}@truco.ar`, `ReportadoDos${i}`));
    }

    // reportsPerWindow = 3: el cuarto intento de la ventana ya se rechaza (429).
    const statuses: number[] = [];
    for (let i = 0; i < 4; i++) {
      const res = await rateLimitApp.inject({
        method: 'POST',
        url: '/v1/me/reports',
        headers: { cookie: reporter.cookie },
        payload: { targetUserId: targets[i]!.id, reasonCode: 'ABUSIVE_BEHAVIOR' },
      });
      statuses.push(res.statusCode);
    }
    expect(statuses).toEqual([201, 201, 201, 429]);
  });

  it('bloquea nuevos reportes cuando hay demasiados abiertos', async () => {
    const reporter = await registerUser('d@truco.ar', 'ReportadorTres');
    const targets: Array<{ id: string }> = [];
    for (let i = 0; i < 5; i++) {
      targets.push(await registerUser(`u${i}@truco.ar`, `ReportadoTres${i}`));
    }
    // Subimos la ventana de rate limit para aislar el límite de reportes abiertos.
    let firstReportId: string | undefined;
    for (let i = 0; i < 3; i++) {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/me/reports',
        headers: { cookie: reporter.cookie },
        payload: { targetUserId: targets[i]!.id, reasonCode: 'COLLUSION' },
      });
      expect(res.statusCode).toBe(201);
      if (i === 0) firstReportId = res.json().id as string;
    }

    const duplicate = await app.inject({
      method: 'POST',
      url: '/v1/me/reports',
      headers: { cookie: reporter.cookie },
      payload: { targetUserId: targets[0]!.id, reasonCode: 'COLLUSION' },
    });
    expect(duplicate.statusCode).toBe(201);
    expect(duplicate.json()).toMatchObject({ id: firstReportId, mergedWithExisting: true });

    const blocked = await app.inject({
      method: 'POST',
      url: '/v1/me/reports',
      headers: { cookie: reporter.cookie },
      payload: { targetUserId: targets[3]!.id, reasonCode: 'COLLUSION' },
    });
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().error.details.reason).toBe('TOO_MANY_OPEN_REPORTS');
  });

  it('expone el estado de moderación propio y bloquea el login de una cuenta suspendida', async () => {
    const user = await registerUser('e@truco.ar', 'SuspendidoUno');

    const state = await app.inject({
      method: 'GET',
      url: '/v1/me/moderation',
      headers: { cookie: user.cookie },
    });
    expect(state.statusCode).toBe(200);
    expect(state.json().accountStatus).toBe('ACTIVE');
    expect(state.json().mutedUntil).toBeNull();

    // Sanción aplicada por la moderación (equivalente a lo que hará el panel).
    await dbHandle.db
      .update(usersTable)
      .set({
        status: 'SUSPENDED',
        statusReason: 'Abandono reiterado',
        statusExpiresAt: new Date(clockMs + 48 * 3600 * 1000),
      })
      .where(eq(usersTable.id, user.id));

    // Sesión vigente: la API la corta al instante (403 con motivo y vencimiento).
    const me = await app.inject({
      method: 'GET',
      url: '/v1/me',
      headers: { cookie: user.cookie },
    });
    expect(me.statusCode).toBe(403);
    expect(me.json().error.details.reason).toBe('ACCOUNT_SUSPENDED');
    expect(me.json().error.details.statusReason).toBe('Abandono reiterado');
    expect(me.json().error.details.statusExpiresAt).toBeTruthy();

    // Nuevo login: mensaje claro con motivo y fecha de vencimiento.
    const login = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { email: 'e@truco.ar', password: 'ClaveFuerte123' },
    });
    expect(login.statusCode).toBe(403);
    expect(login.json().error.message).toMatch(/suspendida hasta/i);
    expect(login.json().error.details.statusReason).toBe('Abandono reiterado');

    // Y no puede crear mesas (ni unirse) mientras esté suspendida.
    const createTable = await app.inject({
      method: 'POST',
      url: '/v1/tables',
      headers: { cookie: user.cookie },
      payload: { mode: '1v1', visibility: 'PRIVATE', targetScore: 15 },
    });
    expect(createTable.statusCode).toBe(403);
  });

  it('levanta la suspensión cuando vence el plazo', async () => {
    const user = await registerUser('f@truco.ar', 'SuspendidoDos');
    await dbHandle.db
      .update(usersTable)
      .set({
        status: 'SUSPENDED',
        statusReason: 'Silencio mal aplicado',
        statusExpiresAt: new Date(clockMs + 1000),
      })
      .where(eq(usersTable.id, user.id));

    clockMs += 5000;

    const me = await app.inject({
      method: 'GET',
      url: '/v1/me',
      headers: { cookie: user.cookie },
    });
    expect(me.statusCode).toBe(200);

    const [row] = await dbHandle.db.select().from(usersTable).where(eq(usersTable.id, user.id));
    expect(row?.status).toBe('ACTIVE');
    expect(row?.statusReason).toBeNull();
  });
});
