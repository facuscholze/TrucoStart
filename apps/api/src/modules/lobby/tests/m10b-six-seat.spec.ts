import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApiApp } from '../../../bootstrap.js';
import {
  createAdaptiveTestDatabase,
  type DatabaseConnectionHandle,
} from '../../../db/database.provider.js';
import { buildCookieHeader, extractAuthCookies } from '../../auth/tests/test-cookie-jar.js';
import { InMemoryGameRoomProvisioner } from '../ports/game-room-provisioner.js';

/**
 * Truco de 6 (`3v3`) de punta a punta en la API: mesa pública y privada, asientos y equipos,
 * emparejamiento de seis y la regla de producto "el 3v3 no entra al ranking competitivo".
 */
const TEST_SECRET = 'm10b-six-seat-test-secret-minimum-32-chars!!';

async function createGuestSession(app: NestFastifyApplication, deviceName: string) {
  const res = await app.inject({
    method: 'POST',
    url: '/v1/auth/guest',
    payload: { deviceName },
  });
  expect(res.statusCode).toBe(201);
  const cookieHeader = buildCookieHeader(extractAuthCookies(res.headers['set-cookie']).map);
  const body = res.json<{ user: { id: string; nickname: string } }>();
  return { cookieHeader, user: body.user };
}

describe('M10b truco de 6 (3v3): mesas, asientos, equipos y ranking', () => {
  let dbHandle: DatabaseConnectionHandle;
  let app: NestFastifyApplication;
  let provisioner: InMemoryGameRoomProvisioner;
  const fakeNowMs = 1_800_200_000_000;

  beforeAll(async () => {
    dbHandle = await createAdaptiveTestDatabase();
    provisioner = new InMemoryGameRoomProvisioner();
    app = await createApiApp({
      dbHandle,
      authOptions: {
        runtimeConfig: {
          sessionSecret: TEST_SECRET,
          nowFn: () => fakeNowMs,
        },
        rateLimitConfig: {
          maxPerIp: 500,
          maxPerAccount: 500,
          nowFn: () => fakeNowMs,
        },
      },
      lobbyOptions: {
        gameRoomProvisioner: provisioner,
        runtimeConfig: {
          sessionSecret: TEST_SECRET,
          internalSecret: TEST_SECRET,
          tableTtlMs: 600_000,
          inviteTtlMs: 60_000,
          cleanupIntervalMs: 0,
          joinCodeAccountMax: 50,
          joinCodeIpMax: 200,
          joinCodeWindowMs: 60_000,
          nowFn: () => fakeNowMs,
        },
      },
    });
    await app.listen(0, '127.0.0.1');
  });

  afterAll(async () => {
    await app.close();
    await dbHandle.close();
  });

  async function createTable(mode: string, visibility: 'PUBLIC' | 'PRIVATE', cookie: string) {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/tables',
      headers: { cookie },
      payload: { mode, visibility, targetScore: 15, flor: false, turnTimeoutMs: 20_000 },
    });
    expect(res.statusCode, res.body).toBe(201);
    return res.json<{
      id: string;
      roomId: string;
      mode: string;
      maxSeats: number;
      seats: Array<{ seat: number; team: number; occupied: boolean }>;
      joinCode: string | null;
    }>();
  }

  it('una mesa privada 3v3 nace con seis asientos y tres equipos alternados', async () => {
    const owner = await createGuestSession(app, 'DuenoSeis');
    const table = await createTable('3v3', 'PRIVATE', owner.cookieHeader);

    expect(table.mode).toBe('3v3');
    expect(table.maxSeats).toBe(6);
    expect(table.seats).toHaveLength(6);
    // Equipos 0, 1, 2, 0, 1, 2: el compañero queda enfrentado y los turnos alternan equipos.
    expect(table.seats.map((s) => s.team)).toEqual([0, 1, 2, 0, 1, 2]);
    expect(table.seats.map((s) => s.seat)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(table.joinCode).toHaveLength(6);

    // La sala se aprovisiona con el modo real, no con un 1v1 por defecto.
    expect(provisioner.getProvisionedRoom(table.id)).toMatchObject({
      roomId: table.id,
      mode: '3v3',
      targetScore: 15,
      florEnabled: false,
      visibility: 'PRIVATE',
    });
  });

  it('los seis jugadores se sientan con su equipo correcto y la mesa queda completa', async () => {
    const owner = await createGuestSession(app, 'SeisCero');
    // Mesa pública: una privada exige código o enlace firmado para sentarse.
    const table = await createTable('3v3', 'PUBLIC', owner.cookieHeader);
    for (let seat = 1; seat < 6; seat++) {
      const session = await createGuestSession(app, `Seis${seat}`);
      const res = await app.inject({
        method: 'POST',
        url: `/v1/tables/${table.id}/join`,
        headers: { cookie: session.cookieHeader },
        payload: { preferredSeat: seat },
      });
      expect(res.statusCode, res.body).toBe(200);
    }

    const detail = await app.inject({
      method: 'GET',
      url: `/v1/tables/${table.id}`,
      headers: { cookie: owner.cookieHeader },
    });
    expect(detail.statusCode).toBe(200);
    const body = detail.json<{
      occupiedSeats: number;
      maxSeats: number;
      seats: Array<{ seat: number; team: number; occupied: boolean }>;
    }>();
    expect(body.maxSeats).toBe(6);
    expect(body.occupiedSeats).toBe(6);
    expect(body.seats.every((s) => s.occupied)).toBe(true);
    expect(body.seats.map((s) => s.team)).toEqual([0, 1, 2, 0, 1, 2]);
  });

  it('la mesa completa rechaza al séptimo jugador con ROOM_FULL', async () => {
    const owner = await createGuestSession(app, 'LlenoUno');
    const table = await createTable('3v3', 'PUBLIC', owner.cookieHeader);
    for (let i = 1; i < 6; i++) {
      const session = await createGuestSession(app, `Lleno${i + 1}`);
      const res = await app.inject({
        method: 'POST',
        url: `/v1/tables/${table.id}/join`,
        headers: { cookie: session.cookieHeader },
        payload: {},
      });
      expect(res.statusCode, res.body).toBe(200);
    }
    const late = await createGuestSession(app, 'LlenoTarde');
    const lateRes = await app.inject({
      method: 'POST',
      url: `/v1/tables/${table.id}/join`,
      headers: { cookie: late.cookieHeader },
      payload: {},
    });
    expect(lateRes.statusCode).toBe(409);
    expect(lateRes.json<{ error: { details: { reason: string } } }>().error.details.reason).toBe(
      'TABLE_FULL',
    );
  });

  it('las mesas 3v3 públicas aparecen en el listado con maxSeats 6 y filtran por modo', async () => {
    const owner = await createGuestSession(app, 'ListaSeis');
    const table = await createTable('3v3', 'PUBLIC', owner.cookieHeader);

    const all = await app.inject({ method: 'GET', url: '/v1/tables?limit=50' });
    expect(all.statusCode).toBe(200);
    const found = all
      .json<{ tables: Array<{ id: string; mode: string; maxSeats: number }> }>()
      .tables.find((t) => t.id === table.id);
    expect(found).toMatchObject({ mode: '3v3', maxSeats: 6 });

    const onlySix = await app.inject({ method: 'GET', url: '/v1/tables?mode=3v3&limit=50' });
    expect(onlySix.statusCode).toBe(200);
    const rows = onlySix.json<{ tables: Array<{ mode: string }> }>().tables;
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((t) => t.mode === '3v3')).toBe(true);
  });

  it('el emparejamiento 3v3 junta seis jugadores y reparte tres equipos de dos', async () => {
    const sessions = [];
    for (let i = 0; i < 6; i++) {
      sessions.push(await createGuestSession(app, `ColaSeis${i}`));
    }
    let matched: {
      status: string;
      tableId?: string;
      mode?: string;
    } | null = null;
    for (const session of sessions) {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/matchmaking/queue',
        headers: { cookie: session.cookieHeader },
        payload: { mode: '3v3', rulesetCode: 'ar-corto-15-v1', competitive: false },
      });
      // 200 = en cola, 201 = mesa armada con este jugador como disparador del match.
      expect([200, 201], res.body).toContain(res.statusCode);
      const body = res.json<{ status: string; tableId?: string; mode?: string }>();
      if (body.status === 'MATCHED') matched = body;
    }
    expect(matched?.status).toBe('MATCHED');
    expect(matched?.mode).toBe('3v3');

    const detail = await app.inject({
      method: 'GET',
      url: `/v1/tables/${matched!.tableId}`,
      headers: { cookie: sessions[0]!.cookieHeader },
    });
    expect(detail.statusCode).toBe(200);
    const body = detail.json<{
      maxSeats: number;
      occupiedSeats: number;
      seats: Array<{ team: number }>;
    }>();
    expect(body.maxSeats).toBe(6);
    expect(body.occupiedSeats).toBe(6);
    expect(body.seats.map((s) => s.team)).toEqual([0, 1, 2, 0, 1, 2]);
  });

  it('la cola competitiva rechaza 3v3: el truco de 6 no suma al ranking', async () => {
    const session = await createGuestSession(app, 'CompetiSeis');
    const res = await app.inject({
      method: 'POST',
      url: '/v1/matchmaking/queue',
      headers: { cookie: session.cookieHeader },
      payload: { mode: '3v3', rulesetCode: 'ar-corto-15-v1', competitive: true },
    });
    expect([400, 403, 409, 422]).toContain(res.statusCode);
    expect(res.body).not.toContain('MATCHED');
  });

  it('el ranking sólo expone 1v1 y 2v2: pedir 3v3 se rechaza', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/rankings?mode=3v3' });
    expect(res.statusCode).toBe(400);
    // Los dos modos competitivos siguen respondiendo 200.
    for (const mode of ['1v1', '2v2']) {
      const ok = await app.inject({ method: 'GET', url: `/v1/rankings?mode=${mode}` });
      expect(ok.statusCode).toBe(200);
      expect(ok.json<{ mode: string }>().mode).toBe(mode);
    }
  });

  it('las estadísticas del perfil suman el modo 3v3', async () => {
    const session = await createGuestSession(app, 'StatsSeis');
    const res = await app.inject({
      method: 'GET',
      url: `/v1/users/${session.user.id}/stats`,
      headers: { cookie: session.cookieHeader },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ byMode: Record<string, { matchesPlayed: number }> }>();
    expect(Object.keys(body.byMode).sort()).toEqual(['1v1', '2v2', '3v3']);
    expect(body.byMode['3v3']!.matchesPlayed).toBe(0);
  });

  it('los torneos no admiten 3v3 en esta etapa', async () => {
    const session = await createGuestSession(app, 'TorneoSeis');
    const res = await app.inject({
      method: 'POST',
      url: '/v1/tournaments',
      headers: { cookie: session.cookieHeader },
      payload: {
        name: 'Torneo de seis',
        format: 'SINGLE_ELIMINATION',
        visibility: 'PRIVATE',
        capacity: 8,
        rules: {
          mode: '3v3',
          rulesetCode: 'ar-corto-15-v1',
          targetScore: 15,
          florEnabled: false,
          turnTimeoutMs: 25_000,
        },
      },
    });
    expect([400, 422]).toContain(res.statusCode);
  });
});
