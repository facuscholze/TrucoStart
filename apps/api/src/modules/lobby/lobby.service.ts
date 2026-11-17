import {
  Inject,
  Injectable,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import {
  type CreateTableRequest,
  type DeleteTableResponse,
  DeleteTableResponseSchema,
  type GameMode,
  type JoinByCodeRequest,
  type JoinPublicTableRequest,
  type LeaveTableResponse,
  LeaveTableResponseSchema,
  type ListTablesQuery,
  type PublicTableListResponse,
  PublicTableListResponseSchema,
  type RulesetCode,
  signTableInviteToken,
  type TableDetailResponse,
  TableDetailResponseSchema,
  type TableInviteResponse,
  TableInviteResponseSchema,
  type TableVisibility,
  verifyTableInviteToken,
} from '@truco/shared';
import { DomainApiException } from '../../common/api-exception.js';
import {
  RATE_LIMIT_STORE,
  type RateLimitStore,
} from '../../common/rate-limit/rate-limit-store.interface.js';
import { generateUuidV7 } from '../../common/uuidv7.js';
import { AuditRepository } from '../audit/audit.repository.js';
import type { RequestClientMeta } from '../auth/auth.config.js';
import type { AuthenticatedPrincipal } from '../auth/guards/session-auth.guard.js';
import {
  MATCHMAKING_STORE,
  type MatchmakingStore,
} from '../matchmaking/store/matchmaking-store.interface.js';
import { normalizeJoinCode } from './join-code.js';
import {
  LOBBY_RUNTIME_CONFIG,
  type LobbyRuntimeConfig,
  resolveRuleSetByCode,
  resolveRuleSetSelection,
} from './lobby.config.js';
import { type InitialSeatParticipant, LobbyRepository } from './lobby.repository.js';
import { LobbyRealtimeGateway } from './lobby-realtime.gateway.js';
import {
  type TableAggregate,
  toPublicTableSummary,
  toTableDetailResponse,
} from './lobby-row-mapper.js';
import { GAME_ROOM_PROVISIONER, type GameRoomProvisioner } from './ports/game-room-provisioner.js';

@Injectable()
export class LobbyService implements OnApplicationBootstrap, OnApplicationShutdown {
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    @Inject(LOBBY_RUNTIME_CONFIG) private readonly config: LobbyRuntimeConfig,
    @Inject(LobbyRepository) private readonly lobbyRepository: LobbyRepository,
    @Inject(LobbyRealtimeGateway) private readonly realtimeGateway: LobbyRealtimeGateway,
    @Inject(GAME_ROOM_PROVISIONER) private readonly provisioner: GameRoomProvisioner,
    @Inject(MATCHMAKING_STORE) private readonly matchmakingStore: MatchmakingStore,
    @Inject(RATE_LIMIT_STORE) private readonly rateLimitStore: RateLimitStore,
    @Inject(AuditRepository) private readonly auditRepository: AuditRepository,
  ) {}

  onApplicationBootstrap(): void {
    this.realtimeGateway.registerSnapshotLoader(async () => {
      await this.sweepExpiredTables();
      const rows = await this.lobbyRepository.listPublicTables({
        limit: this.config.lobbyWsMaxSnapshotResults,
      });
      return rows.map((agg) => toPublicTableSummary(agg));
    });

    if (this.config.cleanupIntervalMs > 0) {
      this.cleanupTimer = setInterval(() => {
        void this.sweepExpiredTables().catch(() => undefined);
      }, this.config.cleanupIntervalMs);
      this.cleanupTimer.unref();
    }
  }

  onApplicationShutdown(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  async sweepExpiredTables(): Promise<number> {
    const nowMs = this.config.nowFn();
    const now = new Date(nowMs);
    const zombieBefore = new Date(nowMs - this.config.abandonedTableTtlMs);
    const expired = await this.lobbyRepository.expireStaleTablesTx({
      now,
      zombieInProgressBefore: zombieBefore,
    });

    for (const item of expired) {
      await this.provisioner.deleteRoom(item.id).catch(() => undefined);
      this.realtimeGateway.broadcastTableRemoved(item.id, item.visibility);
    }
    return expired.length;
  }

  private async assertNotInMatchmakingQueue(userId: string): Promise<void> {
    const lookup = await this.matchmakingStore.getUserQueue(userId, this.config.nowFn());
    if (lookup.status === 'QUEUED') {
      throw new DomainApiException(
        409,
        'CONFLICT',
        'Ya estás buscando partida en matchmaking. Cancelá la cola antes de usar mesas manuales.',
        { reason: 'ALREADY_IN_MATCHMAKING_QUEUE' },
      );
    }
  }

  private mintInviteForAggregate(agg: TableAggregate): {
    readonly inviteToken: string;
    readonly inviteExpiresAt: string;
  } {
    const nowMs = this.config.nowFn();
    const exp = Math.min(nowMs + this.config.inviteTtlMs, agg.row.expiresAt.getTime());
    const inviteToken = signTableInviteToken(
      { tableId: agg.row.id, exp },
      this.config.sessionSecret,
    );
    return { inviteToken, inviteExpiresAt: new Date(exp).toISOString() };
  }

  async listPublicTables(
    query: ListTablesQuery,
    meta: RequestClientMeta = { ip: '127.0.0.1', userAgent: null },
  ): Promise<PublicTableListResponse> {
    const ipLimit = await this.rateLimitStore.consumeWindow(
      `lobby:list-tables:ip:${meta.ip}`,
      this.config.listTablesIpMax,
      this.config.listTablesWindowMs,
    );
    if (!ipLimit.allowed) {
      throw new DomainApiException(
        429,
        'RATE_LIMITED',
        'Demasiadas consultas al listado de mesas desde esta IP. Intentá nuevamente en unos segundos.',
        { retryAfterMs: ipLimit.retryAfterMs },
      );
    }

    await this.sweepExpiredTables();
    const cappedLimit = Math.min(query.limit, this.config.listTablesMaxResults);
    const aggregates = await this.lobbyRepository.listPublicTables({
      ...query,
      limit: cappedLimit,
    });
    return PublicTableListResponseSchema.parse({
      tables: aggregates.slice(0, cappedLimit).map((agg) => toPublicTableSummary(agg)),
    });
  }

  async createTable(
    principal: AuthenticatedPrincipal,
    body: CreateTableRequest,
    meta: RequestClientMeta,
  ): Promise<TableDetailResponse> {
    await this.sweepExpiredTables();
    await this.assertNotInMatchmakingQueue(principal.userId);

    const ruleset = resolveRuleSetSelection({
      rulesetCode: body.rulesetCode,
      targetScore: body.targetScore,
      flor: body.flor,
    });
    // Las mesas de práctica son siempre privadas y efímeras: no aparecen en el lobby público.
    const visibility: TableVisibility = body.practice ? 'PRIVATE' : body.visibility;
    const rulesetRow = await this.lobbyRepository.ensureRulesetRow(ruleset);
    const turnTimeoutMs = body.turnTimeoutMs ?? this.config.defaultTurnTimeoutMs;
    const nowMs = this.config.nowFn();
    const now = new Date(nowMs);
    const expiresAt = new Date(nowMs + this.config.tableTtlMs);
    const tableId = generateUuidV7();
    const targetScore: 15 | 30 = ruleset.targetScore === 15 ? 15 : 30;
    const rulesetCode = ruleset.code as RulesetCode;

    const aggregate = await this.lobbyRepository.createTableWithSeatsTx({
      tableId,
      ownerId: principal.userId,
      mode: body.mode,
      visibility,
      rulesetId: rulesetRow.id,
      rulesetCode,
      targetScore,
      florEnabled: ruleset.flor.enabled,
      turnTimeoutMs,
      now,
      expiresAt,
      participants: [
        {
          userId: principal.userId,
          nickname: principal.nickname,
          seat: 0,
          team: 0,
        },
      ],
      isPractice: Boolean(body.practice),
    });

    try {
      await this.provisioner.provisionRoom({
        roomId: tableId,
        mode: body.mode,
        visibility,
        rulesetCode,
        ruleset: ruleset as unknown as Record<string, unknown>,
        targetScore,
        florEnabled: ruleset.flor.enabled,
        turnTimeoutMs,
        ...(body.practice ? { practice: body.practice } : {}),
      });
    } catch (err) {
      await this.lobbyRepository.rollbackCreatedTable(tableId).catch(() => undefined);
      throw err;
    }

    await this.auditRepository.record({
      actorId: principal.userId,
      action: 'lobby.table.created',
      entity: 'table',
      entityId: tableId,
      ip: meta.ip,
      now,
      afterState: {
        mode: body.mode,
        visibility,
        rulesetCode,
        targetScore,
        florEnabled: ruleset.flor.enabled,
        turnTimeoutMs,
        ...(body.practice ? { practice: body.practice.difficulty } : {}),
      },
    });

    if (!body.practice) {
      this.realtimeGateway.broadcastTableUpsert(
        aggregate.row.visibility as TableVisibility,
        toPublicTableSummary(aggregate),
      );
    }

    const invite = this.mintInviteForAggregate(aggregate);
    return TableDetailResponseSchema.parse(
      toTableDetailResponse(aggregate, {
        viewerUserId: principal.userId,
        includeJoinCredentials: true,
        inviteToken: invite.inviteToken,
        inviteExpiresAt: invite.inviteExpiresAt,
      }),
    );
  }

  async createMatchmadeTable(input: {
    readonly mode: GameMode;
    readonly rulesetCode: RulesetCode;
    readonly players: ReadonlyArray<{ readonly userId: string; readonly nickname: string }>;
  }): Promise<TableAggregate> {
    await this.sweepExpiredTables();
    const ruleset = resolveRuleSetByCode(input.rulesetCode);
    const rulesetRow = await this.lobbyRepository.ensureRulesetRow(ruleset);
    const nowMs = this.config.nowFn();
    const now = new Date(nowMs);
    const expiresAt = new Date(nowMs + this.config.tableTtlMs);
    const tableId = generateUuidV7();
    const targetScore: 15 | 30 = ruleset.targetScore === 15 ? 15 : 30;
    const turnTimeoutMs = this.config.defaultTurnTimeoutMs;

    const participants: InitialSeatParticipant[] = input.players.map((p, idx) => ({
      userId: p.userId,
      nickname: p.nickname,
      seat: idx,
      team: idx % 2,
    }));

    const aggregate = await this.lobbyRepository.createTableWithSeatsTx({
      tableId,
      ownerId: participants[0]!.userId,
      mode: input.mode,
      visibility: 'PRIVATE',
      rulesetId: rulesetRow.id,
      rulesetCode: input.rulesetCode,
      targetScore,
      florEnabled: ruleset.flor.enabled,
      turnTimeoutMs,
      now,
      expiresAt,
      participants,
    });

    try {
      await this.provisioner.provisionRoom({
        roomId: tableId,
        mode: input.mode,
        visibility: 'PRIVATE',
        rulesetCode: input.rulesetCode,
        ruleset: ruleset as unknown as Record<string, unknown>,
        targetScore,
        florEnabled: ruleset.flor.enabled,
        turnTimeoutMs,
      });
    } catch (err) {
      await this.lobbyRepository.rollbackCreatedTable(tableId).catch(() => undefined);
      throw err;
    }

    return aggregate;
  }

  async getTableDetail(
    principal: AuthenticatedPrincipal,
    tableId: string,
  ): Promise<TableDetailResponse> {
    await this.sweepExpiredTables();
    const aggregate = await this.lobbyRepository.getTableWithSeats(tableId);
    if (!aggregate) {
      throw new DomainApiException(404, 'NOT_FOUND', 'La mesa solicitada no existe.', {
        reason: 'TABLE_NOT_FOUND',
      });
    }

    const isMember =
      aggregate.row.ownerId === principal.userId ||
      aggregate.activeSeats.some((s) => s.userId === principal.userId);
    const isStaff = principal.role === 'ADMIN' || principal.role === 'MODERATOR';

    if (aggregate.row.visibility === 'PRIVATE' && !isMember && !isStaff) {
      throw new DomainApiException(404, 'NOT_FOUND', 'La mesa solicitada no existe.', {
        reason: 'TABLE_NOT_FOUND',
      });
    }

    const includeCreds = (isMember || isStaff) && aggregate.row.status === 'WAITING';
    const invite = includeCreds ? this.mintInviteForAggregate(aggregate) : null;

    return TableDetailResponseSchema.parse(
      toTableDetailResponse(aggregate, {
        viewerUserId: principal.userId,
        includeJoinCredentials: includeCreds,
        inviteToken: invite?.inviteToken ?? null,
        inviteExpiresAt: invite?.inviteExpiresAt ?? null,
      }),
    );
  }

  async joinPublicTableById(
    principal: AuthenticatedPrincipal,
    tableId: string,
    body: JoinPublicTableRequest,
  ): Promise<TableDetailResponse> {
    await this.sweepExpiredTables();
    await this.assertNotInMatchmakingQueue(principal.userId);

    const aggregate = await this.lobbyRepository.joinTableAtomicallyTx({
      tableId,
      userId: principal.userId,
      nickname: principal.nickname,
      preferredSeat: body.preferredSeat,
      now: new Date(this.config.nowFn()),
      tableTtlMs: this.config.tableTtlMs,
      requirePublicVisibility: true,
    });

    this.realtimeGateway.broadcastTableUpsert(
      aggregate.row.visibility as TableVisibility,
      toPublicTableSummary(aggregate),
    );

    const invite = this.mintInviteForAggregate(aggregate);
    return TableDetailResponseSchema.parse(
      toTableDetailResponse(aggregate, {
        viewerUserId: principal.userId,
        includeJoinCredentials: true,
        inviteToken: invite.inviteToken,
        inviteExpiresAt: invite.inviteExpiresAt,
      }),
    );
  }

  async joinTableByCodeOrInvite(
    principal: AuthenticatedPrincipal,
    body: JoinByCodeRequest,
    meta: RequestClientMeta,
  ): Promise<TableDetailResponse> {
    const nowMs = this.config.nowFn();

    if (body.inviteToken) {
      const claims = verifyTableInviteToken(body.inviteToken, this.config.sessionSecret, nowMs);
      if (!claims) {
        throw new DomainApiException(
          400,
          'VALIDATION_ERROR',
          'El enlace de invitación es inválido o ya expiró.',
          { reason: 'INVALID_INVITE_TOKEN' },
        );
      }

      await this.sweepExpiredTables();
      await this.assertNotInMatchmakingQueue(principal.userId);

      const aggregate = await this.lobbyRepository.joinTableAtomicallyTx({
        tableId: claims.tableId,
        userId: principal.userId,
        nickname: principal.nickname,
        preferredSeat: body.preferredSeat,
        now: new Date(nowMs),
        tableTtlMs: this.config.tableTtlMs,
        requirePublicVisibility: false,
      });

      this.realtimeGateway.broadcastTableUpsert(
        aggregate.row.visibility as TableVisibility,
        toPublicTableSummary(aggregate),
      );
      const invite = this.mintInviteForAggregate(aggregate);
      return TableDetailResponseSchema.parse(
        toTableDetailResponse(aggregate, {
          viewerUserId: principal.userId,
          includeJoinCredentials: true,
          inviteToken: invite.inviteToken,
          inviteExpiresAt: invite.inviteExpiresAt,
        }),
      );
    }

    // Doble rate limit (por IP y por cuenta) contra fuerza bruta / adivinación de códigos de 6 chars
    const ipConsume = await this.rateLimitStore.consumeWindow(
      `lobby:joincode:ip:${meta.ip}`,
      this.config.joinCodeIpMax,
      this.config.joinCodeWindowMs,
    );
    if (!ipConsume.allowed) {
      throw new DomainApiException(
        429,
        'RATE_LIMITED',
        'Demasiados intentos de ingreso por código desde esta red. Esperá unos segundos.',
        { retryAfterMs: ipConsume.retryAfterMs },
      );
    }

    const accountConsume = await this.rateLimitStore.consumeWindow(
      `lobby:joincode:user:${principal.userId}`,
      this.config.joinCodeAccountMax,
      this.config.joinCodeWindowMs,
    );
    if (!accountConsume.allowed) {
      throw new DomainApiException(
        429,
        'RATE_LIMITED',
        'Superaste el límite de intentos de código en tu cuenta. Intentá nuevamente en un minuto.',
        { retryAfterMs: accountConsume.retryAfterMs },
      );
    }

    await this.sweepExpiredTables();
    await this.assertNotInMatchmakingQueue(principal.userId);

    const normalized = normalizeJoinCode(body.code ?? '');
    const tableId = await this.lobbyRepository.findTableIdByJoinCode(normalized);
    if (!tableId) {
      throw new DomainApiException(
        404,
        'NOT_FOUND',
        'No encontramos ninguna mesa activa con ese código.',
        { reason: 'INVALID_JOIN_CODE' },
      );
    }

    const aggregate = await this.lobbyRepository.joinTableAtomicallyTx({
      tableId,
      userId: principal.userId,
      nickname: principal.nickname,
      preferredSeat: body.preferredSeat,
      now: new Date(nowMs),
      tableTtlMs: this.config.tableTtlMs,
      requirePublicVisibility: false,
    });

    this.realtimeGateway.broadcastTableUpsert(
      aggregate.row.visibility as TableVisibility,
      toPublicTableSummary(aggregate),
    );
    const invite = this.mintInviteForAggregate(aggregate);
    return TableDetailResponseSchema.parse(
      toTableDetailResponse(aggregate, {
        viewerUserId: principal.userId,
        includeJoinCredentials: true,
        inviteToken: invite.inviteToken,
        inviteExpiresAt: invite.inviteExpiresAt,
      }),
    );
  }

  async createInviteLink(
    principal: AuthenticatedPrincipal,
    tableId: string,
  ): Promise<TableInviteResponse> {
    await this.sweepExpiredTables();
    const aggregate = await this.lobbyRepository.getTableWithSeats(tableId);
    if (!aggregate) {
      throw new DomainApiException(404, 'NOT_FOUND', 'La mesa solicitada no existe.', {
        reason: 'TABLE_NOT_FOUND',
      });
    }

    const isSeated =
      aggregate.row.ownerId === principal.userId ||
      aggregate.activeSeats.some((s) => s.userId === principal.userId);
    if (!isSeated) {
      throw new DomainApiException(
        403,
        'FORBIDDEN',
        'Solo quienes integran la mesa pueden generar un enlace de invitación.',
      );
    }
    if (aggregate.row.status !== 'WAITING') {
      throw new DomainApiException(
        409,
        'INVALID_STATE',
        'Solo se pueden generar invitaciones antes de iniciar la partida.',
        { reason: 'TABLE_ALREADY_STARTED' },
      );
    }

    const invite = this.mintInviteForAggregate(aggregate);
    return TableInviteResponseSchema.parse({
      tableId: aggregate.row.id,
      joinCode: aggregate.row.joinCode ?? '',
      inviteToken: invite.inviteToken,
      invitePath: `/join?invite=${encodeURIComponent(invite.inviteToken)}`,
      expiresAt: invite.inviteExpiresAt,
    });
  }

  async leaveTable(
    principal: AuthenticatedPrincipal,
    tableId: string,
  ): Promise<LeaveTableResponse> {
    const now = new Date(this.config.nowFn());
    const outcome = await this.lobbyRepository.leaveTableDeterministicallyTx({
      tableId,
      userId: principal.userId,
      now,
    });

    if (outcome.kind === 'CLOSED') {
      await this.provisioner.deleteRoom(outcome.tableId).catch(() => undefined);
      this.realtimeGateway.broadcastTableRemoved(outcome.tableId, outcome.visibility);
      return LeaveTableResponseSchema.parse({
        left: true,
        tableId: outcome.tableId,
        tableStatus: 'CLOSED',
        newOwnerNickname: null,
      });
    }

    this.realtimeGateway.broadcastTableUpsert(
      outcome.aggregate.row.visibility as TableVisibility,
      toPublicTableSummary(outcome.aggregate),
    );
    return LeaveTableResponseSchema.parse({
      left: true,
      tableId: outcome.aggregate.row.id,
      tableStatus: 'WAITING',
      newOwnerNickname: outcome.newOwnerNickname,
    });
  }

  async deleteTableByOwner(
    principal: AuthenticatedPrincipal,
    tableId: string,
    meta: RequestClientMeta,
  ): Promise<DeleteTableResponse> {
    const now = new Date(this.config.nowFn());
    const closed = await this.lobbyRepository.deleteTableByOwnerTx({
      tableId,
      requesterUserId: principal.userId,
      now,
    });

    await this.provisioner.deleteRoom(closed.id).catch(() => undefined);
    this.realtimeGateway.broadcastTableRemoved(closed.id, closed.visibility);

    await this.auditRepository.record({
      actorId: principal.userId,
      action: 'lobby.table.deleted',
      entity: 'table',
      entityId: closed.id,
      ip: meta.ip,
      now,
    });

    return DeleteTableResponseSchema.parse({ deleted: true, tableId: closed.id });
  }
}
