import { randomUUID } from 'node:crypto';
import {
  type Action,
  applyAction,
  buildCardKnowledge,
  BOT_DEFAULT_DIFFICULTY,
  estimateHandWinRate,
  type GameState,
  scoreEnvido,
  type RuleSet,
  viewFor,
} from '@truco/engine';
import {
  type ClientMessage,
  DEFAULT_RECONNECT_GRACE_MS,
  DEFAULT_TURN_TIMEOUT_MS,
  seatsForMode,
  teamCountForMode,
  teamForSeat,
  type ErrorCode,
  type BotDifficulty,
  type GameMode,
  type PracticeConfig,
  QUICK_CHAT_PHRASES,
  type RoomSeatInfo,
  type RulesetCode,
  type TableStatus,
  type TableVisibility,
  type WsAuthTicketClaims,
  type WsEnvelope,
} from '@truco/shared';
import type { Socket } from 'socket.io';
import {
  describeBlockedStatus,
  isMutedSnapshot,
  MODERATION_CACHE_TTL_MS,
  type ModerationLookup,
  type ModerationSnapshot,
} from './moderation.js';
import {
  type MatchLifecyclePublisher,
  NoopMatchLifecyclePublisher,
} from '../events/match-lifecycle-publisher.js';
import { decryptSeedFromStore } from '../security/commit-reveal.js';
import type {
  GameStore,
  PersistedRoomSnapshot,
  PersistedSeatBinding,
  PersistedSequencedEvent,
} from '../store/game-store.interface.js';
import { mapClientMessageToEngineAction } from './action-mapper.js';
import { botNicknameFor, botUserId, decideBotActionForSeat, pickBotDelayMs } from './bot-seats.js';
import { buildPracticeHint } from './practice-hint.js';
import {
  buildSequencedEvent,
  isEventVisibleToSeat,
  projectEngineStepToWsEvents,
} from './event-projector.js';
import {
  emitMatchCompletedLifecycle,
  emitMatchStartedLifecycle,
  emitSeatVacatedLifecycle,
} from './room-lifecycle-notifier.js';
import { createMatchStartBundle } from './room-match-starter.js';
import { deliverRejoinDeltaOrResync } from './room-rejoin-helper.js';
import {
  buildEmptyRoomSnapshot,
  createEmptySeatBinding,
  evaluateSeatJoin,
  prepareRecoveredSnapshot,
} from './room-seat-ops.js';
import {
  armTurnTimers,
  rearmTimersAfterCrashRecovery,
  scheduleDisconnectAbandonTimer,
} from './room-timer-coordinator.js';
import { computeTurnTimingWindow, RoomTimerController } from './room-timers.js';

const MAX_PROCESSED_EVENT_IDS = 256;

export interface RoomActorDeps {
  readonly store: GameStore;
  readonly seedEncryptionKey: string;
  readonly lifecyclePublisher?: MatchLifecyclePublisher;
  readonly defaultTurnTimeoutMs?: number;
  readonly reconnectGraceMs?: number;
  readonly nowFn?: () => number;
  /** Semilla de reparto fija para tests/E2E reproducibles (nunca en producción). */
  readonly dealSeedHex?: string;
  /** Rango de la demora humana simulada de los bots (por defecto 600–1.800 ms). */
  readonly botDecisionMinDelayMs?: number;
  readonly botDecisionMaxDelayMs?: number;
  /** Reemplazo automático de jugadores desconectados por un bot (desactivado por defecto). */
  readonly replaceDisconnectedWithBot?: boolean;
  /** Dificultad del bot de reemplazo (por defecto `MEDIUM`). */
  readonly botReplacementDifficulty?: BotDifficulty;
  /** PRNG para la demora de los bots (inyectable en tests para determinismo). */
  readonly botRandomFn?: () => number;
  /**
   * Consulta del estado de moderación (suspendido / bloqueado / silenciado).
   * Si no se define, el servidor de juego no aplica restricciones (tests antiguos).
   */
  readonly moderationLookup?: ModerationLookup;
}

export interface RoomCreateParams {
  readonly roomId: string;
  readonly mode: GameMode;
  readonly visibility?: TableVisibility;
  readonly rulesetCode: RulesetCode;
  readonly ruleset?: RuleSet;
  readonly turnTimeoutMs?: number;
  /** Configuración de práctica: los asientos no humanos son bots. */
  readonly practice?: PracticeConfig;
}

export class RoomActor {
  readonly roomId: string;
  private status: TableStatus;
  private readonly mode: GameMode;
  private readonly visibility: TableVisibility | undefined;
  private readonly rulesetCode: RulesetCode;
  private readonly ruleset: RuleSet | undefined;
  private readonly turnTimeoutMs: number;
  private readonly reconnectGraceMs: number;
  private readonly seats: PersistedSeatBinding[];
  private matchId: string | null;
  private matchStartedAtMs: number | null;
  private seedCommitment: string | null;
  private encryptedSeed: string | null;
  private seedHexInMemory: string | null;
  private revealedSeed: string | null;
  private gameState: GameState | null;
  private seq: number;
  private turnDeadline: number | null;
  private turnWarningAt: number | null;
  private readonly processedEventIds: string[];

  private readonly deps: Required<
    Omit<
      RoomActorDeps,
      | 'dealSeedHex'
      | 'botDecisionMinDelayMs'
      | 'botDecisionMaxDelayMs'
      | 'replaceDisconnectedWithBot'
      | 'botReplacementDifficulty'
      | 'botRandomFn'
      | 'moderationLookup'
    >
  > &
    Pick<
      RoomActorDeps,
      | 'dealSeedHex'
      | 'botDecisionMinDelayMs'
      | 'botDecisionMaxDelayMs'
      | 'replaceDisconnectedWithBot'
      | 'botReplacementDifficulty'
      | 'botRandomFn'
      | 'moderationLookup'
    >;
  private readonly moderationCache = new Map<
    string,
    { readonly atMs: number; readonly snapshot: ModerationSnapshot | null }
  >();
  private readonly practice: PracticeConfig | undefined;
  private readonly botDifficultyBySeat = new Map<number, BotDifficulty>();
  private botTimer: ReturnType<typeof setTimeout> | null = null;
  private botTurnCounter = 0;
  private readonly timers = new RoomTimerController();
  /**
   * Sockets por asiento. Un mismo asiento puede tener más de uno: pestaña y reconexión
   * conviven mientras el servidor no cierra la vieja, y jugar en dos pestañas es legítimo
   * (torneo en el navegador + cliente de escritorio). Guardar uno solo hacía que el segundo
   * `join` dejara al primero sin eventos: el jugador seguía "conectado" y no veía nada.
   */
  private readonly socketsBySeat = new Map<number, Set<Socket>>();
  private writeChain: Promise<void> = Promise.resolve();

  /** Estado público de la mesa (sin datos de juego), usado por el barrido de inactividad. */
  getTableStatus(): TableStatus {
    return this.status;
  }

  /** Cantidad de asientos con socket conectado en este momento. */
  countConnectedSeats(): number {
    return this.socketsBySeat.size;
  }

  private constructor(snapshot: PersistedRoomSnapshot, deps: RoomActorDeps) {
    this.roomId = snapshot.roomId;
    this.status = snapshot.status;
    this.mode = snapshot.mode;
    this.visibility = snapshot.visibility;
    this.practice = snapshot.practice;
    for (const seat of snapshot.seats) {
      if (seat.isBot && snapshot.practice) {
        this.botDifficultyBySeat.set(seat.seat, snapshot.practice.difficulty);
      }
    }
    this.rulesetCode = snapshot.rulesetCode;
    this.ruleset = snapshot.ruleset;
    this.turnTimeoutMs = snapshot.turnTimeoutMs;
    this.reconnectGraceMs = deps.reconnectGraceMs ?? DEFAULT_RECONNECT_GRACE_MS;
    this.seats = snapshot.seats.map((s) => ({ ...s }));
    this.matchId = snapshot.matchId;
    this.matchStartedAtMs = snapshot.matchStartedAtMs ?? null;
    this.seedCommitment = snapshot.seedCommitment;
    this.encryptedSeed = snapshot.encryptedSeed;
    this.seedHexInMemory = snapshot.encryptedSeed
      ? decryptSeedFromStore(snapshot.encryptedSeed, deps.seedEncryptionKey)
      : snapshot.revealedSeed;
    this.revealedSeed = snapshot.revealedSeed;
    this.gameState = snapshot.gameState;
    this.seq = snapshot.seq;
    this.turnDeadline = snapshot.turnDeadline;
    this.turnWarningAt = null;
    this.processedEventIds = [...snapshot.processedEventIds];
    this.deps = {
      store: deps.store,
      seedEncryptionKey: deps.seedEncryptionKey,
      lifecyclePublisher: deps.lifecyclePublisher ?? new NoopMatchLifecyclePublisher(),
      defaultTurnTimeoutMs: deps.defaultTurnTimeoutMs ?? DEFAULT_TURN_TIMEOUT_MS,
      reconnectGraceMs: this.reconnectGraceMs,
      nowFn: deps.nowFn ?? Date.now,
      ...(deps.dealSeedHex !== undefined ? { dealSeedHex: deps.dealSeedHex } : {}),
      ...(deps.botDecisionMinDelayMs !== undefined
        ? { botDecisionMinDelayMs: deps.botDecisionMinDelayMs }
        : {}),
      ...(deps.botDecisionMaxDelayMs !== undefined
        ? { botDecisionMaxDelayMs: deps.botDecisionMaxDelayMs }
        : {}),
      ...(deps.replaceDisconnectedWithBot !== undefined
        ? { replaceDisconnectedWithBot: deps.replaceDisconnectedWithBot }
        : {}),
      ...(deps.botReplacementDifficulty !== undefined
        ? { botReplacementDifficulty: deps.botReplacementDifficulty }
        : {}),
      ...(deps.botRandomFn !== undefined ? { botRandomFn: deps.botRandomFn } : {}),
      ...(deps.moderationLookup !== undefined ? { moderationLookup: deps.moderationLookup } : {}),
    };
  }

  static createFresh(params: RoomCreateParams, deps: RoomActorDeps): RoomActor {
    const nowMs = (deps.nowFn ?? Date.now)();
    const turnTimeoutMs =
      params.turnTimeoutMs ?? deps.defaultTurnTimeoutMs ?? DEFAULT_TURN_TIMEOUT_MS;
    return new RoomActor(buildEmptyRoomSnapshot({ ...params, turnTimeoutMs, nowMs }), deps);
  }

  static recoverFromSnapshot(snapshot: PersistedRoomSnapshot, deps: RoomActorDeps): RoomActor {
    const nowMs = (deps.nowFn ?? Date.now)();
    const graceMs = deps.reconnectGraceMs ?? DEFAULT_RECONNECT_GRACE_MS;
    const actor = new RoomActor(prepareRecoveredSnapshot(snapshot, nowMs, graceMs), deps);
    rearmTimersAfterCrashRecovery({
      nowMs,
      turnDeadline: actor.turnDeadline,
      turnTimeoutMs: actor.turnTimeoutMs,
      seats: actor.seats,
      timers: actor.timers,
      getState: () => ({ status: actor.status, gameState: actor.gameState }),
      isSeatDisconnected: (seat) => actor.status === 'IN_GAME' && !actor.seats[seat]?.connected,
      enqueue: (t) => actor.enqueue(t),
      applySystemAction: (a) => actor.applyEngineActionInternal(a),
    });
    return actor;
  }

  enqueue<T>(task: () => Promise<T>): Promise<T> {
    const next = this.writeChain.then(task, task);
    this.writeChain = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  dispose(): void {
    this.timers.clearAll();
    this.clearBotTimer();
    this.socketsBySeat.clear();
  }

  async persistInitialSnapshot(): Promise<void> {
    await this.deps.store.saveRoomStateAndEvents(this.buildSnapshot(this.deps.nowFn()), []);
  }

  async clearAllSeatedUsers(): Promise<void> {
    for (const s of this.seats) {
      if (s.userId && !s.isBot) {
        await this.deps.store.clearUserActiveRoom(s.userId, this.roomId);
      }
    }
  }

  private allocateSeq = (): number => ++this.seq;

  private recordEventId(eventId: string): boolean {
    if (this.processedEventIds.includes(eventId)) return false;
    this.processedEventIds.push(eventId);
    if (this.processedEventIds.length > MAX_PROCESSED_EVENT_IDS) this.processedEventIds.shift();
    return true;
  }

  private toPublicSeats(): RoomSeatInfo[] {
    return this.seats.map((s) => ({
      seat: s.seat,
      team: s.team,
      userId: s.userId,
      nickname: s.nickname,
      ready: s.ready,
      connected: s.connected,
      isBot: s.isBot,
    }));
  }

  private buildSnapshot(nowMs: number): PersistedRoomSnapshot {
    return {
      roomId: this.roomId,
      status: this.status,
      mode: this.mode,
      ...(this.visibility !== undefined ? { visibility: this.visibility } : {}),
      rulesetCode: this.rulesetCode,
      ...(this.ruleset !== undefined ? { ruleset: this.ruleset } : {}),
      turnTimeoutMs: this.turnTimeoutMs,
      seats: this.seats.map((s) => ({ ...s })),
      matchId: this.matchId,
      matchStartedAtMs: this.matchStartedAtMs,
      seedCommitment: this.seedCommitment,
      encryptedSeed: this.encryptedSeed,
      revealedSeed: this.revealedSeed,
      gameState: this.gameState,
      seq: this.seq,
      turnDeadline: this.turnDeadline,
      processedEventIds: [...this.processedEventIds],
      updatedAt: nowMs,
      ...(this.practice !== undefined ? { practice: this.practice } : {}),
    };
  }

  private async persistAndEmit(
    nowMs: number,
    events: readonly PersistedSequencedEvent[],
  ): Promise<void> {
    await this.deps.store.saveRoomStateAndEvents(this.buildSnapshot(nowMs), events);
    for (const ev of events) {
      for (const s of this.seats) {
        const sockets = this.socketsBySeat.get(s.seat);
        if (!sockets || !isEventVisibleToSeat(ev.audience, s.seat, s.team)) continue;
        for (const sock of sockets) {
          sock.emit('envelope', {
            eventId: ev.eventId,
            seq: ev.seq,
            ts: ev.ts,
            type: ev.type,
            payload: ev.payload,
          } satisfies WsEnvelope);
        }
      }
    }
  }

  private sendSocketError(
    socket: Socket,
    code: ErrorCode,
    message: string,
    refEventId?: string,
  ): void {
    socket.emit('envelope', {
      eventId: randomUUID(),
      ts: this.deps.nowFn(),
      type: 'error',
      payload: { code, message, ...(refEventId ? { refEventId } : {}) },
    } satisfies WsEnvelope);
  }

  private buildTableStateEvent(nowMs: number): PersistedSequencedEvent {
    return buildSequencedEvent(
      this.allocateSeq,
      nowMs,
      'table.state',
      {
        roomId: this.roomId,
        status: this.status,
        mode: this.mode,
        rulesetCode: this.rulesetCode,
        turnTimeoutMs: this.turnTimeoutMs,
        seats: this.toPublicSeats(),
        matchId: this.matchId,
      },
      { kind: 'ALL' },
    );
  }

  private refreshTurnTimers(nowMs: number): void {
    const window = armTurnTimers(
      {
        roomId: this.roomId,
        turnTimeoutMs: this.turnTimeoutMs,
        timers: this.timers,
        getNow: this.deps.nowFn,
        getState: () => ({ status: this.status, gameState: this.gameState }),
        allocateSeq: this.allocateSeq,
        persistAndEmit: (ts, evs) => this.persistAndEmit(ts, evs),
        applySystemAction: (a) => this.applyEngineActionInternal(a),
        enqueue: (t) => this.enqueue(t),
      },
      nowMs,
    );
    this.turnDeadline = window.deadline;
    this.turnWarningAt = window.warningAt;
  }

  async handleMessage(
    socket: Socket,
    claims: WsAuthTicketClaims,
    msg: ClientMessage,
  ): Promise<void> {
    return this.enqueue(async () => {
      if (msg.type === 'table.join') return this.onTableJoin(socket, claims, msg);
      if (msg.type === 'game.rejoin') return this.onGameRejoin(socket, claims, msg);
      if (!this.recordEventId(msg.eventId)) return;

      const seatIdx = this.seats.findIndex((s) => s.userId === claims.userId);
      if (seatIdx === -1) {
        this.sendSocketError(socket, 'FORBIDDEN', 'No pertenecés a esta sala', msg.eventId);
        return;
      }
      if (msg.type === 'table.leave') return this.onTableLeave(seatIdx);
      if (msg.type === 'table.ready') return this.onTableReady(seatIdx, msg.payload.ready);
      if (msg.type === 'chat.quick')
        return this.onChatQuick(socket, seatIdx, msg.payload.phraseId, msg.eventId);
      if (msg.type === 'game.signal' && (await this.isSeatMuted(seatIdx))) {
        this.sendSocketError(
          socket,
          'FORBIDDEN',
          'Estás silenciado: no podés enviar señas ni emotes.',
          msg.eventId,
        );
        return;
      }
      if (msg.type === 'practice.hint') return this.onPracticeHint(socket, seatIdx, msg.eventId);
      return this.onPlayerGameIntent(socket, seatIdx, msg);
    });
  }

  /** Estado de moderación con cache corto (autoritativo en `apps/api`). */
  private async getModerationSnapshot(userId: string): Promise<ModerationSnapshot | null> {
    if (!this.deps.moderationLookup) return null;
    const now = this.deps.nowFn();
    const cached = this.moderationCache.get(userId);
    if (cached && now - cached.atMs < MODERATION_CACHE_TTL_MS) return cached.snapshot;
    let snapshot: ModerationSnapshot | null = null;
    try {
      snapshot = await this.deps.moderationLookup(userId);
    } catch {
      // Si la API no responde, no se bloquea al jugador por una falla de red.
      snapshot = null;
    }
    this.moderationCache.set(userId, { atMs: now, snapshot });
    return snapshot;
  }

  /** Suspendidos y bloqueados no pueden entrar ni reconectarse a la mesa. */
  private async assertAccountCanPlay(
    socket: Socket,
    userId: string,
    refEventId?: string,
  ): Promise<boolean> {
    const snapshot = await this.getModerationSnapshot(userId);
    if (!snapshot || snapshot.accountStatus === 'ACTIVE') return true;
    this.sendSocketError(socket, 'FORBIDDEN', describeBlockedStatus(snapshot), refEventId);
    return false;
  }

  private async isSeatMuted(seatIdx: number): Promise<boolean> {
    const userId = this.seats[seatIdx]?.userId;
    if (!userId) return false;
    const snapshot = await this.getModerationSnapshot(userId);
    return isMutedSnapshot(snapshot, this.deps.nowFn());
  }

  private async onTableJoin(
    socket: Socket,
    claims: WsAuthTicketClaims,
    msg: Extract<ClientMessage, { type: 'table.join' }>,
  ): Promise<void> {
    if (!this.recordEventId(msg.eventId)) return;
    if (!(await this.assertAccountCanPlay(socket, claims.userId, msg.eventId))) return;
    const activeOtherRoom = await this.deps.store.getUserActiveRoom(claims.userId);
    if (activeOtherRoom && activeOtherRoom !== this.roomId) {
      this.sendSocketError(
        socket,
        'CONFLICT',
        `Ya tenés partida activa en ${activeOtherRoom}`,
        msg.eventId,
      );
      return;
    }

    const outcome = evaluateSeatJoin(this.seats, this.status, claims, msg.payload.preferredSeat);
    if (!outcome.ok) {
      this.sendSocketError(socket, outcome.code, outcome.message, msg.eventId);
      return;
    }

    this.attachSocket(outcome.seatIdx, socket);
    if (!outcome.alreadySeated) await this.deps.store.setUserActiveRoom(claims.userId, this.roomId);
    const now = this.deps.nowFn();
    await this.persistAndEmit(now, [this.buildTableStateEvent(now)]);

    // Mesa de práctica: los bots ya están listos, así que el humano arranca jugando al entrar.
    if (this.practice && this.status !== 'IN_GAME') {
      this.seats[outcome.seatIdx] = { ...this.seats[outcome.seatIdx]!, ready: true };
      await this.startMatchIfAllReady(now);
    }
  }

  /** Suma un socket al asiento sin reemplazar los que ya estaban conectados. */
  private attachSocket(seatIdx: number, socket: Socket): void {
    const sockets = this.socketsBySeat.get(seatIdx) ?? new Set<Socket>();
    sockets.add(socket);
    this.socketsBySeat.set(seatIdx, sockets);
  }

  private async onTableLeave(seatIdx: number): Promise<void> {
    const seatObj = this.seats[seatIdx]!;
    this.socketsBySeat.delete(seatIdx);
    if (seatObj.userId) await this.deps.store.clearUserActiveRoom(seatObj.userId, this.roomId);
    if (this.status === 'IN_GAME') {
      await this.applyEngineActionInternal({ type: 'SYSTEM_ABANDON', seat: seatIdx });
      return;
    }
    const now = this.deps.nowFn();
    this.seats[seatIdx] = createEmptySeatBinding(seatIdx);
    await this.persistAndEmit(now, [this.buildTableStateEvent(now)]);
    if (seatObj.userId) {
      await emitSeatVacatedLifecycle({
        publisher: this.deps.lifecyclePublisher,
        roomId: this.roomId,
        userId: seatObj.userId,
        seat: seatIdx,
        vacatedAtMs: now,
      });
    }
  }

  /**
   * Expulsión inmediata disparada por una sanción (API → game-server, RPC firmado).
   * Avisa al socket con el motivo, abandona la partida en curso y libera el asiento.
   * No espera al caché de moderación: el efecto es inmediato.
   */
  async evictUser(userId: string, reason: string, disconnect: boolean): Promise<boolean> {
    this.moderationCache.delete(userId);
    const seatIdx = this.seats.findIndex((s) => s.userId === userId);
    if (seatIdx === -1) return false;

    const sockets = this.socketsBySeat.get(seatIdx);
    if (sockets && sockets.size > 0) {
      for (const socket of sockets) {
        this.sendSocketError(socket, 'FORBIDDEN', reason);
        if (disconnect) socket.disconnect(true);
      }
      if (disconnect) this.socketsBySeat.delete(seatIdx);
    }

    if (!disconnect) {
      // Silencio: se corta el chat pero el jugador sigue en la mesa.
      await this.persistAndEmit(this.deps.nowFn(), [this.buildTableStateEvent(this.deps.nowFn())]);
      return true;
    }

    await this.onTableLeave(seatIdx);
    return true;
  }

  /** Invalida el caché de moderación (p. ej. al aplicarse un silencio). */
  invalidateModerationCache(userId?: string): void {
    if (userId) {
      this.moderationCache.delete(userId);
      return;
    }
    this.moderationCache.clear();
  }

  private async onTableReady(seatIdx: number, ready: boolean): Promise<void> {
    if (this.status === 'IN_GAME') return;
    const now = this.deps.nowFn();
    this.seats[seatIdx] = { ...this.seats[seatIdx]!, ready };
    if (!this.seats.every((s) => s.userId !== null && s.ready)) {
      await this.persistAndEmit(now, [this.buildTableStateEvent(now)]);
      return;
    }
    await this.startMatchIfAllReady(now);
  }

  private async startMatchIfAllReady(now: number): Promise<void> {
    if (this.status === 'IN_GAME' || (this.gameState && this.gameState.status !== 'FINISHED'))
      return;
    if (!this.seats.every((s) => s.userId !== null && s.ready)) {
      await this.persistAndEmit(now, [this.buildTableStateEvent(now)]);
      return;
    }
    // Invariante de mesa: los equipos se derivan del modo. Si alguien sentó a los jugadores con
    // `seat % 2` en una mesa de 6, aquí se detecta antes de repartir cartas.
    const expectedSeats = seatsForMode(this.mode);
    const teamsOk =
      this.seats.length === expectedSeats &&
      this.seats.every((s, idx) => s.team === teamForSeat(this.mode, idx)) &&
      new Set(this.seats.map((s) => s.team)).size === teamCountForMode(this.mode);
    if (!teamsOk) {
      // Nunca se reparten cartas con una mesa inconsistente: se deja la mesa en WAITING y se
      // avisa por el canal de eventos para que el operador lo vea.
      await this.persistAndEmit(now, [this.buildTableStateEvent(now)]);
      return;
    }

    this.status = 'IN_GAME';
    for (const s of this.seats) {
      if (s.userId && !s.isBot) {
        await this.deps.store.setUserActiveRoom(s.userId, this.roomId);
      }
    }
    const timing = computeTurnTimingWindow(now, this.turnTimeoutMs);
    this.turnDeadline = timing.deadline;
    this.turnWarningAt = timing.warningAt;

    const started = createMatchStartBundle({
      roomId: this.roomId,
      rulesetCode: this.rulesetCode,
      ...(this.ruleset !== undefined ? { ruleset: this.ruleset } : {}),
      publicSeats: this.toPublicSeats(),
      seedEncryptionKey: this.deps.seedEncryptionKey,
      turnDeadline: this.turnDeadline,
      turnWarningAt: this.turnWarningAt,
      nowMs: now,
      tableStateEvent: this.buildTableStateEvent(now),
      allocateSeq: this.allocateSeq,
      ...(this.deps.dealSeedHex !== undefined ? { dealSeedHex: this.deps.dealSeedHex } : {}),
    });

    this.matchId = started.matchId;
    this.matchStartedAtMs = now;
    this.seedHexInMemory = started.seedHex;
    this.seedCommitment = started.seedCommitment;
    this.encryptedSeed = started.encryptedSeed;
    this.revealedSeed = null;
    this.gameState = started.gameState;
    this.refreshTurnTimers(now);
    await this.persistAndEmit(now, started.events);
    if (!this.practice) {
      await emitMatchStartedLifecycle({
        publisher: this.deps.lifecyclePublisher,
        roomId: this.roomId,
        matchId: started.matchId,
        startedAtMs: now,
        seats: this.seats,
        practice: false,
      });
    }
    this.scheduleBotTurnIfNeeded();
  }

  private async onChatQuick(
    socket: Socket,
    seatIdx: number,
    phraseId: string,
    refEventId?: string,
  ): Promise<void> {
    if (await this.isSeatMuted(seatIdx)) {
      this.sendSocketError(
        socket,
        'FORBIDDEN',
        'Estás silenciado: no podés usar el chat rápido ni los emotes.',
        refEventId,
      );
      return;
    }
    const phrase = QUICK_CHAT_PHRASES.find((p) => p.id === phraseId);
    if (!phrase) return;
    const now = this.deps.nowFn();
    await this.persistAndEmit(now, [
      buildSequencedEvent(
        this.allocateSeq,
        now,
        'chat.quickMessage',
        {
          roomId: this.roomId,
          seat: seatIdx,
          nickname: this.seats[seatIdx]?.nickname ?? `Jugador ${seatIdx}`,
          phraseId: phrase.id,
          text: phrase.text,
        },
        { kind: 'ALL' },
      ),
    ]);
  }

  private async onPlayerGameIntent(
    socket: Socket,
    seatIdx: number,
    msg: ClientMessage,
  ): Promise<void> {
    if (this.status !== 'IN_GAME' || !this.gameState) {
      this.sendSocketError(socket, 'INVALID_STATE', 'No hay una partida activa', msg.eventId);
      return;
    }
    const engineAction = mapClientMessageToEngineAction(
      msg,
      seatIdx,
      viewFor(this.gameState, seatIdx),
    );
    if (!engineAction) {
      this.sendSocketError(
        socket,
        'RULE_VIOLATION',
        'Acción no válida en este estado',
        msg.eventId,
      );
      return;
    }
    await this.applyEngineActionInternal(engineAction, socket, msg.eventId);
  }

  private async applyEngineActionInternal(
    action: Action,
    callerSocket?: Socket,
    refEventId?: string,
  ): Promise<void> {
    if (!this.gameState) return;
    const res = applyAction(this.gameState, action);
    if (!res.ok) {
      if (callerSocket)
        this.sendSocketError(callerSocket, 'RULE_VIOLATION', res.error.message, refEventId);
      return;
    }

    const now = this.deps.nowFn();
    this.gameState = res.value.state;
    const matchJustFinished = this.gameState.status === 'FINISHED';
    const snapshotSeatsAtEnd = this.seats.map((s) => ({ ...s }));

    if (matchJustFinished) {
      this.timers.clearAll();
      this.status = 'FINISHED';
      this.turnDeadline = null;
      this.turnWarningAt = null;
      this.revealedSeed = this.seedHexInMemory;
      this.encryptedSeed = null;
      for (let i = 0; i < this.seats.length; i++) {
        const s = this.seats[i]!;
        this.seats[i] = { ...s, ready: false };
        if (s.userId && !s.isBot) await this.deps.store.clearUserActiveRoom(s.userId, this.roomId);
      }
    } else {
      this.refreshTurnTimers(now);
    }

    const outbound = projectEngineStepToWsEvents({
      roomId: this.roomId,
      matchId: this.matchId!,
      seedCommitment: this.seedCommitment!,
      revealedSeed: this.revealedSeed,
      state: this.gameState,
      domainEvents: res.value.events,
      turnDeadline: this.turnDeadline,
      turnWarningAt: this.turnWarningAt,
      nowMs: now,
      allocateSeq: this.allocateSeq,
    });
    await this.persistAndEmit(now, outbound);

    if (!matchJustFinished) this.scheduleBotTurnIfNeeded();

    // La práctica persiste su resultado para progresión con tope reducido, sin rating competitivo.
    const hasHumanPlayer = snapshotSeatsAtEnd.some((seat) => seat.userId !== null && !seat.isBot);
    if (
      matchJustFinished &&
      hasHumanPlayer &&
      this.matchId &&
      this.seedCommitment &&
      this.revealedSeed
    ) {
      await emitMatchCompletedLifecycle({
        publisher: this.deps.lifecyclePublisher,
        store: this.deps.store,
        roomId: this.roomId,
        matchId: this.matchId,
        mode: this.mode,
        rulesetCode: this.rulesetCode,
        seedCommitment: this.seedCommitment,
        seedReveal: this.revealedSeed,
        startedAtMs: this.matchStartedAtMs ?? now,
        endedAtMs: now,
        finalState: this.gameState,
        triggeringAction: action,
        seats: snapshotSeatsAtEnd,
        practice: Boolean(this.practice),
      });
    }
  }

  /**
   * Reemplazo de un jugador desconectado por un bot (feature opt-in, desactivada por defecto).
   * El bot ocupa el asiento con la dificultad configurada y sigue jugando desde `PlayerView`.
   */
  private async convertSeatToBot(seatIdx: number, nowMs: number): Promise<void> {
    const seat = this.seats[seatIdx];
    if (!seat || seat.isBot || !seat.userId) return;
    const previousUserId = seat.userId;
    const difficulty: BotDifficulty =
      this.practice?.difficulty ?? this.deps.botReplacementDifficulty ?? BOT_DEFAULT_DIFFICULTY;
    this.botDifficultyBySeat.set(seatIdx, difficulty);
    this.seats[seatIdx] = {
      ...seat,
      userId: botUserId(seatIdx),
      nickname: botNicknameFor(difficulty, seatIdx),
      sessionId: null,
      ready: true,
      connected: true,
      disconnectedAt: null,
      graceDeadline: null,
      isBot: true,
    };
    this.timers.clearDisconnectGrace(seatIdx);
    await this.deps.store.clearUserActiveRoom(previousUserId, this.roomId);
    await this.persistAndEmit(nowMs, [this.buildTableStateEvent(nowMs)]);
    this.scheduleBotTurnIfNeeded();
  }

  private clearBotTimer(): void {
    if (this.botTimer) {
      clearTimeout(this.botTimer);
      this.botTimer = null;
    }
  }

  private botDifficultyForSeat(seat: number): BotDifficulty {
    return (
      this.botDifficultyBySeat.get(seat) ?? this.practice?.difficulty ?? BOT_DEFAULT_DIFFICULTY
    );
  }

  /**
   * Programa la próxima decisión de un bot con demora humana simulada.
   * La decisión se toma SIEMPRE desde `viewFor(state, seat)` (nunca del estado completo).
   */
  private scheduleBotTurnIfNeeded(): void {
    this.clearBotTimer();
    if (this.status !== 'IN_GAME' || !this.gameState) return;
    if (this.gameState.status !== 'IN_PROGRESS') return;

    const seat = this.gameState.hand.activeSeat;
    const binding = this.seats[seat];
    if (!binding?.isBot) return;

    const difficulty = this.botDifficultyForSeat(seat);
    const random = this.deps.botRandomFn ?? Math.random;
    const delay = pickBotDelayMs({
      minMs: this.deps.botDecisionMinDelayMs ?? 600,
      maxMs: this.deps.botDecisionMaxDelayMs ?? 1_800,
      random01: random(),
    });

    this.botTimer = setTimeout(
      () => {
        this.botTimer = null;
        void this.enqueue(() => this.runBotTurn(seat, difficulty));
      },
      Math.max(1, delay),
    );
  }

  private async runBotTurn(seat: number, difficulty: BotDifficulty): Promise<void> {
    if (this.status !== 'IN_GAME' || !this.gameState) return;
    if (this.gameState.status !== 'IN_PROGRESS') return;
    if (this.gameState.hand.activeSeat !== seat) return;
    if (!this.seats[seat]?.isBot) return;

    const view = viewFor(this.gameState, seat);
    const action = decideBotActionForSeat({
      view,
      difficulty,
      seed: this.botTurnCounter++ + this.seq * 7919,
    });
    await this.applyEngineActionInternal(action);
  }

  private async onPracticeHint(socket: Socket, seatIdx: number, refEventId: string): Promise<void> {
    if (!this.practice) {
      this.sendSocketError(
        socket,
        'FORBIDDEN',
        'Las pistas de entrenamiento solo existen en partidas de práctica',
        refEventId,
      );
      return;
    }
    if (this.status !== 'IN_GAME' || !this.gameState) {
      this.sendSocketError(socket, 'INVALID_STATE', 'No hay una partida activa', refEventId);
      return;
    }
    if (this.gameState.status !== 'IN_PROGRESS') return;

    const view = viewFor(this.gameState, seatIdx);
    const hint = buildPracticeHint({
      view,
      envidoTanto: scoreEnvido(view.hand.myInitialCards),
      handStrength: estimateHandWinRate(view, buildCardKnowledge(view)),
    });
    const now = this.deps.nowFn();
    await this.persistAndEmit(now, [
      buildSequencedEvent(
        this.allocateSeq,
        now,
        'practice.hint',
        {
          roomId: this.roomId,
          seat: seatIdx,
          suggestedAction: hint.suggestedAction,
          explanation: hint.explanation,
          difficulty: this.practice.difficulty,
        },
        { kind: 'SEAT', seat: seatIdx },
      ),
    ]);
  }

  async handleDisconnect(socket: Socket, userId: string): Promise<void> {
    return this.enqueue(async () => {
      const seatIdx = this.seats.findIndex((s) => s.userId === userId);
      if (seatIdx === -1) return;
      const sockets = this.socketsBySeat.get(seatIdx);
      // Un socket que no es el registrado, o que deja el asiento con otro socket vivo, no
      // desconecta al jugador: sólo se saca de la lista.
      if (!sockets?.delete(socket)) return;
      if (sockets.size > 0) return;
      this.socketsBySeat.delete(seatIdx);
      const now = this.deps.nowFn();
      if (this.status !== 'IN_GAME') {
        this.seats[seatIdx] = { ...this.seats[seatIdx]!, connected: false };
        await this.persistAndEmit(now, [this.buildTableStateEvent(now)]);
        return;
      }

      if (this.deps.replaceDisconnectedWithBot) {
        await this.convertSeatToBot(seatIdx, now);
        return;
      }

      const graceDeadline = now + this.reconnectGraceMs;
      this.seats[seatIdx] = {
        ...this.seats[seatIdx]!,
        connected: false,
        disconnectedAt: now,
        graceDeadline,
      };
      await this.persistAndEmit(now, [
        buildSequencedEvent(
          this.allocateSeq,
          now,
          'player.disconnected',
          { roomId: this.roomId, seat: seatIdx, userId, graceDeadline },
          { kind: 'ALL' },
        ),
      ]);
      scheduleDisconnectAbandonTimer({
        timers: this.timers,
        seat: seatIdx,
        delayMs: this.reconnectGraceMs,
        enqueue: (t) => this.enqueue(t),
        shouldAbandon: () =>
          this.status === 'IN_GAME' &&
          !this.seats[seatIdx]?.connected &&
          !this.seats[seatIdx]?.isBot,
        applySystemAction: (a) => this.applyEngineActionInternal(a),
      });
    });
  }

  private async onGameRejoin(
    socket: Socket,
    claims: WsAuthTicketClaims,
    msg: Extract<ClientMessage, { type: 'game.rejoin' }>,
  ): Promise<void> {
    if (!(await this.assertAccountCanPlay(socket, claims.userId, msg.eventId))) return;
    const seatIdx = this.seats.findIndex((s) => s.userId === claims.userId);
    if (seatIdx === -1 || this.seats[seatIdx]?.sessionId !== msg.payload.sessionId) {
      this.sendSocketError(socket, 'FORBIDDEN', 'Sesión de reconexión inválida', msg.eventId);
      return;
    }

    const now = this.deps.nowFn();
    const prevSeq = this.seq;
    this.timers.clearDisconnectGrace(seatIdx);
    this.attachSocket(seatIdx, socket);
    this.seats[seatIdx] = {
      ...this.seats[seatIdx]!,
      connected: true,
      disconnectedAt: null,
      graceDeadline: null,
    };

    await deliverRejoinDeltaOrResync({
      socket,
      store: this.deps.store,
      roomId: this.roomId,
      seatIdx,
      team: this.seats[seatIdx]!.team,
      lastSeq: msg.payload.lastSeq,
      currentSeq: prevSeq,
      nowMs: now,
      matchId: this.matchId,
      seedCommitment: this.seedCommitment,
      turnDeadline: this.turnDeadline,
      gameState: this.gameState,
    });

    await this.persistAndEmit(now, [
      buildSequencedEvent(
        this.allocateSeq,
        now,
        'player.reconnected',
        { roomId: this.roomId, seat: seatIdx, userId: claims.userId },
        { kind: 'ALL' },
      ),
    ]);
  }
}
