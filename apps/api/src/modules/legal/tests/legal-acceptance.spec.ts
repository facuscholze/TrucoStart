import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  LEGAL_DOCUMENT_VERSIONS,
  LEGAL_DRAFT_BANNER,
  type LegalStatusResponse,
} from '@truco/shared';
import { createApiApp } from '../../../bootstrap.js';
import {
  createAdaptiveTestDatabase,
  type DatabaseConnectionHandle,
} from '../../../db/database.provider.js';
import { usersTable } from '../../../db/schema/index.js';
import { extractAuthCookies } from '../../auth/tests/test-cookie-jar.js';

const SESSION_SECRET = 'm8d-legal-secret-minimo-32-caracteres!!!';

/**
 * M8d — aceptación legal, control de edad mínima y constancia en base.
 *
 * Verifica las tres cosas que hacen que el registro sea defendible:
 *  1. Sin consentimiento explícito no se crea la cuenta.
 *  2. La edad mínima es configurable y se aplica del lado del servidor.
 *  3. Queda registrado QUÉ versión se aceptó y CUÁNDO.
 */
describe('M8d — documentos legales, edad mínima y constancia de aceptación', () => {
  let dbHandle: DatabaseConnectionHandle;
  let app: NestFastifyApplication;
  let strictApp: NestFastifyApplication;
  const clockMs = Date.UTC(2026, 10, 20, 15, 0, 0);

  beforeAll(async () => {
    dbHandle = await createAdaptiveTestDatabase();
    app = await createApiApp({
      dbHandle,
      trustProxyCidrs: ['127.0.0.1/32'],
      authOptions: {
        runtimeConfig: { sessionSecret: SESSION_SECRET, nowFn: () => clockMs },
        rateLimitConfig: { maxPerIp: 500, maxPerAccount: 500, nowFn: () => clockMs },
      },
    });
    await app.init();

    // Segunda instancia con edad mínima más alta, para probar que el control
    // depende de la configuración y no de un valor fijo en el código.
    process.env['LEGAL_MIN_AGE'] = '21';
    strictApp = await createApiApp({
      dbHandle,
      trustProxyCidrs: ['127.0.0.1/32'],
      authOptions: {
        runtimeConfig: { sessionSecret: SESSION_SECRET, nowFn: () => clockMs },
        rateLimitConfig: { maxPerIp: 500, maxPerAccount: 500, nowFn: () => clockMs },
      },
    });
    await strictApp.init();
    delete process.env['LEGAL_MIN_AGE'];
  });

  afterAll(async () => {
    await app.close();
    await strictApp.close();
    await dbHandle.close();
  });

  let ipCounter = 0;
  function nextIp(): string {
    ipCounter += 1;
    return `198.51.100.${ipCounter}`;
  }

  async function register(
    target: NestFastifyApplication,
    payload: Record<string, unknown>,
  ): Promise<{ statusCode: number; body: Record<string, unknown> }> {
    const res = await target.inject({
      method: 'POST',
      url: '/v1/auth/register',
      headers: { 'x-forwarded-for': nextIp() },
      payload,
    });
    return { statusCode: res.statusCode, body: res.json() as Record<string, unknown> };
  }

  it('GET /v1/legal publica la edad mínima, las versiones y el aviso de borrador', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/legal' });
    expect(res.statusCode).toBe(200);

    const body = res.json() as LegalStatusResponse;
    // Sin LEGAL_MIN_AGE configurada rige el default conservador.
    expect(body.minAge).toBe(18);
    expect(body.draft).toBe(true);
    expect(body.banner).toBe(LEGAL_DRAFT_BANNER);
    expect(body.documents.map((d) => d.slug).sort()).toEqual(
      ['cookies', 'privacidad', 'reglas-de-conducta', 'terminos'].sort(),
    );
    expect(body.documents.find((d) => d.slug === 'terminos')?.requiredOnRegistration).toBe(true);
    expect(body.documents.find((d) => d.slug === 'privacidad')?.requiredOnRegistration).toBe(true);
    expect(body.documents.find((d) => d.slug === 'cookies')?.requiredOnRegistration).toBe(false);
  });

  it('rechaza el alta sin aceptación legal explícita (400 y no crea la cuenta)', async () => {
    const withoutLegal = await register(app, {
      email: 'sin-legal@truco.ar',
      password: 'ClaveFuerte123',
      nickname: 'SinLegal',
    });
    expect(withoutLegal.statusCode).toBe(400);

    // Tampoco alcanza con un objeto que no afirma `accepted: true`.
    const sneaky = await register(app, {
      email: 'sin-legal@truco.ar',
      password: 'ClaveFuerte123',
      nickname: 'SinLegal',
      legal: { accepted: false },
    });
    expect(sneaky.statusCode).toBe(400);

    const [existing] = await dbHandle.db
      .select()
      .from(usersTable)
      .where(eq(usersTable.email, 'sin-legal@truco.ar'));
    expect(existing).toBeUndefined();
  });

  it('rechaza el alta cuando la edad declarada no alcanza el mínimo configurado', async () => {
    const tooYoung = await register(app, {
      email: 'menor@truco.ar',
      password: 'ClaveFuerte123',
      nickname: 'MenorEdad',
      legal: { accepted: true, age: 17 },
    });
    expect(tooYoung.statusCode).toBe(403);

    const [existing] = await dbHandle.db
      .select()
      .from(usersTable)
      .where(eq(usersTable.email, 'menor@truco.ar'));
    expect(existing).toBeUndefined();
  });

  it('respeta LEGAL_MIN_AGE configurada por entorno (21 en la instancia estricta)', async () => {
    const status = await strictApp.inject({ method: 'GET', url: '/v1/legal' });
    expect((status.json() as LegalStatusResponse).minAge).toBe(21);

    const at20 = await register(strictApp, {
      email: 'veinte@truco.ar',
      password: 'ClaveFuerte123',
      nickname: 'VeinteAnios',
      legal: { accepted: true, age: 20 },
    });
    expect(at20.statusCode).toBe(403);

    const at21 = await register(strictApp, {
      email: 'veintiuno@truco.ar',
      password: 'ClaveFuerte123',
      nickname: 'Veintiuno',
      legal: { accepted: true, age: 21 },
    });
    expect(at21.statusCode).toBe(201);
  });

  it('rechaza el alta si el cliente aceptó una versión que ya no es la vigente', async () => {
    const stale = await register(app, {
      email: 'version-vieja@truco.ar',
      password: 'ClaveFuerte123',
      nickname: 'VersionVieja',
      legal: { accepted: true, versions: { terminos: '2020-01-obsoleto' } },
    });
    expect(stale.statusCode).toBe(409);
  });

  it('guarda la versión aceptada, la fecha y la edad mínima vigente, y lo audita', async () => {
    const accepted = await register(app, {
      email: 'constancia@truco.ar',
      password: 'ClaveFuerte123',
      nickname: 'ConstanciaOk',
      legal: {
        accepted: true,
        versions: {
          terminos: LEGAL_DOCUMENT_VERSIONS.terminos,
          privacidad: LEGAL_DOCUMENT_VERSIONS.privacidad,
        },
        age: 30,
      },
    });
    expect(accepted.statusCode).toBe(201);

    const [row] = await dbHandle.db
      .select()
      .from(usersTable)
      .where(eq(usersTable.email, 'constancia@truco.ar'));

    expect(row?.termsVersion).toBe(LEGAL_DOCUMENT_VERSIONS.terminos);
    expect(row?.privacyVersion).toBe(LEGAL_DOCUMENT_VERSIONS.privacidad);
    expect(row?.legalMinAge).toBe(18);
    expect(row?.legalAcceptedAt?.getTime()).toBe(clockMs);
    // La edad declarada NO se persiste: sólo se usa para el control.
    expect(Object.keys(row ?? {})).not.toContain('age');
  });

  it('el invitado que se convierte en cuenta registrada también deja constancia', async () => {
    const guestRes = await app.inject({
      method: 'POST',
      url: '/v1/auth/guest',
      headers: { 'x-forwarded-for': nextIp() },
      payload: {},
    });
    expect(guestRes.statusCode).toBe(201);
    const cookies = extractAuthCookies(guestRes.headers['set-cookie']).map;
    const cookieHeader = Object.entries(cookies)
      .map(([name, value]) => `${name}=${value}`)
      .join('; ');

    const guestId = (guestRes.json() as { user: { id: string } }).user.id;

    // Sin aceptación: no se vincula.
    const rejected = await app.inject({
      method: 'POST',
      url: '/v1/auth/promote-guest',
      headers: { cookie: cookieHeader, 'x-forwarded-for': nextIp() },
      payload: { email: 'invitado@truco.ar', password: 'ClaveFuerte123' },
    });
    expect(rejected.statusCode).toBe(400);

    const promoted = await app.inject({
      method: 'POST',
      url: '/v1/auth/promote-guest',
      headers: { cookie: cookieHeader, 'x-forwarded-for': nextIp() },
      payload: {
        email: 'invitado@truco.ar',
        password: 'ClaveFuerte123',
        legal: { accepted: true, age: 25 },
      },
    });
    expect(promoted.statusCode).toBe(200);

    const [row] = await dbHandle.db.select().from(usersTable).where(eq(usersTable.id, guestId));
    expect(row?.isGuest).toBe(false);
    expect(row?.termsVersion).toBe(LEGAL_DOCUMENT_VERSIONS.terminos);
    expect(row?.legalAcceptedAt?.getTime()).toBe(clockMs);
  });
});
