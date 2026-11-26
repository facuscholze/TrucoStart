import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildTournamentTopology, simulateTournament } from '@truco/shared';
import {
  createAdaptiveTestDatabase,
  type AppDatabase,
  type DatabaseConnectionHandle,
} from '../../../db/database.provider.js';
import {
  auditLogsTable,
  matchesTable,
  profilesTable,
  ratingProfilesTable,
  ratingSeasonsTable,
  tournamentMatchesTable,
  tournamentParticipantsTable,
  tournamentsTable,
  usersTable,
  walletAccountsTable,
  walletTransactionsTable,
} from '../../../db/schema/index.js';
import { generateUuidV7 } from '../../../common/uuidv7.js';
import { AuditRepository } from '../../audit/audit.repository.js';
import { InMemoryRateLimitStore } from '../../../common/rate-limit/in-memory-rate-limit-store.js';
import { buildLobbyRuntimeConfigFromEnv } from '../../lobby/lobby.config.js';
import { LobbyRepository } from '../../lobby/lobby.repository.js';
import { InMemoryGameRoomProvisioner } from '../../lobby/ports/game-room-provisioner.js';
import { buildTournamentsRuntimeConfig } from '../tournaments.config.js';
import { TournamentsRepository } from '../tournaments.repository.js';
import { TournamentsService } from '../tournaments.service.js';
import type { AuthenticatedPrincipal } from '../../auth/guards/session-auth.guard.js';

const SECRET = 'tournaments-m10a-test-secret-32chars!!!';
const START = new Date('2026-11-26T12:00:00.000Z');

interface SeedUser {
  readonly id: string;
  readonly nickname: string;
  readonly principal: AuthenticatedPrincipal;
}

describe('M10a torneos: ciclo completo sobre PostgreSQL (PGlite)', () => {
  let dbHandle: DatabaseConnectionHandle;
  let db: AppDatabase;
  let service: TournamentsService;
  let repository: TournamentsRepository;
  let clockMs = START.getTime();
  let seasonId: string;
  let realtimeEvents: Array<{ userId: string; type: string }> = [];

  beforeAll(async () => {
    dbHandle = await createAdaptiveTestDatabase();
    db = dbHandle.db;
    repository = new TournamentsRepository(db);
    const lobbyConfig = buildLobbyRuntimeConfigFromEnv({
      sessionSecret: SECRET,
      internalSecret: SECRET,
      cleanupIntervalMs: 0,
    });
    const rateLimit = new InMemoryRateLimitStore(() => clockMs);
    service = new TournamentsService(
      repository,
      buildTournamentsRuntimeConfig({
        nowFn: () => clockMs,
        maintenanceIntervalMs: 0,
        maxActivePrivatePerCreator: 3,
        createPerAccountMax: 100,
        createPerIpMax: 100,
        registerPerAccountMax: 100,
      }),
      lobbyConfig,
      new LobbyRepository(db),
      new InMemoryGameRoomProvisioner(),
      rateLimit,
      new AuditRepository(db),
      {
        emitSocialNotification: (userId: string, payload: { type: string }) => {
          realtimeEvents.push({ userId, type: payload.type });
        },
      } as never,
    );

    // La base ya trae una temporada activa por el seed de desarrollo; se reutiliza.
    const [existingSeason] = await db
      .select({ id: ratingSeasonsTable.id })
      .from(ratingSeasonsTable)
      .where(eq(ratingSeasonsTable.status, 'ACTIVE'))
      .limit(1);
    const [season] = existingSeason
      ? [existingSeason]
      : await db
          .insert(ratingSeasonsTable)
          .values({
            id: generateUuidV7(),
            seasonNumber: Math.floor(Math.random() * 100_000) + 1,
            label: `Temporada ${randomUUID().slice(0, 6)}`,
            status: 'ACTIVE',
            startsAt: START,
            endsAt: new Date(START.getTime() + 90 * 24 * 60 * 60 * 1000),
          })
          .returning({ id: ratingSeasonsTable.id });
    seasonId = season!.id;
  });

  beforeEach(() => {
    // Cada caso arma su torneo desde el mismo instante: si el reloj se filtra entre
    // pruebas, las ventanas de inscripción y check-in quedan corridas.
    clockMs = START.getTime();
    // Los avisos en tiempo real son por caso: si se acumulan, la cuenta miente.
    realtimeEvents = [];
  });

  afterAll(async () => {
    await dbHandle.close();
  });

  /** Avanza el reloj `minutes` desde el inicio del caso. */
  function at(minutes: number): void {
    clockMs = START.getTime() + minutes * 60_000;
  }

  async function seedUsers(
    count: number,
    ratingByIndex?: (index: number) => number,
  ): Promise<SeedUser[]> {
    const users: SeedUser[] = [];
    for (let index = 0; index < count; index++) {
      const id = generateUuidV7();
      const nickname = `Torneo${index + 1}-${randomUUID().slice(0, 6)}`;
      await db.insert(usersTable).values({ id, nickname, nicknameLower: nickname.toLowerCase() });
      await db.insert(profilesTable).values({ userId: id, level: 1, xp: 0 });
      await db.insert(walletAccountsTable).values({
        userId: id,
        currencyType: 'VIRTUAL_COIN',
        hasEconomicValue: false,
        playerTransfersEnabled: false,
      });
      if (ratingByIndex) {
        await db.insert(ratingProfilesTable).values({
          seasonId,
          userId: id,
          mode: '1v1',
          rating: ratingByIndex(index),
          matchesPlayed: 20,
          opponentsCount: 10,
        });
      }
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

  /** Partida real persistida, para que `tournament_matches.match_id` apunte a algo. */
  async function seedGameMatch(tournamentId: string, tournamentMatchId: string): Promise<string> {
    const matchId = generateUuidV7();
    const [tournament] = await db
      .select({ rulesetId: tournamentsTable.rulesetId, rulesetCode: tournamentsTable.rulesetCode })
      .from(tournamentsTable)
      .where(eq(tournamentsTable.id, tournamentId));
    await db.insert(matchesTable).values({
      id: matchId,
      mode: '1v1',
      rulesetId: tournament!.rulesetId,
      rulesetCode: tournament!.rulesetCode,
      seedCommitment: 'a'.repeat(64),
      // Un torneo no puntúa para el ranking competitivo (ADR-030).
      isCompetitive: false,
      isPractice: false,
      hasBots: false,
      startedAt: new Date(clockMs),
      endedAt: new Date(clockMs),
      result: { tournamentId, tournamentMatchId },
    });
    return matchId;
  }

  const createInput = {
    name: 'Copa de prueba',
    format: 'SINGLE_ELIMINATION' as const,
    visibility: 'PRIVATE' as const,
    capacity: 8,
    rules: {
      mode: '1v1' as const,
      rulesetCode: 'ar-corto-15-flor-v1',
      targetScore: 15,
      florEnabled: true,
      turnTimeoutMs: 25_000,
    },
    registrationMinutes: 30,
    checkInMinutes: 10,
    noShowMinutes: 10,
    prizes: [
      { position: 1, coins: 100, cosmeticId: null },
      { position: 2, coins: 40, cosmeticId: null },
    ],
    official: false,
  };

  it('rechaza inscribirse dos veces y respeta el cupo', async () => {
    const organizer = (await seedUsers(1))[0]!;
    const players = await seedUsers(3);
    const tournament = await service.create(
      organizer.principal,
      { ...createInput, capacity: 2 },
      {
        ip: '10.0.0.1',
      },
    );

    await service.register(players[0]!.principal, tournament.id);
    await expect(service.register(players[0]!.principal, tournament.id)).rejects.toMatchObject({
      status: 409,
      details: expect.objectContaining({ reason: 'ALREADY_REGISTERED' }),
    });
    await service.register(players[1]!.principal, tournament.id);
    // El cupo es 2: el tercero no entra.
    await expect(service.register(players[2]!.principal, tournament.id)).rejects.toMatchObject({
      status: 409,
      details: expect.objectContaining({ reason: 'TOURNAMENT_FULL' }),
    });
  }, 60_000);

  it('inscripciones simultáneas: el cupo no se pasa ni con promesas en paralelo', async () => {
    const organizer = (await seedUsers(1))[0]!;
    const players = await seedUsers(6);
    const tournament = await service.create(
      organizer.principal,
      { ...createInput, capacity: 3 },
      {
        ip: '10.0.0.2',
      },
    );

    // Se lanzan las seis a la vez: tres entran y tres reciben 409.
    const results = await Promise.allSettled(
      players.map((player) => service.register(player.principal, tournament.id)),
    );
    const ok = results.filter((result) => result.status === 'fulfilled').length;
    const rejected = results.filter(
      (result) =>
        result.status === 'rejected' &&
        (result.reason as { details?: { reason?: string } })?.details?.reason === 'TOURNAMENT_FULL',
    ).length;

    expect(ok).toBe(3);
    expect(rejected).toBe(3);

    const rows = await db
      .select({ userId: tournamentParticipantsTable.userId })
      .from(tournamentParticipantsTable)
      .where(eq(tournamentParticipantsTable.tournamentId, tournament.id));
    expect(rows).toHaveLength(3);
  }, 60_000);

  it('permite retirarse antes del cierre y volver a inscribirse sin duplicar fila', async () => {
    const organizer = (await seedUsers(1))[0]!;
    const player = (await seedUsers(1))[0]!;
    const tournament = await service.create(organizer.principal, createInput, { ip: '10.0.0.3' });

    await service.register(player.principal, tournament.id);
    await service.unregister(player.principal, tournament.id);
    await service.register(player.principal, tournament.id);

    const rows = await db
      .select({ status: tournamentParticipantsTable.status })
      .from(tournamentParticipantsTable)
      .where(
        and(
          eq(tournamentParticipantsTable.tournamentId, tournament.id),
          eq(tournamentParticipantsTable.userId, player.id),
        ),
      );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe('REGISTERED');
  }, 60_000);

  it('arranca el torneo: siembra por rating, reparte byes y deja la llave lista', async () => {
    const organizer = (await seedUsers(1))[0]!;
    // 5 participantes con ratings distintos: mejor rating ⇒ mejor semilla.
    const players = await seedUsers(5, (index) => 1900 - index * 100);
    const tournament = await service.create(
      organizer.principal,
      { ...createInput, capacity: 8 },
      {
        ip: '10.0.0.4',
      },
    );
    for (const player of players) {
      await service.register(player.principal, tournament.id);
      await service.checkIn(player.principal, tournament.id);
    }

    // La inscripción cierra a los 30 min y el check-in 10 min después: a los 41 el
    // torneo ya debe haber arrancado.
    at(41);
    const started = await service.startTournament(tournament.id, new Date(clockMs));
    expect(started).toBe(true);

    const matches = await db
      .select()
      .from(tournamentMatchesTable)
      .where(eq(tournamentMatchesTable.tournamentId, tournament.id));
    // Cuadro de 8: 7 cruces en eliminación simple, con 3 byes.
    expect(matches).toHaveLength(7);

    // Byes de siembra: en la primera ronda faltan 3 lados (cuadro de 8 con 5 personas).
    // Los cruces siguientes que todavía esperan un resultado no son byes.
    const firstRoundByes = matches.filter(
      (match) =>
        match.round === 1 &&
        match.bracket === 'WINNERS' &&
        (match.homeUserId === null || match.awayUserId === null),
    );
    expect(firstRoundByes).toHaveLength(3);
    // Los byes van a los mejores sembrados: pasan sin jugar las semillas 1, 2 y 3.
    expect(firstRoundByes.map((match) => match.homeSeed ?? match.awaySeed).sort()).toEqual([
      1, 2, 3,
    ]);
    // El mejor rating (1900) es la semilla 1.
    const [seedOne] = await db
      .select({ userId: tournamentParticipantsTable.userId })
      .from(tournamentParticipantsTable)
      .where(
        and(
          eq(tournamentParticipantsTable.tournamentId, tournament.id),
          eq(tournamentParticipantsTable.seed, 1),
        ),
      );
    expect(seedOne!.userId).toBe(players[0]!.id);
    // Ningún cruce real enfrenta a alguien consigo mismo.
    for (const match of matches) {
      if (match.homeUserId && match.awayUserId) {
        expect(match.homeUserId).not.toBe(match.awayUserId);
      }
    }
  }, 60_000);

  /**
   * Juega un torneo completo contra el servicio real: crea, inscribe, hace check-in,
   * arranca, juega cada cruce listo según la topología y entrega premios. Devuelve los
   * datos que cada caso necesita para afirmar. Es el mismo camino que usa la API, sin
   * atajos por SQL.
   */
  async function playTournamentToTheEnd(input: {
    readonly format: 'SINGLE_ELIMINATION' | 'DOUBLE_ELIMINATION';
    readonly participants: number;
    readonly ip: string;
  }) {
    const organizer = (await seedUsers(1))[0]!;
    const players = await seedUsers(input.participants, (index) => 1800 - index * 50);
    const tournament = await service.create(
      organizer.principal,
      {
        ...createInput,
        format: input.format,
        capacity: input.participants,
        checkInMinutes: 5,
        registrationMinutes: 5,
        noShowMinutes: 15,
      },
      { ip: input.ip },
    );
    for (const player of players) {
      await service.register(player.principal, tournament.id);
      await service.checkIn(player.principal, tournament.id);
    }
    at(41);
    expect(await service.startTournament(tournament.id, new Date(clockMs))).toBe(true);

    // Se juega con la topología: en cada cruce listo gana el sembrado más alto (el 1).
    const topology = buildTournamentTopology(input.format, input.participants);
    const plan = simulateTournament(topology, (home, away) => Math.min(home, away));
    const participantRows = await db
      .select()
      .from(tournamentParticipantsTable)
      .where(eq(tournamentParticipantsTable.tournamentId, tournament.id));
    const userBySeed = new Map(participantRows.map((row) => [row.seed!, row.userId] as const));

    for (const simulated of plan.matches) {
      if (!simulated.played) continue;
      const [row] = await db
        .select()
        .from(tournamentMatchesTable)
        .where(
          and(
            eq(tournamentMatchesTable.tournamentId, tournament.id),
            eq(tournamentMatchesTable.bracket, simulated.bracket),
            eq(tournamentMatchesTable.round, simulated.round),
            eq(tournamentMatchesTable.slot, simulated.slot),
          ),
        );
      expect(
        row,
        `cruce ${simulated.bracket} ronda ${simulated.round} slot ${simulated.slot}`,
      ).toBeDefined();
      const winnerUserId = userBySeed.get(simulated.winnerSeed!)!;
      // La partida del torneo debe existir en `matches`: el vínculo es una FK real.
      const gameMatchId = await seedGameMatch(tournament.id, row!.id);
      expect(
        await service.completeMatchByGame({
          tournamentMatchId: row!.id,
          matchId: gameMatchId,
          winnerUserId,
          now: new Date(clockMs),
        }),
      ).toBe(true);
      // Reentrega del mismo resultado (mismo matchId): no aplica dos veces.
      expect(
        await service.completeMatchByGame({
          tournamentMatchId: row!.id,
          matchId: gameMatchId,
          winnerUserId,
          now: new Date(clockMs),
        }),
      ).toBe(false);
      // Evento duplicado con OTRO matchId sobre un cruce ya cerrado: tampoco avanza.
      expect(
        await service.completeMatchByGame({
          tournamentMatchId: row!.id,
          matchId: await seedGameMatch(tournament.id, row!.id),
          winnerUserId,
          now: new Date(clockMs),
        }),
      ).toBe(false);
    }

    const [finished] = await db
      .select()
      .from(tournamentsTable)
      .where(eq(tournamentsTable.id, tournament.id));
    // Estado final de las inscripciones: hay que releerlas, la foto de arriba es previa.
    const finalParticipants = await db
      .select()
      .from(tournamentParticipantsTable)
      .where(eq(tournamentParticipantsTable.tournamentId, tournament.id));
    return {
      organizer,
      tournament,
      participantRows: finalParticipants,
      championSeed: plan.championSeed,
      finished,
    };
  }

  it('juega un torneo de 4 hasta el campeón, con avance idempotente y premios una sola vez', async () => {
    const { tournament, participantRows, finished } = await playTournamentToTheEnd({
      format: 'SINGLE_ELIMINATION',
      participants: 4,
      ip: '10.0.0.5',
    });
    expect(finished!.status).toBe('FINISHED');

    const champion = participantRows.find((row) => row.seed === 1)!;
    const [championRow] = await db
      .select()
      .from(tournamentParticipantsTable)
      .where(eq(tournamentParticipantsTable.id, champion.id));
    expect(championRow!.status).toBe('WINNER');

    // Premios: 100 y 40 monedas, una sola vez por posición.
    const prizes = await db
      .select()
      .from(walletTransactionsTable)
      .where(eq(walletTransactionsTable.referenceId, tournament.id));
    expect(prizes.map((prize) => prize.amount).sort((a, b) => b - a)).toEqual([100, 40]);
    expect(prizes.every((prize) => prize.referenceType === 'tournament')).toBe(true);

    // Reintentar el pago no acredita de nuevo: la entrega es idempotente.
    expect(await service.payout(tournament.id, new Date(clockMs))).toBe(0);
    const after = await db
      .select()
      .from(walletTransactionsTable)
      .where(eq(walletTransactionsTable.referenceId, tournament.id));
    expect(after).toHaveLength(2);

    // Auditoría de la operación completa.
    const audit = await db
      .select({ action: auditLogsTable.action })
      .from(auditLogsTable)
      .where(eq(auditLogsTable.entityId, tournament.id));
    expect(audit.map((row) => row.action)).toEqual(
      expect.arrayContaining(['tournaments.created', 'tournaments.registered']),
    );

    // Notificaciones de M9a: al menos el arranque de ronda llegó a los cuatro.
    expect(
      realtimeEvents.filter((event) => event.type === 'TOURNAMENT_ROUND_STARTED'),
    ).toHaveLength(4);
  }, 120_000);

  it('un torneo de 7 reparte byes y termina con un campeón', async () => {
    // 7 no es potencia de 2: el cuadro tiene 8 lugares y un pase libre. El torneo tiene
    // que jugarse igual, con 6 cruces jugados (N−1) y nadie esperando rival para siempre.
    const { tournament, participantRows, finished } = await playTournamentToTheEnd({
      format: 'SINGLE_ELIMINATION',
      participants: 7,
      ip: '10.0.0.11',
    });
    expect(finished!.status).toBe('FINISHED');
    const matches = await db
      .select()
      .from(tournamentMatchesTable)
      .where(eq(tournamentMatchesTable.tournamentId, tournament.id));
    const played = matches.filter((match) => match.resolvedFromMatchId !== null);
    expect(played).toHaveLength(6);
    // El pase libre existe como cruce cerrado sin partida, y es uno solo.
    expect(
      matches.filter((match) => match.status === 'COMPLETED' && match.resolvedFromMatchId === null),
    ).toHaveLength(1);
    // Un solo campeón y el resto eliminado exactamente una vez en eliminación simple.
    expect(participantRows.filter((row) => row.status === 'WINNER')).toHaveLength(1);
    expect(participantRows.filter((row) => row.status === 'ELIMINATED')).toHaveLength(6);
  }, 120_000);

  it('un torneo de 16 con eliminación doble también llega al campeón', async () => {
    // La doble eliminación se juega sin bracket reset (ADR-029): 2N−2 = 30 cruces.
    const { tournament, participantRows, finished } = await playTournamentToTheEnd({
      format: 'DOUBLE_ELIMINATION',
      participants: 16,
      ip: '10.0.0.12',
    });
    expect(finished!.status).toBe('FINISHED');
    const matches = await db
      .select()
      .from(tournamentMatchesTable)
      .where(eq(tournamentMatchesTable.tournamentId, tournament.id));
    const played = matches.filter((match) => match.resolvedFromMatchId !== null);
    expect(played).toHaveLength(30);
    expect(participantRows.filter((row) => row.status === 'WINNER')).toHaveLength(1);
    // Nadie queda eliminado con menos de dos derrotas.
    expect(participantRows.filter((row) => row.status === 'ELIMINATED')).toHaveLength(15);
  }, 180_000);

  it('un torneo de 64 se simula completo y el servicio acepta cada resultado', async () => {
    // La simulación con bots cubre el tamaño máximo del contrato: 63 cruces, nadie dos
    // veces en la misma ronda y un campeón que nunca perdió. Se juega con el sembrado
    // más alto ganando salvo sorpresas puntuales, para no depender de un único orden.
    const topology = buildTournamentTopology('SINGLE_ELIMINATION', 64);
    const pickWinner = (home: number, away: number) =>
      home % 7 === 0 ? away : Math.min(home, away);
    const plan = simulateTournament(topology, pickWinner);

    expect(plan.playedCount).toBe(63);
    expect(plan.championSeed).not.toBeNull();
    expect(plan.eliminations).toHaveLength(63);

    // El desarrollo completo se puede escribir y propagar por el mismo camino que usa
    // la API, sin atajos: se verifica sobre los 63 cruces de la llave armada.
    const organizer = (await seedUsers(1))[0]!;
    const players = await seedUsers(64, (index) => 1800 - index * 5);
    const tournament = await service.create(
      organizer.principal,
      { ...createInput, capacity: 64, registrationMinutes: 5, checkInMinutes: 5 },
      { ip: '10.0.0.13' },
    );
    for (const player of players) {
      await service.register(player.principal, tournament.id);
      await service.checkIn(player.principal, tournament.id);
    }
    at(41);
    expect(await service.startTournament(tournament.id, new Date(clockMs))).toBe(true);

    const participants = await db
      .select()
      .from(tournamentParticipantsTable)
      .where(eq(tournamentParticipantsTable.tournamentId, tournament.id));
    const userBySeed = new Map(participants.map((row) => [row.seed!, row.userId] as const));
    const rows = await db
      .select()
      .from(tournamentMatchesTable)
      .where(eq(tournamentMatchesTable.tournamentId, tournament.id));
    // La clave es la misma que usa la topología: bracket, ronda y cruce.
    const rowByKey = new Map<string, (typeof rows)[number]>(
      rows.map((row) => [`${row.bracket}-R${row.round}-S${row.slot}`, row]),
    );

    let applied = 0;
    for (const simulated of plan.matches) {
      if (!simulated.played) continue;
      const row = rowByKey.get(simulated.key)!;
      expect(row, `cruce ${simulated.key}`).toBeDefined();
      const winnerUserId = userBySeed.get(simulated.winnerSeed!)!;
      const ok = await service.completeMatchByGame({
        tournamentMatchId: row.id,
        matchId: await seedGameMatch(tournament.id, row.id),
        winnerUserId,
        now: new Date(clockMs),
      });
      expect(ok, `cruce ${simulated.key}`).toBe(true);
      applied += 1;
    }
    expect(applied).toBe(63);

    const [final] = await db
      .select()
      .from(tournamentsTable)
      .where(eq(tournamentsTable.id, tournament.id));
    expect(final!.status).toBe('FINISHED');
    const finalParticipants = await db
      .select()
      .from(tournamentParticipantsTable)
      .where(eq(tournamentParticipantsTable.tournamentId, tournament.id));
    expect(finalParticipants.filter((row) => row.status === 'WINNER')).toHaveLength(1);
  }, 240_000);

  it('quien no hace check-in queda fuera sin arrancar una llave de una sola persona', async () => {
    const organizer = (await seedUsers(1))[0]!;
    const players = await seedUsers(3);
    const tournament = await service.create(organizer.principal, createInput, { ip: '10.0.0.6' });

    for (const player of players) await service.register(player.principal, tournament.id);
    // Sólo uno hace check-in.
    await service.checkIn(players[0]!.principal, tournament.id);

    at(45);
    expect(await service.startTournament(tournament.id, new Date(clockMs))).toBe(false);

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
    expect(participants.filter((p) => p.status === 'NO_SHOW')).toHaveLength(2);
    expect(participants.filter((p) => p.status === 'CHECKED_IN')).toHaveLength(1);
  }, 60_000);

  it('la tabla no inventa eliminaciones: quien sigue en carrera lo dice', async () => {
    const organizer = (await seedUsers(1))[0]!;
    const players = await seedUsers(4);
    const tournament = await service.create(organizer.principal, createInput, { ip: '10.0.0.9' });
    for (const player of players) {
      await service.register(player.principal, tournament.id);
      await service.checkIn(player.principal, tournament.id);
    }
    at(41);
    expect(await service.startTournament(tournament.id, new Date(clockMs))).toBe(true);

    const detail = await service.detail(organizer.id, tournament.id);
    // Nadie jugó todavía: la tabla no puede decir que alguien quedó afuera.
    expect(detail.standings).toHaveLength(4);
    for (const standing of detail.standings) {
      expect(standing.tiebreakNote).not.toMatch(/Cayó/);
      expect(standing.eliminationRound).toBeNull();
    }

    // Tras jugar la primera semifinal, el perdedor sí figura como eliminado.
    const [firstMatch] = (await db
      .select()
      .from(tournamentMatchesTable)
      .where(
        and(
          eq(tournamentMatchesTable.tournamentId, tournament.id),
          eq(tournamentMatchesTable.round, 1),
        ),
      )
      .limit(1))!;
    const loser = firstMatch!.awayUserId!;
    const winner = firstMatch!.homeUserId!;
    await service.completeMatchByGame({
      tournamentMatchId: firstMatch!.id,
      matchId: await seedGameMatch(tournament.id, firstMatch!.id),
      winnerUserId: winner,
      now: new Date(clockMs),
    });

    const after = await service.detail(organizer.id, tournament.id);
    const loserStanding = after.standings.find((standing) => standing.userId === loser)!;
    expect(loserStanding.tiebreakNote).toContain('Cayó en la ronda 1');
    expect(loserStanding.eliminationRound).toBe(1);
  }, 60_000);

  it('un torneo privado no se puede leer sin participar', async () => {
    const organizer = (await seedUsers(1))[0]!;
    const stranger = (await seedUsers(1))[0]!;
    const tournament = await service.create(organizer.principal, createInput, { ip: '10.0.0.7' });

    await expect(service.detail(stranger.id, tournament.id)).rejects.toMatchObject({
      status: 404,
    });
    const detail = await service.detail(organizer.id, tournament.id);
    expect(detail.tournament.joinCode).toHaveLength(6);
    // El organizador ve el código; un participante no.
    const player = (await seedUsers(1))[0]!;
    await service.register(player.principal, tournament.id);
    const playerView = await service.detail(player.id, tournament.id);
    expect(playerView.tournament.joinCode).toBeNull();
  }, 60_000);

  it('el panel ve los torneos privados, pero el jugador ajeno no', async () => {
    const organizer = (await seedUsers(1))[0]!;
    const stranger = (await seedUsers(1))[0]!;
    const tournament = await service.create(organizer.principal, createInput, { ip: '10.0.0.3' });

    // El listado del staff no filtra por visibilidad: incluye el privado de un tercero.
    const staffList = await service.listForStaff({ status: [], limit: 20, cursor: null });
    expect(staffList.items.map((item) => item.id)).toContain(tournament.id);

    // El listado del jugador sí lo esconde.
    const playerList = await service.list(stranger.id, { status: [], limit: 20, cursor: null });
    expect(playerList.items.map((item) => item.id)).not.toContain(tournament.id);

    // Y el detalle del staff no cae en el 404 de visibilidad, que sí aplica al jugador.
    await expect(service.detail(stranger.id, tournament.id)).rejects.toMatchObject({ status: 404 });
    const staffDetail = await service.detail(stranger.id, tournament.id, { asStaff: true });
    expect(staffDetail.tournament.id).toBe(tournament.id);
    // Aunque lea el torneo, el código de invitación no se le muestra: sigue siendo del organizador.
    expect(staffDetail.tournament.joinCode).toBeNull();
  }, 60_000);

  it('la creación de staff guarda el motivo en la auditoría', async () => {
    const admin = (await seedUsers(1))[0]!;
    const tournament = await service.createAsStaff(
      {
        userId: admin.id,
        nickname: admin.principal.nickname,
        role: 'ADMIN',
        sessionId: admin.principal.sessionId,
        email: null,
        permissions: [],
      },
      { ...createInput, official: true },
      { ip: '10.0.0.4', reason: 'Copa oficial de apertura de temporada' },
    );

    const [created] = await db
      .select({ action: auditLogsTable.action, reason: auditLogsTable.reason })
      .from(auditLogsTable)
      .where(
        and(
          eq(auditLogsTable.entityId, tournament.id),
          eq(auditLogsTable.action, 'tournaments.created'),
        ),
      );
    expect(created?.reason).toBe('Copa oficial de apertura de temporada');

    // Un torneo privado de un jugador no inventa un motivo que nadie informó.
    const player = (await seedUsers(1))[0]!;
    const privateTournament = await service.create(player.principal, createInput, {
      ip: '10.0.0.5',
    });
    const [privateCreated] = await db
      .select({ reason: auditLogsTable.reason })
      .from(auditLogsTable)
      .where(
        and(
          eq(auditLogsTable.entityId, privateTournament.id),
          eq(auditLogsTable.action, 'tournaments.created'),
        ),
      );
    expect(privateCreated?.reason ?? null).toBeNull();
  }, 60_000);

  it('no se puede crear un torneo oficial sin ser del equipo', async () => {
    const player = (await seedUsers(1))[0]!;
    await expect(
      service.create(player.principal, { ...createInput, official: true }, { ip: '10.0.0.8' }),
    ).rejects.toMatchObject({ status: 403 });
  }, 60_000);
});
