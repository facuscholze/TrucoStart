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

    const matchViews = matches.map((match) => this.toMatchView(match, nicknames));
    const now = this.now();
    const summary = await this.toSummary(row, viewerUserId, { participants, prizes });

    return {
      tournament: summary,
      participants: participantViews,
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
  ): TournamentMatchView {
    return {
      id: match.id,
      round: match.round,
      slot: match.slot,
      bracket: match.bracket,
      status: match.status,
      homeNickname: match.homeUserId ? (nicknames.get(match.homeUserId) ?? 'Jugador') : null,
      awayNickname: match.awayUserId ? (nicknames.get(match.awayUserId) ?? 'Jugador') : null,
      homeUserId: match.homeUserId,
      awayUserId: match.awayUserId,
      winnerUserId: match.winnerUserId,
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
      return {
        match: this.toMatchView(pending, nicknames),
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
      const ready = participants.filter((participant) => participant.status === 'CHECKED_IN');
      if (ready.length < 2) {
        await this.repository.updateTournament(tx, tournamentId, {
          status: 'CANCELLED',
          cancelledAt: now,
          cancelledReason: 'No hubo suficientes jugadores con check-in para armar la llave.',
          finishedAt: now,
        });
        return { started: false, userIds: [] as string[] };
      }

      const ratings = await this.repository.ratingsFor(
        ready.map((participant) => participant.userId),
        tournament.mode,
        tx,
      );
      const ordered = seedEntrants(
        ready.map((participant) => ({
          userId: participant.userId,
          rating: ratings.get(participant.userId) ?? null,
          seedOrder: participant.registeredAt.getTime(),
        })),
      );
      const seedByUser = new Map(ordered.map((entrant, index) => [entrant.userId, index + 1]));
      const userBySeed = new Map(ordered.map((entrant, index) => [index + 1, entrant.userId]));
      for (const participant of ready) {
        await this.repository.updateParticipant(tx, participant.id, {
          seed: seedByUser.get(participant.userId)!,
          seedRating: ratings.get(participant.userId) ?? null,
        });
      }

      const topology = buildTournamentTopology(tournament.format, ordered.length);
      const rows = this.materializeBracket(topology, userBySeed, tournament, now);
      await this.repository.insertMatches(tx, rows);
      await this.repository.updateTournament(tx, tournamentId, {
        status: 'IN_PROGRESS',
        startsAt: now,
      });

      return { started: true, userIds: ready.map((participant) => participant.userId) };
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
    userBySeed: ReadonlyMap<number, string>,
    tournament: TournamentRow,
    now: Date,
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

      const homeUserId = home !== null ? (userBySeed.get(home) ?? null) : null;
      const awayUserId = away !== null ? (userBySeed.get(away) ?? null) : null;
      const winnerUserId = freeAdvance !== null ? (userBySeed.get(freeAdvance) ?? null) : null;
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
    const pending = (await this.repository.listMatches(tournament.id)).filter(
      (match) =>
        match.status === 'READY' &&
        match.roomId === null &&
        match.homeUserId !== null &&
        match.awayUserId !== null,
    );
    for (const match of pending) {
      const room = await this.provisionMatchRoom({
        tournament,
        match,
        homeUserId: match.homeUserId!,
        awayUserId: match.awayUserId!,
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
    readonly homeUserId: string;
    readonly awayUserId: string;
    readonly now: Date;
  }): Promise<{ roomId: string }> {
    const ruleset = resolveRuleSetByCode(input.tournament.rulesetCode);
    const rulesetRow = await this.lobbyRepository.ensureRulesetRow(ruleset);
    const [nicknames] = await Promise.all([
      this.repository.nicknamesFor([input.homeUserId, input.awayUserId]),
    ]);
    const roomId = generateUuidV7(input.now.getTime());

    await this.lobbyRepository.createTableWithSeatsTx({
      tableId: roomId,
      ownerId: input.homeUserId,
      mode: input.tournament.mode,
      visibility: 'PRIVATE',
      rulesetId: rulesetRow.id,
      rulesetCode: input.tournament.rulesetCode,
      targetScore: input.tournament.targetScore === 15 ? 15 : 30,
      florEnabled: input.tournament.florEnabled,
      turnTimeoutMs: input.tournament.turnTimeoutMs,
      now: input.now,
      expiresAt: new Date(input.now.getTime() + this.lobbyConfig.tableTtlMs),
      participants: [
        {
          userId: input.homeUserId,
          nickname: nicknames.get(input.homeUserId) ?? 'Jugador',
          seat: 0,
          team: 0,
        },
        {
          userId: input.awayUserId,
          nickname: nicknames.get(input.awayUserId) ?? 'Jugador',
          seat: 1,
          team: 1,
        },
      ],
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
    let lockedTournament: TournamentRow | null = null;
    await this.repository.transaction(async (tx) => {
      const tournament = await this.repository.lockById(tx, tournamentId);
      if (!tournament) return;
      lockedTournament = tournament;
      const matches = await this.repository.lockMatches(tx, tournamentId);
      const participants = await this.repository.listParticipants(tournamentId, tx);
      const entrantCount = countEntrants(tournament, participants);
      if (entrantCount < 2) return;

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
        if (!source || source.status !== 'COMPLETED' || source.winnerUserId === null) continue;
        const destination = destinations.get(match.key);
        if (!destination) continue;

        const moves = [
          ...(destination.winnerTo
            ? [{ to: destination.winnerTo.key, userId: source.winnerUserId }]
            : []),
          ...(destination.loserTo && source.loserUserId
            ? [{ to: destination.loserTo.key, userId: source.loserUserId }]
            : []),
        ];
        for (const move of moves) {
          const targetRow = rowByKey.get(move.to);
          if (!targetRow) continue;
          // Un cruce ya cerrado no recibe nada: la llave ya está consistente.
          if (targetRow.status === 'COMPLETED' || targetRow.status === 'FORFEITED') continue;
          const side: 'home' | 'away' = targetRow.homeUserId === null ? 'home' : 'away';
          if (side === 'away' && targetRow.awayUserId !== null) continue;
          // Nunca se pisa un lado ya asignado.
          if (targetRow.homeUserId === move.userId || targetRow.awayUserId === move.userId)
            continue;

          const patch: Partial<typeof tournamentMatchesTable.$inferInsert> =
            side === 'home'
              ? { homeUserId: move.userId, homeSeed: source.homeSeed ?? null }
              : { awayUserId: move.userId, awaySeed: source.homeSeed ?? null };
          const nextHome = side === 'home' ? move.userId : targetRow.homeUserId;
          const nextAway = side === 'away' ? move.userId : targetRow.awayUserId;
          if (nextHome !== null && nextAway !== null) {
            // La sala se aprovisiona DESPUÉS de confirmar la transacción: el
            // repositorio del lobby escribe por el pool y hacerlo acá dentro
            // bloquearía la conexión (el mismo deadlock que ya sufrió este servicio).
            patch.status = 'READY';
            patch.deadlineAt =
              tournament.noShowMinutes > 0
                ? new Date(now.getTime() + tournament.noShowMinutes * 60_000)
                : null;
            ready.push({ match: targetRow, homeUserId: nextHome, awayUserId: nextAway });
          }
          await this.repository.updateMatch(tx, targetRow.id, patch);
          // Se refleja en memoria para que el resto del recorrido vea el cambio.
          rowByKey.set(move.to, {
            ...targetRow,
            homeUserId: nextHome,
            awayUserId: nextAway,
            status: patch.status ?? targetRow.status,
          });
        }
      }
    });

    // Se aprovisionan las salas recién después de confirmar y antes de avisar: un aviso
    // de "partida lista" que lleva a una sala inexistente no sirve.
    if (lockedTournament) await this.provisionPendingRooms(lockedTournament, now);

    for (const readyMatch of ready) {
      await this.notify(
        [readyMatch.homeUserId!, readyMatch.awayUserId!],
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

      await this.repository.updateMatch(tx, locked.id, {
        status: 'FORFEITED',
        forfeitReason: 'NO_SHOW',
        completedAt: now,
      });
      return { id: locked.id, status: locked.status, deadlineAt: locked.deadlineAt };
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
    if (match) {
      if (match.status !== 'READY' && match.status !== 'IN_PROGRESS') return false;
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

    return false;
  }

  /** Si ya no quedan cruces pendientes, el torneo termina y se pagan los premios. */
  private async finishIfDecided(tournamentId: string, now: Date): Promise<void> {
    const tournament = await this.repository.findById(tournamentId);
    if (!tournament || tournament.status !== 'IN_PROGRESS') return;

    const pending = await this.repository.countPendingMatches(tournament.id);
    if (pending > 0) return;

    const standings = await this.standingsFor(tournament);
    const champion = standings[0];
    await this.repository.transaction(async (tx) => {
      const locked = await this.repository.lockById(tx, tournament.id);
      if (!locked || locked.status !== 'IN_PROGRESS') return;
      if (champion) {
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
    const [prizes, standings] = await Promise.all([
      this.repository.listPrizes([tournamentId]),
      this.standingsFor(tournament),
    ]);
    let awarded = 0;

    for (const prize of prizes) {
      const recipient = standings[prize.position - 1];
      if (!recipient) continue;
      const delivered = await this.repository.transaction(async (tx) => {
        const award = await this.repository.insertAward(tx, {
          id: generateUuidV7(now.getTime()),
          tournamentId,
          userId: recipient.userId,
          position: prize.position,
          coins: prize.coins,
          cosmeticId: prize.cosmeticId,
          awardedAt: now,
        });
        // Ya existía: la entrega es idempotente y no se vuelve a acreditar.
        if (!award) return false;

        const transactionId = await this.creditPrize(tx, {
          tournamentId,
          userId: recipient.userId,
          position: prize.position,
          coins: prize.coins,
          cosmeticId: prize.cosmeticId,
          now,
        });
        if (transactionId) await this.repository.setAwardTransaction(tx, award.id, transactionId);
        return true;
      });
      if (delivered) awarded += 1;
    }
    return awarded;
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
    return buildStandings(tournament, participants, matches, names);
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

  const finalMatch = matches
    .filter((match) =>
      tournament.format === 'DOUBLE_ELIMINATION'
        ? match.bracket === 'GRAND_FINAL'
        : match.bracket === 'WINNERS' && match.round === Math.max(...matches.map((m) => m.round)),
    )
    .at(-1);
  const championUserId =
    finalMatch?.status === 'COMPLETED' ? (finalMatch.winnerUserId ?? null) : null;
  const runnerUpUserId =
    finalMatch?.status === 'COMPLETED' ? (finalMatch.loserUserId ?? null) : null;

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
