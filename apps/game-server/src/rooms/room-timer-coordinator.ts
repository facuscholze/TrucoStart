import type { Action, GameState } from '@truco/engine';
import type {
  PersistedSeatBinding,
  PersistedSequencedEvent,
} from '../store/game-store.interface.js';
import { buildSequencedEvent } from './event-projector.js';
import { computeTurnTimingWindow, type RoomTimerController } from './room-timers.js';

export interface ArmTurnTimersContext {
  readonly roomId: string;
  readonly turnTimeoutMs: number;
  readonly timers: RoomTimerController;
  readonly getNow: () => number;
  readonly getState: () => { status: string; gameState: GameState | null };
  readonly allocateSeq: () => number;
  readonly persistAndEmit: (
    nowMs: number,
    events: readonly PersistedSequencedEvent[],
  ) => Promise<void>;
  readonly applySystemAction: (action: Action) => Promise<void>;
  readonly enqueue: <T>(task: () => Promise<T>) => Promise<T>;
}

export function armTurnTimers(
  ctx: ArmTurnTimersContext,
  nowMs: number,
): { deadline: number | null; warningAt: number | null } {
  const current = ctx.getState();
  if (
    current.status !== 'IN_GAME' ||
    !current.gameState ||
    current.gameState.status !== 'IN_PROGRESS'
  ) {
    ctx.timers.clearTurnTimers();
    return { deadline: null, warningAt: null };
  }

  const timing = computeTurnTimingWindow(nowMs, ctx.turnTimeoutMs);
  const expectedHand = current.gameState.hand.handNumber;
  const expectedActive = current.gameState.hand.activeSeat;

  ctx.timers.scheduleTurnTimers(
    timing.warningDelayMs,
    timing.timeoutDelayMs,
    () => {
      void ctx.enqueue(async () => {
        const latest = ctx.getState();
        if (
          latest.status !== 'IN_GAME' ||
          latest.gameState?.hand.handNumber !== expectedHand ||
          latest.gameState.hand.activeSeat !== expectedActive
        ) {
          return;
        }
        const ts = ctx.getNow();
        await ctx.persistAndEmit(ts, [
          buildSequencedEvent(
            ctx.allocateSeq,
            ts,
            'game.turn',
            {
              roomId: ctx.roomId,
              handNumber: latest.gameState.hand.handNumber,
              seat: latest.gameState.hand.activeSeat,
              responderTeam: latest.gameState.hand.responderTeam,
              deadline: timing.deadline,
              warningAt: timing.warningAt,
              isWarning: true,
            },
            { kind: 'ALL' },
          ),
        ]);
      });
    },
    () => {
      void ctx.enqueue(async () => {
        const latest = ctx.getState();
        if (
          latest.status === 'IN_GAME' &&
          latest.gameState?.hand.handNumber === expectedHand &&
          latest.gameState.hand.activeSeat === expectedActive
        ) {
          await ctx.applySystemAction({ type: 'SYSTEM_TIMEOUT', seat: expectedActive });
        }
      });
    },
  );

  return { deadline: timing.deadline, warningAt: timing.warningAt };
}

export function scheduleDisconnectAbandonTimer(params: {
  readonly timers: RoomTimerController;
  readonly seat: number;
  readonly delayMs: number;
  readonly enqueue: <T>(task: () => Promise<T>) => Promise<T>;
  readonly shouldAbandon: () => boolean;
  readonly applySystemAction: (action: Action) => Promise<void>;
}): void {
  params.timers.scheduleDisconnectGrace(params.seat, params.delayMs, () => {
    void params.enqueue(async () => {
      if (params.shouldAbandon()) {
        await params.applySystemAction({ type: 'SYSTEM_ABANDON', seat: params.seat });
      }
    });
  });
}

export function rearmTimersAfterCrashRecovery(params: {
  readonly nowMs: number;
  readonly turnDeadline: number | null;
  readonly turnTimeoutMs: number;
  readonly seats: readonly PersistedSeatBinding[];
  readonly timers: RoomTimerController;
  readonly getState: () => { status: string; gameState: GameState | null };
  readonly isSeatDisconnected: (seat: number) => boolean;
  readonly enqueue: <T>(task: () => Promise<T>) => Promise<T>;
  readonly applySystemAction: (action: Action) => Promise<void>;
}): void {
  const current = params.getState();
  if (current.status !== 'IN_GAME' || current.gameState?.status !== 'IN_PROGRESS') return;

  const remainingTurn = params.turnDeadline
    ? Math.max(50, params.turnDeadline - params.nowMs)
    : params.turnTimeoutMs;
  const expectedHand = current.gameState.hand.handNumber;
  const expectedActive = current.gameState.hand.activeSeat;

  params.timers.scheduleTurnTimers(
    Math.max(20, Math.floor(remainingTurn * 0.7)),
    remainingTurn,
    () => undefined,
    () => {
      void params.enqueue(async () => {
        const latest = params.getState();
        if (
          latest.status === 'IN_GAME' &&
          latest.gameState?.hand.handNumber === expectedHand &&
          latest.gameState.hand.activeSeat === expectedActive
        ) {
          await params.applySystemAction({ type: 'SYSTEM_TIMEOUT', seat: expectedActive });
        }
      });
    },
  );

  for (const s of params.seats) {
    if (s.userId !== null && !s.connected && s.graceDeadline !== null) {
      scheduleDisconnectAbandonTimer({
        timers: params.timers,
        seat: s.seat,
        delayMs: Math.max(50, s.graceDeadline - params.nowMs),
        enqueue: params.enqueue,
        shouldAbandon: () => params.isSeatDisconnected(s.seat),
        applySystemAction: params.applySystemAction,
      });
    }
  }
}
