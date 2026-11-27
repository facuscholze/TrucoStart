import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApiApp } from '../../../bootstrap.js';

/**
 * La API **arranca** con el módulo de ligas y sirve sus rutas.
 *
 * Este archivo existe por un defecto real: `LeaguesService` inyectaba cinco dependencias sin
 * `@Inject`, resueltas por la metadata `design:paramtypes` que emite `tsc` pero **no** `tsx` ni
 * esbuild. Con `tsx` —el stack E2E, `pnpm dev`— la API moría al construir el módulo con
 * «Nest can't resolve dependencies of the LeaguesService (?, …)», mientras las 45 pruebas del
 * servicio seguían en verde porque lo construyen a mano con `new LeaguesService(...)`.
 *
 * O sea: el módulo no estaba probado como módulo. Este test levanta la app completa, revisa que
 * las rutas de ligas existan y que respondan con el contrato esperado (401 sin sesión, no 404).
 */
describe('M10b ligas: el módulo se resuelve y la API sirve sus rutas', () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    app = await createApiApp();
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('arranca con el módulo de ligas registrado', () => {
    // Si la inyección de dependencias falla, `createApiApp` ya habría lanzado en `beforeAll`.
    expect(app).toBeDefined();
  });

  it('sirve las rutas de jugador de ligas (401 sin sesión, nunca 404)', async () => {
    for (const [method, url] of [
      ['GET', '/v1/leagues'],
      ['POST', '/v1/leagues'],
      ['GET', '/v1/leagues/019a7e40-0000-7000-8000-0000000000e1'],
      ['POST', '/v1/leagues/019a7e40-0000-7000-8000-0000000000e1/join'],
      ['POST', '/v1/leagues/019a7e40-0000-7000-8000-0000000000e1/leave'],
      ['POST', '/v1/leagues/019a7e40-0000-7000-8000-0000000000e1/start'],
      ['POST', '/v1/leagues/matches/019a7e40-0000-7000-8000-0000000000e1/reschedule'],
    ] as const) {
      const response = await app.inject({ method, url });
      expect(response.statusCode, `${method} ${url}`).toBe(401);
    }
  });

  it('sirve las rutas del panel de ligas y exige sesión de staff', async () => {
    for (const [method, url] of [
      ['GET', '/v1/admin/leagues'],
      ['GET', '/v1/admin/leagues/019a7e40-0000-7000-8000-0000000000e1/audit'],
      ['POST', '/v1/admin/leagues/019a7e40-0000-7000-8000-0000000000e1/start'],
      ['POST', '/v1/admin/leagues/rounds/019a7e40-0000-7000-8000-0000000000e1/close'],
      ['POST', '/v1/admin/leagues/019a7e40-0000-7000-8000-0000000000e1/close'],
    ] as const) {
      const response = await app.inject({ method, url });
      // 401/403: la ruta existe y el guard la corta. Un 404 sería la ruta sin registrar.
      expect([401, 403], `${method} ${url}`).toContain(response.statusCode);
    }
  });
});
