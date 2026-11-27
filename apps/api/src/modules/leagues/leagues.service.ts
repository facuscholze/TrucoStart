import {
  Inject,
  Injectable,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import {
  type CreateLeagueRequest,
  type LeagueCloseResult,
  type LeagueDetail,
  type LeagueDivision,
  type LeagueListQuery,
  type LeagueListResponse,
  type LeagueMatchView,
  type LeagueStandingRow,
  type LeagueSummary,
  buildLeagueStandings,
  canTransitionLeague,
  leagueDivisionRank,
  nextLeagueDivision,
  previousLeagueDivision,
  resolveMovements,
  type LeaguePromotionRules,
} from '@truco/shared';
import { eq } from 'drizzle-orm';
import { DomainApiException } from '../../common/api-exception.js';
import {
  RATE_LIMIT_STORE,
  type RateLimitStore,
} from '../../common/rate-limit/rate-limit-store.interface.js';
import { generateUuidV7 } from '../../common/uuidv7.js';
import type { AppTransaction } from '../../db/database.provider.js';
import {
  cosmeticCatalogTable,
  leagueClosuresTable,
  leagueMatchesTable,
  leagueMovementsTable,
  leaguePrizeAwardsTable,
  leaguePrizesTable,
  leagueReschedulesTable,
  leagueRoundsTable,
  leaguesTable,
  socialNotificationsTable,
  userCosmeticsTable,
  walletTransactionsTable,
} from '../../db/schema/index.js';
import type { AdminPrincipal } from '../admin/admin-auth.service.js';
import { type AuditRepository } from '../audit/audit.repository.js';
import type { AuthenticatedPrincipal } from '../auth/guards/session-auth.guard.js';
import {
  LOBBY_RUNTIME_CONFIG,
  resolveRuleSetByCode,
  type LobbyRuntimeConfig,
} from '../lobby/lobby.config.js';
import { type LobbyRepository } from '../lobby/lobby.repository.js';
import { LobbyRealtimeGateway } from '../lobby/lobby-realtime.gateway.js';
import { type MatchCompletionBridge } from '../lobby/ports/match-completion-bridge.js';
import {
  GAME_ROOM_PROVISIONER,
  type GameRoomProvisioner,
} from '../lobby/ports/game-room-provisioner.js';
import { buildSchedule, roundsForParticipants } from './league-schedule.js';
import { LEAGUES_RUNTIME_CONFIG, type LeaguesRuntimeConfig } from './leagues.config.js';
import {
  type LeagueMatchRow,
  type LeagueParticipantRow,
  type LeagueRoundRow,
  type LeagueRow,
  type LeaguesRepository,
} from './leagues.repository.js';

/**
 * Ligas por temporada (M10b, entrega 2).
 *
 * Decisiones visibles en el código:
 *
 * - **La tabla no se guarda.** `buildLeagueStandings` la reconstruye desde las partidas; el
 *   cierre congela una copia en `league_closures.standings`. Guardar la tabla viva obligaría a
 *   mantenerla en sincronía con cada resultado, y el desempate tendría dos fuentes.
 * - **Cerrar es idempotente por transacción, no por bandera.** El cierre completo (definir
 *   ausencias, congelar tabla, aplicar movimientos, pagar premios, marcar `FINISHED`) corre en
 *   una transacción con la fila de la liga bloqueada. Si falla a mitad, no queda nada escrito y
 *   se puede reintentar; si dos cierres corren juntos, el segundo espera y encuentra la liga ya
 *   `FINISHED`, y no vuelve a pagar (además, `league_prize_awards` tiene único por posición y
 *   persona).
 * - **Revertir el cierre es volver a `ACTIVE`.** `CLOSING → ACTIVE` es la transición que permite
 *   que un cierre fallido deje la liga en juego en vez de trabada.
 * - **Las partidas de liga usan el aprovisionamiento de salas existente.** Se reutiliza
 *   `LobbyRepository.createTableWithSeatsTx` y el `GameRoomProvisioner`, como los torneos:
 *   `isCompetitive = false` (ADR-035: la liga tiene su propia tabla y no toca Glicko-2) y nunca
 *   contra bots.
 * - **Ausencias**: pasado el plazo, la partida se define sola. Si no se presentó uno, gana el
 *   otro; si no se presentó ninguno, **nadie suma** (ADR-035).
 */
@Injectable()
export class LeaguesService implements OnApplicationBootstrap, OnApplicationShutdown {
  private maintenanceTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly repository: LeaguesRepository,
    @Inject(LEAGUES_RUNTIME_CONFIG) private readonly config: LeaguesRuntimeConfig,
    @Inject(LOBBY_RUNTIME_CONFIG) private readonly lobbyConfig: LobbyRuntimeConfig,
    private readonly lobbyRepository: LobbyRepository,
    @Inject(GAME_ROOM_PROVISIONER) private readonly provisioner: GameRoomProvisioner,
    @Inject(RATE_LIMIT_STORE) private readonly rateLimitStore: RateLimitStore,
    private readonly auditRepository: AuditRepository,
    @Inject(LobbyRealtimeGateway) private readonly realtime: LobbyRealtimeGateway,
    private readonly matchCompletion: MatchCompletionBridge,
  ) {
    // El puente de fin de partida lo ocupa este servicio al arrancar, igual que torneos: es la
    // única vía por la que una partida real cierra su cruce de liga.
    this.matchCompletion.register((info) => this.completeByRoom(info));
  }

  onApplicationBootstrap(): void {
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

  // -------------------------------------------------------------- creación

  async create(
    principal: AuthenticatedPrincipal,
    body: CreateLeagueRequest,
    meta: { readonly ip: string },
  ): Promise<LeagueSummary> {
    await this.consumeLimit(
      `leagues:create:account:${principal.userId}`,
      this.config.createPerAccountMax,
    );
    await this.consumeLimit(`leagues:create:ip:${meta.ip}`, this.config.createPerIpMax);

    if (body.official && !isStaff(principal.role)) {
      throw new DomainApiException(
        403,
        'FORBIDDEN',
        'Sólo el equipo puede crear ligas oficiales.',
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
        'El total de monedas virtuales de los premios supera el tope permitido.',
        { reason: 'PRIZE_POOL_TOO_LARGE' },
      );
    }

    const active = await this.repository.countActiveByCreator(principal.userId);
    if (active >= this.config.maxActivePerCreator) {
      throw new DomainApiException(409, 'CONFLICT', 'Ya tenés demasiadas ligas activas a la vez.', {
        reason: 'TOO_MANY_ACTIVE_LEAGUES',
      });
    }

    const now = this.now();
    const startsAt = new Date(body.season.startsAt);
    const endsAt = new Date(body.season.endsAt);
    if (startsAt <= now) {
      throw new DomainApiException(400, 'VALIDATION_ERROR', 'La temporada ya empezó.', {
        reason: 'SEASON_STARTED',
      });
    }
    const registrationClosesAt = new Date(
      Math.min(now.getTime() + body.registrationMinutes * 60_000, startsAt.getTime()),
    );

    // Una sola liga por división y temporada: la tabla de la división no se parte en dos.
    const existing = await this.repository.findSameDivisionSeason({
      mode: body.mode,
      division: body.division,
      seasonLabel: body.season.label,
    });
    if (existing) {
      throw new DomainApiException(
        409,
        'CONFLICT',
        'Ya existe una liga de esa división en esta temporada.',
        { reason: 'DIVISION_ALREADY_EXISTS', leagueId: existing.id },
      );
    }

    // La escalera tiene que existir del otro lado: ascender desde PLATINO o descender desde
    // BRONCE no tiene a dónde ir.
    const divisionRank = leagueDivisionRank(body.division);
    if (body.promotion.promotions > 0 && divisionRank === 3) {
      throw new DomainApiException(
        400,
        'VALIDATION_ERROR',
        'La división más alta no tiene ascenso.',
        { reason: 'INVALID_PROMOTION_RULES' },
      );
    }
    if (body.promotion.relegations > 0 && divisionRank === 0) {
      throw new DomainApiException(
        400,
        'VALIDATION_ERROR',
        'La división más baja no tiene descenso.',
        { reason: 'INVALID_PROMOTION_RULES' },
      );
    }

    const ruleset = resolveRuleSetByCode(body.rules.rulesetCode);
    const rulesetRow = await this.lobbyRepository.ensureRulesetRow(ruleset);
    // El primer día de juego es el inicio de la temporada, nunca antes del cierre de inscripción.
    const firstRoundStartsAt = startsAt < registrationClosesAt ? registrationClosesAt : startsAt;

    const created = await this.repository.transaction(async (tx) => {
      const row = await this.repository.insertLeague(tx, {
        id: generateUuidV7(now.getTime()),
        name: body.name,
        mode: body.mode,
        division: body.division,
        status: 'REGISTRATION',
        official: body.official,
        seasonLabel: body.season.label,
        startsAt,
        endsAt,
        rulesetId: rulesetRow.id,
        rulesetCode: body.rules.rulesetCode,
        targetScore: body.rules.targetScore,
        florEnabled: body.rules.florEnabled,
        turnTimeoutMs: body.rules.turnTimeoutMs,
        scheduleFormat: body.schedule.format,
        rounds: body.schedule.format === 'WINDOW' ? 1 : body.schedule.rounds,
        daysBetweenRounds: body.schedule.daysBetweenRounds,
        roundWindowHours: body.schedule.roundWindowHours,
        maxReschedulesPerMatch: body.schedule.maxReschedulesPerMatch,
        rescheduleMinHoursBeforeDeadline: body.schedule.rescheduleMinHoursBeforeDeadline,
        rescheduleExtensionHours: body.schedule.rescheduleExtensionHours,
        promotions: body.promotion.promotions,
        relegations: body.promotion.relegations,
        minMatchesToMove: body.promotion.minMatchesToMove,
        capacity: body.capacity,
        registrationClosesAt,
        firstRoundStartsAt,
        createdBy: principal.userId,
        createdAt: now,
        updatedAt: now,
      });
      for (const prize of body.prizes) {
        await this.repository.insertPrize(tx, {
          id: generateUuidV7(now.getTime()),
          leagueId: row.id,
          position: prize.position,
          coins: prize.coins,
          cosmeticId: prize.cosmeticId,
          createdAt: now,
        });
      }
      return row;
    });

    await this.auditRepository.record({
      actorId: principal.userId,
      action: 'LEAGUE_CREATED',
      entity: 'league',
      entityId: created.id,
      afterState: { name: created.name, mode: created.mode, division: created.division },
      now,
    });

    return this.toSummary(created, {
      participantCount: 0,
      currentRound: null,
      isParticipant: false,
      prizes: await this.repository.listPrizes(created.id),
    });
  }

  // --------------------------------------------------------------- listado

  async list(
    principal: AuthenticatedPrincipal,
    query: LeagueListQuery,
  ): Promise<LeagueListResponse> {
    const rows = await this.repository.listLeagues({
      mode: query.mode,
      division: query.division,
      statuses: query.status,
      limit: query.limit + 1,
      cursor: query.cursor,
    });
    const page = rows.slice(0, query.limit);
    const items: LeagueSummary[] = [];
    for (const row of page) {
      items.push(
        await this.toSummary(row, {
          participantCount: await this.repository.countActiveParticipants(row.id),
          currentRound: await this.currentRoundNumber(row.id),
          isParticipant: (await this.repository.findParticipant(row.id, principal.userId)) !== null,
          prizes: await this.repository.listPrizes(row.id),
        }),
      );
    }
    const last = page[page.length - 1];
    return {
      items,
      nextCursor:
        rows.length > query.limit && last
          ? `${last.firstRoundStartsAt.getTime()}~${last.id}`
          : null,
    };
  }

  async detail(principal: AuthenticatedPrincipal, leagueId: string): Promise<LeagueDetail> {
    const row = await this.requireLeague(leagueId);
    const participants = await this.repository.listParticipants(row.id);
    const matches = await this.repository.listMatches(row.id);
    const isOrganizer = row.createdBy === principal.userId || isStaff(principal.role);
    const mine =
      participants.find((participant) => participant.userId === principal.userId) ?? null;
    const nicknames = await this.repository.nicknamesFor([
      ...participants.map((participant) => participant.userId),
      ...matches.flatMap((match) => [match.homeUserId, match.awayUserId]),
    ]);
    const standings = this.standingsFor(row, participants, matches);
    const rounds = await this.repository.listRounds(row.id);
    const now = this.now();

    const movementByUser = new Map(
      resolveMovements({
        standings,
        division: row.division,
        promotion: this.promotionRules(row),
        hasDivisionAbove: nextLeagueDivision(row.division) !== null,
        hasDivisionBelow: previousLeagueDivision(row.division) !== null,
      }).map((movement) => [movement.userId, movement.kind]),
    );

    const standingRows: LeagueStandingRow[] = standings.map((standing) => ({
      ...standing,
      movement: movementByUser.get(standing.userId) ?? 'NONE',
      eligibleToMove: standing.played >= row.minMatchesToMove,
    }));

    const visibleMatches = isOrganizer
      ? matches
      : matches.filter(
          (match) => match.homeUserId === principal.userId || match.awayUserId === principal.userId,
        );

    const myNext = matches
      .filter(
        (match) =>
          (match.homeUserId === principal.userId || match.awayUserId === principal.userId) &&
          (match.status === 'SCHEDULED' ||
            match.status === 'READY' ||
            match.status === 'IN_PROGRESS'),
      )
      .sort((a, b) => (a.deadlineAt?.getTime() ?? 0) - (b.deadlineAt?.getTime() ?? 0))[0];

    const nextRound = rounds.find((round) => round.status === 'SCHEDULED' && round.startsAt > now);
    const myStanding = standingRows.find((standing) => standing.userId === principal.userId);
    const myProjectedMovement = !mine
      ? 'UNKNOWN'
      : !myStanding
        ? 'NONE'
        : myStanding.eligibleToMove
          ? myStanding.movement
          : 'NONE';

    return {
      ...this.toSummary(row, {
        participantCount: participants.filter(
          (participant) => participant.status === 'REGISTERED' || participant.status === 'ACTIVE',
        ).length,
        currentRound: rounds.find((round) => round.status === 'OPEN')?.number ?? null,
        isParticipant: mine !== null && mine.status !== 'WITHDRAWN',
        prizes: await this.repository.listPrizes(row.id),
      }),
      promotion: this.promotionRules(row),
      schedule: {
        format: row.scheduleFormat,
        rounds: row.rounds,
        daysBetweenRounds: row.daysBetweenRounds,
        roundWindowHours: row.roundWindowHours,
        maxReschedulesPerMatch: row.maxReschedulesPerMatch,
        rescheduleMinHoursBeforeDeadline: row.rescheduleMinHoursBeforeDeadline,
        rescheduleExtensionHours: row.rescheduleExtensionHours,
      },
      standings: standingRows,
      rounds: rounds.map((round) => ({
        id: round.id,
        number: round.number,
        status: round.status,
        startsAt: round.startsAt.toISOString(),
        deadlineAt: round.deadlineAt.toISOString(),
        closedAt: round.closedAt?.toISOString() ?? null,
      })),
      matches: visibleMatches.map((match) =>
        this.toMatchView(match, nicknames, principal.userId, row),
      ),
      myNextMatch: myNext ? this.toMatchView(myNext, nicknames, principal.userId, row) : null,
      nextRoundStartsAt: nextRound?.startsAt.toISOString() ?? null,
      myProjectedMovement,
    };
  }

  // ----------------------------------------------------------- inscripción

  async join(principal: AuthenticatedPrincipal, leagueId: string): Promise<{ joined: true }> {
    await this.consumeLimit(
      `leagues:join:account:${principal.userId}`,
      this.config.joinPerAccountMax,
    );
    const now = this.now();

    await this.repository.transaction(async (tx) => {
      const locked = await this.repository.lockById(tx, leagueId);
      if (!locked) throw notFound();
      if (
        locked.status !== 'REGISTRATION' ||
        locked.registrationClosesAt.getTime() <= now.getTime()
      ) {
        throw new DomainApiException(409, 'CONFLICT', 'La inscripción de la liga está cerrada.', {
          reason: 'REGISTRATION_CLOSED',
        });
      }
      const existing = await this.repository.findParticipant(leagueId, principal.userId, tx);
      if (existing && existing.status !== 'WITHDRAWN') {
        throw new DomainApiException(409, 'CONFLICT', 'Ya estás inscripto en esta liga.', {
          reason: 'ALREADY_JOINED',
        });
      }
      const activeCount = await this.repository.countActiveParticipants(leagueId, tx);
      if (!existing && activeCount >= locked.capacity) {
        throw new DomainApiException(409, 'CONFLICT', 'La liga no tiene más lugares.', {
          reason: 'LEAGUE_FULL',
        });
      }
      const seed = existing ? existing.seed : await this.repository.nextSeed(tx, leagueId);
      await this.repository.upsertParticipant(tx, {
        id: existing?.id ?? generateUuidV7(now.getTime()),
        leagueId,
        userId: principal.userId,
        seed,
        status: 'ACTIVE',
        joinedDivision: locked.division,
        joinedAt: existing?.joinedAt ?? now,
        updatedAt: now,
        withdrawnAt: null,
      });
    });

    return { joined: true };
  }

  /** Baja: la fila se conserva con `WITHDRAWN` y su `seed`, así la tabla no cambia de orden. */
  async leave(principal: AuthenticatedPrincipal, leagueId: string): Promise<{ left: true }> {
    const now = this.now();
    await this.repository.transaction(async (tx) => {
      const locked = await this.repository.lockById(tx, leagueId);
      if (!locked) throw notFound();
      if (locked.status !== 'REGISTRATION') {
        throw new DomainApiException(
          409,
          'CONFLICT',
          'No se puede abandonar una liga que ya empezó.',
          { reason: 'LEAGUE_STARTED' },
        );
      }
      const existing = await this.repository.findParticipant(leagueId, principal.userId, tx);
      if (!existing || existing.status === 'WITHDRAWN') {
        throw new DomainApiException(404, 'NOT_FOUND', 'No estás inscripto en esta liga.', {
          reason: 'NOT_JOINED',
        });
      }
      await this.repository.setParticipantStatus(tx, leagueId, principal.userId, 'WITHDRAWN', now);
    });
    return { left: true };
  }

  // ------------------------------------------------------------ arranque

  /**
   * Cierra la inscripción y arma calendario y partidas.
   *
   * A partir de acá los participantes quedan `ACTIVE`, se crean las jornadas y se empareja cada
   * una. Es idempotente: si la liga ya está `ACTIVE` no hace nada.
   */
  async start(actor: { readonly userId: string; readonly role: string }, leagueId: string) {
    const now = this.now();
    const result = await this.repository.transaction(async (tx) => {
      const locked = await this.repository.lockById(tx, leagueId);
      if (!locked) throw notFound();
      this.assertOrganizer(actor, locked);
      if (locked.status !== 'REGISTRATION') {
        throw new DomainApiException(409, 'CONFLICT', 'La liga ya no está en inscripción.', {
          reason: 'NOT_IN_REGISTRATION',
        });
      }
      if (!canTransitionLeague(locked.status, 'ACTIVE')) {
        throw new DomainApiException(409, 'CONFLICT', 'Transición de estado inválida.');
      }
      const participants = await this.repository.listParticipants(leagueId, tx);
      const active = participants.filter(
        (participant) => participant.status === 'REGISTERED' || participant.status === 'ACTIVE',
      );
      if (active.length < 2) {
        throw new DomainApiException(
          409,
          'CONFLICT',
          'Una liga necesita al menos dos jugadores para armar el calendario.',
          { reason: 'NOT_ENOUGH_PARTICIPANTS' },
        );
      }

      const schedule = buildSchedule({
        participantIds: active.map((participant) => participant.userId),
        format: locked.scheduleFormat,
        rounds: locked.rounds,
        firstRoundStartsAt: locked.firstRoundStartsAt,
        daysBetweenRounds: locked.daysBetweenRounds,
        roundWindowHours: locked.roundWindowHours,
        endsAt: locked.endsAt,
      });
      if (schedule.length === 0) {
        throw new DomainApiException(409, 'CONFLICT', 'No se pudo armar el calendario.');
      }

      for (const participant of active) {
        await this.repository.setParticipantStatus(tx, leagueId, participant.userId, 'ACTIVE', now);
      }

      for (const round of schedule) {
        const roundId = generateUuidV7(now.getTime());
        await this.repository.insertRound(tx, {
          id: roundId,
          leagueId,
          number: round.number,
          status: 'SCHEDULED',
          startsAt: round.startsAt,
          deadlineAt: round.deadlineAt,
          createdAt: now,
        });
        for (const pair of round.pairs) {
          await this.repository.insertMatch(tx, {
            id: generateUuidV7(now.getTime()),
            leagueId,
            roundId,
            roundNumber: round.number,
            homeUserId: pair.homeUserId,
            awayUserId: pair.awayUserId,
            status: 'SCHEDULED',
            deadlineAt: round.deadlineAt,
            createdAt: now,
            updatedAt: now,
          });
        }
      }

      await this.repository.updateLeague(tx, leagueId, { status: 'ACTIVE', updatedAt: now });
      return {
        rounds: schedule.length,
        matches: schedule.reduce((sum, r) => sum + r.pairs.length, 0),
      };
    });

    await this.auditRepository.record({
      actorId: actor.userId,
      action: 'LEAGUE_STARTED',
      entity: 'league',
      entityId: leagueId,
      afterState: result,
      now,
    });
    return { started: true, ...result };
  }

  // ------------------------------------------------------- reprogramación

  /**
   * Reprograma una partida: extiende su plazo con un motivo y dentro de los topes de la liga.
   *
   * Reglas (todas de la liga, no globales):
   * - Sólo el jugador de la partida (o el organizador) puede pedirlo.
   * - Sólo antes de `rescheduleMinHoursBeforeDeadline` del plazo actual.
   * - Hasta `maxReschedulesPerMatch` veces por partida.
   * - La nueva fecha no pasa de la ventana de la liga (`endsAt`): estirar el plazo más allá del
   *   cierre de temporada sería regalar una partida que la tabla no puede contar.
   */
  async reschedule(
    principal: AuthenticatedPrincipal,
    matchId: string,
    body: { readonly reason: string },
  ): Promise<{ matchId: string; deadlineAt: string; reschedulesUsed: number }> {
    await this.consumeLimit(
      `leagues:reschedule:account:${principal.userId}`,
      this.config.reschedulePerAccountMax,
    );
    const now = this.now();

    return await this.repository.transaction(async (tx) => {
      const match = await this.repository.lockMatch(tx, matchId);
      if (!match)
        throw new DomainApiException(404, 'NOT_FOUND', 'La partida no existe.', {
          reason: 'MATCH_NOT_FOUND',
        });
      const league = await this.repository.lockById(tx, match.leagueId);
      if (!league) throw notFound();
      const isPlayer =
        match.homeUserId === principal.userId || match.awayUserId === principal.userId;
      if (!isPlayer && league.createdBy !== principal.userId && !isStaff(principal.role)) {
        throw new DomainApiException(403, 'FORBIDDEN', 'No participás de esta partida.', {
          reason: 'NOT_IN_MATCH',
        });
      }
      if (match.status !== 'SCHEDULED' && match.status !== 'READY') {
        throw new DomainApiException(409, 'CONFLICT', 'La partida ya se jugó o se definió.', {
          reason: 'MATCH_NOT_PENDING',
        });
      }
      if (league.status !== 'ACTIVE') {
        throw new DomainApiException(409, 'CONFLICT', 'La liga no está en juego.', {
          reason: 'LEAGUE_NOT_ACTIVE',
        });
      }
      const used = await this.repository.countReschedules(matchId, tx);
      if (used >= league.maxReschedulesPerMatch) {
        throw new DomainApiException(
          409,
          'CONFLICT',
          'Esta partida ya agotó sus reprogramaciones.',
          { reason: 'RESCHEDULE_LIMIT_REACHED' },
        );
      }
      const previousDeadlineAt = match.deadlineAt ?? now;
      const minNoticeMs = league.rescheduleMinHoursBeforeDeadline * 3_600_000;
      if (previousDeadlineAt.getTime() - now.getTime() < minNoticeMs) {
        throw new DomainApiException(
          409,
          'CONFLICT',
          'Falta muy poco para el plazo: ya no se puede reprogramar.',
          { reason: 'TOO_LATE_TO_RESCHEDULE' },
        );
      }
      const extended = new Date(
        previousDeadlineAt.getTime() + league.rescheduleExtensionHours * 3_600_000,
      );
      const newDeadlineAt = extended > league.endsAt ? league.endsAt : extended;
      if (newDeadlineAt.getTime() <= previousDeadlineAt.getTime()) {
        throw new DomainApiException(
          409,
          'CONFLICT',
          'No hay margen para extender el plazo dentro de la temporada.',
          { reason: 'NO_ROOM_TO_EXTEND' },
        );
      }

      await this.repository.insertReschedule(tx, {
        id: generateUuidV7(now.getTime()),
        matchId,
        requestedBy: principal.userId,
        reason: body.reason,
        previousDeadlineAt,
        newDeadlineAt,
        createdAt: now,
      });
      await this.repository.updateMatch(tx, matchId, {
        deadlineAt: newDeadlineAt,
        reschedulesUsed: used + 1,
      });
      // La sala ya aprovisionada también mueve su vencimiento: si no, la mesa se cerraría con el
      // plazo viejo y la reprogramación no serviría de nada.
      if (match.roomId) {
        await this.lobbyRepository
          .extendTableExpiry(match.roomId, newDeadlineAt)
          .catch(() => undefined);
      }
      return {
        matchId,
        deadlineAt: newDeadlineAt.toISOString(),
        reschedulesUsed: used + 1,
      };
    });
  }

  // -------------------------------------------------------------- cierre

  /**
   * Cierra una jornada: define por ausencia las partidas vencidas y marca la jornada `CLOSED`.
   *
   * Idempotente por el estado de la jornada, que se lee con cerrojo: dos cierres simultáneos se
   * serializan y el segundo no hace nada.
   */
  async closeRound(actor: { readonly userId: string; readonly role: string }, roundId: string) {
    const now = this.now();
    const outcome = await this.repository.transaction(async (tx) => {
      const locked = await this.repository.lockRound(tx, roundId);
      if (!locked) {
        throw new DomainApiException(404, 'NOT_FOUND', 'La jornada no existe.', {
          reason: 'ROUND_NOT_FOUND',
        });
      }
      const league = await this.repository.lockById(tx, locked.leagueId);
      if (!league) throw notFound();
      this.assertOrganizer(actor, league);
      if (locked.status === 'CLOSED' || locked.status === 'CANCELLED') {
        // Ya cerrada: no se vuelve a definir nada. Es la idempotencia del cierre de jornada.
        return { alreadyClosed: true, forfeited: 0 };
      }
      const forfeited = await this.forfeitExpiredMatchesInRound(tx, league, locked.id, now);
      await this.repository.updateRound(tx, roundId, { status: 'CLOSED', closedAt: now });
      return { alreadyClosed: false, forfeited };
    });

    if (!outcome.alreadyClosed) {
      await this.auditRepository.record({
        actorId: actor.userId,
        action: 'LEAGUE_ROUND_CLOSED',
        entity: 'league_round',
        entityId: roundId,
        afterState: { forfeited: outcome.forfeited },
        now,
      });
    }
    return { closed: true, ...outcome };
  }

  /**
   * Cierra la temporada: congela la tabla, aplica ascensos y descensos y paga los premios.
   *
   * Toda la operación es **una transacción**. La idempotencia tiene tres capas:
   * 1. La fila de la liga se lee con `FOR UPDATE`: dos cierres simultáneos se serializan.
   * 2. Si la liga ya está `FINISHED` y hay un cierre guardado, se devuelve ese mismo resultado
   *    sin escribir nada (reintento después de un éxito).
   * 3. Si el cierre falla a mitad, la transacción revierte: no queda ni la tabla congelada ni los
   *    premios ni el estado, así que el reintento parte de cero. Además `league_closures` tiene
   *    único por liga y `league_prize_awards` único por posición y persona, por si algo llegara
   *    a correr dos veces por otro camino.
   */
  async closeSeason(
    actor: { readonly userId: string; readonly role: string },
    leagueId: string,
  ): Promise<LeagueCloseResult> {
    const now = this.now();
    const closure = await this.repository.transaction(async (tx) => {
      const locked = await this.repository.lockById(tx, leagueId);
      if (!locked) throw notFound();
      this.assertOrganizer(actor, locked);

      // Reintento después de un cierre exitoso: se devuelve el resultado guardado, sin escribir.
      const existingClosure = await this.repository.findClosure(leagueId, tx);
      if (locked.status === 'FINISHED' && existingClosure) {
        return {
          leagueId,
          finishedAt: existingClosure.closedAt.toISOString(),
          championUserId: existingClosure.championUserId,
          promoted: (existingClosure.promotedUserIds as string[]) ?? [],
          relegated: (existingClosure.relegatedUserIds as string[]) ?? [],
          awardedPrizes: 0,
          forfeitedMatches: existingClosure.forfeitedMatches,
        } satisfies LeagueCloseResult;
      }

      if (locked.status !== 'ACTIVE' && locked.status !== 'CLOSING') {
        throw new DomainApiException(409, 'CONFLICT', 'La liga no está en juego.', {
          reason: 'LEAGUE_NOT_ACTIVE',
        });
      }
      if (!canTransitionLeague('ACTIVE', 'CLOSING')) {
        throw new DomainApiException(409, 'CONFLICT', 'Transición de estado inválida.');
      }

      // Se marca `CLOSING` antes de escribir el resto: si algo falla, la transacción revierte y
      // la liga vuelve a `ACTIVE`.
      await this.repository.updateLeague(tx, leagueId, { status: 'CLOSING', updatedAt: now });

      // 1. Definir por ausencia lo que venció, jornada por jornada.
      const rounds = await this.repository.listRounds(leagueId, tx);
      let forfeitedMatches = 0;
      for (const round of rounds) {
        if (round.status === 'CLOSED' || round.status === 'CANCELLED') continue;
        forfeitedMatches += await this.forfeitExpiredMatchesInRound(tx, locked, round.id, now);
        await this.repository.updateRound(tx, round.id, { status: 'CLOSED', closedAt: now });
      }
      // Partidas sin jornada (formato `WINDOW`).
      forfeitedMatches += await this.forfeitExpiredMatchesInRound(tx, locked, null, now);

      // 2. Tabla congelada desde las partidas definitivas.
      const participants = await this.repository.listParticipants(leagueId, tx);
      const matches = await this.repository.listMatches(leagueId, tx);
      const standings = this.standingsFor(locked, participants, matches);
      const championUserId = standings[0]?.played ? standings[0].userId : null;

      // 3. Ascensos y descensos.
      const movements = resolveMovements({
        standings,
        division: locked.division,
        promotion: this.promotionRules(locked),
        hasDivisionAbove: nextLeagueDivision(locked.division) !== null,
        hasDivisionBelow: previousLeagueDivision(locked.division) !== null,
      });
      const promoted = movements
        .filter((movement) => movement.kind !== 'RELEGATION')
        .map((movement) => movement.userId);
      const relegated = movements
        .filter((movement) => movement.kind === 'RELEGATION')
        .map((movement) => movement.userId);
      const movementByUser = new Map(movements.map((movement) => [movement.userId, movement]));

      for (const standing of standings) {
        const movement = movementByUser.get(standing.userId);
        if (!movement) continue;
        const toDivision =
          movement.kind === 'RELEGATION'
            ? (previousLeagueDivision(locked.division) ?? null)
            : (nextLeagueDivision(locked.division) ?? null);
        await this.repository.insertMovement(tx, {
          id: generateUuidV7(now.getTime()),
          leagueId,
          userId: standing.userId,
          kind: movement.kind,
          fromDivision: locked.division,
          toDivision,
          createdAt: now,
        });
        await this.repository.setParticipantStatus(
          tx,
          leagueId,
          standing.userId,
          movement.kind === 'RELEGATION' ? 'RELEGATED' : 'PROMOTED',
          now,
        );
      }

      // 4. Premios: por el libro mayor, con asiento idempotente por liga y posición.
      const prizes = await this.repository.listPrizes(leagueId, tx);
      let awardedPrizes = 0;
      for (const prize of prizes) {
        const winner = standings[prize.position - 1];
        if (!winner) continue;
        // Un premio no se paga a quien no jugó la liga: la tabla tiene filas con cero partidas.
        if (winner.played === 0) continue;
        const credited = await this.awardPrize(tx, {
          league: locked,
          userId: winner.userId,
          position: prize.position,
          coins: prize.coins,
          cosmeticId: prize.cosmeticId,
          now,
        });
        if (credited) awardedPrizes += 1;
      }

      // 5. Tabla congelada y estado final.
      const closureRow = await this.repository.insertClosure(tx, {
        id: generateUuidV7(now.getTime()),
        leagueId,
        closedAt: now,
        standings,
        championUserId,
        promotedUserIds: promoted,
        relegatedUserIds: relegated,
        forfeitedMatches,
        createdAt: now,
      });
      if (!closureRow) {
        // Otra transacción ganó la carrera del cierre: no se aplica nada de lo nuestro.
        throw new DomainApiException(409, 'CONFLICT', 'La liga ya fue cerrada por otro cierre.', {
          reason: 'ALREADY_CLOSED',
        });
      }
      await this.repository.updateLeague(tx, leagueId, {
        status: 'FINISHED',
        finishedAt: now,
        closedAt: now,
        updatedAt: now,
      });

      return {
        leagueId,
        finishedAt: now.toISOString(),
        championUserId,
        promoted,
        relegated,
        awardedPrizes,
        forfeitedMatches,
      } satisfies LeagueCloseResult;
    });

    await this.auditRepository.record({
      actorId: actor.userId,
      action: 'LEAGUE_CLOSED',
      entity: 'league',
      entityId: leagueId,
      afterState: {
        promoted: closure.promoted.length,
        relegated: closure.relegated.length,
        awardedPrizes: closure.awardedPrizes,
      },
      now,
    });
    await this.notifyParticipants(leagueId, {
      type: 'LEAGUE_SEASON_FINISHED',
      referenceId: leagueId,
      payload: { leagueId, championUserId: closure.championUserId },
      dedupeKey: `league-season:${leagueId}`,
    });

    return closure;
  }

  // ------------------------------------------------------- barrido y salas

  /**
   * Barrido de mantenimiento: abre jornadas, aprisiona salas, define ausencias y cierra ligas
   * vencidas.
   *
   * Es el camino que hace que la liga avance sin que nadie apriete un botón, y también el que se
   * ejercita en las pruebas con un reloj inyectado.
   */
  async runMaintenance(): Promise<void> {
    const now = this.now();

    for (const round of await this.repository.roundsToOpen(now)) {
      const opened = await this.repository.transaction(async (tx) => {
        const locked = await this.repository.lockRound(tx, round.id);
        if (!locked || locked.status !== 'SCHEDULED') return false;
        await this.repository.updateRound(tx, round.id, { status: 'OPEN' });
        // Abrir la jornada pone sus partidas **listas**: con la jornada en juego, la partida ya
        // se puede jugar y sólo le falta la sala. Sin este paso las partidas se quedaban
        // `SCHEDULED` para siempre y nunca se aprovisionaba nada.
        await this.repository.markRoundMatchesReady(tx, locked.id);
        return true;
      });
      if (!opened) continue;
      // El aprovisionamiento va **después** de confirmar: si falla, la partida queda `READY`
      // sin sala y el próximo barrido la reintenta.
      await this.provisionPendingRooms(round.leagueId, now);
      await this.notifyRoundOpen(round);
    }

    for (const round of await this.repository.roundsToClose(now)) {
      await this.repository.transaction(async (tx) => {
        const locked = await this.repository.lockRound(tx, round.id);
        if (!locked || locked.status !== 'OPEN') return;
        const league = await this.repository.findById(locked.leagueId, tx);
        if (!league) return;
        await this.forfeitExpiredMatchesInRound(tx, league, locked.id, now);
        await this.repository.updateRound(tx, locked.id, { status: 'CLOSED', closedAt: now });
      });
    }

    for (const league of await this.repository.leaguesToClose(now)) {
      // El cierre automático usa el mismo camino que el manual, con el organizador como actor.
      await this.closeSeason({ userId: league.createdBy, role: 'SYSTEM' }, league.id).catch(
        () => undefined,
      );
    }
  }

  /** Abre las salas de las partidas listas que todavía no tienen. */
  private async provisionPendingRooms(leagueId: string, now: Date): Promise<void> {
    const league = await this.repository.findById(leagueId);
    if (!league || league.status !== 'ACTIVE') return;
    const pending = (await this.repository.matchesReadyWithoutRoom(leagueId)).slice(
      0,
      this.config.maxRoomsPerSweep,
    );
    for (const match of pending) {
      try {
        const room = await this.provisionMatchRoom(league, match, now);
        await this.repository.transaction(async (tx) => {
          const locked = await this.repository.lockMatch(tx, match.id);
          if (!locked || locked.roomId !== null) return;
          await this.repository.setMatchRoom(tx, match.id, room.roomId);
        });
      } catch {
        // La partida queda `READY` sin sala y el próximo barrido lo reintenta, igual que en
        // torneos: no se pierde la partida por un aprovisionamiento fallido.
      }
    }
  }

  /**
   * Aprovisiona la sala de una partida de liga con el aprovisionamiento existente.
   *
   * - `isCompetitive = false`: la liga tiene su propia tabla, no toca Glicko-2 (ADR-035).
   * - Sin práctica: una liga nunca usa bots.
   * - Si el aprovisionamiento falla, se borra la mesa creada para no dejar mesas huérfanas.
   */
  private async provisionMatchRoom(
    league: LeagueRow,
    match: LeagueMatchRow,
    now: Date,
  ): Promise<{ roomId: string }> {
    const ruleset = resolveRuleSetByCode(league.rulesetCode);
    const rulesetRow = await this.lobbyRepository.ensureRulesetRow(ruleset);
    const nicknames = await this.repository.nicknamesFor([match.homeUserId, match.awayUserId]);
    const roomId = generateUuidV7(now.getTime());

    await this.lobbyRepository.createTableWithSeatsTx({
      tableId: roomId,
      ownerId: match.homeUserId,
      mode: league.mode,
      visibility: 'PRIVATE',
      rulesetId: rulesetRow.id,
      rulesetCode: league.rulesetCode,
      targetScore: league.targetScore === 15 ? 15 : 30,
      florEnabled: league.florEnabled,
      turnTimeoutMs: league.turnTimeoutMs,
      now,
      expiresAt: new Date(
        Math.min(
          now.getTime() + this.lobbyConfig.tableTtlMs,
          (match.deadlineAt ?? league.endsAt).getTime(),
        ),
      ),
      participants: [
        {
          userId: match.homeUserId,
          nickname: nicknames.get(match.homeUserId) ?? 'Jugador',
          seat: 0,
          team: 0,
        },
        {
          userId: match.awayUserId,
          nickname: nicknames.get(match.awayUserId) ?? 'Jugador',
          seat: 1,
          team: 1,
        },
      ],
      isCompetitive: false,
    });

    try {
      await this.provisioner.provisionRoom({
        roomId,
        mode: league.mode,
        visibility: 'PRIVATE',
        rulesetCode: league.rulesetCode,
        ruleset: ruleset as unknown as Record<string, unknown>,
        targetScore: league.targetScore === 15 ? 15 : 30,
        florEnabled: league.florEnabled,
        turnTimeoutMs: league.turnTimeoutMs,
      });
    } catch (error) {
      await this.lobbyRepository.rollbackCreatedTable(roomId).catch(() => undefined);
      throw error;
    }
    return { roomId };
  }

  /**
   * Resultado de una partida real sobre una sala de liga.
   *
   * La idempotencia es `resolvedFromMatchId`: la misma partida no resuelve dos veces el cruce.
   * Se devuelve `false` cuando la sala no es de liga, para no interferir con otros consumidores
   * del mismo puente.
   */
  async completeByRoom(input: {
    readonly roomId: string;
    readonly matchId: string;
    readonly winnerTeam: number;
    readonly endedAt: Date;
  }): Promise<boolean> {
    const match = await this.repository.findMatchByRoomId(input.roomId);
    if (!match) return false;
    if (
      match.status !== 'READY' &&
      match.status !== 'IN_PROGRESS' &&
      match.status !== 'SCHEDULED'
    ) {
      return false;
    }
    const winnerUserId = input.winnerTeam === 0 ? match.homeUserId : match.awayUserId;
    return await this.markMatchPlayed({
      matchId: match.id,
      winnerUserId,
      homeScore: input.winnerTeam === 0 ? 30 : 0,
      awayScore: input.winnerTeam === 0 ? 0 : 30,
      realMatchId: input.matchId,
      now: input.endedAt,
    });
  }

  /** Marca una partida como jugada. Idempotente por `resolvedFromMatchId`. */
  async markMatchPlayed(input: {
    readonly matchId: string;
    readonly winnerUserId: string;
    readonly homeScore: number;
    readonly awayScore: number;
    readonly realMatchId: string | null;
    readonly now: Date;
  }): Promise<boolean> {
    return await this.repository.transaction(async (tx) => {
      const locked = await this.repository.lockMatch(tx, input.matchId);
      if (!locked) return false;
      if (locked.resolvedFromMatchId === input.realMatchId && input.realMatchId !== null) {
        return false;
      }
      if (
        locked.status === 'COMPLETED' ||
        locked.status === 'FORFEITED' ||
        locked.status === 'VOID'
      ) {
        return false;
      }
      if (input.winnerUserId !== locked.homeUserId && input.winnerUserId !== locked.awayUserId) {
        return false;
      }
      await this.repository.updateMatch(tx, locked.id, {
        status: 'COMPLETED',
        winnerUserId: input.winnerUserId,
        homeScore: input.homeScore,
        awayScore: input.awayScore,
        resolvedFromMatchId: input.realMatchId,
        startedAt: locked.startedAt ?? input.now,
        completedAt: input.now,
      });
      return true;
    });
  }

  // --------------------------------------------------------------- interno

  /**
   * Define por ausencia las partidas pendientes de una jornada cuyo plazo ya venció.
   *
   * - No se presentó **uno**: gana el otro (`NO_SHOW`, con `noShowUserId` del ausente).
   * - No se presentó **ninguno**: `DOUBLE_NO_SHOW`, sin ganador; nadie suma (ADR-035).
   *
   * Devuelve cuántas partidas definió, para que el cierre lo informe y lo audite.
   */
  private async forfeitExpiredMatchesInRound(
    tx: AppTransaction,
    league: LeagueRow,
    roundId: string | null,
    now: Date,
  ): Promise<number> {
    const pending = (await this.repository.pendingMatchesPastDeadline(league.id, now, tx)).filter(
      (match) => (roundId === null ? match.roundId === null : match.roundId === roundId),
    );
    let defined = 0;
    for (const match of pending) {
      // Una partida que llegó a jugarse no se define por ausencia acá: la cierra el resultado
      // de la mesa (`completeByRoom`) o, si quedó colgada, el cierre la marca al vencer.
      if (match.status === 'IN_PROGRESS') continue;
      /*
       * Nadie jugó esa partida: el sistema **no puede saber** quién faltó. La partida pasó de
       * `SCHEDULED` a `READY` cuando abrió la jornada y desde ahí los dos tenían la sala; no hay
       * señal de presencia. Inventar un ausente sería inventar un resultado, así que se define
       * como doble ausente: nadie suma (ADR-035).
       *
       * Quien sí tiene una ausencia comprobable es la partida que arrancó y se abandonó; ése es
       * `ABANDON`, no este camino.
       */
      await this.repository.updateMatch(tx, match.id, {
        status: 'FORFEITED',
        winnerUserId: null,
        forfeitReason: 'DOUBLE_NO_SHOW',
        homeScore: null,
        awayScore: null,
        noShowUserId: null,
        completedAt: now,
      });
      defined += 1;
    }
    return defined;
  }

  /**
   * Acredita un premio por el libro mayor inmutable.
   *
   * `idempotencyKey` incluye liga, posición y persona: reintentar el cierre no acredita dos veces
   * aunque se saltee la guarda del estado. Devuelve `false` si ya estaba acreditado.
   */
  private async awardPrize(
    tx: AppTransaction,
    input: {
      readonly league: LeagueRow;
      readonly userId: string;
      readonly position: number;
      readonly coins: number;
      readonly cosmeticId: string | null;
      readonly now: Date;
    },
  ): Promise<boolean> {
    const idempotencyKey = `league:${input.league.id}:prize:${input.position}:${input.userId}`;
    const transactionId = generateUuidV7(input.now.getTime());
    const [inserted] = await tx
      .insert(walletTransactionsTable)
      .values({
        id: transactionId,
        userId: input.userId,
        amount: input.coins,
        kind: 'MISSION_REWARD',
        idempotencyKey,
        referenceType: 'league',
        referenceId: input.league.id,
        metadata: { position: input.position, symbolic: true },
        createdAt: input.now,
      })
      .onConflictDoNothing({
        target: [walletTransactionsTable.userId, walletTransactionsTable.idempotencyKey],
      })
      .returning({ id: walletTransactionsTable.id });
    if (!inserted) return false;

    if (input.cosmeticId) {
      const [cosmetic] = await tx
        .select({ id: cosmeticCatalogTable.id })
        .from(cosmeticCatalogTable)
        .where(eq(cosmeticCatalogTable.id, input.cosmeticId))
        .limit(1);
      if (cosmetic) {
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
    }

    await this.repository.insertAward(tx, {
      id: generateUuidV7(input.now.getTime()),
      leagueId: input.league.id,
      userId: input.userId,
      position: input.position,
      coins: input.coins,
      cosmeticId: input.cosmeticId,
      walletTransactionId: inserted.id,
      awardedAt: input.now,
    });
    return true;
  }

  private standingsFor(
    league: LeagueRow,
    participants: readonly LeagueParticipantRow[],
    matches: readonly LeagueMatchRow[],
  ): LeagueStandingRow[] {
    void league;
    return buildLeagueStandings({
      participants: participants
        .filter((participant) => participant.status !== 'WITHDRAWN')
        .map((participant) => ({
          userId: participant.userId,
          nickname: participant.userId,
          status: participant.status,
          seed: participant.seed,
        })),
      results: matches
        .filter((match) => match.status === 'COMPLETED' || match.status === 'FORFEITED')
        .map((match) => ({
          homeUserId: match.homeUserId,
          awayUserId: match.awayUserId,
          winnerUserId: match.winnerUserId,
          homeScore: match.homeScore,
          awayScore: match.awayScore,
          forfeitReason: match.forfeitReason,
          noShowUserIds: match.noShowUserId
            ? [match.noShowUserId]
            : match.forfeitReason === 'DOUBLE_NO_SHOW'
              ? [match.homeUserId, match.awayUserId]
              : [],
          voided: match.status === 'VOID',
        })),
    });
  }

  async audit(actor: { readonly userId: string; readonly role: string }, leagueId: string) {
    const league = await this.requireLeague(leagueId);
    this.assertOrganizer(actor, league);
    const [closure, movements] = await Promise.all([
      this.repository.findClosure(leagueId),
      this.repository.listMovements(leagueId),
    ]);
    return {
      leagueId,
      status: league.status,
      closure: closure
        ? {
            closedAt: closure.closedAt.toISOString(),
            championUserId: closure.championUserId,
            promoted: closure.promotedUserIds,
            relegated: closure.relegatedUserIds,
            forfeitedMatches: closure.forfeitedMatches,
          }
        : null,
      movements: movements.map((movement) => ({
        userId: movement.userId,
        kind: movement.kind,
        fromDivision: movement.fromDivision,
        toDivision: movement.toDivision,
        createdAt: movement.createdAt.toISOString(),
      })),
    };
  }

  private assertOrganizer(
    actor: { readonly userId: string; readonly role: string },
    league: LeagueRow,
  ): void {
    if (league.createdBy === actor.userId || isStaff(actor.role)) return;
    throw new DomainApiException(
      403,
      'FORBIDDEN',
      'Sólo quien organiza la liga puede hacer esto.',
      {
        reason: 'NOT_ORGANIZER',
      },
    );
  }

  private promotionRules(league: LeagueRow): LeaguePromotionRules {
    return {
      promotions: league.promotions,
      relegations: league.relegations,
      minMatchesToMove: league.minMatchesToMove,
    };
  }

  private async currentRoundNumber(leagueId: string): Promise<number | null> {
    const rounds = await this.repository.listRounds(leagueId);
    return rounds.find((round) => round.status === 'OPEN')?.number ?? null;
  }

  private toSummary(
    row: LeagueRow,
    extra: {
      readonly participantCount: number;
      readonly currentRound: number | null;
      readonly isParticipant: boolean;
      readonly prizes: ReadonlyArray<{
        readonly position: number;
        readonly coins: number;
        readonly cosmeticId: string | null;
      }>;
    },
  ): LeagueSummary {
    return {
      id: row.id,
      name: row.name,
      mode: row.mode,
      division: row.division,
      status: row.status,
      official: row.official,
      seasonLabel: row.seasonLabel,
      startsAt: row.startsAt.toISOString(),
      endsAt: row.endsAt.toISOString(),
      rulesetCode: row.rulesetCode,
      targetScore: row.targetScore,
      florEnabled: row.florEnabled,
      turnTimeoutMs: row.turnTimeoutMs,
      capacity: row.capacity,
      participantCount: extra.participantCount,
      currentRound: extra.currentRound,
      registrationClosesAt: row.registrationClosesAt.toISOString(),
      finishedAt: row.finishedAt?.toISOString() ?? null,
      createdByNickname: '',
      isParticipant: extra.isParticipant,
      isOrganizer: false,
      prizes: extra.prizes.map((prize) => ({
        position: prize.position,
        coins: prize.coins,
        cosmeticId: prize.cosmeticId,
        cosmeticName: null,
      })),
    };
  }

  private toMatchView(
    match: LeagueMatchRow,
    nicknames: ReadonlyMap<string, string>,
    viewerUserId: string,
    league: LeagueRow,
  ): LeagueMatchView {
    return {
      id: match.id,
      roundNumber: match.roundNumber,
      status: match.status,
      homeUserId: match.homeUserId,
      homeNickname: nicknames.get(match.homeUserId) ?? 'Jugador',
      awayUserId: match.awayUserId,
      awayNickname: nicknames.get(match.awayUserId) ?? 'Jugador',
      homeScore: match.homeScore,
      awayScore: match.awayScore,
      winnerUserId: match.winnerUserId,
      forfeitReason: match.forfeitReason,
      roomId: match.roomId,
      deadlineAt: match.deadlineAt?.toISOString() ?? null,
      reschedulesUsed: match.reschedulesUsed,
      maxReschedules: league.maxReschedulesPerMatch,
      canReschedule: false,
      isMine: match.homeUserId === viewerUserId || match.awayUserId === viewerUserId,
    };
  }

  private async requireLeague(leagueId: string): Promise<LeagueRow> {
    const row = await this.repository.findById(leagueId);
    if (!row) throw notFound();
    return row;
  }

  private async consumeLimit(key: string, max: number): Promise<void> {
    const result = await this.rateLimitStore.consumeWindow(key, max, this.config.rateLimitWindowMs);
    if (!result.allowed) {
      throw new DomainApiException(
        429,
        'RATE_LIMITED',
        'Demasiadas acciones de liga seguidas. Esperá un momento e intentá de nuevo.',
        { retryAfterMs: result.retryAfterMs },
      );
    }
  }

  private async notifyRoundOpen(round: LeagueRoundRow): Promise<void> {
    await this.notifyParticipants(round.leagueId, {
      type: 'LEAGUE_ROUND_OPEN',
      referenceId: round.leagueId,
      payload: { leagueId: round.leagueId, roundNumber: round.number },
      dedupeKey: `league-round:${round.leagueId}:${round.number}`,
    });
  }

  /**
   * Avisos de liga por el libro de M9a.
   *
   * El único `(usuario, tipo, reference_id)` de `social_notifications` junto con
   * `onConflictDoNothing` hacen que un aviso de jornada o de temporada se guarde una sola vez.
   */
  private async notifyParticipants(
    leagueId: string,
    notification: {
      readonly type: 'LEAGUE_ROUND_OPEN' | 'LEAGUE_MATCH_PENDING' | 'LEAGUE_SEASON_FINISHED';
      readonly referenceId: string;
      readonly payload: Record<string, unknown>;
      readonly dedupeKey: string;
    },
  ): Promise<void> {
    const participants = await this.repository.listParticipants(leagueId);
    const now = this.now();
    for (const participant of participants) {
      if (participant.status === 'WITHDRAWN') continue;
      const [inserted] = await this.repository.database
        .insert(socialNotificationsTable)
        .values({
          id: generateUuidV7(now.getTime()),
          userId: participant.userId,
          type: notification.type,
          referenceId: notification.referenceId,
          payload: { ...notification.payload, dedupeKey: notification.dedupeKey },
          createdAt: now,
        })
        .onConflictDoNothing()
        .returning({ id: socialNotificationsTable.id });
      if (!inserted) continue;
      this.realtime.emitSocialNotification(participant.userId, {
        id: inserted.id,
        type: notification.type,
        actorUserId: null,
        actorNickname: null,
        referenceId: notification.referenceId,
        tableId: null,
        createdAt: now.toISOString(),
        readAt: null,
      } as never);
    }
  }
}

function isStaff(role: string): boolean {
  return role === 'ADMIN' || role === 'MODERATOR';
}

function notFound(): DomainApiException {
  return new DomainApiException(404, 'NOT_FOUND', 'La liga no existe.', {
    reason: 'LEAGUE_NOT_FOUND',
  });
}

/** Reexportado para el panel: cuántas jornadas implica un plantel (informativo). */
export { roundsForParticipants };
export type { AdminPrincipal };
export type { LeagueDivision };
export {
  leagueMatchesTable,
  leagueRoundsTable,
  leaguePrizesTable,
  leagueClosuresTable,
  leagueMovementsTable,
  leaguePrizeAwardsTable,
  leagueReschedulesTable,
  leaguesTable,
};
