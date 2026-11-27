import { randomUUID } from 'node:crypto';
import { asc, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createAdaptiveTestDatabase,
  type AppDatabase,
  type DatabaseConnectionHandle,
} from '../../../db/database.provider.js';
import {
  auditLogsTable,
  cosmeticCatalogTable,
  leagueClosuresTable,
  leagueMatchesTable,
  leagueMovementsTable,
  leagueParticipantsTable,
  leaguePrizeAwardsTable,
  leagueReschedulesTable,
  leagueRoundsTable,
  profilesTable,
  socialNotificationsTable,
  tableSeatsTable,
  tablesTable,
  usersTable,
  walletAccountsTable,
  walletTransactionsTable,
} from '../../../db/schema/index.js';
import { generateUuidV7 } from '../../../common/uuidv7.js';
import { parseWithZod } from '../../../common/zod-validation.js';
import { InMemoryRateLimitStore } from '../../../common/rate-limit/in-memory-rate-limit-store.js';
import { AuditRepository } from '../../audit/audit.repository.js';
import { buildLobbyRuntimeConfigFromEnv } from '../../lobby/lobby.config.js';
import { LobbyRepository } from '../../lobby/lobby.repository.js';
import { MatchCompletionBridge } from '../../lobby/ports/match-completion-bridge.js';
import { InMemoryGameRoomProvisioner } from '../../lobby/ports/game-room-provisioner.js';
import { buildLeaguesRuntimeConfig } from '../leagues.config.js';
import { LeaguesRepository } from '../leagues.repository.js';
import { LeaguesService } from '../leagues.service.js';
import type { AuthenticatedPrincipal } from '../../auth/guards/session-auth.guard.js';
import {
  LeagueListQuerySchema,
  type CreateLeagueRequest,
  type LeagueDivision,
} from '@truco/shared';

const SECRET = 'leagues-m10b-test-secret-32chars-ok!!!';
const START = new Date('2027-01-04T12:00:00.000Z');

interface SeedUser {
  readonly id: string;
  readonly nickname: string;
  readonly principal: AuthenticatedPrincipal;
}

function createRequest(overrides: Partial<CreateLeagueRequest> = {}): CreateLeagueRequest {
  return {
    name: `Liga ${randomUUID().slice(0, 6)}`,
    mode: '1v1',
    division: 'PLATA',
    season: {
      label: `T${randomUUID().slice(0, 6)}`,
      startsAt: new Date(START.getTime() + 60 * 60_000).toISOString(),
      endsAt: new Date(START.getTime() + 60 * 24 * 60 * 60_000).toISOString(),
    },
    rules: {
      rulesetCode: 'ar-standard-v1',
      targetScore: 30,
      florEnabled: true,
      turnTimeoutMs: 25_000,
    },
    schedule: {
      format: 'ROUNDS',
      rounds: 3,
      daysBetweenRounds: 7,
      roundWindowHours: 48,
      maxReschedulesPerMatch: 2,
      rescheduleMinHoursBeforeDeadline: 12,
      rescheduleExtensionHours: 48,
    },
    promotion: { promotions: 1, relegations: 1, minMatchesToMove: 1 },
    capacity: 16,
    registrationMinutes: 30,
    prizes: [],
    official: false,
    ...overrides,
  } as CreateLeagueRequest;
}

describe('M10b ligas: ciclo completo sobre PostgreSQL (PGlite)', () => {
  let dbHandle: DatabaseConnectionHandle;
  let db: AppDatabase;
  let service: LeaguesService;
  let repository: LeaguesRepository;
  let clockMs = START.getTime();
  let provisioner: InMemoryGameRoomProvisioner;

  beforeAll(async () => {
    dbHandle = await createAdaptiveTestDatabase();
    db = dbHandle.db;
    repository = new LeaguesRepository(db);
    const lobbyConfig = buildLobbyRuntimeConfigFromEnv({
      sessionSecret: SECRET,
      internalSecret: SECRET,
      cleanupIntervalMs: 0,
    });
    provisioner = new InMemoryGameRoomProvisioner();
    service = new LeaguesService(
      repository,
      buildLeaguesRuntimeConfig({
        nowFn: () => clockMs,
        maintenanceIntervalMs: 0,
        maxActivePerCreator: 100,
        createPerAccountMax: 100,
        createPerIpMax: 100,
        joinPerAccountMax: 1_000,
        reschedulePerAccountMax: 1_000,
      }),
      lobbyConfig,
      new LobbyRepository(db),
      provisioner,
      new InMemoryRateLimitStore(() => clockMs),
      new AuditRepository(db),
      { emitSocialNotification: () => undefined } as never,
      new MatchCompletionBridge(),
    );
    service.onApplicationBootstrap();
  });

  beforeEach(() => {
    clockMs = START.getTime();
  });

  afterAll(async () => {
    service.onApplicationShutdown();
    await dbHandle.close();
  });

  function at(minutes: number): void {
    clockMs = START.getTime() + minutes * 60_000;
  }

  /**
   * Adelanta el reloj hasta el inicio de la primera jornada (y un minuto más).
   *
   * El arranque del calendario no es el cierre de inscripción sino el inicio de la temporada, que
   * en estas pruebas es una hora después: usar `at(31)` dejaba las jornadas todavía en el futuro.
   */
  async function atFirstRound(leagueId: string): Promise<void> {
    const round = await firstRound(leagueId);
    clockMs = round.startsAt.getTime() + 60_000;
  }

  /**
   * Primera jornada de la liga.
   *
   * Siempre con `orderBy`: sin él, `select` devuelve cualquiera de las tres jornadas y el test
   * mide una fila distinta de la que cree (ése fue un defecto de estas pruebas, no del producto).
   */
  async function firstRound(leagueId: string): Promise<typeof leagueRoundsTable.$inferSelect> {
    const [round] = await db
      .select()
      .from(leagueRoundsTable)
      .where(eq(leagueRoundsTable.leagueId, leagueId))
      .orderBy(asc(leagueRoundsTable.number));
    if (!round) throw new Error('La liga no tiene jornadas');
    return round;
  }

  /** Primera partida de la liga, ordenada por jornada. */
  async function firstMatch(leagueId: string): Promise<typeof leagueMatchesTable.$inferSelect> {
    const [match] = await db
      .select()
      .from(leagueMatchesTable)
      .where(eq(leagueMatchesTable.leagueId, leagueId))
      .orderBy(asc(leagueMatchesTable.roundNumber));
    if (!match) throw new Error('La liga no tiene partidas');
    return match;
  }

  /** SQL crudo, para escenarios que necesitan forzar el reloj de la base. */
  async function runSql(query: string): Promise<void> {
    await db.execute(sql.raw(query));
  }

  /**
   * Adelanta el plazo de una jornada para simular que venció.
   *
   * Se mueven `starts_at` y `deadline_at` juntos porque el `CHECK` de la tabla exige
   * `deadline_at > starts_at`: mover sólo el plazo sería un rango inválido y lo rechaza.
   */
  async function expireRound(roundId: string): Promise<void> {
    const deadline = new Date(clockMs - 60_000).toISOString();
    const startsAt = new Date(clockMs - 3_600_000).toISOString();
    await runSql(
      `UPDATE league_rounds SET starts_at = '${startsAt}', deadline_at = '${deadline}' WHERE id = '${roundId}'`,
    );
    // La partida tiene su propio plazo, copiado de la jornada al crearse: se mueve también o el
    // cierre seguiría viendo la partida como vigente.
    await runSql(
      `UPDATE league_matches SET deadline_at = '${deadline}' WHERE round_id = '${roundId}'`,
    );
  }

  async function seedUsers(count: number): Promise<SeedUser[]> {
    const users: SeedUser[] = [];
    for (let index = 0; index < count; index++) {
      const id = generateUuidV7();
      const nickname = `Liga${index + 1}-${randomUUID().slice(0, 6)}`;
      await db.insert(usersTable).values({ id, nickname, nicknameLower: nickname.toLowerCase() });
      await db.insert(profilesTable).values({ userId: id, level: 1, xp: 0 });
      await db.insert(walletAccountsTable).values({
        userId: id,
        currencyType: 'VIRTUAL_COIN',
        hasEconomicValue: false,
        playerTransfersEnabled: false,
      });
      users.push({
        id,
        nickname,
        principal: {
          userId: id,
          nickname,
          sessionId: generateUuidV7(),
          familyId: generateUuidV7(),
          email: null,
          isGuest: false,
          emailVerified: false,
          role: 'PLAYER',
          mutedUntil: null,
        } as unknown as AuthenticatedPrincipal,
      });
    }
    return users;
  }

  /** Crea una liga, inscribe a los jugadores y la arranca. */
  async function setUpLeague(input: {
    readonly players: number;
    readonly overrides?: Partial<CreateLeagueRequest>;
    readonly division?: LeagueDivision;
  }): Promise<{ leagueId: string; users: SeedUser[]; organizer: SeedUser }> {
    const users = await seedUsers(input.players + 1);
    const organizer = users[0]!;
    const players = users.slice(1);
    const created = await service.create(
      organizer.principal,
      createRequest({ division: input.division ?? 'PLATA', ...input.overrides }),
      { ip: '127.0.0.1' },
    );
    for (const player of players) {
      await service.join(player.principal, created.id);
    }
    await service.start(organizer.principal, created.id);
    return { leagueId: created.id, users: players, organizer };
  }

  /** Juega una partida: gana `winner`, con marcador 30-x. */
  async function playMatch(matchId: string, winnerUserId: string, loserUserId: string) {
    const match = await repository.findMatchById(matchId);
    if (!match) throw new Error('La partida no existe');
    const homeWins = match.homeUserId === winnerUserId;
    await service.markMatchPlayed({
      matchId,
      winnerUserId,
      homeScore: homeWins ? 30 : 10,
      awayScore: homeWins ? 10 : 30,
      realMatchId: generateUuidV7(),
      now: new Date(clockMs),
    });
    void loserUserId;
  }

  // ------------------------------------------------------------- creación

  it('crea una liga en inscripción y sin costo de entrada', async () => {
    const [organizer] = await seedUsers(1);
    const created = await service.create(organizer!.principal, createRequest(), {
      ip: '127.0.0.1',
    });
    expect(created.status).toBe('REGISTRATION');
    expect(created.mode).toBe('1v1');
    // No existe ningún campo de precio: el contrato no lo tiene y la tabla tampoco.
    expect(Object.keys(created)).not.toContain('price');
    expect(Object.keys(created)).not.toContain('entryFee');
  });

  it('no permite dos ligas de la misma división y temporada', async () => {
    const [organizer] = await seedUsers(1);
    const request = createRequest();
    await service.create(organizer!.principal, request, { ip: '127.0.0.1' });
    await expect(
      service.create(organizer!.principal, request, { ip: '127.0.0.1' }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('rechaza ascensos en la división más alta y descensos en la más baja', async () => {
    const [organizer] = await seedUsers(1);
    await expect(
      service.create(
        organizer!.principal,
        createRequest({
          division: 'PLATINO',
          promotion: { promotions: 1, relegations: 1, minMatchesToMove: 1 },
        }),
        { ip: '127.0.0.1' },
      ),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      service.create(
        organizer!.principal,
        createRequest({
          division: 'BRONCE',
          promotion: { promotions: 1, relegations: 1, minMatchesToMove: 1 },
        }),
        { ip: '127.0.0.1' },
      ),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('sólo el staff crea ligas oficiales', async () => {
    const [player] = await seedUsers(1);
    await expect(
      service.create(player!.principal, createRequest({ official: true }), { ip: '127.0.0.1' }),
    ).rejects.toMatchObject({ status: 403 });
  });

  // --------------------------------------------------------- inscripción

  it('inscribe con número de inscripción y no deja repetir la inscripción', async () => {
    const users = await seedUsers(3);
    const created = await service.create(users[0]!.principal, createRequest(), { ip: '127.0.0.1' });
    await service.join(users[1]!.principal, created.id);
    await service.join(users[2]!.principal, created.id);
    const rows = await db
      .select()
      .from(leagueParticipantsTable)
      .where(eq(leagueParticipantsTable.leagueId, created.id));
    expect(rows.map((row) => row.seed).sort()).toEqual([1, 2]);
    await expect(service.join(users[1]!.principal, created.id)).rejects.toMatchObject({
      status: 409,
    });
  });

  it('reinscribirse después de la baja conserva el número de inscripción', async () => {
    const users = await seedUsers(2);
    const created = await service.create(users[0]!.principal, createRequest(), { ip: '127.0.0.1' });
    await service.join(users[1]!.principal, created.id);
    await service.leave(users[1]!.principal, created.id);
    await service.join(users[1]!.principal, created.id);
    const rows = await db
      .select()
      .from(leagueParticipantsTable)
      .where(eq(leagueParticipantsTable.leagueId, created.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.seed).toBe(1);
    expect(rows[0]!.status).toBe('ACTIVE');
  });

  it('no deja inscribirse cuando el cupo está lleno', async () => {
    const users = await seedUsers(3);
    const created = await service.create(users[0]!.principal, createRequest({ capacity: 2 }), {
      ip: '127.0.0.1',
    });
    await service.join(users[1]!.principal, created.id);
    await service.join(users[2]!.principal, created.id);
    const extra = await seedUsers(1);
    await expect(service.join(extra[0]!.principal, created.id)).rejects.toMatchObject({
      status: 409,
    });
  });

  // ----------------------------------------------------------- calendario

  it('arranca con calendario, una jornada por ronda y todos colocados sin repetir rival', async () => {
    const { leagueId } = await setUpLeague({ players: 4 });
    const rounds = await db
      .select()
      .from(leagueRoundsTable)
      .where(eq(leagueRoundsTable.leagueId, leagueId));
    expect(rounds).toHaveLength(3);
    const matches = await db
      .select()
      .from(leagueMatchesTable)
      .where(eq(leagueMatchesTable.leagueId, leagueId));
    // Cuatro jugadores y tres jornadas: dos partidas por jornada.
    expect(matches).toHaveLength(6);
    // Nadie contra sí mismo.
    for (const match of matches) {
      expect(match.homeUserId).not.toBe(match.awayUserId);
    }
    // Cada par aparece una sola vez en la temporada.
    const pairs = matches.map((match) => [match.homeUserId, match.awayUserId].sort().join('|'));
    expect(new Set(pairs).size).toBe(6);
  });

  it('necesita al menos dos jugadores para arrancar', async () => {
    const users = await seedUsers(2);
    const created = await service.create(users[0]!.principal, createRequest(), { ip: '127.0.0.1' });
    await service.join(users[1]!.principal, created.id);
    await expect(service.start(users[0]!.principal, created.id)).rejects.toMatchObject({
      status: 409,
    });
  });

  // ------------------------------------------------------------- ausencias

  it('define por ausencia cuando vence el plazo de la jornada sin que nadie juegue', async () => {
    const { leagueId, organizer } = await setUpLeague({ players: 2 });
    await atFirstRound(leagueId);
    await service.runMaintenance();
    const round = await firstRound(leagueId);
    // Se fuerza el vencimiento del plazo y el cierre de jornada.
    await expireRound(round!.id);
    const outcome = await service.closeRound({ userId: organizer.id, role: 'PLAYER' }, round.id);
    expect(outcome.forfeited).toBe(1);
    // Sólo la partida de ESA jornada: la liga tiene tres jornadas con una partida cada una.
    const matches = await db
      .select()
      .from(leagueMatchesTable)
      .where(eq(leagueMatchesTable.roundId, round.id));
    expect(matches).toHaveLength(1);
    expect(matches[0]!.status).toBe('FORFEITED');
    expect(matches[0]!.forfeitReason).toBe('DOUBLE_NO_SHOW');
    // Ni gana ni pierde nadie: el doble ausente no tiene ganador (ADR-035).
    expect(matches[0]!.winnerUserId).toBeNull();
  });

  it('el cierre de jornada es idempotente: la segunda vez no define nada', async () => {
    const { leagueId, organizer } = await setUpLeague({ players: 2 });
    await atFirstRound(leagueId);
    const round = await firstRound(leagueId);
    await expireRound(round.id);
    const first = await service.closeRound({ userId: organizer.id, role: 'PLAYER' }, round.id);
    const second = await service.closeRound({ userId: organizer.id, role: 'PLAYER' }, round.id);
    expect(first.forfeited).toBe(1);
    expect(second.alreadyClosed).toBe(true);
    expect(second.forfeited).toBe(0);
  });

  // -------------------------------------------------------------- cierre

  it('cierra la temporada con tabla congelada, premios y estado FINISHED', async () => {
    const { leagueId, users, organizer } = await setUpLeague({ players: 4 });
    const matches = await db
      .select()
      .from(leagueMatchesTable)
      .where(eq(leagueMatchesTable.leagueId, leagueId));
    // Que gane siempre el jugador 0.
    const winner = users[0]!.id;
    for (const match of matches.filter((candidate) => candidate.roundNumber === 1)) {
      const loser = match.homeUserId === winner ? match.awayUserId : match.homeUserId;
      await playMatch(match.id, winner, loser);
    }
    at(31);
    const result = await service.closeSeason({ userId: organizer.id, role: 'PLAYER' }, leagueId);
    expect(result.championUserId).toBe(winner);
    const league = await repository.findById(leagueId);
    expect(league?.status).toBe('FINISHED');
    const closure = await repository.findClosure(leagueId);
    expect(closure).not.toBeNull();
    expect((closure!.standings as unknown[]).length).toBe(4);
  });

  it('un reintento del cierre devuelve el mismo resultado y no acredita de nuevo', async () => {
    const { leagueId, users, organizer } = await setUpLeague({
      players: 4,
      overrides: { prizes: [{ position: 1, coins: 100, cosmeticId: null }] },
    });
    const winner = users[0]!.id;
    const matches = await db
      .select()
      .from(leagueMatchesTable)
      .where(eq(leagueMatchesTable.leagueId, leagueId));
    for (const match of matches.filter((candidate) => candidate.roundNumber === 1)) {
      const loser = match.homeUserId === winner ? match.awayUserId : match.homeUserId;
      await playMatch(match.id, winner, loser);
    }
    at(31);
    const first = await service.closeSeason({ userId: organizer.id, role: 'PLAYER' }, leagueId);
    expect(first.awardedPrizes).toBe(1);

    const second = await service.closeSeason({ userId: organizer.id, role: 'PLAYER' }, leagueId);
    expect(second.championUserId).toBe(first.championUserId);
    expect(second.promoted).toEqual(first.promoted);
    // El reintento no acredita otra vez.
    expect(second.awardedPrizes).toBe(0);

    const awards = await db
      .select()
      .from(leaguePrizeAwardsTable)
      .where(eq(leaguePrizeAwardsTable.leagueId, leagueId));
    expect(awards).toHaveLength(1);
    const ledger = await db
      .select()
      .from(walletTransactionsTable)
      .where(eq(walletTransactionsTable.referenceId, leagueId));
    expect(ledger).toHaveLength(1);
    expect(ledger[0]!.amount).toBe(100);
  });

  it('si el cierre falla a mitad, no deja datos a medias y el reintento cierra limpio', async () => {
    const { leagueId, users, organizer } = await setUpLeague({
      players: 4,
      overrides: { prizes: [{ position: 1, coins: 50, cosmeticId: null }] },
    });
    const winner = users[0]!.id;
    const matches = await db
      .select()
      .from(leagueMatchesTable)
      .where(eq(leagueMatchesTable.leagueId, leagueId));
    for (const match of matches.filter((candidate) => candidate.roundNumber === 1)) {
      const loser = match.homeUserId === winner ? match.awayUserId : match.homeUserId;
      await playMatch(match.id, winner, loser);
    }
    at(31);

    /*
     * Fallo a mitad: se rompe la escritura de premios con un trigger que rechaza la fila del
     * libro mayor. El cierre ya escribió movimientos y la tabla congelada antes de llegar acá,
     * así que si no fuera transaccional, esos datos quedarían a medias.
     */
    await runSql(`
      CREATE OR REPLACE FUNCTION reject_league_prize() RETURNS trigger AS $$
      BEGIN
        IF NEW.reference_type = 'league' THEN
          RAISE EXCEPTION 'fallo simulado a mitad del cierre';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);
    await runSql(`
      CREATE TRIGGER reject_league_prize_trg BEFORE INSERT ON wallet_transactions
      FOR EACH ROW EXECUTE FUNCTION reject_league_prize();
    `);

    await expect(
      service.closeSeason({ userId: organizer.id, role: 'PLAYER' }, leagueId),
    ).rejects.toBeTruthy();

    // Nada a medias: la liga sigue `ACTIVE`, sin cierre, sin movimientos y sin premios.
    const leagueAfterFailure = await repository.findById(leagueId);
    expect(leagueAfterFailure?.status).toBe('ACTIVE');
    expect(await repository.findClosure(leagueId)).toBeNull();
    expect(
      await db
        .select()
        .from(leagueMovementsTable)
        .where(eq(leagueMovementsTable.leagueId, leagueId)),
    ).toHaveLength(0);
    expect(
      await db
        .select()
        .from(leaguePrizeAwardsTable)
        .where(eq(leaguePrizeAwardsTable.leagueId, leagueId)),
    ).toHaveLength(0);
    expect(
      await db
        .select()
        .from(walletTransactionsTable)
        .where(eq(walletTransactionsTable.referenceId, leagueId)),
    ).toHaveLength(0);

    // Se quita el trigger y el reintento cierra bien, sin duplicar nada.
    await runSql(`DROP TRIGGER reject_league_prize_trg ON wallet_transactions`);
    const retry = await service.closeSeason({ userId: organizer.id, role: 'PLAYER' }, leagueId);
    expect(retry.championUserId).toBe(winner);
    expect(retry.awardedPrizes).toBe(1);
    expect(
      await db
        .select()
        .from(walletTransactionsTable)
        .where(eq(walletTransactionsTable.referenceId, leagueId)),
    ).toHaveLength(1);
    expect(await repository.findClosure(leagueId)).not.toBeNull();
  });

  it('dos cierres simultáneos no duplican premios ni movimientos', async () => {
    const { leagueId, users, organizer } = await setUpLeague({
      players: 4,
      overrides: { prizes: [{ position: 1, coins: 75, cosmeticId: null }] },
    });
    const winner = users[0]!.id;
    const matches = await db
      .select()
      .from(leagueMatchesTable)
      .where(eq(leagueMatchesTable.leagueId, leagueId));
    for (const match of matches.filter((candidate) => candidate.roundNumber === 1)) {
      const loser = match.homeUserId === winner ? match.awayUserId : match.homeUserId;
      await playMatch(match.id, winner, loser);
    }
    at(31);

    const results = await Promise.allSettled([
      service.closeSeason({ userId: organizer.id, role: 'PLAYER' }, leagueId),
      service.closeSeason({ userId: organizer.id, role: 'PLAYER' }, leagueId),
    ]);
    // Al menos uno cierra; el otro termina devolviendo el mismo resultado o con un 409 explícito.
    expect(results.some((result) => result.status === 'fulfilled')).toBe(true);
    const fulfilled = results.filter((result) => result.status === 'fulfilled');
    const championIds = new Set(
      fulfilled.map(
        (result) =>
          (result as PromiseFulfilledResult<{ championUserId: string | null }>).value
            .championUserId,
      ),
    );
    expect(championIds.size).toBe(1);
    // Y lo importante: una sola acreditación, un solo movimiento por jugador, un solo cierre.
    expect(
      await db
        .select()
        .from(walletTransactionsTable)
        .where(eq(walletTransactionsTable.referenceId, leagueId)),
    ).toHaveLength(1);
    expect(await repository.findClosure(leagueId)).not.toBeNull();
    expect(
      await db.select().from(leagueClosuresTable).where(eq(leagueClosuresTable.leagueId, leagueId)),
    ).toHaveLength(1);
    expect(
      await db
        .select()
        .from(leaguePrizeAwardsTable)
        .where(eq(leaguePrizeAwardsTable.leagueId, leagueId)),
    ).toHaveLength(1);
  });

  it('un premio no se paga a quien no jugó ninguna partida', async () => {
    const { leagueId, organizer } = await setUpLeague({
      players: 4,
      overrides: { prizes: [{ position: 1, coins: 40, cosmeticId: null }] },
    });
    at(31);
    const result = await service.closeSeason({ userId: organizer.id, role: 'PLAYER' }, leagueId);
    // Nadie jugó: la tabla tiene cuatro filas con cero partidas y no hay campeón.
    expect(result.championUserId).toBeNull();
    expect(result.awardedPrizes).toBe(0);
  });

  // --------------------------------------------------- ascensos y descensos

  it('asciende a los mejores y desciende a los peores según las reglas de la división', async () => {
    const { leagueId, users, organizer } = await setUpLeague({
      players: 4,
      division: 'PLATA',
      overrides: { promotion: { promotions: 1, relegations: 1, minMatchesToMove: 1 } },
    });
    const [a, b, , d] = users.map((user) => user.id) as [string, string, string, string];
    const matches = await db
      .select()
      .from(leagueMatchesTable)
      .where(eq(leagueMatchesTable.leagueId, leagueId));
    for (const match of matches) {
      // `a` gana todas sus partidas; `d` pierde todas.
      const winner =
        match.homeUserId === a || match.awayUserId === a
          ? a
          : match.homeUserId === d || match.awayUserId === d
            ? void 0
            : b;
      if (!winner) {
        const loser = match.homeUserId === d ? match.awayUserId : match.homeUserId;
        await playMatch(match.id, loser, d);
        continue;
      }
      const loser = match.homeUserId === winner ? match.awayUserId : match.homeUserId;
      await playMatch(match.id, winner, loser);
    }
    at(31);
    const result = await service.closeSeason({ userId: organizer.id, role: 'PLAYER' }, leagueId);
    expect(result.championUserId).toBe(a);
    expect(result.promoted).toContain(a);
    expect(result.relegated).toContain(d);
    const movements = await db
      .select()
      .from(leagueMovementsTable)
      .where(eq(leagueMovementsTable.leagueId, leagueId));
    const promotion = movements.find((movement) => movement.userId === a);
    const relegation = movements.find((movement) => movement.userId === d);
    expect(promotion?.kind).toBe('PROMOTION');
    expect(promotion?.toDivision).toBe('ORO');
    expect(relegation?.kind).toBe('RELEGATION');
    expect(relegation?.toDivision).toBe('BRONCE');
  });

  it('un jugador inactivo no asciende ni desciende', async () => {
    const { leagueId, users, organizer } = await setUpLeague({
      players: 4,
      overrides: { promotion: { promotions: 2, relegations: 2, minMatchesToMove: 5 } },
    });
    const [a] = users.map((user) => user.id) as [string];
    const matches = await db
      .select()
      .from(leagueMatchesTable)
      .where(eq(leagueMatchesTable.leagueId, leagueId));
    // Todos juegan una sola partida: nadie llega al mínimo de 5.
    for (const match of matches.filter((candidate) => candidate.roundNumber === 1)) {
      const loser = match.homeUserId === a ? match.awayUserId : match.homeUserId;
      await playMatch(match.id, a, loser);
    }
    at(31);
    const result = await service.closeSeason({ userId: organizer.id, role: 'PLAYER' }, leagueId);
    expect(result.promoted).toEqual([]);
    expect(result.relegated).toEqual([]);
    expect(
      await db
        .select()
        .from(leagueMovementsTable)
        .where(eq(leagueMovementsTable.leagueId, leagueId)),
    ).toHaveLength(0);
  });

  // -------------------------------------------------------- reprogramación

  it('reprograma una partida con motivo y extiende el plazo', async () => {
    const { leagueId, users } = await setUpLeague({ players: 2 });
    at(31);
    const match = await firstMatch(leagueId);
    const before = match.deadlineAt!.getTime();
    void before;
    const result = await service.reschedule(users[0]!.principal, match.id, {
      reason: 'Me toca trabajar ese día',
    });
    expect(result.reschedulesUsed).toBe(1);
    expect(new Date(result.deadlineAt).getTime()).toBeGreaterThan(before);
    const reschedules = await db
      .select()
      .from(leagueReschedulesTable)
      .where(eq(leagueReschedulesTable.matchId, match.id));
    expect(reschedules).toHaveLength(1);
    expect(reschedules[0]!.reason).toBe('Me toca trabajar ese día');
  });

  it('no deja reprogramar más veces que el tope de la liga', async () => {
    const { leagueId, users } = await setUpLeague({
      players: 2,
      overrides: {
        schedule: {
          format: 'ROUNDS',
          rounds: 3,
          daysBetweenRounds: 7,
          roundWindowHours: 48,
          maxReschedulesPerMatch: 1,
          rescheduleMinHoursBeforeDeadline: 12,
          rescheduleExtensionHours: 24,
        },
      },
    });
    at(31);
    const match = await firstMatch(leagueId);
    await service.reschedule(users[0]!.principal, match.id, { reason: 'Primera vez, motivo' });
    await expect(
      service.reschedule(users[0]!.principal, match.id, { reason: 'Segunda vez, motivo' }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('no deja reprogramar un partido ajeno', async () => {
    const { leagueId, organizer } = await setUpLeague({ players: 2 });
    at(31);
    const match = await firstMatch(leagueId);
    const outsider = await seedUsers(1);
    await expect(
      service.reschedule(outsider[0]!.principal, match.id, { reason: 'No participo de esto' }),
    ).rejects.toMatchObject({ status: 403 });
    void organizer;
  });

  // -------------------------------------------------------------- salas

  it('aprovisiona una sala real por partida lista, sin bots y sin tocar el ranking', async () => {
    const { leagueId } = await setUpLeague({ players: 2 });
    await atFirstRound(leagueId);
    await service.runMaintenance();
    const round = await firstRound(leagueId);
    expect(round.status).toBe('OPEN');
    // Segunda pasada: la jornada ya está abierta, así que lo que hace falta es que las partidas
    // de esa jornada queden `READY` con su sala (el barrido aprovisiona lo que está pendiente).
    await service.runMaintenance();
    const match = await firstMatch(leagueId);
    // El barrido abre la jornada y aprisiona las salas de las partidas listas.
    expect(match.roomId).not.toBeNull();
    const seats = await db
      .select()
      .from(tableSeatsTable)
      .where(eq(tableSeatsTable.tableId, match.roomId!));
    expect(seats).toHaveLength(2);
    const [table] = await db.select().from(tablesTable).where(eq(tablesTable.id, match.roomId!));
    // ADR-035: la liga tiene su propia tabla y no entra al ranking competitivo.
    expect(table!.isCompetitive).toBe(false);
    expect(table!.isPractice).toBe(false);
  });

  it('el resultado de la sala cierra la partida de liga una sola vez', async () => {
    const { leagueId, users } = await setUpLeague({ players: 2 });
    await atFirstRound(leagueId);
    await service.runMaintenance();
    await service.runMaintenance();
    const match = await firstMatch(leagueId);
    const realMatchId = generateUuidV7();
    const first = await service.completeByRoom({
      roomId: match.roomId!,
      matchId: realMatchId,
      winnerTeam: 0,
      endedAt: new Date(clockMs),
    });
    expect(first).toBe(true);
    // El mismo resultado otra vez no cambia nada.
    const second = await service.completeByRoom({
      roomId: match.roomId!,
      matchId: realMatchId,
      winnerTeam: 1,
      endedAt: new Date(clockMs),
    });
    expect(second).toBe(false);
    const after = await repository.findMatchById(match.id);
    expect(after?.status).toBe('COMPLETED');
    expect(after?.winnerUserId).toBe(match.homeUserId);
    void users;
  });

  // ---------------------------------------------------------- notificación

  it('avisa la apertura de jornada por el libro de M9a', async () => {
    const { leagueId } = await setUpLeague({ players: 2 });
    await atFirstRound(leagueId);
    await service.runMaintenance();
    const notifications = await db
      .select()
      .from(socialNotificationsTable)
      .where(eq(socialNotificationsTable.referenceId, leagueId));
    expect(notifications.some((row) => row.type === 'LEAGUE_ROUND_OPEN')).toBe(true);
    // Un segundo barrido no duplica el aviso de la misma jornada.
    await service.runMaintenance();
    const again = await db
      .select()
      .from(socialNotificationsTable)
      .where(eq(socialNotificationsTable.referenceId, leagueId));
    expect(again.filter((row) => row.type === 'LEAGUE_ROUND_OPEN')).toHaveLength(
      notifications.filter((row) => row.type === 'LEAGUE_ROUND_OPEN').length,
    );
  });

  // -------------------------------------------------------------- auditoría

  it('deja auditoría del cierre de temporada', async () => {
    const { leagueId, organizer } = await setUpLeague({ players: 2 });
    at(31);
    await service.closeSeason({ userId: organizer.id, role: 'PLAYER' }, leagueId);
    const audits = await db
      .select()
      .from(auditLogsTable)
      .where(eq(auditLogsTable.entityId, leagueId));
    expect(audits.some((row) => row.action === 'LEAGUE_CLOSED')).toBe(true);
  });

  // ------------------------------------------------- vista pública de la liga

  it('el resumen dice quién organiza y si el que mira es el organizador', async () => {
    const { leagueId, organizer } = await setUpLeague({ players: 2 });

    const asOrganizer = await service.detail(organizer.principal, leagueId);
    // Antes eran `''` y `false` fijos: quien organizaba no veía sus herramientas en la pantalla.
    expect(asOrganizer.createdByNickname).toBe(organizer.nickname);
    expect(asOrganizer.isOrganizer).toBe(true);

    const otherUser = await seedUsers(1);
    const asStranger = await service.detail(otherUser[0]!.principal, leagueId);
    expect(asStranger.createdByNickname).toBe(organizer.nickname);
    expect(asStranger.isOrganizer).toBe(false);
  });

  it('el listado también trae el apodo del organizador', async () => {
    const { organizer } = await setUpLeague({ players: 2 });
    const page = await service.list(
      organizer.principal,
      parseWithZod(LeagueListQuerySchema, { limit: 50 }),
    );
    expect(page.items.length).toBeGreaterThan(0);
    for (const item of page.items) {
      expect(item.createdByNickname).not.toBe('');
    }
    expect(page.items.some((item) => item.isOrganizer)).toBe(true);
  });

  it('los premios con cosmético muestran el nombre del catálogo', async () => {
    const { leagueId, organizer } = await setUpLeague({
      players: 2,
      overrides: {
        prizes: [
          { position: 1, coins: 100, cosmeticId: 'avatar-gold' },
          { position: 2, coins: 50, cosmeticId: null },
        ],
      },
    });
    await db.insert(cosmeticCatalogTable).values({
      id: 'avatar-gold',
      nameKey: 'cosmetics.avatarGolden.name',
      descriptionKey: 'cosmetics.avatarGolden.description',
      category: 'AVATAR',
      priceCoins: 100,
      icon: 'star',
    });

    const detail = await service.detail(organizer.principal, leagueId);
    const first = detail.prizes.find((prize) => prize.position === 1)!;
    expect(first.cosmeticId).toBe('avatar-gold');
    // Antes el nombre era `null` fijo y la web decía «un cosmético» sin poder nombrarlo.
    expect(first.cosmeticName).toBe('cosmetics.avatarGolden.name');
    expect(detail.prizes.find((prize) => prize.position === 2)!.cosmeticName).toBeNull();
  });
});
