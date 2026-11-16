import { DEFAULT_TURN_WARNING_LEAD_MS } from '@truco/shared';

export interface TurnTimingWindow {
  readonly deadline: number;
  readonly warningAt: number;
  readonly warningDelayMs: number;
  readonly timeoutDelayMs: number;
}

export function computeTurnTimingWindow(
  nowMs: number,
  turnTimeoutMs: number,
  warningLeadMs = DEFAULT_TURN_WARNING_LEAD_MS,
): TurnTimingWindow {
  const effectiveLead = Math.min(warningLeadMs, Math.floor(turnTimeoutMs * 0.35));
  const warningDelayMs = Math.max(20, turnTimeoutMs - effectiveLead);
  const timeoutDelayMs = Math.max(warningDelayMs + 20, turnTimeoutMs);
  return {
    deadline: nowMs + timeoutDelayMs,
    warningAt: nowMs + warningDelayMs,
    warningDelayMs,
    timeoutDelayMs,
  };
}

export class RoomTimerController {
  private turnWarningTimer: ReturnType<typeof setTimeout> | null = null;
  private turnTimeoutTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly disconnectGraceTimers = new Map<number, ReturnType<typeof setTimeout>>();

  scheduleTurnTimers(
    warningDelayMs: number,
    timeoutDelayMs: number,
    onWarning: () => void,
    onTimeout: () => void,
  ): void {
    this.clearTurnTimers();
    this.turnWarningTimer = setTimeout(onWarning, Math.max(1, warningDelayMs));
    this.turnTimeoutTimer = setTimeout(onTimeout, Math.max(1, timeoutDelayMs));
  }

  clearTurnTimers(): void {
    if (this.turnWarningTimer) {
      clearTimeout(this.turnWarningTimer);
      this.turnWarningTimer = null;
    }
    if (this.turnTimeoutTimer) {
      clearTimeout(this.turnTimeoutTimer);
      this.turnTimeoutTimer = null;
    }
  }

  scheduleDisconnectGrace(seat: number, delayMs: number, onExpire: () => void): void {
    this.clearDisconnectGrace(seat);
    const timer = setTimeout(
      () => {
        this.disconnectGraceTimers.delete(seat);
        onExpire();
      },
      Math.max(1, delayMs),
    );
    this.disconnectGraceTimers.set(seat, timer);
  }

  clearDisconnectGrace(seat: number): void {
    const existing = this.disconnectGraceTimers.get(seat);
    if (existing) {
      clearTimeout(existing);
      this.disconnectGraceTimers.delete(seat);
    }
  }

  clearAll(): void {
    this.clearTurnTimers();
    for (const timer of this.disconnectGraceTimers.values()) {
      clearTimeout(timer);
    }
    this.disconnectGraceTimers.clear();
  }
}
