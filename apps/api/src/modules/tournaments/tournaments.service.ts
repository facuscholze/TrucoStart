import {
  Inject,
  Injectable,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import {
  type TournamentDetailResponse,
  type TournamentFormat,
  type TournamentListResponse,
  type TournamentMatchView,
  type TournamentParticipantView,
  type TournamentPrizeView,
  type TournamentStanding,
  type TournamentSummary,
  buildTournamentTopology,
  canTransitionTournament,
  indexTopology,
  matchDestinations,
  seedEntrants,
} from '@truco/shared';
import { and, eq, inArray } from 'drizzle-orm';
import { DomainApiException } from '../../common/api-exception.js';
import {
  RATE_LIMIT_STORE,
  type RateLimitStore,
} from '../../common/rate-limit/rate-limit-store.interface.js';
import { generateUuidV7 } from '../../common/uuidv7.js';
import type { AppTransaction } from '../../db/database.provider.js';
import type { tournamentMatchesTable } from '../../db/schema/index.js';
import {
  cosmeticCatalogTable,
  socialNotificationsTable,
  tournamentParticipantsTable,
  userCosmeticsTable,
  walletAccountsTable,
  walletTransactionsTable,
} from '../../db/schema/index.js';
import type { AdminPrincipal } from '../admin/admin-auth.service.js';
import { AuditRepository } from '../audit/audit.repository.js';
import type { AuthenticatedPrincipal } from '../auth/guards/session-auth.guard.js';
import {
  LOBBY_RUNTIME_CONFIG,
  resolveRuleSetSelection,
  type LobbyRuntimeConfig,
} from '../lobby/lobby.config.js';
import { resolveRuleSetByCode } from '../lobby/lobby.config.js';
import {
  seatForTeamMember,
  TEAM_SIZE,
  teamPresence,
  walkoverWinner,
  type TeamPresence,
} from './tournament-teams.js';
import { LobbyRepository } from '../lobby/lobby.repository.js';
import { LobbyRealtimeGateway } from '../lobby/lobby-realtime.gateway.js';
import { MatchCompletionBridge } from '../lobby/ports/match-completion-bridge.js';
import {
  GAME_ROOM_PROVISIONER,
  type GameRoomProvisioner,
} from '../lobby/ports/game-room-provisioner.js';
import { TOURNAMENTS_RUNTIME_CONFIG, type TournamentsRuntimeConfig } from './tournaments.config.js';
import {
  type ParticipantRow,
  type TeamMemberRow,
  type TeamRow,
  type TournamentMatchRow,
  type TournamentRow,
  TournamentsRepository,
} from './tournaments.repository.js';

/**
 * Torneos (M10a).
 *
 * Decisiones visibles en el código:
 *
 * - **La llave no se guarda como grafo.** `buildTournamentTopology` la reconstruye
 *   desde el formato y la cantidad de participantes congelada al arrancar; la base
 *   guarda una fila por cruce con su lugar (`bracket`, `round`, `slot`), que es la
 *   misma clave de la topología. Así el cuadro no puede desincronizarse.
 * - **El avance es idempotente de dos formas.** El cruce se resuelve bajo `FOR UPDATE`
 *   y la fila se escribe una sola vez; además `(tournament, resolvedFromMatchId)` es
 *   único en la base, con lo que dos workers no pueden aplicar la misma partida dos veces.
 * - **Nadie se inscribe dos veces ni de más.** La transacción bloquea el torneo, cuenta
 *   y escribe; la base tiene el único `(tournament, user)` como última red.
 * - **No hay bots.** Un torneo arranca sólo con personas que hicieron check-in.
 * - **Los premios son simbólicos.** Monedas virtuales por `wallet_transactions`
 *   (`kind = MISSION_REWARD`, asiento positivo) o un cosmético; nunca dinero ni valor
 *   económico. `tournament_awards` garantiza una entrega por torneo y posición, y
 *   además el asiento usa `idempotencyKey` propia.
 * - **Las partidas de torneo no puntúan al ranking competitivo** (ADR-030): se crean
 *   con `isCompetitive = false`, así que no alteran Glicko-2 ni el leaderboard.
 */
@Injectable()
export class TournamentsService implements OnApplicationBootstrap, OnApplicationShutdown {
  private maintenanceTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    @Inject(TournamentsRepository) private readonly repository: TournamentsRepository,
    @Inject(TOURNAMENTS_RUNTIME_CONFIG) private readonly config: TournamentsRuntimeConfig,
    @Inject(LOBBY_RUNTIME_CONFIG) private readonly lobbyConfig: LobbyRuntimeConfig,
    @Inject(LobbyRepository) private readonly lobbyRepository: LobbyRepository,
    @Inject(GAME_ROOM_PROVISIONER) private readonly provisioner: GameRoomProvisioner,
    @Inject(RATE_LIMIT_STORE) private readonly rateLimitStore: RateLimitStore,
    @Inject(AuditRepository) private readonly auditRepository: AuditRepository,
    // Mismo gateway de M9a: el namespace `/lobby` ya entrega `social.notification`
    // por el canal del usuario, así que las notificaciones de torneo llegan por ahí.
    @Inject(LobbyRealtimeGateway) private readonly realtime: LobbyRealtimeGateway,
    // Puente del lobby: el lobby no importa este módulo, así que se anota acá el cierre
    // de cruces. Es una interfaz, no una dependencia de módulo: no hay ciclo.
    @Inject(MatchCompletionBridge) private readonly matchCompletion: MatchCompletionBridge,
  ) {}

  onApplicationBootstrap(): void {
    // A partir de acá, cada `match.completed` del lobby intenta cerrar su cruce.
    this.matchCompletion.register((info) => this.completeByRoom(info));
    if (this.config.maintenanceIntervalMs <= 0) return;
    this.maintenanceTimer = setInterval(() => {
      void this.runMaintenance().catch(() => undefined);
    }, this.config.maintenanceIntervalMs);
    this.maintenanceTimer.unref?.();
  }

  onApplicationShutdown(): void {
    if (this.maintenanceTimer) clearInterval(this.maintenanceTimer);
    this.maintenanceTimer = null;
  }

  private now(): Date {
    return new Date(this.config.nowFn());
  }

  // --------------------------------------------------------------- creación

  async create(
    principal: AuthenticatedPrincipal,
    body: CreateInput,
    meta: { readonly ip: string; readonly reason?: string | undefined },
  ): Promise<TournamentSummary> {
    await this.consumeLimit(
      `tournaments:create:account:${principal.userId}`,
      this.config.createPerAccountMax,
    );
    await this.consumeLimit(`tournaments:create:ip:${meta.ip}`, this.config.createPerIpMax);

    const wantsOfficial = body.visibility === 'OFFICIAL' || body.official;
    if (wantsOfficial && !isStaff(principal.role)) {
      throw new DomainApiException(
        403,
        'FORBIDDEN',
        'Sólo el equipo puede crear torneos oficiales.',
        {
          reason: 'OFFICIAL_REQUIRES_STAFF',
        },
      );
    }

    const prizePool = body.prizes.reduce((sum, prize) => sum + prize.coins, 0);
    if (prizePool > this.config.maxTotalPrizeCoins) {
      throw new DomainApiException(
        400,
        'VALIDATION_ERROR',
        `La bolsa de premios no puede superar ${this.config.maxTotalPrizeCoins} monedas simbólicas.`,
        { reason: 'PRIZE_POOL_TOO_LARGE' },
      );
    }
    if (new Set(body.prizes.map((prize) => prize.position)).size !== body.prizes.length) {
      throw new DomainApiException(
        400,
        'VALIDATION_ERROR',
        'Hay dos premios para la misma posición.',
        {
          reason: 'DUPLICATE_PRIZE_POSITION',
        },
      );
    }
    if (body.prizes.some((prize) => prize.position > body.capacity)) {
      throw new DomainApiException(
        400,
        'VALIDATION_ERROR',
        'Un premio apunta a una posición fuera del cupo.',
        {
          reason: 'PRIZE_POSITION_OUT_OF_RANGE',
        },
      );
    }

    // El RuleSet lo define el torneo: puntos y flor deben coincidir con el catálogo.
    const ruleset = resolveRuleSetSelection({
      rulesetCode: body.rules.rulesetCode as never,
      targetScore: body.rules.targetScore === 15 ? 15 : 30,
      flor: body.rules.florEnabled,
    });
    const rulesetRow = await this.lobbyRepository.ensureRulesetRow(ruleset);

    const now = this.now();
    const id = generateUuidV7(now.getTime());
    const joinCode = body.visibility === 'PRIVATE' ? await this.generateJoinCode() : null;
    const registrationClosesAt = new Date(now.getTime() + body.registrationMinutes * 60_000);
    const checkInClosesAt = new Date(registrationClosesAt.getTime() + body.checkInMinutes * 60_000);

    const created = await this.repository.transaction(async (tx) => {
      if (body.visibility === 'PRIVATE') {
        const active = await this.repository.countActivePrivateByCreator(tx, principal.userId);
        if (active >= this.config.maxActivePrivatePerCreator) {
          throw new DomainApiException(
            409,
            'CONFLICT',
            `Ya tenés ${active} torneos privados activos. Esperá a que terminen para crear otro.`,
            {
              reason: 'TOO_MANY_ACTIVE_TOURNAMENTS',
              limit: this.config.maxActivePrivatePerCreator,
            },
          );
        }
      }

      const row = await this.repository.insertTournament(tx, {
        id,
        name: body.name,
        format: body.format,
        visibility: body.visibility,
        status: 'REGISTRATION',
        mode: body.rules.mode,
        rulesetId: rulesetRow.id,
        rulesetCode: ruleset.code as TournamentRow['rulesetCode'],
        targetScore: ruleset.targetScore,
        florEnabled: ruleset.flor.enabled,
        turnTimeoutMs: body.rules.turnTimeoutMs,
        capacity: body.capacity,
        joinCode,
        noShowMinutes: body.noShowMinutes,
        registrationClosesAt,
        checkInClosesAt,
        createdBy: principal.userId,
        createdAt: now,
        updatedAt: now,
      });

      await this.repository.insertPrizes(
        tx,
        body.prizes.map((prize) => ({
          id: generateUuidV7(now.getTime()),
          tournamentId: id,
          position: prize.position,
          coins: prize.coins,
          cosmeticId: prize.cosmeticId,
          createdAt: now,
        })),
      );
      return row;
    });

    await this.auditRepository.record({
      actorId: principal.userId,
      action: 'tournaments.created',
      entity: 'tournament',
      entityId: created.id,
      afterState: {
        format: created.format,
        visibility: created.visibility,
        capacity: created.capacity,
        targetScore: created.targetScore,
        prizes: body.prizes.map((prize) => ({ position: prize.position, coins: prize.coins })),
      },
      // La creación de staff siempre trae motivo; la de un jugador no lleva (no hay
      // decisión administrativa que justificar) y se registra igual quién la hizo.
      ...(meta.reason !== undefined ? { reason: meta.reason } : {}),
      ip: meta.ip,
      now,
    });

    return this.toSummary(created, principal.userId);
  }

  /**
   * Alta desde el panel. El staff crea cualquier torneo, incluido el oficial, sin
   * depender del rol del usuario que esté logueado en el juego.
   */
  async createAsStaff(
    principal: AdminPrincipal,
    body: CreateInput,
    meta: { readonly ip: string; readonly reason?: string | undefined },
  ): Promise<TournamentSummary> {
    const asPlayer = {
      userId: principal.userId,
      nickname: principal.nickname,
      role: principal.role,
      sessionId: principal.sessionId,
    } as unknown as AuthenticatedPrincipal;
    return this.create(asPlayer, { ...body, official: true }, meta);
  }

  /** Código legible, sin 0/O ni 1/I, para poder dictarlo. */
  private async generateJoinCode(): Promise<string> {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    for (let attempt = 0; attempt < 12; attempt++) {
      const bytes = new Uint8Array(6);
      globalThis.crypto.getRandomValues(bytes);
      let code = '';
      for (const byte of bytes) code += alphabet[byte % alphabet.length];
      if (!(await this.repository.findByJoinCode(code))) return code;
    }
    throw new Error('No se pudo generar un código de torneo único.');
  }

  // ---------------------------------------------------------------- lectura

  async list(
    viewerUserId: string,
    query: {
      readonly status: readonly string[];
      readonly limit: number;
      readonly cursor: string | null;
    },
  ): Promise<TournamentListResponse> {
    const cursor = decodeCursor(query.cursor);
    const rows = await this.repository.listVisible({
      viewerUserId,
      statuses: query.status,
      limit: query.limit + 1,
      cursor,
      includePrivateForViewer: true,
    });
    const page = rows.slice(0, query.limit);
    const items = await Promise.all(page.map((row) => this.toSummary(row, viewerUserId)));
    const last = page[page.length - 1];
    return {
      items,
      nextCursor: rows.length > query.limit && last ? encodeCursor(last) : null,
    };
  }

  /**
   * Listado del panel. El staff ve también los torneos privados de terceros: sin eso
   * no podría revisar un cuadro que ya está en juego ni resolver una incidencia.
   */
  async listForStaff(query: {
    readonly status: readonly string[];
    readonly limit: number;
    readonly cursor: string | null;
  }): Promise<TournamentListResponse> {
    const cursor = decodeCursor(query.cursor);
    const rows = await this.repository.listForStaff({
      statuses: query.status,
      limit: query.limit + 1,
      cursor,
    });
    const page = rows.slice(0, query.limit);
    // El resumen se arma desde el punto de vista del staff: no hay "vos" en esta vista.
    const items = await Promise.all(page.map((row) => this.toSummary(row, row.createdBy)));
    const last = page[page.length - 1];
    return {
      items,
      nextCursor: rows.length > query.limit && last ? encodeCursor(last) : null,
    };
  }

  async detail(
    viewerUserId: string,
    tournamentId: string,
    options: { readonly asStaff?: boolean } = {},
  ): Promise<TournamentDetailResponse> {
    const row = await this.requireTournament(tournamentId);
    const [participants, matches, prizes] = await Promise.all([
      this.repository.listParticipants(tournamentId),
      this.repository.listMatches(tournamentId),
      this.repository.listPrizes([tournamentId]),
    ]);

    const isParticipant = participants.some(
      (participant) => participant.userId === viewerUserId && participant.status !== 'WITHDRAWN',
    );
    const isOrganizer = row.createdBy === viewerUserId;
    // Un torneo privado no se puede leer de paso: hay que tener el código o participar.
    // El staff es la excepción explícita: necesita ver el cuadro para resolver
    // incidencias, y ese acceso queda en la auditoría del panel.
    if (
      row.visibility === 'PRIVATE' &&
      !isParticipant &&
      !isOrganizer &&
      options.asStaff !== true
    ) {
      throw new DomainApiException(404, 'NOT_FOUND', 'No encontramos ese torneo.', {
        reason: 'TOURNAMENT_NOT_VISIBLE',
      });
    }

    const userIds = new Set<string>([row.createdBy, viewerUserId]);
    for (const participant of participants) userIds.add(participant.userId);
    for (const match of matches) {
      if (match.homeUserId) userIds.add(match.homeUserId);
      if (match.awayUserId) userIds.add(match.awayUserId);
    }
    const [nicknames, ratings] = await Promise.all([
      this.repository.nicknamesFor([...userIds]),
      this.repository.ratingsFor(
        participants.map((participant) => participant.userId),
        row.mode,
      ),
    ]);

    const participantViews: TournamentParticipantView[] = participants.map((participant) => ({
      userId: participant.userId,
      nickname: nicknames.get(participant.userId) ?? 'Jugador',
      seed: participant.seed,
      status: participant.status,
      registeredAt: participant.registeredAt.toISOString(),
      checkedInAt: participant.checkedInAt?.toISOString() ?? null,
      // El rating ajeno es dato de otro: sólo el organizador y el propio jugador lo ven.
      rating:
        isOrganizer || participant.userId === viewerUserId
          ? (ratings.get(participant.userId) ?? participant.seedRating)
          : null,
    }));

    const teams = row.mode === '2v2' ? await this.repository.listTeams(row.id) : [];
    const teamNames = new Map(teams.map((team) => [team.id, team.name]));
    const matchViews = matches.map((match) => this.toMatchView(match, nicknames, teamNames));
    const now = this.now();
    const summary = await this.toSummary(row, viewerUserId, { participants, prizes });

    // Equipos del torneo 2v2 con sus integrantes: es lo que ocupa cada lado del cuadro
    // y lo que la pantalla muestra en lugar de una lista de personas sueltas.
    const teamMembers = row.mode === '2v2' ? await this.repository.listTeamMembers(row.id) : [];
    const teamViews = teams.map((team) => ({
      id: team.id,
      name: team.name,
      seed: team.seed,
      captainUserId: team.captainUserId,
      members: teamMembers
        .filter((member) => member.teamId === team.id)
        .map((member) => ({
          userId: member.userId,
          nickname: nicknames.get(member.userId) ?? member.nickname,
          status: member.status,
        })),
    }));

    return {
      tournament: summary,
      participants: participantViews,
      teams: teamViews,
      matches: matchViews,
      standings: buildStandings(row, participants, matches, nicknames),
      myNextMatch:
        matchViews.find(
          (match) =>
            (match.homeUserId === viewerUserId || match.awayUserId === viewerUserId) &&
            match.status !== 'COMPLETED' &&
            match.status !== 'FORFEITED',
        ) ?? null,
      canRegister:
        (row.status === 'REGISTRATION' || row.status === 'CHECK_IN') &&
        row.registrationClosesAt.getTime() > now.getTime() &&
        !isParticipant &&
        summary.registeredCount < row.capacity,
      canCheckIn: this.canCheckIn(row, participants, viewerUserId, now),
      registrationClosedReason: this.registrationClosedReason(row, participants, now),
    };
  }

  private toMatchView(
    match: TournamentMatchRow,
    nicknames: ReadonlyMap<string, string>,
    teamNames?: ReadonlyMap<string, string>,
  ): TournamentMatchView {
    // En 2v2 el lado se muestra con el nombre del equipo; en 1v1, con el apodo. El cuadro
    // tiene un solo campo por lado para que la web no tenga que saber de qué torneo es.
    const sideName = (userId: string | null, teamId: string | null): string | null => {
      if (teamId !== null) return teamNames?.get(teamId) ?? 'Equipo';
      return userId ? (nicknames.get(userId) ?? 'Jugador') : null;
    };
    return {
      id: match.id,
      round: match.round,
      slot: match.slot,
      bracket: match.bracket,
      status: match.status,
      homeNickname: sideName(match.homeUserId, match.homeTeamId),
      awayNickname: sideName(match.awayUserId, match.awayTeamId),
      homeUserId: match.homeUserId,
      awayUserId: match.awayUserId,
      winnerUserId: match.winnerUserId,
      homeTeamId: match.homeTeamId,
      awayTeamId: match.awayTeamId,
      winnerTeamId: match.winnerTeamId,
      roomId: match.roomId,
      deadlineAt: match.deadlineAt?.toISOString() ?? null,
      forfeitReason: match.forfeitReason,
      startedAt: match.startedAt?.toISOString() ?? null,
      completedAt: match.completedAt?.toISOString() ?? null,
    };
  }

  async listMine(viewerUserId: string): Promise<{ items: TournamentSummary[] }> {
    const ids = await this.repository.tournamentIdsForUser(viewerUserId);
    const rows = await this.repository.tournamentsByIds(ids);
    const items = await Promise.all(rows.map((row) => this.toSummary(row, viewerUserId)));
    return {
      items: items.sort((a, b) => a.registrationClosesAt.localeCompare(b.registrationClosesAt)),
    };
  }

  /** "Mi próxima partida": el cruce pendiente más urgente del jugador y su torneo. */
  async myNextMatch(
    viewerUserId: string,
  ): Promise<{ match: TournamentMatchView | null; tournament: TournamentSummary | null }> {
    for (const pending of await this.repository.listMatchesForUser(viewerUserId)) {
      const tournament = await this.repository.findById(pending.tournamentId);
      if (!tournament) continue;
      const nicknames = await this.repository.nicknamesFor(
        [pending.homeUserId, pending.awayUserId].filter((id): id is string => id !== null),
      );
      const teams = tournament.mode === '2v2' ? await this.repository.listTeams(tournament.id) : [];
      return {
        match: this.toMatchView(
          pending,
          nicknames,
          new Map(teams.map((team) => [team.id, team.name])),
        ),
        tournament: await this.toSummary(tournament, viewerUserId),
      };
    }
    return { match: null, tournament: null };
  }

  private canCheckIn(
    row: TournamentRow,
    participants: readonly ParticipantRow[],
    viewerUserId: string,
    now: Date,
  ): boolean {
    if (row.status !== 'REGISTRATION' && row.status !== 'CHECK_IN') return false;
    if (row.checkInClosesAt.getTime() <= now.getTime()) return false;
    const mine = participants.find((participant) => participant.userId === viewerUserId);
    return mine !== undefined && mine.status === 'REGISTERED';
  }

  private registrationClosedReason(
    row: TournamentRow,
    participants: readonly ParticipantRow[],
    now: Date,
  ): string | null {
    if (row.status === 'CANCELLED') return 'El torneo fue cancelado.';
    if (row.status === 'FINISHED') return 'El torneo ya terminó.';
    if (row.status === 'IN_PROGRESS') return 'El torneo ya empezó.';
    // `CHECK_IN` sólo significa que alguien ya se presentó; la inscripción sigue abierta
    // hasta su propio plazo, que es el que se evalúa abajo.
    if (row.status === 'DRAFT') return 'El torneo todavía no abrió la inscripción.';
    if (row.registrationClosesAt.getTime() <= now.getTime()) return 'La inscripción ya cerró.';
    const active = participants.filter(
      (participant) => participant.status === 'REGISTERED' || participant.status === 'CHECKED_IN',
    ).length;
    if (active >= row.capacity) return 'El torneo está completo.';
    return null;
  }

  private async toSummary(
    row: TournamentRow,
    viewerUserId: string,
    preloaded?: {
      readonly participants?: readonly ParticipantRow[];
      readonly prizes?: readonly PrizeRow[];
    },
  ): Promise<TournamentSummary> {
    const participants =
      preloaded?.participants ?? (await this.repository.listParticipants(row.id));
    const prizes = preloaded?.prizes ?? (await this.repository.listPrizes([row.id]));
    const nicknames = await this.repository.nicknamesFor([row.createdBy]);
    const prizeViews = await this.toPrizeViews(prizes);
    const isParticipant = participants.some(
      (participant) => participant.userId === viewerUserId && participant.status !== 'WITHDRAWN',
    );
    const isOrganizer = row.createdBy === viewerUserId;

    return {
      id: row.id,
      name: row.name,
      format: row.format,
      visibility: row.visibility,
      status: row.status,
      mode: row.mode,
      rulesetCode: row.rulesetCode as TournamentSummary['rulesetCode'],
      targetScore: row.targetScore,
      florEnabled: row.florEnabled,
      turnTimeoutMs: row.turnTimeoutMs,
      capacity: row.capacity,
      registeredCount: participants.filter(
        (participant) => participant.status === 'REGISTERED' || participant.status === 'CHECKED_IN',
      ).length,
      checkedInCount: participants.filter((participant) => participant.status === 'CHECKED_IN')
        .length,
      // El código es la llave de invitación: sólo lo ve quien organiza.
      joinCode: row.visibility === 'PRIVATE' && isOrganizer ? row.joinCode : null,
      registrationClosesAt: row.registrationClosesAt.toISOString(),
      checkInClosesAt: row.checkInClosesAt.toISOString(),
      startsAt: row.startsAt?.toISOString() ?? null,
      finishedAt: row.finishedAt?.toISOString() ?? null,
      cancelledReason: row.cancelledReason,
      createdByNickname: nicknames.get(row.createdBy) ?? 'Organizador',
      isParticipant,
      isOrganizer,
      prizes: prizeViews,
    };
  }

  private async toPrizeViews(prizes: readonly PrizeRow[]): Promise<TournamentPrizeView[]> {
    const cosmeticIds = prizes
      .map((prize) => prize.cosmeticId)
      .filter((id): id is string => id !== null);
    const names = new Map<string, string>();
    if (cosmeticIds.length > 0) {
      const rows = await this.repository.database
        .select({ id: cosmeticCatalogTable.id, nameKey: cosmeticCatalogTable.nameKey })
        .from(cosmeticCatalogTable)
        .where(inArray(cosmeticCatalogTable.id, cosmeticIds));
      for (const cosmetic of rows) names.set(cosmetic.id, cosmetic.nameKey);
    }
    return prizes.map((prize) => ({
      position: prize.position,
      coins: prize.coins,
      cosmeticId: prize.cosmeticId,
      cosmeticName: prize.cosmeticId ? (names.get(prize.cosmeticId) ?? prize.cosmeticId) : null,
    }));
  }

  // ------------------------------------------------------------- inscripción

  async register(
    principal: AuthenticatedPrincipal,
    tournamentId: string,
  ): Promise<{ participants: number }> {
    await this.consumeLimit(
      `tournaments:register:account:${principal.userId}`,
      this.config.registerPerAccountMax,
    );
    const now = this.now();

    const total = await this.repository.transaction(async (tx) => {
      // Bloquear el torneo serializa las inscripciones: dos pedidos a la vez no pueden
      // leer el mismo cupo libre y escribirse los dos.
      const tournament = await this.repository.lockById(tx, tournamentId);
      if (!tournament) {
        throw new DomainApiException(404, 'NOT_FOUND', 'No encontramos ese torneo.', {
          reason: 'TOURNAMENT_NOT_FOUND',
        });
      }
      // El check-in puede empezar antes de que cierre la inscripción: quien ya se
      // presentó no debe cerrarle la puerta a quien todavía no se inscribió.
      if (tournament.status !== 'REGISTRATION' && tournament.status !== 'CHECK_IN') {
        throw new DomainApiException(
          409,
          'CONFLICT',
          'La inscripción de este torneo no está abierta.',
          {
            reason: 'REGISTRATION_CLOSED',
          },
        );
      }
      if (tournament.registrationClosesAt.getTime() <= now.getTime()) {
        throw new DomainApiException(409, 'CONFLICT', 'La inscripción ya cerró.', {
          reason: 'REGISTRATION_DEADLINE_PASSED',
        });
      }

      const existing = await this.repository.findParticipant(tournamentId, principal.userId, tx);
      if (existing && existing.status !== 'WITHDRAWN') {
        throw new DomainApiException(409, 'CONFLICT', 'Ya estás inscripto en este torneo.', {
          reason: 'ALREADY_REGISTERED',
        });
      }

      const active = await this.repository.countActiveParticipants(tx, tournamentId);
      if (active >= tournament.capacity) {
        throw new DomainApiException(409, 'CONFLICT', 'El torneo está completo.', {
          reason: 'TOURNAMENT_FULL',
          capacity: tournament.capacity,
        });
      }

      if (existing) {
        // Volver tras retirarse reactiva la misma fila: el único `(torneo, usuario)`
        // sigue garantizando "una vez", sin borrar el historial de la baja.
        await this.repository.updateParticipant(tx, existing.id, {
          status: 'REGISTERED',
          registeredAt: now,
          withdrawnAt: null,
          checkedInAt: null,
          seed: null,
          seedRating: null,
        });
      } else {
        await this.repository.insertParticipant(tx, {
          id: generateUuidV7(now.getTime()),
          tournamentId,
          userId: principal.userId,
          status: 'REGISTERED',
          registeredAt: now,
        });
      }
      return active + 1;
    });

    await this.auditRepository.record({
      actorId: principal.userId,
      action: 'tournaments.registered',
      entity: 'tournament',
      entityId: tournamentId,
      now,
    });
    return { participants: total };
  }

  /**
   * Inscripción de un equipo (torneos 2v2). El capitán inscribe el equipo con sus
   * integrantes en una sola operación atómica: o queda todo el equipo inscripto o no
   * queda nadie. Cada integrante es un inscripto propio, así el check-in, la baja y los
   * premios siguen siendo por persona.
   *
   * El cupo cuenta **equipos**, no personas: un torneo de 8 equipos son 16 personas.
   */
  async registerTeam(
    principal: AuthenticatedPrincipal,
    tournamentId: string,
    body: { readonly name: string; readonly teammateUserIds: readonly string[] },
  ): Promise<{ teamId: string; participants: number }> {
    await this.consumeLimit(
      `tournaments:register:account:${principal.userId}`,
      this.config.registerPerAccountMax,
    );
    const now = this.now();
    const expectedMembers = TEAM_SIZE['2v2'];
    const memberIds = [principal.userId, ...body.teammateUserIds];
    if (new Set(memberIds).size !== memberIds.length) {
      throw new DomainApiException(
        409,
        'CONFLICT',
        'No podés repetir integrantes en el mismo equipo.',
        { reason: 'DUPLICATE_TEAMMATE' },
      );
    }
    if (memberIds.length !== expectedMembers) {
      throw new DomainApiException(
        400,
        'VALIDATION_ERROR',
        `Un equipo de 2v2 necesita exactamente ${expectedMembers} integrantes.`,
        { reason: 'TEAM_SIZE_MISMATCH', expected: expectedMembers },
      );
    }
    if (!body.name.trim()) {
      throw new DomainApiException(400, 'VALIDATION_ERROR', 'El equipo necesita un nombre.', {
        reason: 'TEAM_NAME_REQUIRED',
      });
    }

    const result = await this.repository.transaction(async (tx) => {
      const tournament = await this.repository.lockById(tx, tournamentId);
      if (!tournament) {
        throw new DomainApiException(404, 'NOT_FOUND', 'No encontramos ese torneo.', {
          reason: 'TOURNAMENT_NOT_FOUND',
        });
      }
      if (tournament.mode !== '2v2') {
        throw new DomainApiException(409, 'CONFLICT', 'Este torneo es 1v1: inscribite solo.', {
          reason: 'NOT_A_TEAM_TOURNAMENT',
        });
      }
      if (tournament.status !== 'REGISTRATION' && tournament.status !== 'CHECK_IN') {
        throw new DomainApiException(
          409,
          'CONFLICT',
          'La inscripción de este torneo no está abierta.',
          { reason: 'REGISTRATION_CLOSED' },
        );
      }
      if (tournament.registrationClosesAt.getTime() <= now.getTime()) {
        throw new DomainApiException(409, 'CONFLICT', 'La inscripción ya cerró.', {
          reason: 'REGISTRATION_DEADLINE_PASSED',
        });
      }

      // Nadie puede estar en dos equipos del mismo torneo (ni en uno y suelto).
      for (const memberId of memberIds) {
        const existing = await this.repository.findParticipant(tournamentId, memberId, tx);
        if (existing && existing.status !== 'WITHDRAWN') {
          throw new DomainApiException(
            409,
            'CONFLICT',
            existing.userId === principal.userId
              ? 'Ya estás inscripto en este torneo.'
              : 'Uno de los integrantes ya está inscripto en este torneo.',
            { reason: 'ALREADY_REGISTERED', userId: existing.userId },
          );
        }
      }

      const teams = await this.repository.countActiveParticipants(tx, tournamentId);
      const activeTeams = Math.ceil(teams / expectedMembers);
      if (activeTeams >= tournament.capacity) {
        throw new DomainApiException(409, 'CONFLICT', 'El torneo está completo.', {
          reason: 'TOURNAMENT_FULL',
          capacity: tournament.capacity,
        });
      }

      const teamId = generateUuidV7(now.getTime());
      await this.repository.insertTeam(tx, {
        id: teamId,
        tournamentId,
        name: body.name.trim(),
        captainUserId: principal.userId,
        createdAt: now,
        updatedAt: now,
      });

      for (const memberId of memberIds) {
        const previous = await this.repository.findParticipant(tournamentId, memberId, tx);
        if (previous) {
          // Volver tras retirarse reactiva la fila: el único `(torneo, usuario)` sigue
          // garantizando "una vez" y no se borra el historial de la baja.
          await this.repository.updateParticipant(tx, previous.id, {
            status: 'REGISTERED',
            teamId,
            registeredAt: now,
            withdrawnAt: null,
            checkedInAt: null,
            seed: null,
            seedRating: null,
          });
        } else {
          await this.repository.insertParticipant(tx, {
            id: generateUuidV7(now.getTime()),
            tournamentId,
            userId: memberId,
            teamId,
            status: 'REGISTERED',
            registeredAt: now,
          });
        }
      }
      return { teamId, participants: memberIds.length };
    });

    await this.auditRepository.record({
      actorId: principal.userId,
      action: 'tournaments.team.registered',
      entity: 'tournament',
      entityId: tournamentId,
      afterState: { teamId: result.teamId, name: body.name, members: memberIds.length },
      now,
    });
    return result;
  }

  async unregister(principal: AuthenticatedPrincipal, tournamentId: string): Promise<void> {
    const now = this.now();
    await this.repository.transaction(async (tx) => {
      const tournament = await this.repository.lockById(tx, tournamentId);
      if (!tournament) {
        throw new DomainApiException(404, 'NOT_FOUND', 'No encontramos ese torneo.');
      }
      if (
        tournament.status !== 'REGISTRATION' ||
        tournament.registrationClosesAt.getTime() <= now.getTime()
      ) {
        throw new DomainApiException(
          409,
          'CONFLICT',
          'Ya no podés darte de baja: la inscripción cerró. Si no vas a jugar, no te presentes al check-in.',
          { reason: 'WITHDRAWAL_CLOSED' },
        );
      }
      const participant = await this.repository.findParticipant(tournamentId, principal.userId, tx);
      if (!participant || participant.status === 'WITHDRAWN') {
        throw new DomainApiException(409, 'CONFLICT', 'No estás inscripto en este torneo.', {
          reason: 'NOT_REGISTERED',
        });
      }
      await this.repository.updateParticipant(tx, participant.id, {
        status: 'WITHDRAWN',
        withdrawnAt: now,
      });
    });
    await this.auditRepository.record({
      actorId: principal.userId,
      action: 'tournaments.withdrawn',
      entity: 'tournament',
      entityId: tournamentId,
      now,
    });
  }

  async checkIn(principal: AuthenticatedPrincipal, tournamentId: string): Promise<void> {
    const now = this.now();
    await this.repository.transaction(async (tx) => {
      const tournament = await this.repository.lockById(tx, tournamentId);
      if (!tournament) {
        throw new DomainApiException(404, 'NOT_FOUND', 'No encontramos ese torneo.');
      }
      if (tournament.status !== 'REGISTRATION' && tournament.status !== 'CHECK_IN') {
        throw new DomainApiException(
          409,
          'CONFLICT',
          'El check-in de este torneo no está abierto.',
          {
            reason: 'CHECK_IN_CLOSED',
          },
        );
      }
      if (tournament.checkInClosesAt.getTime() <= now.getTime()) {
        throw new DomainApiException(409, 'CONFLICT', 'El check-in ya cerró.', {
          reason: 'CHECK_IN_DEADLINE_PASSED',
        });
      }
      const participant = await this.repository.findParticipant(tournamentId, principal.userId, tx);
      if (!participant || participant.status === 'WITHDRAWN') {
        throw new DomainApiException(409, 'CONFLICT', 'No estás inscripto en este torneo.', {
          reason: 'NOT_REGISTERED',
        });
      }
      if (participant.status === 'CHECKED_IN') return;
      await this.repository.updateParticipant(tx, participant.id, {
        status: 'CHECKED_IN',
        checkedInAt: now,
      });
      // Cerrar la inscripción apenas arranca el check-in deja el estado inequívoco.
      if (tournament.status === 'REGISTRATION') {
        await this.repository.updateTournament(tx, tournamentId, { status: 'CHECK_IN' });
      }
    });
  }

  async resolveJoinCode(joinCode: string): Promise<{ tournamentId: string }> {
    const row = await this.repository.findByJoinCode(joinCode.trim().toUpperCase());
    if (!row) {
      throw new DomainApiException(404, 'NOT_FOUND', 'No hay ningún torneo con ese código.', {
        reason: 'JOIN_CODE_NOT_FOUND',
      });
    }
    return { tournamentId: row.id };
  }

  // --------------------------------------------------------------- lifecycle

  /**
   * Barrido periódico. Idempotente: correrlo dos veces no cambia nada.
   * 1. Arranca los torneos cuyo check-in ya cerró (o los cancela si no hay gente).
   * 2. Define por incomparecencia los cruces cuyo plazo venció.
   */
  async runMaintenance(): Promise<{ started: number; forfeits: number }> {
    const now = this.now();
    let started = 0;
    let forfeits = 0;

    for (const tournament of await this.repository.listTournamentsAwaitingStart(now)) {
      if (await this.startTournament(tournament.id, now)) started += 1;
    }
    for (const match of await this.repository.listOverdueMatches(now)) {
      if (await this.expireMatch(match, now)) forfeits += 1;
    }
    return { started, forfeits };
  }

  /**
   * Arranca el torneo: aplica incomparecencias del check-in, siembra por Glicko-2 y
   * escribe la llave completa. Devuelve `false` si no correspondía arrancar.
   */
  async startTournament(tournamentId: string, now = this.now()): Promise<boolean> {
    const outcome = await this.repository.transaction(async (tx) => {
      const tournament = await this.repository.lockById(tx, tournamentId);
      if (!tournament) return null;
      if (tournament.status !== 'REGISTRATION' && tournament.status !== 'CHECK_IN') return null;
      if (tournament.checkInClosesAt.getTime() > now.getTime()) return null;

      const participants = await this.repository.lockParticipants(tx, tournamentId);
      // Quien se inscribió y no se presentó queda fuera sin sanción: no presentarse a un
      // torneo simbólico no es abandonar una partida en curso.
      for (const participant of participants) {
        if (participant.status === 'REGISTERED') {
          await this.repository.updateParticipant(tx, participant.id, { status: 'NO_SHOW' });
        }
      }
      // En 2v2 el inscripto que ocupa un lado del cuadro es el EQUIPO: entra sólo si se
      // presentaron todos sus integrantes. Un equipo al que le falta uno no puede llenar
      // una mesa de cuatro asientos y no debe ganar por walkover (docs/RULES.md).
      const teams = await this.repository.listTeams(tournamentId, tx);
      const members = await this.repository.listTeamMembers(tournamentId, tx);
      const membersByTeam = new Map<string, typeof members>();
      for (const member of members) {
        const list = membersByTeam.get(member.teamId) ?? [];
        list.push(member);
        membersByTeam.set(member.teamId, list);
      }
      const completeTeams = new Set<string>();
      for (const team of teams) {
        const roster = membersByTeam.get(team.id) ?? [];
        const presence = teamPresence(
          roster.map((row) => ({ userId: row.userId, checkedIn: row.status === 'CHECKED_IN' })),
          tournament.mode,
        );
        if (presence.kind === 'COMPLETE') {
          completeTeams.add(team.id);
          continue;
        }
        // Un equipo incompleto queda fuera entero: no se juega con medio equipo ni se
        // le da el cruce por ganado al rival sin jugar.
        for (const row of roster) {
          if (row.status === 'REGISTERED' || row.status === 'CHECKED_IN') {
            await this.repository.updateParticipant(tx, row.participantId, {
              status: 'NO_SHOW',
            });
          }
        }
      }

      const ready = participants.filter((participant) => participant.status === 'CHECKED_IN');
      const readyTeams = teams.filter((team) => completeTeams.has(team.id));
      const entrantCount = tournament.mode === '2v2' ? readyTeams.length : ready.length;
      if (entrantCount < 2) {
        await this.repository.updateTournament(tx, tournamentId, {
          status: 'CANCELLED',
          cancelledAt: now,
          cancelledReason:
            tournament.mode === '2v2'
              ? 'No hubo suficientes equipos completos en el check-in para armar la llave.'
              : 'No hubo suficientes jugadores con check-in para armar la llave.',
          finishedAt: now,
        });
        return { started: false, userIds: [] as string[] };
      }

      const ratings = await this.repository.ratingsFor(
        ready.map((participant) => participant.userId),
        tournament.mode,
        tx,
      );

      // El sembrado es por inscripto: en 2v2, por equipo y con el rating medio de sus
      // integrantes (el equipo es una sola unidad frente al cuadro).
      const isTeamTournament = tournament.mode === '2v2';
      const entrants = isTeamTournament
        ? readyTeams.map((team) => {
            const roster = membersByTeam.get(team.id) ?? [];
            const values = roster
              .map((row) => ratings.get(row.userId))
              .filter((value): value is number => value !== undefined);
            const average =
              values.length > 0
                ? values.reduce((sum, value) => sum + value, 0) / values.length
                : null;
            return { id: team.id, rating: average, seedOrder: team.createdAt.getTime() };
          })
        : ready.map((participant) => ({
            id: participant.userId,
            rating: ratings.get(participant.userId) ?? null,
            seedOrder: participant.registeredAt.getTime(),
          }));
      const orderedEntrants = seedEntrants(
        entrants.map((entrant) => ({
          userId: entrant.id,
          rating: entrant.rating,
          seedOrder: entrant.seedOrder,
        })),
      );
      const entrantBySeed = new Map(
        orderedEntrants.map((entrant, index) => [index + 1, entrant.userId]),
      );

      if (isTeamTournament) {
        const teamById = new Map(readyTeams.map((team) => [team.id, team]));
        for (const entrant of orderedEntrants) {
          const seed = orderedEntrants.indexOf(entrant) + 1;
          const team = teamById.get(entrant.userId)!;
          const round =
            entrant.rating === null || entrant.rating === undefined
              ? null
              : Math.round(entrant.rating);
          await this.repository.updateTeam(tx, team.id, { seed, seedRating: round });
          for (const member of membersByTeam.get(team.id) ?? []) {
            await this.repository.updateParticipant(tx, member.participantId, {
              seed,
              seedRating: round,
            });
          }
        }
      } else {
        const seedByUser = new Map(
          orderedEntrants.map((entrant, index) => [entrant.userId, index + 1]),
        );
        for (const participant of ready) {
          await this.repository.updateParticipant(tx, participant.id, {
            seed: seedByUser.get(participant.userId)!,
            seedRating: ratings.get(participant.userId) ?? null,
          });
        }
      }

      const topology = buildTournamentTopology(tournament.format, orderedEntrants.length);
      const rows = this.materializeBracket(
        topology,
        entrantBySeed,
        tournament,
        now,
        isTeamTournament,
      );
      await this.repository.insertMatches(tx, rows);
      await this.repository.updateTournament(tx, tournamentId, {
        status: 'IN_PROGRESS',
        startsAt: now,
      });

      return {
        started: true,
        userIds: participants
          .filter((participant) => participant.status === 'CHECKED_IN')
          .map((participant) => participant.userId),
      };
    });

    if (!outcome?.started) return false;
    // Los byes se resolvieron al escribir; ahora se propaga lo que quedó listo sin jugar.
    await this.advanceBracket(tournamentId, now);
    // La primera ronda no pasa por el avance: sus cruces ya nacieron `READY`, así que
    // las salas se aprovisionan acá.
    const started = await this.requireTournament(tournamentId);
    await this.provisionPendingRooms(started, now);
    await this.notify(
      outcome.userIds,
      {
        type: 'TOURNAMENT_ROUND_STARTED',
        referenceId: tournamentId,
        payload: { tournamentId, round: 1 },
        dedupeKey: `tournament:${tournamentId}:round:1`,
      },
      now,
    );
    return true;
  }

  /**
   * Convierte la topología en filas. Todo cruce cuyos dos lados ya se conocen sin jugar
   * (byes y sus consecuencias) se escribe resuelto en el acto; los demás quedan `READY`
   * con su plazo de presentación, o `SCHEDULED` si todavía esperan un resultado.
   */
  private materializeBracket(
    topology: ReturnType<typeof buildTournamentTopology>,
    entrantBySeed: ReadonlyMap<number, string>,
    tournament: TournamentRow,
    now: Date,
    isTeamTournament = false,
  ): BracketRow[] {
    // Un lado "pendiente" es distinto de un lado vacío. Un pase libre (BYE) es vacío en
    // la topología: el cruce no se juega y el rival avanza sin jugar. Un lado pendiente
    // depende de un cruce que todavía no se jugó: ese cruce NO se puede dar por ganado,
    // porque le regalaría una ronda de ventaja a quien esperaba.
    const seedByKey = new Map<
      string,
      { winner: number | null; loser: number | null; pending: boolean }
    >();
    const rows: BracketRow[] = [];

    const resolve = (source: BracketSource): { seed: number | null; pending: boolean } => {
      if (source.kind === 'SEED') return { seed: source.seed, pending: false };
      if (source.kind === 'EMPTY') return { seed: null, pending: false };
      const referenced = seedByKey.get(source.key);
      if (!referenced) return { seed: null, pending: false };
      // Un cruce cuyo resultado todavía no existe deja pendiente a su destino.
      if (referenced.pending) return { seed: null, pending: true };
      return {
        seed: source.kind === 'WINNER' ? referenced.winner : referenced.loser,
        pending: false,
      };
    };

    for (const match of topology.matches) {
      const homeSide = resolve(match.home);
      const awaySide = resolve(match.away);
      const home = homeSide.seed;
      const away = awaySide.seed;
      const bothPresent = home !== null && away !== null;
      const anyPending = homeSide.pending || awaySide.pending;
      // El pase libre sólo existe cuando un lado es estructuralmente vacío.
      const freeAdvance = bothPresent || anyPending ? null : (home ?? away);
      seedByKey.set(match.key, {
        winner: freeAdvance,
        loser: null,
        // Pendiente si depende de un cruce sin jugar, o si este cruce todavía se juega
        // (ambos presentes): sus destinos tampoco conocen el resultado.
        pending: anyPending || bothPresent,
      });

      // En 2v2 la semilla identifica un equipo, no a una persona: el lado del cruce es
      // el equipo y sus integrantes se resuelven al aprovisionar la mesa.
      const homeEntrant = home !== null ? (entrantBySeed.get(home) ?? null) : null;
      const awayEntrant = away !== null ? (entrantBySeed.get(away) ?? null) : null;
      const winnerEntrant = freeAdvance !== null ? (entrantBySeed.get(freeAdvance) ?? null) : null;
      const homeUserId = isTeamTournament ? null : homeEntrant;
      const awayUserId = isTeamTournament ? null : awayEntrant;
      const winnerUserId = isTeamTournament ? null : winnerEntrant;
      // Nadie avanza con un cruce vacío (los dos lados sin participantes).
      const isEmpty = home === null && away === null;

      rows.push({
        id: generateUuidV7(now.getTime()),
        tournamentId: tournament.id,
        bracket: match.bracket,
        round: match.round,
        slot: match.slot,
        homeUserId,
        awayUserId,
        homeTeamId: isTeamTournament ? homeEntrant : null,
        awayTeamId: isTeamTournament ? awayEntrant : null,
        winnerTeamId: isTeamTournament && !isEmpty ? winnerEntrant : null,
        homeSeed: home,
        awaySeed: away,
        status: bothPresent ? 'READY' : freeAdvance !== null ? 'COMPLETED' : 'SCHEDULED',
        winnerUserId: isEmpty ? null : winnerUserId,
        loserUserId: null,
        startedAt: null,
        completedAt: freeAdvance !== null ? now : null,
        deadlineAt:
          bothPresent && tournament.noShowMinutes > 0
            ? new Date(now.getTime() + tournament.noShowMinutes * 60_000)
            : null,
        createdAt: now,
        updatedAt: now,
      });
    }
    return rows;
  }

  /**
   * Propaga los cruces ya resueltos: escribe el ganador en el cruce siguiente y, cuando
   * ese cruce junta sus dos lados, lo deja `READY` con su plazo. Se detiene sola porque
   * sólo escribe diferenciales.
   */
  /**
   * Aprovisiona las salas de los cruces que quedaron `READY` sin sala y las asocia.
   *
   * Se llama **fuera** de toda transacción del torneo: el repositorio del lobby escribe
   * por el pool y usarlo dentro de una transacción abierta produciría deadlock. Si el
   * aprovisionamiento falla, el cruce queda listo sin sala y el barrido lo reintenta.
   */
  private async provisionPendingRooms(tournament: TournamentRow, now: Date): Promise<void> {
    const isTeam = tournament.mode === '2v2';
    const pending = (await this.repository.listMatches(tournament.id)).filter((match) =>
      isTeam
        ? match.status === 'READY' &&
          match.roomId === null &&
          match.homeTeamId !== null &&
          match.awayTeamId !== null
        : match.status === 'READY' &&
          match.roomId === null &&
          match.homeUserId !== null &&
          match.awayUserId !== null,
    );
    for (const match of pending) {
      const room = await this.provisionMatchRoom({
        tournament,
        match,
        homeUserId: match.homeUserId,
        awayUserId: match.awayUserId,
        now,
      }).catch(() => null);
      if (!room) continue;
      await this.repository.setMatchRoom(match.id, room.roomId);
    }
  }

  /**
   * Aprovisiona la sala de un cruce listo, con el `RuleSet` que el torneo definió.
   *
   * Sin esto el cruce queda `READY` sin `roomId` y nadie puede jugarlo: la pantalla
   * muestra "mi próxima partida" pero no hay a dónde entrar. Se reutiliza la mesa y el
   * aprovisionamiento existentes (M4/M5a) en vez de abrir un camino paralelo de salas.
   *
   * - `isCompetitive = false` siempre (ADR-030).
   * - Sin `practice`: un torneo nunca usa bots.
   * - La sala se borra si la escritura del cruce no llega a confirmarse, para no dejar
   *   mesas huérfanas por un fallo intermedio.
   */
  private async provisionMatchRoom(input: {
    readonly tournament: TournamentRow;
    readonly match: TournamentMatchRow;
    readonly homeUserId: string | null;
    readonly awayUserId: string | null;
    readonly now: Date;
  }): Promise<{ roomId: string }> {
    const ruleset = resolveRuleSetByCode(input.tournament.rulesetCode);
    const rulesetRow = await this.lobbyRepository.ensureRulesetRow(ruleset);

    // Los asientos de la mesa salen del lado del cruce: en 1v1 es una persona por lado;
    // en 2v2 son los integrantes de cada equipo, intercalados (`seat % 2 === team`) como
    // espera el motor con N asientos.
    const seats: Array<{ userId: string; nickname: string; seat: number; team: number }> = [];
    if (input.tournament.mode === '2v2') {
      const teamIds = [input.match.homeTeamId, input.match.awayTeamId].filter(
        (id): id is string => id !== null,
      );
      const members = await this.repository.listTeamMembers(input.tournament.id);
      const roster = members.filter((member) => teamIds.includes(member.teamId));
      const nicknames = await this.repository.nicknamesFor(roster.map((m) => m.userId));
      for (let team = 0 as 0 | 1; team <= 1; team++) {
        const teamId = team === 0 ? input.match.homeTeamId : input.match.awayTeamId;
        const teamMembers = roster.filter((member) => member.teamId === teamId);
        teamMembers.forEach((member, index) => {
          seats.push({
            userId: member.userId,
            nickname: nicknames.get(member.userId) ?? member.nickname,
            seat: seatForTeamMember(team, index),
            team,
          });
        });
      }
    } else {
      const ids = [input.homeUserId, input.awayUserId].filter((id): id is string => id !== null);
      const nicknames = await this.repository.nicknamesFor(ids);
      ids.forEach((userId, index) => {
        seats.push({
          userId,
          nickname: nicknames.get(userId) ?? 'Jugador',
          seat: index,
          team: index,
        });
      });
    }
    if (seats.length === 0) throw new Error('El cruce no tiene jugadores para la mesa.');
    const ownerId = seats[0]!.userId;
    const roomId = generateUuidV7(input.now.getTime());

    await this.lobbyRepository.createTableWithSeatsTx({
      tableId: roomId,
      ownerId,
      mode: input.tournament.mode,
      visibility: 'PRIVATE',
      rulesetId: rulesetRow.id,
      rulesetCode: input.tournament.rulesetCode,
      targetScore: input.tournament.targetScore === 15 ? 15 : 30,
      florEnabled: input.tournament.florEnabled,
      turnTimeoutMs: input.tournament.turnTimeoutMs,
      now: input.now,
      expiresAt: new Date(input.now.getTime() + this.lobbyConfig.tableTtlMs),
      participants: seats,
      isCompetitive: false,
    });

    try {
      await this.provisioner.provisionRoom({
        roomId,
        mode: input.tournament.mode,
        visibility: 'PRIVATE',
        rulesetCode: input.tournament.rulesetCode,
        ruleset: ruleset as unknown as Record<string, unknown>,
        targetScore: input.tournament.targetScore === 15 ? 15 : 30,
        florEnabled: input.tournament.florEnabled,
        turnTimeoutMs: input.tournament.turnTimeoutMs,
      });
    } catch (error) {
      await this.lobbyRepository.rollbackCreatedTable(roomId).catch(() => undefined);
      throw error;
    }
    return { roomId };
  }

  private async advanceBracket(tournamentId: string, now: Date): Promise<void> {
    const ready: Array<{
      match: TournamentMatchRow;
      homeUserId: string | null;
      awayUserId: string | null;
    }> = [];
    // En 2v2 lo que avanza es el equipo, no la persona: el aviso de "partida lista" va
    // a todos los integrantes de los equipos que quedaron en el cruce.
    const readyTeamMembers: string[] = [];
    let lockedTournament: TournamentRow | null = null;
    await this.repository.transaction(async (tx) => {
      const tournament = await this.repository.lockById(tx, tournamentId);
      if (!tournament) return;
      lockedTournament = tournament;
      const matches = await this.repository.lockMatches(tx, tournamentId);
      const participants = await this.repository.listParticipants(tournamentId, tx);
      const isTeam = tournament.mode === '2v2';
      const entrantCount = isTeam
        ? new Set(
            participants
              .filter(
                (participant) =>
                  participant.teamId !== null &&
                  participant.status !== 'WITHDRAWN' &&
                  participant.status !== 'NO_SHOW',
              )
              .map((participant) => participant.teamId),
          ).size
        : countEntrants(tournament, participants);
      if (entrantCount < 2) return;
      // Equipos completos: un equipo con un solo integrante activo no ocupa un lado.
      const membersByTeam = new Map<string, number>();
      if (isTeam) {
        for (const participant of participants) {
          if (participant.teamId === null) continue;
          if (participant.status === 'WITHDRAWN' || participant.status === 'NO_SHOW') continue;
          membersByTeam.set(participant.teamId, (membersByTeam.get(participant.teamId) ?? 0) + 1);
        }
      }

      const topology = buildTournamentTopology(tournament.format, entrantCount);
      const byKey = indexTopology(topology);
      const rowByKey = new Map(
        matches.map((match) => [slotKey(match.bracket, match.round, match.slot), match]),
      );
      // Si la llave guardada no coincide con la reconstruida, no se toca nada: es un
      // torneo que quedó a medio arrancar y lo resuelve el staff desde el panel.
      if (byKey.size !== rowByKey.size) return;

      // La topología está ordenada por dependencias, así que un solo recorrido alcanza
      // para propagar byes en cadena y resultados reales. Se recorren los DESTINOS de
      // cada cruce ya resuelto: a quién recibe su ganador y a quién su perdedor.
      const destinations = matchDestinations(topology);
      for (const match of topology.matches) {
        const source = rowByKey.get(match.key);
        if (!source || source.status !== 'COMPLETED') continue;
        // El ganador del cruce es una persona (1v1) o un equipo (2v2).
        const sourceWinner = isTeam ? source.winnerTeamId : source.winnerUserId;
        const sourceLoser = isTeam ? source.loserTeamId : source.loserUserId;
        if (sourceWinner === null) continue;
        // Un equipo que quedó con un solo integrante activo no puede seguir: su lugar
        // lo toma el rival del cruce anterior ya resuelto (si no hay, no avanza nadie).
        if (isTeam && sourceWinner !== null && (membersByTeam.get(sourceWinner) ?? 0) < 2) {
          const replacement = sourceLoser;
          if (replacement === null) continue;
        }
        const destination = destinations.get(match.key);
        if (!destination) continue;

        const moves = [
          ...(destination.winnerTo
            ? [{ to: destination.winnerTo.key, entrant: sourceWinner }]
            : []),
          ...(destination.loserTo && sourceLoser
            ? [{ to: destination.loserTo.key, entrant: sourceLoser }]
            : []),
        ];
        for (const move of moves) {
          const targetRow = rowByKey.get(move.to);
          if (!targetRow) continue;
          // Un cruce ya cerrado no recibe nada: la llave ya está consistente.
          if (targetRow.status === 'COMPLETED' || targetRow.status === 'FORFEITED') continue;
          const side: 'home' | 'away' = isTeam
            ? targetRow.homeTeamId === null
              ? 'home'
              : 'away'
            : targetRow.homeUserId === null
              ? 'home'
              : 'away';
          // Nunca se pisa un lado ya asignado.
          if (isTeam) {
            if (side === 'away' && targetRow.awayTeamId !== null) continue;
            if (targetRow.homeTeamId === move.entrant || targetRow.awayTeamId === move.entrant)
              continue;
          } else {
            if (side === 'away' && targetRow.awayUserId !== null) continue;
            if (targetRow.homeUserId === move.entrant || targetRow.awayUserId === move.entrant)
              continue;
          }

          const patch: Partial<typeof tournamentMatchesTable.$inferInsert> = isTeam
            ? side === 'home'
              ? { homeTeamId: move.entrant, homeSeed: source.homeSeed ?? null }
              : { awayTeamId: move.entrant, awaySeed: source.homeSeed ?? null }
            : side === 'home'
              ? { homeUserId: move.entrant, homeSeed: source.homeSeed ?? null }
              : { awayUserId: move.entrant, awaySeed: source.homeSeed ?? null };
          const nextHome = isTeam
            ? side === 'home'
              ? move.entrant
              : targetRow.homeTeamId
            : side === 'home'
              ? move.entrant
              : targetRow.homeUserId;
          const nextAway = isTeam
            ? side === 'away'
              ? move.entrant
              : targetRow.awayTeamId
            : side === 'away'
              ? move.entrant
              : targetRow.awayUserId;
          if (nextHome !== null && nextAway !== null) {
            // La sala se aprovisiona DESPUÉS de confirmar la transacción: el
            // repositorio del lobby escribe por el pool y hacerlo acá dentro
            // bloquearía la conexión (el mismo deadlock que ya sufrió este servicio).
            patch.status = 'READY';
            patch.deadlineAt =
              tournament.noShowMinutes > 0
                ? new Date(now.getTime() + tournament.noShowMinutes * 60_000)
                : null;
            // El aviso de "partida lista" va a los integrantes del equipo que juega.
            ready.push({
              match: targetRow,
              homeUserId: isTeam ? null : nextHome,
              awayUserId: isTeam ? null : nextAway,
            });
            if (isTeam) {
              for (const member of participants) {
                if (member.teamId === nextHome || member.teamId === nextAway) {
                  readyTeamMembers.push(member.userId);
                }
              }
            }
          }
          await this.repository.updateMatch(tx, targetRow.id, patch);
          // Se refleja en memoria para que el resto del recorrido vea el cambio.
          rowByKey.set(move.to, {
            ...targetRow,
            homeUserId: isTeam ? targetRow.homeUserId : nextHome,
            awayUserId: isTeam ? targetRow.awayUserId : nextAway,
            homeTeamId: isTeam ? nextHome : targetRow.homeTeamId,
            awayTeamId: isTeam ? nextAway : targetRow.awayTeamId,
            status: patch.status ?? targetRow.status,
          });
        }
      }
    });

    // Se aprovisionan las salas recién después de confirmar y antes de avisar: un aviso
    // de "partida lista" que lleva a una sala inexistente no sirve.
    if (lockedTournament) await this.provisionPendingRooms(lockedTournament, now);

    for (const readyMatch of ready) {
      const recipients =
        readyTeamMembers.length > 0
          ? readyTeamMembers
          : [readyMatch.homeUserId, readyMatch.awayUserId].filter(
              (id): id is string => id !== null,
            );
      if (recipients.length === 0) continue;
      await this.notify(
        recipients,
        {
          type: 'TOURNAMENT_MATCH_READY',
          referenceId: tournamentId,
          payload: {
            tournamentId,
            tournamentMatchId: readyMatch.match.id,
            bracket: readyMatch.match.bracket,
            round: readyMatch.match.round,
          },
          dedupeKey: `tournament:${tournamentId}:match:${readyMatch.match.id}`,
        },
        now,
      );
    }
  }

  /**
   * Define un cruce vencido. Si la partida real ya terminó, gana quien ganó. Si nadie
   * empezó a jugar, se aplica doble incomparecencia: no se inventa un ganador, el cruce
   * se cierra y ningún lado avanza (el cuadro sigue por el otro lado).
   */
  async expireMatch(match: TournamentMatchRow, now = this.now()): Promise<boolean> {
    const before = await this.repository.transaction(async (tx) => {
      const locked = await this.repository.lockMatch(tx, match.id);
      if (!locked) return null;
      if (locked.status !== 'SCHEDULED' && locked.status !== 'READY') return null;
      if (!locked.deadlineAt || locked.deadlineAt.getTime() > now.getTime()) return null;

      // En equipos, el vencimiento se define según quién se presentó completo: si un
      // lado tiene a sus dos integrantes y el otro no, el cruce lo gana el completo; si
      // ninguno completa, se cierra sin ganador.
      if (locked.homeTeamId !== null || locked.awayTeamId !== null) {
        const participants = await this.repository.listParticipants(locked.tournamentId, tx);
        const presenceFor = (teamId: string | null): TeamPresence => {
          if (teamId === null) return { kind: 'ABSENT' };
          const roster = participants.filter(
            (participant) =>
              participant.teamId === teamId &&
              participant.status !== 'WITHDRAWN' &&
              participant.status !== 'NO_SHOW',
          );
          return teamPresence(
            roster.map((participant) => ({ userId: participant.userId, checkedIn: true })),
            '2v2',
          );
        };
        const outcome = walkoverWinner(
          presenceFor(locked.homeTeamId),
          presenceFor(locked.awayTeamId),
        );
        const winnerTeamId =
          outcome === 'HOME' ? locked.homeTeamId : outcome === 'AWAY' ? locked.awayTeamId : null;
        await this.repository.updateMatch(tx, locked.id, {
          status: winnerTeamId ? 'COMPLETED' : 'FORFEITED',
          winnerTeamId,
          loserTeamId: winnerTeamId
            ? winnerTeamId === locked.homeTeamId
              ? locked.awayTeamId
              : locked.homeTeamId
            : null,
          forfeitReason: 'NO_SHOW',
          completedAt: now,
        });
        return {
          id: locked.id,
          tournamentId: locked.tournamentId,
          status: locked.status,
          deadlineAt: locked.deadlineAt,
          winnerSide: winnerTeamId ? outcome : null,
        };
      }
      await this.repository.updateMatch(tx, locked.id, {
        status: 'FORFEITED',
        forfeitReason: 'NO_SHOW',
        completedAt: now,
      });
      return {
        id: locked.id,
        tournamentId: locked.tournamentId,
        status: locked.status,
        deadlineAt: locked.deadlineAt,
        winnerSide: null,
      };
    });
    if (!before) return false;

    // La auditoría se escribe fuera de la transacción: si falla, el cruce ya quedó
    // cerrado y la auditoría se reintenta, pero nunca se bloquea la conexión del torneo.
    await this.auditRepository.record({
      action: 'tournaments.match.forfeited',
      entity: 'tournament_match',
      entityId: before.id,
      reason: 'Nadie se presentó antes del plazo.',
      beforeState: { status: before.status, deadlineAt: before.deadlineAt.toISOString() },
      afterState: { status: 'FORFEITED', forfeitReason: 'NO_SHOW' },
      now,
    });
    // Un cruce que se define por incomparecencia también mueve la llave: si hubo un lado
    // completo, avanza; si no hubo, el cuadro sigue por el otro lado. En 1v1 no hubo
    // ganador que propagar y no hace falta recorrer.
    if (before.winnerSide !== null) {
      await this.advanceBracket(before.tournamentId, now);
      await this.finishIfDecided(before.tournamentId, now);
    }
    return true;
  }

  /**
   * Registra el resultado de una partida de torneo y avanza la llave.
   *
   * Idempotencia: el cruce se lee y escribe bajo `FOR UPDATE`; si ya está cerrado por la
   * misma partida, no se hace nada. `(tournament, resolved_from_match_id)` es único en la
   * base, así que dos procesos no pueden aplicar dos veces el mismo resultado.
   */
  async completeMatchByGame(input: {
    readonly tournamentMatchId: string;
    readonly matchId: string;
    readonly winnerUserId: string;
    readonly now?: Date;
  }): Promise<boolean> {
    const now = input.now ?? this.now();
    const appliedTournamentId = await this.repository.transaction(async (tx) => {
      const locked = await this.repository.lockMatch(tx, input.tournamentMatchId);
      if (!locked) return false;
      if (locked.resolvedFromMatchId === input.matchId) return false;
      if (locked.status === 'COMPLETED' || locked.status === 'FORFEITED') return false;
      const winnerIsPlayer =
        locked.homeUserId === input.winnerUserId || locked.awayUserId === input.winnerUserId;
      if (!winnerIsPlayer) return false;

      const loserUserId =
        locked.homeUserId === input.winnerUserId ? locked.awayUserId : locked.homeUserId;
      await this.repository.updateMatch(tx, locked.id, {
        status: 'COMPLETED',
        winnerUserId: input.winnerUserId,
        loserUserId,
        matchId: input.matchId,
        resolvedFromMatchId: input.matchId,
        completedAt: now,
      });
      await tx
        .update(tournamentParticipantsTable)
        .set({ status: 'ELIMINATED' })
        .where(
          and(
            eq(tournamentParticipantsTable.tournamentId, locked.tournamentId),
            eq(tournamentParticipantsTable.userId, loserUserId ?? ''),
          ),
        );
      return locked.tournamentId;
    });

    if (!appliedTournamentId) return false;
    await this.advanceBracket(appliedTournamentId, now);
    await this.finishIfDecided(appliedTournamentId, now);
    return true;
  }

  /**
   * Cierra el cruce de torneo que corresponde a una sala, a partir del resultado real de la
   * partida. Es el puente entre `match.completed` y la llave.
   *
   * Devuelve `false` sin tocar nada si la sala no es de un torneo, si el cruce ya estaba
   * cerrado o si el ganador no es uno de los dos jugadores del cruce. El avance queda
   * idempotente por `matchId` a través de `completeMatchByGame`.
   */
  async completeByRoom(input: {
    readonly roomId: string;
    readonly matchId: string;
    readonly winnerTeam: number;
    readonly endedAt: Date;
  }): Promise<boolean> {
    const match = await this.repository.findMatchByRoomId(input.roomId);
    if (!match) return false;
    if (match.status !== 'READY' && match.status !== 'IN_PROGRESS') return false;

    const tournament = await this.repository.findById(match.tournamentId);
    if (!tournament) return false;

    if (tournament.mode === '2v2') {
      // En 2v2 el resultado de la mesa es del equipo (0 = local, 1 = visitante), el
      // mismo reparto de asientos que armó el aprovisionamiento. Los dos integrantes
      // del equipo ganador avanzan y cobran; el equipo perdedor queda eliminado.
      const winnerTeamId = input.winnerTeam === 0 ? match.homeTeamId : match.awayTeamId;
      if (!winnerTeamId) return false;
      return this.completeTeamMatch({
        tournamentMatchId: match.id,
        matchId: input.matchId,
        winnerTeamId,
        now: input.endedAt,
      });
    }

    // El equipo 0 es el local del cruce y el 1 el visitante: es cómo se armaron los
    // asientos al aprovisionar la sala.
    const winnerUserId = input.winnerTeam === 0 ? match.homeUserId : match.awayUserId;
    if (!winnerUserId) return false;
    return this.completeMatchByGame({
      tournamentMatchId: match.id,
      matchId: input.matchId,
      winnerUserId,
      now: input.endedAt,
    });
  }

  /**
   * Cierra un cruce de equipos con el resultado de la mesa.
   *
   * Es el equivalente de `completeMatchByGame` cuando lo que avanza es un equipo. La
   * idempotencia es la misma: `resolvedFromMatchId` con único `(torneo, partida)`.
   */
  async completeTeamMatch(input: {
    readonly tournamentMatchId: string;
    readonly matchId: string;
    readonly winnerTeamId: string;
    readonly now?: Date;
  }): Promise<boolean> {
    const now = input.now ?? this.now();
    const applied = await this.repository.transaction(async (tx) => {
      const locked = await this.repository.lockMatch(tx, input.tournamentMatchId);
      if (!locked) return null;
      if (locked.resolvedFromMatchId === input.matchId) return null;
      if (locked.status === 'COMPLETED' || locked.status === 'FORFEITED') return null;
      const winnerTeamId =
        locked.homeTeamId === input.winnerTeamId
          ? locked.homeTeamId
          : locked.awayTeamId === input.winnerTeamId
            ? locked.awayTeamId
            : null;
      if (!winnerTeamId) return null;
      const loserTeamId =
        winnerTeamId === locked.homeTeamId ? locked.awayTeamId : locked.homeTeamId;
      await this.repository.updateMatch(tx, locked.id, {
        status: 'COMPLETED',
        winnerTeamId,
        loserTeamId,
        matchId: input.matchId,
        resolvedFromMatchId: input.matchId,
        homePresentAt: locked.homePresentAt ?? now,
        awayPresentAt: locked.awayPresentAt ?? now,
        startedAt: locked.startedAt ?? now,
        completedAt: now,
      });
      return { tournamentId: locked.tournamentId, loserTeamId };
    });
    if (!applied) return false;

    // El equipo perdedor queda eliminado para cada integrante (estadística y tabla).
    if (applied.loserTeamId) {
      await this.repository
        .markTeamEliminated(applied.tournamentId, applied.loserTeamId)
        .catch(() => undefined);
    }
    await this.advanceBracket(applied.tournamentId, now);
    await this.finishIfDecided(applied.tournamentId, now);
    return true;
  }

  /** Si ya no quedan cruces pendientes, el torneo termina y se pagan los premios. */
  private async finishIfDecided(tournamentId: string, now: Date): Promise<void> {
    const tournament = await this.repository.findById(tournamentId);
    if (!tournament || tournament.status !== 'IN_PROGRESS') return;

    const pending = await this.repository.countPendingMatches(tournament.id);
    if (pending > 0) return;

    const standings = await this.standingsFor(tournament);
    // La posición 1 no es sinónimo de campeón: una final cerrada por incomparecencia
    // (doble ausencia) deja el cuadro completo sin que nadie haya ganado. En ese caso
    // no se corona a nadie y `payout` no paga premios inventados.
    const matches = await this.repository.listMatches(tournament.id);
    const championTeamId =
      tournament.mode === '2v2' ? finalWinnerTeam(tournament.format, matches) : null;
    const championUserId =
      tournament.mode === '2v2' ? null : finalWinner(tournament.format, matches);
    const champion = championUserId
      ? standings.find((standing) => standing.userId === championUserId)
      : undefined;
    const hasChampion =
      tournament.mode === '2v2' ? championTeamId !== null : champion !== undefined;
    await this.repository.transaction(async (tx) => {
      const locked = await this.repository.lockById(tx, tournament.id);
      if (!locked || locked.status !== 'IN_PROGRESS') return;
      if (hasChampion && championTeamId !== null) {
        // En equipos el título es de todo el equipo: cada integrante queda WINNER.
        await tx
          .update(tournamentParticipantsTable)
          .set({ status: 'WINNER' })
          .where(
            and(
              eq(tournamentParticipantsTable.tournamentId, tournament.id),
              eq(tournamentParticipantsTable.teamId, championTeamId),
            ),
          );
      } else if (champion) {
        await tx
          .update(tournamentParticipantsTable)
          .set({ status: 'WINNER' })
          .where(
            and(
              eq(tournamentParticipantsTable.tournamentId, tournament.id),
              eq(tournamentParticipantsTable.userId, champion.userId),
            ),
          );
      }
      await this.repository.updateTournament(tx, tournament.id, {
        status: 'FINISHED',
        finishedAt: now,
      });
    });

    await this.payout(tournament.id, now);
  }

  // ---------------------------------------------------------------- premios

  /**
   * Entrega los premios una sola vez por torneo y posición.
   *
   * - `tournament_awards` tiene único `(torneo, posición)`: si ya se entregó, no se repite.
   * - El asiento contable usa `idempotencyKey = tournament:<id>:prize:<posición>`, así que
   *   un reintento tampoco duplica monedas en el libro mayor.
   * - Los premios en monedas usan `MISSION_REWARD` (asiento positivo). No existe una
   *   categoría de "premio en dinero" y el `CHECK` del libro mayor acepta sólo esas.
   */
  async payout(tournamentId: string, now = this.now()): Promise<number> {
    const tournament = await this.repository.findById(tournamentId);
    if (!tournament || tournament.status !== 'FINISHED') return 0;
    const [prizes, standings, matches] = await Promise.all([
      this.repository.listPrizes([tournamentId]),
      this.standingsFor(tournament),
      this.repository.listMatches(tournamentId),
    ]);
    // Un torneo puede terminar sin campeón (final cerrada por incomparecencia de ambos
    // lados). Sin ganador no se paga: la posición en la tabla no es un título.
    const championExists =
      tournament.mode === '2v2'
        ? finalWinnerTeam(tournament.format, matches) !== null
        : finalWinner(tournament.format, matches) !== null;
    if (!championExists) return 0;
    let awarded = 0;

    // En 2v2 la posición premiada es de un equipo y la cobra cada integrante: el asiento
    // contable sigue siendo por persona, con su propia clave idempotente.
    const teams = tournament.mode === '2v2' ? await this.repository.listTeams(tournamentId) : [];
    const members =
      tournament.mode === '2v2' ? await this.repository.listTeamMembers(tournamentId) : [];
    const memberIdsByStandingName = new Map<string, string[]>();
    for (const team of teams) {
      memberIdsByStandingName.set(
        team.name,
        members.filter((member) => member.teamId === team.id).map((member) => member.userId),
      );
    }
    const teamIdByStandingName = new Map(teams.map((team) => [team.name, team.id]));

    for (const prize of prizes) {
      const recipient = standings[prize.position - 1];
      if (!recipient) continue;
      const teamMemberIds = memberIdsByStandingName.get(recipient.nickname);
      if (teamMemberIds) {
        for (const memberId of teamMemberIds) {
          awarded += await this.awardToUser({
            tournamentId,
            userId: memberId,
            position: prize.position,
            coins: prize.coins,
            cosmeticId: prize.cosmeticId,
            teamId: teamIdByStandingName.get(recipient.nickname) ?? null,
            now,
          });
        }
        continue;
      }
      awarded += await this.awardToUser({
        tournamentId,
        userId: recipient.userId,
        position: prize.position,
        coins: prize.coins,
        cosmeticId: prize.cosmeticId,
        teamId: null,
        now,
      });
    }
    return awarded;
  }

  /**
   * Entrega un premio a una persona, una sola vez. Devuelve 1 si acreditó y 0 si ya
   * estaba entregado (la clave idempotente y el único `(torneo, posición, persona)`).
   */
  private async awardToUser(input: {
    readonly tournamentId: string;
    readonly userId: string;
    readonly position: number;
    readonly coins: number;
    readonly cosmeticId: string | null;
    readonly teamId: string | null;
    readonly now: Date;
  }): Promise<number> {
    const delivered = await this.repository.transaction(async (tx) => {
      const award = await this.repository.insertAward(tx, {
        id: generateUuidV7(input.now.getTime()),
        tournamentId: input.tournamentId,
        userId: input.userId,
        position: input.position,
        teamId: input.teamId,
        coins: input.coins,
        cosmeticId: input.cosmeticId,
        awardedAt: input.now,
      });
      // Ya existía: la entrega es idempotente y no se vuelve a acreditar.
      if (!award) return false;

      const transactionId = await this.creditPrize(tx, {
        tournamentId: input.tournamentId,
        userId: input.userId,
        position: input.position,
        coins: input.coins,
        cosmeticId: input.cosmeticId,
        now: input.now,
      });
      if (transactionId) await this.repository.setAwardTransaction(tx, award.id, transactionId);
      return true;
    });
    return delivered ? 1 : 0;
  }

  private async creditPrize(
    tx: AppTransaction,
    input: {
      readonly tournamentId: string;
      readonly userId: string;
      readonly position: number;
      readonly coins: number;
      readonly cosmeticId: string | null;
      readonly now: Date;
    },
  ): Promise<string | null> {
    if (input.coins <= 0) {
      // Los premios sólo de cosmético se entregan igual: quedan en `tournament_awards`.
      return null;
    }
    await tx
      .insert(walletAccountsTable)
      .values({
        userId: input.userId,
        currencyType: 'VIRTUAL_COIN',
        hasEconomicValue: false,
        playerTransfersEnabled: false,
      })
      .onConflictDoNothing({ target: walletAccountsTable.userId });
    // Se bloquea la cuenta para que el saldo no se lea viejo en un crédito concurrente.
    await tx
      .select({ userId: walletAccountsTable.userId })
      .from(walletAccountsTable)
      .where(eq(walletAccountsTable.userId, input.userId))
      .for('update')
      .limit(1);

    const idempotencyKey = `tournament:${input.tournamentId}:prize:${input.position}`;
    const transactionId = generateUuidV7(input.now.getTime());
    const [inserted] = await tx
      .insert(walletTransactionsTable)
      .values({
        id: transactionId,
        userId: input.userId,
        amount: input.coins,
        kind: 'MISSION_REWARD',
        idempotencyKey,
        referenceType: 'tournament',
        referenceId: input.tournamentId,
        metadata: { position: input.position, symbolic: true },
        createdAt: input.now,
      })
      .onConflictDoNothing({
        target: [walletTransactionsTable.userId, walletTransactionsTable.idempotencyKey],
      })
      .returning({ id: walletTransactionsTable.id });

    if (!inserted) return null;
    if (input.cosmeticId) {
      await tx
        .insert(userCosmeticsTable)
        .values({
          userId: input.userId,
          cosmeticId: input.cosmeticId,
          transactionId: inserted.id,
          acquiredAt: input.now,
        })
        .onConflictDoNothing();
    }
    return inserted.id;
  }

  // ------------------------------------------------------------------ admin

  /** Cancelación administrativa con motivo obligatorio y auditoría. */
  async cancel(
    principal: AdminPrincipal,
    tournamentId: string,
    body: { readonly reason: string },
    meta: { readonly ip: string },
  ): Promise<void> {
    const now = this.now();
    await this.repository.transaction(async (tx) => {
      const tournament = await this.repository.lockById(tx, tournamentId);
      if (!tournament) {
        throw new DomainApiException(404, 'NOT_FOUND', 'No encontramos ese torneo.');
      }
      if (!canTransitionTournament(tournament.status, 'CANCELLED')) {
        throw new DomainApiException(409, 'CONFLICT', 'Ese torneo ya no se puede cancelar.', {
          reason: 'INVALID_TRANSITION',
          from: tournament.status,
        });
      }
      await this.repository.updateTournament(tx, tournamentId, {
        status: 'CANCELLED',
        cancelledAt: now,
        cancelledReason: body.reason,
        finishedAt: now,
      });
    });
    await this.auditRepository.record({
      actorId: principal.userId,
      adminSessionId: principal.sessionId,
      action: 'tournaments.cancelled',
      entity: 'tournament',
      entityId: tournamentId,
      reason: body.reason,
      ip: meta.ip,
      now,
    });
  }

  /**
   * Resuelve una incidencia sobre un cruce: define el ganador a mano (o lo deja sin
   * ganador) con motivo. Exige staff y deja auditoría con el estado anterior.
   */
  async resolveIncident(
    principal: AdminPrincipal,
    tournamentId: string,
    body: {
      readonly matchId: string;
      readonly winnerUserId: string | null;
      readonly reason: string;
    },
    meta: { readonly ip: string },
  ): Promise<void> {
    const now = this.now();
    const before = await this.repository.transaction(async (tx) => {
      const match = await this.repository.lockMatch(tx, body.matchId);
      if (!match || match.tournamentId !== tournamentId) {
        throw new DomainApiException(404, 'NOT_FOUND', 'No encontramos ese cruce en el torneo.');
      }
      if (match.status === 'COMPLETED' || match.status === 'FORFEITED') {
        throw new DomainApiException(409, 'CONFLICT', 'Ese cruce ya está cerrado.', {
          reason: 'MATCH_ALREADY_RESOLVED',
        });
      }
      if (
        body.winnerUserId !== null &&
        body.winnerUserId !== match.homeUserId &&
        body.winnerUserId !== match.awayUserId
      ) {
        throw new DomainApiException(400, 'VALIDATION_ERROR', 'El ganador no juega ese cruce.', {
          reason: 'WINNER_NOT_IN_MATCH',
        });
      }
      const loserUserId =
        body.winnerUserId === null
          ? null
          : body.winnerUserId === match.homeUserId
            ? match.awayUserId
            : match.homeUserId;
      await this.repository.updateMatch(tx, match.id, {
        status: body.winnerUserId === null ? 'FORFEITED' : 'COMPLETED',
        winnerUserId: body.winnerUserId,
        loserUserId,
        forfeitReason: body.winnerUserId === null ? 'DISQUALIFIED' : null,
        completedAt: now,
      });
      return { status: match.status, homeUserId: match.homeUserId, awayUserId: match.awayUserId };
    });

    await this.auditRepository.record({
      actorId: principal.userId,
      adminSessionId: principal.sessionId,
      action: 'tournaments.match.resolved',
      entity: 'tournament_match',
      entityId: body.matchId,
      reason: body.reason,
      beforeState: before,
      afterState: { winnerUserId: body.winnerUserId },
      ip: meta.ip,
      now,
    });

    await this.advanceBracket(tournamentId, now);
    await this.finishIfDecided(tournamentId, now);
  }

  /** Avance manual de la ronda: empuja los resultados ya cargados y cierra si terminó. */
  async forceAdvance(
    principal: AdminPrincipal,
    tournamentId: string,
    body: { readonly reason: string },
    meta: { readonly ip: string },
  ): Promise<void> {
    const now = this.now();
    await this.advanceBracket(tournamentId, now);
    await this.finishIfDecided(tournamentId, now);
    await this.auditRepository.record({
      actorId: principal.userId,
      adminSessionId: principal.sessionId,
      action: 'tournaments.advanced',
      entity: 'tournament',
      entityId: tournamentId,
      reason: body.reason,
      ip: meta.ip,
      now,
    });
  }

  // ---------------------------------------------------------------- helpers

  /** Orden de posiciones, con apodo, para la tabla y para repartir premios. */
  async standingsFor(tournament: TournamentRow): Promise<TournamentStanding[]> {
    const [participants, matches] = await Promise.all([
      this.repository.listParticipants(tournament.id),
      this.repository.listMatches(tournament.id),
    ]);
    const names = await this.repository.nicknamesFor(
      participants.map((participant) => participant.userId),
    );
    if (tournament.mode !== '2v2') return buildStandings(tournament, participants, matches, names);
    // En equipos la tabla es por equipo: la posición la ocupa el equipo y cada
    // integrante ve la misma fila, con el nombre del equipo y sus integrantes.
    const [teams, members] = await Promise.all([
      this.repository.listTeams(tournament.id),
      this.repository.listTeamMembers(tournament.id),
    ]);
    return buildTeamStandings(tournament, teams, members, participants, matches, names);
  }

  private async requireTournament(id: string): Promise<TournamentRow> {
    const row = await this.repository.findById(id);
    if (!row) {
      throw new DomainApiException(404, 'NOT_FOUND', 'No encontramos ese torneo.', {
        reason: 'TOURNAMENT_NOT_FOUND',
      });
    }
    return row;
  }

  private async consumeLimit(key: string, max: number): Promise<void> {
    const result = await this.rateLimitStore.consumeWindow(key, max, this.config.rateLimitWindowMs);
    if (!result.allowed) {
      throw new DomainApiException(
        429,
        'RATE_LIMITED',
        'Demasiadas acciones de torneo seguidas. Esperá un momento e intentá de nuevo.',
        { retryAfterMs: result.retryAfterMs },
      );
    }
  }

  private async notify(
    userIds: readonly string[],
    notification: {
      readonly type: 'TOURNAMENT_ROUND_STARTED' | 'TOURNAMENT_MATCH_READY';
      readonly referenceId: string;
      readonly payload: Record<string, unknown>;
      /**
       * Identificador del aviso dentro del lote y del usuario. La base tiene único
       * `(usuario, tipo, reference_id)`, así que un aviso de ronda sólo se guarda una vez
       * por torneo y uno de cruce una vez por cruce: `notify` es idempotente.
       */
      readonly dedupeKey: string;
    },
    now: Date,
  ): Promise<void> {
    for (const userId of new Set(userIds)) {
      const id = generateUuidV7(now.getTime());
      const [inserted] = await this.repository.database
        .insert(socialNotificationsTable)
        .values({
          id,
          userId,
          type: notification.type,
          referenceId: notification.referenceId,
          payload: { ...notification.payload, dedupeKey: notification.dedupeKey },
          createdAt: now,
        })
        .onConflictDoNothing()
        .returning({ id: socialNotificationsTable.id });
      if (!inserted) continue;
      this.realtime.emitSocialNotification(userId, {
        id,
        type: notification.type,
        actorUserId: null,
        actorNickname: null,
        referenceId: notification.referenceId,
        tableId: null,
        createdAt: now.toISOString(),
        readAt: null,
      });
    }
  }
}

export interface CreateInput {
  readonly name: string;
  readonly format: TournamentFormat;
  readonly visibility: 'OFFICIAL' | 'PRIVATE';
  readonly capacity: number;
  readonly rules: {
    readonly mode: '1v1' | '2v2';
    readonly rulesetCode: string;
    readonly targetScore: number;
    readonly florEnabled: boolean;
    readonly turnTimeoutMs: number;
  };
  readonly registrationMinutes: number;
  readonly checkInMinutes: number;
  readonly noShowMinutes: number;
  readonly prizes: readonly { position: number; coins: number; cosmeticId: string | null }[];
  readonly official: boolean;
}

type PrizeRow = Awaited<ReturnType<TournamentsRepository['listPrizes']>>[number];

type BracketSource = ReturnType<typeof buildTournamentTopology>['matches'][number]['home'];
type BracketRow = typeof tournamentMatchesTable.$inferInsert;

function isStaff(role: string): boolean {
  return role === 'ADMIN' || role === 'MODERATOR';
}

function slotKey(bracket: string, round: number, slot: number): string {
  return `${bracket}-R${round}-S${slot}`;
}

function encodeCursor(row: TournamentRow): string {
  return Buffer.from(`${row.createdAt.toISOString()}|${row.id}`, 'utf8').toString('base64url');
}

function decodeCursor(cursor: string | null): { createdAt: Date; id: string } | null {
  if (!cursor) return null;
  try {
    const [createdAt, id] = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
    const parsed = new Date(createdAt!);
    if (Number.isNaN(parsed.getTime()) || !id) return null;
    return { createdAt: parsed, id };
  } catch {
    return null;
  }
}

/**
 * Cantidad de participantes que jugaron la llave, deducida de las filas. Es la misma
 * cifra que se congeló al arrancar, así que la topología se reconstruye idéntica.
 */
/**
 * Cuántos jugadores tiene el cuadro. No se puede deducir del mayor sembrado escrito en
 * los cruces: una fila con pase libre no guarda semilla del lado vacío, y un participante
 * que espera su turno todavía no aparece en ningún cruce. Si se usara esa cuenta, al
 * propagar un bye el cuadro se reconstruía con menos jugadores y la topología no
 * coincidía, así que el avance siguiente no encontraba destinos y la llave se congelaba.
 *
 * La cantidad real es la de los participantes que llegaron al cuadro (todos los que no se
 * retiraron ni faltaron al check-in), acotada por el cupo.
 */
function countEntrants(tournament: TournamentRow, participants: readonly ParticipantRow[]): number {
  const inBracket = participants.filter(
    (participant) => participant.status !== 'WITHDRAWN' && participant.status !== 'NO_SHOW',
  ).length;
  return inBracket > 0 ? Math.min(inBracket, tournament.capacity) : tournament.capacity;
}

/**
 * El último cruce del cuadro: la final. En eliminación doble es la `GRAND_FINAL`; en
 * simple, el último cruce de la llave de ganadores.
 */
function lastMatchOfBracket(
  format: TournamentFormat,
  matches: readonly TournamentMatchRow[],
): TournamentMatchRow | undefined {
  if (format === 'DOUBLE_ELIMINATION') {
    return matches.filter((match) => match.bracket === 'GRAND_FINAL').at(-1);
  }
  const lastRound = Math.max(...matches.map((match) => match.round));
  return matches.filter((match) => match.bracket === 'WINNERS' && match.round === lastRound).at(-1);
}

/**
 * Campeón del torneo, o `null` si todavía no hay uno.
 *
 * Es la única fuente para coronar, para la tabla y para pagar premios: un torneo que
 * termina con la final cerrada por incomparecencia de ambos lados no tiene campeón, y
 * ese caso pagaba los premios al primero de la tabla como si hubiera ganado.
 */
function finalWinner(
  format: TournamentFormat,
  matches: readonly TournamentMatchRow[],
): string | null {
  const finalMatch = lastMatchOfBracket(format, matches);
  if (!finalMatch || finalMatch.status !== 'COMPLETED') return null;
  return finalMatch.winnerUserId ?? null;
}

/**
 * Equipo campeón, o `null`. Es el equivalente de `finalWinner` en torneos por equipos:
 * ahí el cruce corona a un equipo (`winnerTeamId`), no a una persona.
 */
function finalWinnerTeam(
  format: TournamentFormat,
  matches: readonly TournamentMatchRow[],
): string | null {
  const finalMatch = lastMatchOfBracket(format, matches);
  if (!finalMatch || finalMatch.status !== 'COMPLETED') return null;
  return finalMatch.winnerTeamId ?? null;
}

/**
 * Tabla de posiciones de un torneo por equipos.
 *
 * Mismo desempate que en 1v1, aplicado al equipo: campeón, subcampeón, quien cayó más
 * tarde y, a igual ronda, la mejor siembra. La fila la ocupa el equipo y se identifica
 * por su nombre; cada integrante ve la misma posición.
 */
function buildTeamStandings(
  tournament: TournamentRow,
  teams: readonly TeamRow[],
  members: readonly TeamMemberRow[],
  participants: readonly ParticipantRow[],
  matches: readonly TournamentMatchRow[],
  nicknames: ReadonlyMap<string, string>,
): TournamentStanding[] {
  const finalMatch = lastMatchOfBracket(tournament.format, matches);
  const championTeamId =
    finalMatch?.status === 'COMPLETED' ? (finalMatch.winnerTeamId ?? null) : null;
  const runnerUpTeamId = championTeamId === null ? null : (finalMatch?.loserTeamId ?? null);

  const lastLossRound = new Map<string, number>();
  for (const match of matches) {
    if (match.loserTeamId === null) continue;
    if (match.status !== 'COMPLETED' && match.status !== 'FORFEITED') continue;
    const previous = lastLossRound.get(match.loserTeamId) ?? 0;
    lastLossRound.set(match.loserTeamId, Math.max(previous, match.round));
  }

  const membersOf = (teamId: string): TeamMemberRow[] =>
    members.filter((member) => member.teamId === teamId);
  // Un equipo sin integrantes activos (todos ausentes o retirados) no ocupa una fila.
  const visible = teams.filter((team) =>
    membersOf(team.id).some(
      (member) =>
        member.status !== 'WITHDRAWN' &&
        member.status !== 'NO_SHOW' &&
        participants.some(
          (participant) => participant.userId === member.userId && participant.teamId === team.id,
        ),
    ),
  );

  const ordered = [...visible].sort((a, b) => {
    if (a.id === championTeamId) return -1;
    if (b.id === championTeamId) return 1;
    if (a.id === runnerUpTeamId) return -1;
    if (b.id === runnerUpTeamId) return 1;
    const roundA = lastLossRound.get(a.id) ?? Number.POSITIVE_INFINITY;
    const roundB = lastLossRound.get(b.id) ?? Number.POSITIVE_INFINITY;
    if (roundA !== roundB) return roundB - roundA;
    return (a.seed ?? 99) - (b.seed ?? 99);
  });

  const hasBracket = matches.length > 0;
  return ordered.map((team, index) => {
    const lossRound = lastLossRound.get(team.id) ?? null;
    const roster = membersOf(team.id)
      .map((member) => nicknames.get(member.userId) ?? 'Jugador')
      .join(' y ');
    const tiebreakNote = !hasBracket
      ? 'Inscripción'
      : team.id === championTeamId
        ? 'Campeón'
        : team.id === runnerUpTeamId
          ? 'Subcampeón'
          : lossRound !== null
            ? `Cayó en la ronda ${lossRound}`
            : 'Sigue en carrera';
    return {
      position: index + 1,
      // La fila la ocupa el capitán como referencia estable del equipo; el nombre visible
      // es el del equipo y `nickname` lleva los integrantes para mostrarlos igual.
      userId: team.captainUserId,
      nickname: team.name,
      seed: team.seed,
      eliminationRound: lossRound,
      tiebreakNote: tiebreakNote === 'Campeón' ? `Campeón — ${roster}` : tiebreakNote,
    };
  });
}

/**
 * Tabla de posiciones con el desempate documentado (ver `docs/RULES.md` § Torneos):
 * 1.º campeón, 2.º subcampeón (perdedor de la final) y después quien cayó más tarde;
 * a igual ronda manda la mejor semilla. Antes de que haya llave, orden de inscripción.
 *
 * Se calcula con los resultados REALES de los cruces, nunca con una simulación: si el
 * staff resuelve una incidencia a mano, la tabla lo refleja igual que el cuadro.
 */
function buildStandings(
  tournament: TournamentRow,
  participants: readonly ParticipantRow[],
  matches: readonly TournamentMatchRow[],
  nicknames: ReadonlyMap<string, string>,
): TournamentStanding[] {
  const visible = participants.filter(
    (participant) => participant.status !== 'WITHDRAWN' && participant.status !== 'NO_SHOW',
  );
  const name = (userId: string): string => nicknames.get(userId) ?? 'Jugador';

  const finalMatch = lastMatchOfBracket(tournament.format, matches);
  // Sólo un cruce final GANADO corona: cerrado por incomparecencia de ambos lados no
  // deja campeón (y por lo tanto tampoco subcampeón).
  const championUserId = finalWinner(tournament.format, matches);
  const runnerUpUserId = championUserId === null ? null : (finalMatch?.loserUserId ?? null);

  // Ronda de la última derrota de cada jugador: quien cayó más tarde quedó mejor.
  const lastLossRound = new Map<string, number>();
  for (const match of matches) {
    if (match.loserUserId === null) continue;
    if (match.status !== 'COMPLETED' && match.status !== 'FORFEITED') continue;
    const previous = lastLossRound.get(match.loserUserId) ?? 0;
    lastLossRound.set(match.loserUserId, Math.max(previous, match.round));
  }
  const seedOf = new Map(
    visible.map((participant, index) => [participant.userId, participant.seed ?? index + 1]),
  );

  const ordered = [...visible].sort((a, b) => {
    if (a.userId === championUserId) return -1;
    if (b.userId === championUserId) return 1;
    if (a.userId === runnerUpUserId) return -1;
    if (b.userId === runnerUpUserId) return 1;
    const roundA = lastLossRound.get(a.userId) ?? Number.POSITIVE_INFINITY;
    const roundB = lastLossRound.get(b.userId) ?? Number.POSITIVE_INFINITY;
    if (roundA !== roundB) return roundB - roundA;
    return (seedOf.get(a.userId) ?? 99) - (seedOf.get(b.userId) ?? 99);
  });

  const hasBracket = matches.length > 0;
  return ordered.map((participant, index) => {
    const lossRound = lastLossRound.get(participant.userId) ?? null;
    // Nunca se dice que alguien "cayó" si todavía no perdió: en un cuadro en juego la
    // tabla muestra quién sigue en carrera, no una eliminación inventada.
    const tiebreakNote = !hasBracket
      ? 'Inscripción'
      : participant.userId === championUserId
        ? 'Campeón'
        : participant.userId === runnerUpUserId
          ? 'Subcampeón'
          : lossRound !== null
            ? `Cayó en la ronda ${lossRound}`
            : 'Sigue en carrera';
    return {
      position: index + 1,
      userId: participant.userId,
      nickname: name(participant.userId),
      seed: participant.seed,
      eliminationRound: lossRound,
      tiebreakNote,
    };
  });
}
