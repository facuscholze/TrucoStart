import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createAdaptiveTestDatabase,
  type AppDatabase,
  type DatabaseConnectionHandle,
} from '../../../db/database.provider.js';
import {
  profilesTable,
  ratingSeasonsTable,
  tournamentMatchesTable,
  tournamentParticipantsTable,
  tournamentsTable,
  usersTable,
  walletAccountsTable,
} from '../../../db/schema/index.js';
import { generateUuidV7 } from '../../../common/uuidv7.js';
import { InMemoryRateLimitStore } from '../../../common/rate-limit/in-memory-rate-limit-store.js';
import { AuditRepository } from '../../audit/audit.repository.js';
import { buildLobbyRuntimeConfigFromEnv } from '../../lobby/lobby.config.js';
import { LobbyRepository } from '../../lobby/lobby.repository.js';
import { MatchCompletionBridge } from '../../lobby/ports/match-completion-bridge.js';
import { InMemoryGameRoomProvisioner } from '../../lobby/ports/game-room-provisioner.js';
import { buildTournamentsRuntimeConfig } from '../tournaments.config.js';
import { TournamentsRepository } from '../tournaments.repository.js';
import { TournamentsService } from '../tournaments.service.js';
import type { AuthenticatedPrincipal } from '../../auth/guards/session-auth.guard.js';

/**
 * Check-in vencido y no-show, con reloj controlado.
 *
 * El servicio nunca lee `Date.now()`: lo recibe por `nowFn`. Eso permite recorrer días de
 * calendario en milisegundos y probar el barrido de verdad (`runMaintenance`, el mismo que
 * corre el planificador), sin `sleep` ni esperas reales.
 *
 * La prueba está pensada para PostgreSQL 16 real en CI (`DATABASE_URL` +
 * `TRUCO_REQUIRE_REAL_SERVICES=1`, que prohíbe el fallback a PGlite). En el sandbox corre
 * sobre PGlite por la misma interfaz; el camino de código es idéntico.
 */

const SECRET = 'tournaments-noshow-test-secret-32chars!';
const START = new Date('2026-11-26T12:00:00.000Z');

interface SeedUser {
  readonly id: string;
  readonly principal: AuthenticatedPrincipal;
}

describe('M10a check-in vencido y no-show: barrido con reloj controlado', () => {
  let dbHandle: DatabaseConnectionHandle;
  let db: AppDatabase;
  let service: TournamentsService;
  let clockMs = START.getTime();
  let ipCounter = 0;

  beforeAll(async () => {
    dbHandle = await createAdaptiveTestDatabase();
    db = dbHandle.db;

    const rateLimit = new InMemoryRateLimitStore(() => clockMs);
    service = new TournamentsService(
      new TournamentsRepository(db),
      buildTournamentsRuntimeConfig({
        // El reloj es una dependencia: el test lo mueve a mano.
        nowFn: () => clockMs,
        maintenanceIntervalMs: 0,
        maxActivePrivatePerCreator: 50,
        createPerAccountMax: 100,
        createPerIpMax: 100,
        registerPerAccountMax: 100,
      }),
      buildLobbyRuntimeConfigFromEnv({
        sessionSecret: SECRET,
        internalSecret: SECRET,
        cleanupIntervalMs: 0,
      }),
      new LobbyRepository(db),
      new InMemoryGameRoomProvisioner(),
      rateLimit,
      new AuditRepository(db),
      { emitSocialNotification: () => undefined } as never,
      new MatchCompletionBridge(),
    );
    service.onApplicationBootstrap();

    const [existingSeason] = await db
      .select({ id: ratingSeasonsTable.id })
      .from(ratingSeasonsTable)
      .where(eq(ratingSeasonsTable.status, 'ACTIVE'))
      .limit(1);
    if (!existingSeason) {
      await db.insert(ratingSeasonsTable).values({
        id: generateUuidV7(),
        seasonNumber: Math.floor(Math.random() * 100_000) + 1,
        label: `Temporada ${randomUUID().slice(0, 6)}`,
        status: 'ACTIVE',
        startsAt: START,
        endsAt: new Date(START.getTime() + 90 * 24 * 60 * 60 * 1000),
      });
    }
  });

  beforeEach(() => {
    clockMs = START.getTime();
  });

  afterAll(async () => {
    await dbHandle.close();
  });

  /** Avanza el reloj `minutes` desde el inicio del caso. */
  function at(minutes: number): void {
    clockMs = START.getTime() + minutes * 60_000;
  }

  async function seedUsers(count: number, ratingStart = 1600): Promise<SeedUser[]> {
    const users: SeedUser[] = [];
    for (let index = 0; index < count; index++) {
      const id = generateUuidV7();
      const nickname = `NoShow${index + 1}-${randomUUID().slice(0, 6)}`;
      await db.insert(usersTable).values({ id, nickname, nicknameLower: nickname.toLowerCase() });
      await db.insert(profilesTable).values({ userId: id, level: 1, xp: 0 });
      await db.insert(walletAccountsTable).values({
        userId: id,
        currencyType: 'VIRTUAL_COIN',
        hasEconomicValue: false,
        playerTransfersEnabled: false,
      });
      const principal = {
        userId: id,
        nickname,
        sessionId: generateUuidV7(),
      } as unknown as AuthenticatedPrincipal;
      users.push({ id, principal });
      void ratingStart;
    }
    return users;
  }

  async function createTournament(
    organizer: SeedUser,
    minutes: { checkIn: number; noShow: number },
  ) {
    return service.create(
      organizer.principal,
      {
        name: `Copa no-show ${randomUUID().slice(0, 6)}`,
        format: 'SINGLE_ELIMINATION',
        visibility: 'PRIVATE',
        capacity: 4,
        rules: {
          mode: '1v1',
          rulesetCode: 'ar-corto-15-v1',
          targetScore: 15,
          florEnabled: false,
          turnTimeoutMs: 25_000,
        },
        // El check-in vence a los `checkIn` minutos: la inscripción ocupa la primera mitad
        // de esa ventana y el check-in la segunda (`checkInClosesAt = registro + checkIn`).
        registrationMinutes: minutes.checkIn / 2,
        checkInMinutes: minutes.checkIn / 2,
        noShowMinutes: minutes.noShow,
        prizes: [
          { position: 1, coins: 100, cosmeticId: null },
          { position: 2, coins: 40, cosmeticId: null },
        ],
        official: false,
      },
      { ip: `10.10.0.${++ipCounter}` },
    );
  }

  it('cierra el check-in, deja afuera a los ausentes, define el cruce por incomparecencia y avanza la llave', async () => {
    const organizer = (await seedUsers(1))[0]!;
    const players = await seedUsers(4);
    const tournament = await createTournament(organizer, { checkIn: 10, noShow: 5 });

    for (const player of players) await service.register(player.principal, tournament.id);

    // 1) La ventana de check-in corre: dos se presentan ANTES del cierre.
    at(4);
    for (const player of players.slice(0, 2)) {
      await service.checkIn(player.principal, tournament.id);
    }

    // 2) Pasado el cierre, la inscripción tardía ya no puede colarse: un check-in fuera
    //    de ventana es un conflicto, no un reintento silencioso.
    at(11);
    await expect(service.checkIn(players[2]!.principal, tournament.id)).rejects.toMatchObject({
      status: 409,
      details: expect.objectContaining({ reason: 'CHECK_IN_DEADLINE_PASSED' }),
    });

    // 3) El barrido real (el que corre el planificador) arranca el torneo: vencido el
    //    check-in, los dos que no se presentaron quedan `NO_SHOW` y fuera del cuadro.
    const firstSweep = await service.runMaintenance();
    expect(firstSweep.started, 'el barrido arrancó el torneo').toBeGreaterThanOrEqual(1);

    const [started] = await db
      .select()
      .from(tournamentsTable)
      .where(eq(tournamentsTable.id, tournament.id));
    expect(started!.status).toBe('IN_PROGRESS');

    const participants = await db
      .select()
      .from(tournamentParticipantsTable)
      .where(eq(tournamentParticipantsTable.tournamentId, tournament.id));
    expect(participants.filter((row) => row.status === 'NO_SHOW')).toHaveLength(2);
    expect(participants.filter((row) => row.status === 'CHECKED_IN')).toHaveLength(2);

    // 4) La llave se armó sólo con los presentes: un cruce, con sus dos lados ocupados y
    //    sin pases libres regalados a quien nunca llegó.
    const matches = await db
      .select()
      .from(tournamentMatchesTable)
      .where(eq(tournamentMatchesTable.tournamentId, tournament.id));
    expect(matches).toHaveLength(1);
    const final = matches[0]!;
    expect(final.status).toBe('READY');
    expect(final.homeUserId).not.toBeNull();
    expect(final.awayUserId).not.toBeNull();
    // El plazo de presentación sale de `noShowMinutes` (5) desde que el cruce quedó listo.
    expect(final.deadlineAt!.getTime()).toBe(new Date(clockMs).getTime() + 5 * 60_000);

    // 5) Nadie entra a la mesa: pasa el plazo y el barrido resuelve la incomparecencia.
    at(17);
    const secondSweep = await service.runMaintenance();
    expect(secondSweep.forfeits, 'el barrido cerró el cruce vencido').toBeGreaterThanOrEqual(1);

    const [forfeited] = await db
      .select()
      .from(tournamentMatchesTable)
      .where(eq(tournamentMatchesTable.id, final.id));
    expect(forfeited!.status).toBe('FORFEITED');
    expect(forfeited!.forfeitReason).toBe('NO_SHOW');
    // Doble ausencia: el cruce se cierra sin inventar ganador.
    expect(forfeited!.winnerUserId).toBeNull();

    // 6) La llave avanza: el torneo no queda trabado a mitad de camino.
    const [afterForfeit] = await db
      .select()
      .from(tournamentsTable)
      .where(eq(tournamentsTable.id, tournament.id));
    expect(['IN_PROGRESS', 'FINISHED']).toContain(afterForfeit!.status);
    const remaining = await db
      .select()
      .from(tournamentMatchesTable)
      .where(
        and(
          eq(tournamentMatchesTable.tournamentId, tournament.id),
          eq(tournamentMatchesTable.status, 'READY'),
        ),
      );
    // Con el único cruce resuelto no queda nada pendiente en el cuadro.
    expect(remaining).toHaveLength(0);
  }, 120_000);

  it('el barrido es idempotente: repetirlo no reabre ni redefine el cruce cerrado', async () => {
    const organizer = (await seedUsers(1))[0]!;
    const players = await seedUsers(2);
    const tournament = await createTournament(organizer, { checkIn: 10, noShow: 5 });
    for (const player of players) {
      await service.register(player.principal, tournament.id);
      await service.checkIn(player.principal, tournament.id);
    }

    at(11);
    await service.runMaintenance();
    const [match] = await db
      .select()
      .from(tournamentMatchesTable)
      .where(eq(tournamentMatchesTable.tournamentId, tournament.id));
    expect(match!.status).toBe('READY');

    at(30);
    await service.runMaintenance();
    const [closed] = await db
      .select()
      .from(tournamentMatchesTable)
      .where(eq(tournamentMatchesTable.id, match!.id));
    expect(closed!.status).toBe('FORFEITED');

    // Tres barridos más sobre el mismo estado: nada cambia, no hay premios ni reapertura.
    at(45);
    await service.runMaintenance();
    at(60);
    const sweep = await service.runMaintenance();
    expect(sweep.forfeits).toBe(0);
    const [still] = await db
      .select()
      .from(tournamentMatchesTable)
      .where(eq(tournamentMatchesTable.id, match!.id));
    expect(still!.status).toBe('FORFEITED');
    expect(still!.completedAt?.getTime()).toBe(closed!.completedAt?.getTime());
  }, 120_000);

  it('un torneo sin nadie presente se cancela y no arma una llave vacía', async () => {
    const organizer = (await seedUsers(1))[0]!;
    const players = await seedUsers(3);
    const tournament = await createTournament(organizer, { checkIn: 10, noShow: 5 });
    for (const player of players) await service.register(player.principal, tournament.id);

    at(11);
    await service.runMaintenance();

    const [row] = await db
      .select()
      .from(tournamentsTable)
      .where(eq(tournamentsTable.id, tournament.id));
    expect(row!.status).toBe('CANCELLED');
    expect(row!.cancelledReason).toContain('check-in');

    const participants = await db
      .select()
      .from(tournamentParticipantsTable)
      .where(eq(tournamentParticipantsTable.tournamentId, tournament.id));
    expect(participants.every((participant) => participant.status === 'NO_SHOW')).toBe(true);

    const matches = await db
      .select()
      .from(tournamentMatchesTable)
      .where(eq(tournamentMatchesTable.tournamentId, tournament.id));
    expect(matches).toHaveLength(0);
  }, 120_000);
});
