import { randomUUID } from 'node:crypto';
import { and, eq, inArray } from 'drizzle-orm';
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
  tableSeatsTable,
  tablesTable,
  tournamentAwardsTable,
  tournamentMatchesTable,
  tournamentParticipantsTable,
  tournamentTeamsTable,
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
import { MatchCompletionBridge } from '../../lobby/ports/match-completion-bridge.js';
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
  let provisioner: InMemoryGameRoomProvisioner;
  let matchCompletion: MatchCompletionBridge;

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
    provisioner = new InMemoryGameRoomProvisioner();
    matchCompletion = new MatchCompletionBridge();
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
      provisioner,
      rateLimit,
      new AuditRepository(db),
      {
        emitSocialNotification: (userId: string, payload: { type: string }) => {
          realtimeEvents.push({ userId, type: payload.type });
        },
      } as never,
      matchCompletion,
    );
    // El puente lo ocupa el propio servicio al arrancar, igual que en Nest.
    service.onApplicationBootstrap();

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

  it('cada cruce listo tiene sala aprovisionada y "mi próxima partida" apunta a ella', async () => {
    const organizer = (await seedUsers(1))[0]!;
    const players = await seedUsers(4, (index) => 1800 - index * 50);
    const tournament = await service.create(
      organizer.principal,
      { ...createInput, capacity: 4, registrationMinutes: 5, checkInMinutes: 5 },
      { ip: '10.0.0.21' },
    );
    for (const player of players) {
      await service.register(player.principal, tournament.id);
      await service.checkIn(player.principal, tournament.id);
    }
    at(41);
    expect(await service.startTournament(tournament.id, new Date(clockMs))).toBe(true);

    const matches = await db
      .select()
      .from(tournamentMatchesTable)
      .where(eq(tournamentMatchesTable.tournamentId, tournament.id));
    const ready = matches.filter((match) => match.status === 'READY');
    expect(ready).toHaveLength(2);
    // Todo cruce jugable tiene sala: sin eso el botón "entrar a la mesa" no lleva a nada.
    for (const match of ready) {
      expect(match.roomId).not.toBeNull();
      const room = provisioner.getProvisionedRoom(match.roomId!);
      expect(room, `sala del cruce ${match.slot}`).toBeDefined();
      // La sala usa las reglas del torneo y nunca es de práctica ni con bots.
      expect(room!.targetScore).toBe(createInput.rules.targetScore);
      expect(room!.florEnabled).toBe(createInput.rules.florEnabled);
      expect(room!.practice ?? null).toBeNull();
      expect(room!.visibility).toBe('PRIVATE');
    }
    // La mesa queda como no competitiva: los cruces no mueven el ranking (ADR-030).
    const [table] = await db
      .select({ isCompetitive: tablesTable.isCompetitive })
      .from(tablesTable)
      .where(eq(tablesTable.id, ready[0]!.roomId!));
    expect(table?.isCompetitive).toBe(false);

    // "Mi próxima partida" devuelve el cruce del jugador con su sala, para poder entrar.
    const firstPlayer = players.find((player) => player.id === ready[0]!.homeUserId)!;
    const next = await service.myNextMatch(firstPlayer.id);
    expect(next.match?.roomId).toBe(ready[0]!.roomId);
    expect(next.tournament?.id).toBe(tournament.id);
    expect(next.match?.deadlineAt).not.toBeNull();
  }, 120_000);

  it('con pases libres la llave sigue avanzando: la final se abre sola', async () => {
    // Regresión: la cantidad de jugadores se deducía del mayor sembrado escrito en los
    // cruces. Un pase libre no guarda semilla del lado vacío, así que al propagarlo la
    // topología se reconstruía con menos jugadores, el avance no encontraba destinos y la
    // llave quedaba congelada (la final nunca pasaba de `SCHEDULED`). Un cuadro de 6
    // tiene dos pases libres en la primera ronda, justo el caso que lo rompía.
    const { tournament, participantRows, finished } = await playTournamentToTheEnd({
      format: 'SINGLE_ELIMINATION',
      participants: 6,
      ip: '10.0.0.31',
    });
    expect(finished!.status).toBe('FINISHED');
    expect(participantRows.filter((row) => row.status === 'WINNER')).toHaveLength(1);

    const matches = await db
      .select()
      .from(tournamentMatchesTable)
      .where(eq(tournamentMatchesTable.tournamentId, tournament.id));
    // Cinco cruces jugados (N−1) y ningún cruce pendiente al terminar.
    expect(matches.filter((match) => match.resolvedFromMatchId !== null)).toHaveLength(5);
    expect(
      matches.filter((match) => match.status === 'SCHEDULED' || match.status === 'READY'),
    ).toHaveLength(0);
    // La final existe, se jugó y su ganador es el campeón.
    const final = matches.find((match) => match.round === 3);
    expect(final?.status).toBe('COMPLETED');
    expect(final?.winnerUserId).not.toBeNull();
  }, 120_000);

  it('el resultado de la mesa cierra el cruce de su sala y avanza la llave', async () => {
    // Regresión del puente `match.completed` → torneo: sin esto, jugar la partida en la
    // mesa no cerraba el cruce, la llave quedaba congelada y el torneo nunca terminaba.
    const organizer = (await seedUsers(1))[0]!;
    const players = await seedUsers(4, (index) => 1800 - index * 50);
    const tournament = await service.create(
      organizer.principal,
      { ...createInput, capacity: 4, registrationMinutes: 5, checkInMinutes: 5 },
      { ip: '10.0.0.41' },
    );
    for (const player of players) {
      await service.register(player.principal, tournament.id);
      await service.checkIn(player.principal, tournament.id);
    }
    at(41);
    expect(await service.startTournament(tournament.id, new Date(clockMs))).toBe(true);

    const matches = await db
      .select()
      .from(tournamentMatchesTable)
      .where(eq(tournamentMatchesTable.tournamentId, tournament.id));
    const semi = matches.find((match) => match.round === 1 && match.slot === 1)!;
    expect(semi.roomId).toBeTruthy();
    expect(semi.homeUserId).toBeTruthy();

    // El equipo 0 es el local del cruce: gana el local. La partida tiene que existir en
    // `matches` porque el vínculo del cruce es una FK real.
    const gameMatchId = await seedGameMatch(tournament.id, semi.id);
    const applied = await service.completeByRoom({
      roomId: semi.roomId!,
      matchId: gameMatchId,
      winnerTeam: 0,
      endedAt: new Date(clockMs),
    });
    expect(applied).toBe(true);

    const [afterSemi] = await db
      .select()
      .from(tournamentMatchesTable)
      .where(eq(tournamentMatchesTable.id, semi.id));
    expect(afterSemi!.status).toBe('COMPLETED');
    expect(afterSemi!.winnerUserId).toBe(semi.homeUserId);
    expect(afterSemi!.resolvedFromMatchId).toBe(gameMatchId);

    // Reentrega del mismo resultado: no vuelve a aplicarse.
    expect(
      await service.completeByRoom({
        roomId: semi.roomId!,
        matchId: gameMatchId,
        winnerTeam: 0,
        endedAt: new Date(clockMs),
      }),
    ).toBe(false);

    // Una sala que no es de ningún torneo no toca nada.
    expect(
      await service.completeByRoom({
        roomId: generateUuidV7(),
        matchId: generateUuidV7(),
        winnerTeam: 0,
        endedAt: new Date(clockMs),
      }),
    ).toBe(false);

    // El ganador del local quedó escrito en la final, que ahora espera al otro lado.
    const final = (
      await db
        .select()
        .from(tournamentMatchesTable)
        .where(
          and(
            eq(tournamentMatchesTable.tournamentId, tournament.id),
            eq(tournamentMatchesTable.round, 2),
          ),
        )
    )[0]!;
    expect(final.homeUserId ?? final.awayUserId).toBe(semi.homeUserId);
  }, 120_000);

  /**
   * M10a — torneo 2v2 de punta a punta contra PostgreSQL (PGlite local, PostgreSQL real
   * en CI): equipos, check-in por integrante, cuadro, mesas de cuatro asientos, cierre
   * por equipo y premios por integrante.
   */
  it('un torneo 2v2 se juega con equipos: mesa de 4 asientos, campeón y premios por integrante', async () => {
    const organizer = (await seedUsers(1))[0]!;
    // 4 equipos de 2 = 8 personas.
    const players = await seedUsers(8, (index) => 1900 - index * 40);
    const tournament = await service.create(
      organizer.principal,
      {
        ...createInput,
        capacity: 4,
        rules: { ...createInput.rules, mode: '2v2' },
      },
      { ip: '10.0.0.31' },
    );
    expect(tournament.mode).toBe('2v2');

    for (let team = 0; team < 4; team++) {
      await service.registerTeam(players[team * 2]!.principal, tournament.id, {
        name: `Equipo ${team + 1}`,
        teammateUserIds: [players[team * 2 + 1]!.id],
      });
    }

    // Un equipo de 2v2 no puede inscribirse con un solo integrante ni con alguien que ya
    // está en otro equipo.
    await expect(
      service.registerTeam(players[0]!.principal, tournament.id, {
        name: 'Incompleto',
        teammateUserIds: [],
      }),
    ).rejects.toMatchObject({ status: 400 });

    // Check-in: todos los integrantes, uno por uno.
    for (const player of players) await service.checkIn(player.principal, tournament.id);
    at(41);
    expect(await service.startTournament(tournament.id, new Date(clockMs))).toBe(true);

    // El cuadro tiene 4 lados (equipos), no 8.
    const firstRound = await db
      .select()
      .from(tournamentMatchesTable)
      .where(eq(tournamentMatchesTable.tournamentId, tournament.id));
    expect(firstRound).toHaveLength(3);
    for (const match of firstRound) {
      expect(match.homeUserId).toBeNull();
      expect(match.awayUserId).toBeNull();
      if (match.status === 'READY') {
        expect(match.homeTeamId).not.toBeNull();
        expect(match.awayTeamId).not.toBeNull();
      }
    }

    // "Mi próxima partida" tiene que encontrar el cruce por EQUIPO: en 2v2 el lado del
    // cuadro no es la persona, así que sin esto la pantalla no ofrece entrar a la mesa.
    const next = await service.myNextMatch(players[0]!.id);
    expect(next.match).not.toBeNull();
    expect(next.match!.roomId).toBeTruthy();
    const detail2v2 = await service.detail(players[0]!.id, tournament.id);
    expect(detail2v2.myNextMatch).not.toBeNull();

    // Cada cruce listo tiene su mesa con 4 asientos intercalados por equipo.
    const ready = firstRound.filter((match) => match.roomId !== null);
    expect(ready.length).toBeGreaterThan(0);
    for (const match of ready) {
      const seats = await db
        .select()
        .from(tableSeatsTable)
        .where(eq(tableSeatsTable.tableId, match.roomId!));
      expect(seats).toHaveLength(4);
      const teamA = seats.filter((seat) => seat.team === 0).map((seat) => seat.userId);
      const teamB = seats.filter((seat) => seat.team === 1).map((seat) => seat.userId);
      expect(teamA).toHaveLength(2);
      expect(teamB).toHaveLength(2);
      // Cada equipo es el de su lado del cuadro, y nadie se repite.
      expect(new Set([...teamA, ...teamB]).size).toBe(4);
      // Los asientos respetan la intercalación que espera el motor (`seat % 2 === team`).
      for (const seat of seats) expect(seat.seat % 2).toBe(seat.team);
    }

    // Se juegan todos los cruces con el resultado de la mesa (equipo 0 o 1).
    const teams = await db
      .select()
      .from(tournamentTeamsTable)
      .where(eq(tournamentTeamsTable.tournamentId, tournament.id));
    expect(teams).toHaveLength(4);
    for (let guard = 0; guard < 8; guard++) {
      const pending = await db
        .select()
        .from(tournamentMatchesTable)
        .where(
          and(
            eq(tournamentMatchesTable.tournamentId, tournament.id),
            inArray(tournamentMatchesTable.status, ['READY', 'SCHEDULED']),
          ),
        );
      const playable = pending.filter((match) => match.homeTeamId && match.awayTeamId);
      if (playable.length === 0) break;
      for (const match of playable) {
        const winningTeamId = match.homeTeamId!;
        const gameMatchId = await seedGameMatch(tournament.id, match.id);
        await service.completeTeamMatch({
          tournamentMatchId: match.id,
          matchId: gameMatchId,
          winnerTeamId: winningTeamId,
          now: new Date(clockMs),
        });
      }
      at(42 + guard);
    }

    const [finished] = await db
      .select()
      .from(tournamentsTable)
      .where(eq(tournamentsTable.id, tournament.id));
    expect(finished!.status).toBe('FINISHED');

    // La tabla es por equipo y el campeón es un equipo con sus dos integrantes.
    const standings = await service.standingsFor(finished!);
    expect(standings).toHaveLength(4);
    expect(standings[0]!.nickname).toBe('Equipo 1');
    expect(standings[0]!.tiebreakNote).toContain('Campeón');

    // El DETALLE tiene que publicar la misma tabla por equipo: armar la vista con la tabla
    // de personas dejaba un torneo terminado con todos "Sigue en carrera" y sin campeón.
    const finishedDetail = await service.detail(players[0]!.id, tournament.id);
    expect(finishedDetail.standings[0]!.nickname).toBe('Equipo 1');
    expect(finishedDetail.standings[0]!.tiebreakNote).toContain('Campeón');
    // Y el campeón son las DOS personas del equipo, no la que esté primera.
    const winners = finishedDetail.participants
      .filter((participant) => participant.status === 'WINNER')
      .map((participant) => participant.userId)
      .sort();
    expect(winners).toEqual([players[0]!.id, players[1]!.id].sort());

    // Premios: cada integrante del campeón cobra las 100 monedas y los subcampeones 40.
    const awards = await db
      .select()
      .from(tournamentAwardsTable)
      .where(eq(tournamentAwardsTable.tournamentId, tournament.id));
    expect(awards).toHaveLength(4);
    expect(awards.filter((award) => award.position === 1)).toHaveLength(2);
    expect(awards.filter((award) => award.position === 2)).toHaveLength(2);
    expect(awards.every((award) => award.teamId !== null)).toBe(true);
    const credits = await db
      .select()
      .from(walletTransactionsTable)
      .where(eq(walletTransactionsTable.referenceId, tournament.id));
    expect(credits).toHaveLength(4);

    // Reintentar el pago no duplica nada, ni por equipo ni por persona.
    expect(await service.payout(tournament.id, new Date(clockMs))).toBe(0);

    // Idempotencia del cierre por equipo: el mismo resultado no se aplica dos veces.
    const closed = await db
      .select()
      .from(tournamentMatchesTable)
      .where(
        and(
          eq(tournamentMatchesTable.tournamentId, tournament.id),
          eq(tournamentMatchesTable.status, 'COMPLETED'),
        ),
      );
    const finalMatch = closed.find((match) => match.round === 2)!;
    expect(
      await service.completeTeamMatch({
        tournamentMatchId: finalMatch.id,
        matchId: finalMatch.resolvedFromMatchId!,
        winnerTeamId: finalMatch.winnerTeamId!,
        now: new Date(clockMs),
      }),
    ).toBe(false);
  }, 120_000);

  it('en 2v2 un equipo al que le falta un integrante no entra al cuadro ni gana por walkover', async () => {
    const organizer = (await seedUsers(1))[0]!;
    const players = await seedUsers(6, (index) => 1900 - index * 40);
    const tournament = await service.create(
      organizer.principal,
      {
        ...createInput,
        capacity: 4,
        rules: { ...createInput.rules, mode: '2v2' },
      },
      { ip: '10.0.0.32' },
    );

    // Equipo 1 completo, equipo 2 con un solo integrante presente, equipo 3 completo.
    for (let team = 0; team < 3; team++) {
      await service.registerTeam(players[team * 2]!.principal, tournament.id, {
        name: `Equipo ${team + 1}`,
        teammateUserIds: [players[team * 2 + 1]!.id],
      });
    }
    await service.checkIn(players[0]!.principal, tournament.id);
    await service.checkIn(players[1]!.principal, tournament.id);
    // Del equipo 2 sólo se presenta el capitán.
    await service.checkIn(players[2]!.principal, tournament.id);
    await service.checkIn(players[4]!.principal, tournament.id);
    await service.checkIn(players[5]!.principal, tournament.id);

    at(41);
    expect(await service.startTournament(tournament.id, new Date(clockMs))).toBe(true);

    // El equipo incompleto queda fuera entero: no hay lado suyo en ningún cruce.
    const teamTwo = await db
      .select()
      .from(tournamentTeamsTable)
      .where(
        and(
          eq(tournamentTeamsTable.tournamentId, tournament.id),
          eq(tournamentTeamsTable.name, 'Equipo 2'),
        ),
      );
    const matches = await db
      .select()
      .from(tournamentMatchesTable)
      .where(eq(tournamentMatchesTable.tournamentId, tournament.id));
    expect(
      matches.some(
        (match) => match.homeTeamId === teamTwo[0]!.id || match.awayTeamId === teamTwo[0]!.id,
      ),
    ).toBe(false);

    // Y sus integrantes quedan como ausentes, sin sanción de partida.
    const absent = await db
      .select()
      .from(tournamentParticipantsTable)
      .where(eq(tournamentParticipantsTable.tournamentId, tournament.id));
    expect(absent.filter((row) => row.status === 'NO_SHOW')).toHaveLength(2);

    // Con dos equipos completos la final se arma entre ellos.
    const ready = matches.filter((match) => match.homeTeamId && match.awayTeamId);
    expect(ready).toHaveLength(1);
    expect(ready[0]!.status).toBe('READY');
  }, 120_000);

  it('2v2: el equipo al que le falta un compañero en el check-in queda desinscripto entero y no gana por walkover', async () => {
    // El reloj del archivo es monotónico: se ancla al inicio para que las ventanas del
    // torneo (inscripción 30 min + check-in 10) cierren recién a los 40.
    at(0);
    const organizer = (await seedUsers(1))[0]!;
    const players = await seedUsers(8, (index) => 1900 - index * 30);
    const tournament = await service.create(
      organizer.principal,
      { ...createInput, capacity: 4, rules: { ...createInput.rules, mode: '2v2' } },
      { ip: '10.0.0.34' },
    );
    for (let team = 0; team < 4; team++) {
      await service.registerTeam(players[team * 2]!.principal, tournament.id, {
        name: `Equipo ${team + 1}`,
        teammateUserIds: [players[team * 2 + 1]!.id],
      });
    }

    // Se presentan siete de los ocho: al equipo 3 le falta su compañero (players[7]).
    for (const player of players.slice(0, 7))
      await service.checkIn(player.principal, tournament.id);

    // Vencida la ventana, el barrido arranca el torneo: no puede quedarse esperando al
    // que nunca llegó (docs/RULES.md § Torneos: el equipo entra completo o no entra).
    at(41);
    expect(await service.startTournament(tournament.id, new Date(clockMs))).toBe(true);

    const [row] = await db
      .select()
      .from(tournamentsTable)
      .where(eq(tournamentsTable.id, tournament.id));
    expect(row!.status).toBe('IN_PROGRESS');

    // El equipo incompleto es el 4 (se presentó players[6], faltó players[7]). Queda fuera
    // entero: sus DOS integrantes como ausentes, incluido el capitán que sí se presentó.
    const participants = await db
      .select()
      .from(tournamentParticipantsTable)
      .where(eq(tournamentParticipantsTable.tournamentId, tournament.id));
    const teamThree = await db
      .select()
      .from(tournamentTeamsTable)
      .where(
        and(
          eq(tournamentTeamsTable.tournamentId, tournament.id),
          eq(tournamentTeamsTable.name, 'Equipo 4'),
        ),
      );
    const excluded = participants.filter((p) => p.teamId === teamThree[0]!.id);
    expect(excluded).toHaveLength(2);
    expect(excluded.map((p) => p.status)).toEqual(['NO_SHOW', 'NO_SHOW']);

    // No ocupa ningún lado del cuadro: no hay cruce que le regale nada al rival.
    const matches = await db
      .select()
      .from(tournamentMatchesTable)
      .where(eq(tournamentMatchesTable.tournamentId, tournament.id));
    for (const match of matches) {
      expect(match.homeTeamId).not.toBe(teamThree[0]!.id);
      expect(match.awayTeamId).not.toBe(teamThree[0]!.id);
      // Y ningún cruce quedó ya ganado sin jugarse por esa ausencia.
      expect(match.status).not.toBe('FORFEITED');
    }

    // Con tres equipos completos la llave se arma entre ellos, sin lados vacíos.
    const teamsInBracket = new Set(
      matches.flatMap((match) =>
        [match.homeTeamId, match.awayTeamId].filter((id): id is string => id !== null),
      ),
    );
    expect(teamsInBracket).toEqual(
      new Set(
        (
          await db
            .select()
            .from(tournamentTeamsTable)
            .where(eq(tournamentTeamsTable.tournamentId, tournament.id))
        )
          .filter((team) => team.id !== teamThree[0]!.id)
          .map((team) => team.id),
      ),
    );

    // La tabla no inventa al ausente: aparece sin victorias, no como clasificado.
    const detail = await service.detail(organizer.id, tournament.id);
    const standings = detail.standings.map((standing) => standing.nickname);
    expect(standings).not.toContain('Equipo 4');
    expect(standings).toContain('Equipo 1');
  }, 120_000);

  it('el cupo de un torneo 2v2 cuenta equipos: nunca muestra más inscriptos que cupo', async () => {
    const organizer = (await seedUsers(1))[0]!;
    const players = await seedUsers(8);
    const tournament = await service.create(
      organizer.principal,
      { ...createInput, capacity: 4, rules: { ...createInput.rules, mode: '2v2' } },
      { ip: '10.0.0.33' },
    );
    for (let team = 0; team < 4; team++) {
      await service.registerTeam(players[team * 2]!.principal, tournament.id, {
        name: `Equipo ${team + 1}`,
        teammateUserIds: [players[team * 2 + 1]!.id],
      });
    }
    for (const player of players) await service.checkIn(player.principal, tournament.id);

    // 4 equipos de 2 personas sobre un cupo de 4: el resumen dice 4/4, no 8/4.
    const detail = await service.detail(organizer.id, tournament.id);
    expect(detail.tournament.registeredCount).toBe(4);
    expect(detail.tournament.checkedInCount).toBe(4);
    expect(detail.tournament.registeredCount).toBeLessThanOrEqual(tournament.capacity);
    // Y el cupo se agota de verdad: un quinto equipo no entra.
    const extra = await seedUsers(2);
    await expect(
      service.registerTeam(extra[0]!.principal, tournament.id, {
        name: 'Equipo 5',
        teammateUserIds: [extra[1]!.id],
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect(detail.canRegister).toBe(false);
    expect(detail.registrationClosedReason).toBe('El torneo está completo.');
  }, 90_000);

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

  /**
   * Hueco de verificación de M10a: ventana de check-in, ausentes y cruce vencido.
   *
   * El reloj lo inyecta el servicio (`nowFn`), así que el caso recorre un torneo de días
   * en milisegundos: no espera tiempo real en ningún paso.
   */
  it('check-in vencido: echa a los ausentes, define el cruce por incomparecencia y avanza', async () => {
    const organizer = (await seedUsers(1))[0]!;
    const players = await seedUsers(4, (index) => 1900 - index * 50);
    // Los dos torneos se crean en el mismo instante: sus ventanas (inscripción 30 min,
    // check-in 10 más) quedan ancladas al reloj inyectado.
    const abandoned = await service.create(
      organizer.principal,
      { ...createInput, capacity: 4 },
      { ip: '10.0.0.21' },
    );
    const played = await service.create(
      organizer.principal,
      { ...createInput, capacity: 4 },
      { ip: '10.0.0.22' },
    );
    for (const player of players) {
      await service.register(player.principal, abandoned.id);
      await service.register(player.principal, played.id);
    }

    // 1) La inscripción ya cerró pero el check-in sigue abierto: se puede llegar tarde
    //    a inscribirse no, a presentarse sí.
    at(35);
    expect(await service.startTournament(abandoned.id, new Date(clockMs))).toBe(false);
    await service.checkIn(players[0]!.principal, played.id);
    await service.checkIn(players[1]!.principal, played.id);

    // 2) Vencida la ventana, quien no se presentó no puede colarse en el cuadro.
    at(41);
    await expect(service.checkIn(players[2]!.principal, played.id)).rejects.toMatchObject({
      status: 409,
    });

    // 3) El torneo sin nadie presente se cancela y todos quedan como ausentes.
    expect(await service.startTournament(abandoned.id, new Date(clockMs))).toBe(false);
    const absent = await db
      .select()
      .from(tournamentParticipantsTable)
      .where(eq(tournamentParticipantsTable.tournamentId, abandoned.id));
    expect(absent.every((row) => row.status === 'NO_SHOW')).toBe(true);
    const [cancelled] = await db
      .select()
      .from(tournamentsTable)
      .where(eq(tournamentsTable.id, abandoned.id));
    expect(cancelled!.status).toBe('CANCELLED');

    // 4) Con dos presentados la llave se arma igual: los ausentes quedan fuera del cuadro
    //    y nadie juega contra alguien que no está.
    expect(await service.startTournament(played.id, new Date(clockMs))).toBe(true);
    const participants = await db
      .select()
      .from(tournamentParticipantsTable)
      .where(eq(tournamentParticipantsTable.tournamentId, played.id));
    expect(participants.filter((row) => row.status === 'CHECKED_IN')).toHaveLength(2);
    expect(participants.filter((row) => row.status === 'NO_SHOW')).toHaveLength(2);

    const matches = await db
      .select()
      .from(tournamentMatchesTable)
      .where(eq(tournamentMatchesTable.tournamentId, played.id));
    expect(matches).toHaveLength(1);
    const final = matches[0]!;
    expect(final.status).toBe('READY');
    expect(final.homeUserId).not.toBeNull();
    expect(final.awayUserId).not.toBeNull();
    // El plazo de presentación sale de `noShowMinutes` (10) contado desde que quedó listo.
    expect(final.deadlineAt!.getTime()).toBe(new Date(clockMs).getTime() + 10 * 60_000);

    // 5) Nadie se presenta al cruce: vence y se cierra por incomparecencia, sin inventar
    //    ganador (doble ausencia).
    at(52);
    expect(await service.expireMatch(final, new Date(clockMs))).toBe(true);
    const [forfeited] = await db
      .select()
      .from(tournamentMatchesTable)
      .where(eq(tournamentMatchesTable.id, final.id));
    expect(forfeited!.status).toBe('FORFEITED');
    expect(forfeited!.forfeitReason).toBe('NO_SHOW');
    expect(forfeited!.winnerUserId).toBeNull();

    // 6) La definición es idempotente: volver a pasarla no reabre ni redefine el cruce.
    //    (El barrido general se prueba aparte: acá interesa este cruce, no los torneos
    //    que dejaron abiertos los otros casos del archivo.)
    at(53);
    expect(await service.expireMatch(final, new Date(clockMs))).toBe(false);
    const [still] = await db
      .select()
      .from(tournamentsTable)
      .where(eq(tournamentsTable.id, played.id));
    expect(still!.status).toBe('IN_PROGRESS');

    // 7) La llave no se traba: el panel cierra el cuadro sin ganador y el torneo termina
    //    sin pagar premio de campeón.
    await service.forceAdvance(
      { userId: organizer.id, sessionId: generateUuidV7(), permissions: [] } as never,
      played.id,
      { reason: 'Doble incomparecencia en la final.' },
      { ip: '10.0.0.22' },
    );
    const [closed] = await db
      .select()
      .from(tournamentsTable)
      .where(eq(tournamentsTable.id, played.id));
    expect(closed!.status).toBe('FINISHED');
    const awards = await db
      .select()
      .from(tournamentAwardsTable)
      .where(eq(tournamentAwardsTable.tournamentId, played.id));
    expect(awards).toHaveLength(0);
  }, 90_000);

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
    // El listado ordena por fecha de creación (más reciente primero) y tiene tope. El caso
    // lo crea en un instante posterior al resto del archivo para que esté primero: así
    // prueba la visibilidad del privado, no cuántos torneos crearon los otros casos.
    at(120);
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
