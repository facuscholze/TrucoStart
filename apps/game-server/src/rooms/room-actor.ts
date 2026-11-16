import { randomUUID } from 'node:crypto';
import { type Action, applyAction, type GameState, viewFor } from '@truco/engine';
import {
  type ClientMessage,
  DEFAULT_RECONNECT_GRACE_MS,
  DEFAULT_TURN_TIMEOUT_MS,
  type ErrorCode,
  type GameMode,
  QUICK_CHAT_PHRASES,
  type RoomSeatInfo,
  type RulesetCode,
  type TableStatus,
  type WsAuthTicketClaims,
  type WsEnvelope,
} from '@truco/shared';
import type { Socket } from 'socket.io';
import { decryptSeedFromStore } from '../security/commit-reveal.js';
import type {
  GameStore,
  PersistedRoomSnapshot,
  PersistedSeatBinding,
  PersistedSequencedEvent,
} from '../store/game-store.interface.js';
import { mapClientMessageToEngineAction } from './action-mapper.js';
import {
  buildSequencedEvent,
  isEventVisibleToSeat,
  projectEngineStepToWsEvents,
} from './event-projector.js';
import { createMatchStartBundle } from './room-match-starter.js';
import { deliverRejoinDeltaOrResync } from './room-rejoin-helper.js';
import {
  buildEmptyRoomSnapshot,
  createEmptySeatBinding,
  evaluateSeatJoin,
  prepareRecoveredSnapshot,
} from './room-seat-ops.js';
import { computeTurnTimingWindow, RoomTimerController } from './room-timers.js';

const MAX_PROCESSED_EVENT_IDS = 256;

export interface RoomActorDeps {
  readonly store: GameStore;
  readonly seedEncryptionKey: string;
  readonly defaultTurnTimeoutMs?: number;
  readonly reconnectGraceMs?: number;
  readonly nowFn?: () => number;
}

export interface RoomCreateParams {
  readonly roomId: string;
  readonly mode: GameMode;
  readonly rulesetCode: RulesetCode;
  readonly turnTimeoutMs?: number;
}

export class RoomActor {
  readonly roomId: string;
  private status: TableStatus;
  private readonly mode: GameMode;
  private readonly rulesetCode: RulesetCode;
  private readonly turnTimeoutMs: number;
  private readonly reconnectGraceMs: number;
  private readonly seats: PersistedSeatBinding[];
  private matchId: string | null;
  private seedCommitment: string | null;
  private encryptedSeed: string | null;
  private seedHexInMemory: string | null;
  private revealedSeed: string | null;
  private gameState: GameState | null;
  private seq: number;
  private turnDeadline: number | null;
  private turnWarningAt: number | null;
  private readonly processedEventIds: string[];

  private readonly deps: Required<RoomActorDeps>;
  private readonly timers = new RoomTimerController();
  private readonly socketsBySeat = new Map<number, Socket>();
  private writeChain: Promise<void> = Promise.resolve();

  private constructor(snapshot: PersistedRoomSnapshot, deps: RoomActorDeps) {
    this.roomId = snapshot.roomId;
    this.status = snapshot.status;
    this.mode = snapshot.mode;
    this.rulesetCode = snapshot.rulesetCode;
    this.turnTimeoutMs = snapshot.turnTimeoutMs;
    this.reconnectGraceMs = deps.reconnectGraceMs ?? DEFAULT_RECONNECT_GRACE_MS;
    this.seats = snapshot.seats.map((s) => ({ ...s }));
    this.matchId = snapshot.matchId;
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
      defaultTurnTimeoutMs: deps.defaultTurnTimeoutMs ?? DEFAULT_TURN_TIMEOUT_MS,
      reconnectGraceMs: this.reconnectGraceMs,
      nowFn: deps.nowFn ?? Date.now,
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
    actor.rearmRecoveredTimers();
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
    this.socketsBySeat.clear();
  }

  private allocateSeq = (): number => {
    this.seq += 1;
    return this.seq;
  };

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
    }));
  }

  private buildSnapshot(nowMs: number): PersistedRoomSnapshot {
    return {
      roomId: this.roomId,
      status: this.status,
      mode: this.mode,
      rulesetCode: this.rulesetCode,
      turnTimeoutMs: this.turnTimeoutMs,
      seats: this.seats.map((s) => ({ ...s })),
      matchId: this.matchId,
      seedCommitment: this.seedCommitment,
      encryptedSeed: this.encryptedSeed,
      revealedSeed: this.revealedSeed,
      gameState: this.gameState,
      seq: this.seq,
      turnDeadline: this.turnDeadline,
      processedEventIds: [...this.processedEventIds],
      updatedAt: nowMs,
    };
  }

  private async persistAndEmit(
    nowMs: number,
    events: readonly PersistedSequencedEvent[],
  ): Promise<void> {
    await this.deps.store.saveRoomStateAndEvents(this.buildSnapshot(nowMs), events);
    for (const ev of events) {
      for (const s of this.seats) {
        const sock = this.socketsBySeat.get(s.seat);
        if (sock && isEventVisibleToSeat(ev.audience, s.seat, s.team)) {
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

  private armTurnTimersForCurrentState(nowMs: number): void {
    if (this.status !== 'IN_GAME' || !this.gameState || this.gameState.status !== 'IN_PROGRESS') {
      this.timers.clearTurnTimers();
      this.turnDeadline = null;
      this.turnWarningAt = null;
      return;
    }
    const timing = computeTurnTimingWindow(nowMs, this.turnTimeoutMs);
    this.turnDeadline = timing.deadline;
    this.turnWarningAt = timing.warningAt;
    const expectedHand = this.gameState.hand.handNumber;
    const expectedActive = this.gameState.hand.activeSeat;

    this.timers.scheduleTurnTimers(
      timing.warningDelayMs,
      timing.timeoutDelayMs,
      () => {
        void this.enqueue(async () => {
          if (
            this.status !== 'IN_GAME' ||
            this.gameState?.hand.handNumber !== expectedHand ||
            this.gameState.hand.activeSeat !== expectedActive
          ) {
            return;
          }
          const ts = this.deps.nowFn();
          await this.persistAndEmit(ts, [
            buildSequencedEvent(
              this.allocateSeq,
              ts,
              'game.turn',
              {
                roomId: this.roomId,
                handNumber: this.gameState.hand.handNumber,
                seat: this.gameState.hand.activeSeat,
                responderTeam: this.gameState.hand.responderTeam,
                deadline: this.turnDeadline!,
                warningAt: this.turnWarningAt!,
                isWarning: true,
              },
              { kind: 'ALL' },
            ),
          ]);
        });
      },
      () => {
        void this.enqueue(async () => {
          if (
            this.status === 'IN_GAME' &&
            this.gameState?.hand.handNumber === expectedHand &&
            this.gameState.hand.activeSeat === expectedActive
          ) {
            await this.applyEngineActionInternal({ type: 'SYSTEM_TIMEOUT', seat: expectedActive });
          }
        });
      },
    );
  }

  private rearmRecoveredTimers(): void {
    const now = this.deps.nowFn();
    if (this.status !== 'IN_GAME' || this.gameState?.status !== 'IN_PROGRESS') return;

    const remainingTurn = this.turnDeadline
      ? Math.max(50, this.turnDeadline - now)
      : this.turnTimeoutMs;
    const expectedHand = this.gameState.hand.handNumber;
    const expectedActive = this.gameState.hand.activeSeat;
    this.timers.scheduleTurnTimers(
      Math.max(20, Math.floor(remainingTurn * 0.7)),
      remainingTurn,
      () => undefined,
      () => {
        void this.enqueue(async () => {
          if (
            this.status === 'IN_GAME' &&
            this.gameState?.hand.handNumber === expectedHand &&
            this.gameState.hand.activeSeat === expectedActive
          ) {
            await this.applyEngineActionInternal({ type: 'SYSTEM_TIMEOUT', seat: expectedActive });
          }
        });
      },
    );
    for (const s of this.seats) {
      if (s.userId !== null && !s.connected && s.graceDeadline !== null) {
        this.scheduleGraceAbandon(s.seat, Math.max(50, s.graceDeadline - now));
      }
    }
  }

  private scheduleGraceAbandon(seat: number, delayMs: number): void {
    this.timers.scheduleDisconnectGrace(seat, delayMs, () => {
      void this.enqueue(async () => {
        if (this.status === 'IN_GAME' && this.seats[seat] && !this.seats[seat]!.connected) {
          await this.applyEngineActionInternal({ type: 'SYSTEM_ABANDON', seat });
        }
      });
    });
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
      if (msg.type === 'chat.quick') return this.onChatQuick(seatIdx, msg.payload.phraseId);
      return this.onPlayerGameIntent(socket, seatIdx, msg);
    });
  }

  private async onTableJoin(
    socket: Socket,
    claims: WsAuthTicketClaims,
    msg: Extract<ClientMessage, { type: 'table.join' }>,
  ): Promise<void> {
    if (!this.recordEventId(msg.eventId)) return;
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

    this.socketsBySeat.set(outcome.seatIdx, socket);
    if (!outcome.alreadySeated) {
      await this.deps.store.setUserActiveRoom(claims.userId, this.roomId);
    }
    const now = this.deps.nowFn();
    await this.persistAndEmit(now, [this.buildTableStateEvent(now)]);
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
  }

  private async onTableReady(seatIdx: number, ready: boolean): Promise<void> {
    if (this.status === 'IN_GAME') return;
    const now = this.deps.nowFn();
    this.seats[seatIdx] = { ...this.seats[seatIdx]!, ready };
    if (!this.seats.every((s) => s.userId !== null && s.ready)) {
      await this.persistAndEmit(now, [this.buildTableStateEvent(now)]);
      return;
    }

    this.status = 'IN_GAME';
    const timing = computeTurnTimingWindow(now, this.turnTimeoutMs);
    this.turnDeadline = timing.deadline;
    this.turnWarningAt = timing.warningAt;

    const started = createMatchStartBundle({
      roomId: this.roomId,
      rulesetCode: this.rulesetCode,
      publicSeats: this.toPublicSeats(),
      seedEncryptionKey: this.deps.seedEncryptionKey,
      turnDeadline: this.turnDeadline,
      turnWarningAt: this.turnWarningAt,
      nowMs: now,
      tableStateEvent: this.buildTableStateEvent(now),
      allocateSeq: this.allocateSeq,
    });

    this.matchId = started.matchId;
    this.seedHexInMemory = started.seedHex;
    this.seedCommitment = started.seedCommitment;
    this.encryptedSeed = started.encryptedSeed;
    this.revealedSeed = null;
    this.gameState = started.gameState;
    this.armTurnTimersForCurrentState(now);
    await this.persistAndEmit(now, started.events);
  }

  private async onChatQuick(seatIdx: number, phraseId: string): Promise<void> {
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
    if (this.gameState.status === 'FINISHED') {
      this.timers.clearAll();
      this.status = 'FINISHED';
      this.turnDeadline = null;
      this.turnWarningAt = null;
      this.revealedSeed = this.seedHexInMemory;
      this.encryptedSeed = null;
      for (let i = 0; i < this.seats.length; i++) {
        const s = this.seats[i]!;
        this.seats[i] = { ...s, ready: false };
        if (s.userId) await this.deps.store.clearUserActiveRoom(s.userId, this.roomId);
      }
    } else {
      this.armTurnTimersForCurrentState(now);
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
  }

  async handleDisconnect(socket: Socket, userId: string): Promise<void> {
    return this.enqueue(async () => {
      const seatIdx = this.seats.findIndex((s) => s.userId === userId);
      if (seatIdx === -1 || this.socketsBySeat.get(seatIdx) !== socket) return;

      this.socketsBySeat.delete(seatIdx);
      const now = this.deps.nowFn();
      if (this.status !== 'IN_GAME') {
        this.seats[seatIdx] = { ...this.seats[seatIdx]!, connected: false };
        await this.persistAndEmit(now, [this.buildTableStateEvent(now)]);
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
      this.scheduleGraceAbandon(seatIdx, this.reconnectGraceMs);
    });
  }

  private async onGameRejoin(
    socket: Socket,
    claims: WsAuthTicketClaims,
    msg: Extract<ClientMessage, { type: 'game.rejoin' }>,
  ): Promise<void> {
    const seatIdx = this.seats.findIndex((s) => s.userId === claims.userId);
    if (seatIdx === -1 || this.seats[seatIdx]?.sessionId !== msg.payload.sessionId) {
      this.sendSocketError(socket, 'FORBIDDEN', 'Sesión de reconexión inválida', msg.eventId);
      return;
    }

    const now = this.deps.nowFn();
    const prevSeq = this.seq;
    this.timers.clearDisconnectGrace(seatIdx);
    this.socketsBySeat.set(seatIdx, socket);
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
