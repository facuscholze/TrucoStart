import {
  type ClientEventType,
  DEFAULT_WS_RATE_LIMIT_WINDOW_MS,
  DEFAULT_WS_TABLE_EVENT_MAX,
} from '@truco/shared';

export type WsRateLimitCategory = 'table' | 'action' | 'chat';

export interface WsRateLimiterConfig {
  readonly windowMs?: number;
  readonly actionMax?: number;
  readonly chatMax?: number;
  readonly tableMax?: number;
  readonly connectionTotalMax?: number;
}

export function classifyClientEventCategory(eventType: ClientEventType): WsRateLimitCategory {
  switch (eventType) {
    case 'chat.quick':
      return 'chat';
    case 'table.join':
    case 'table.leave':
    case 'table.ready':
    case 'game.rejoin':
      return 'table';
    case 'game.playCard':
    case 'game.call':
    case 'game.respond':
    case 'game.foldHand':
    case 'practice.hint':
    case 'game.signal':
      return 'action';
  }
}

export class WsConnectionRateLimiter {
  private readonly windowMs: number;
  private readonly limits: Record<WsRateLimitCategory, number>;
  private readonly connectionTotalMax: number;
  private readonly buckets = new Map<string, number[]>();

  constructor(config: WsRateLimiterConfig = {}) {
    this.windowMs = config.windowMs ?? DEFAULT_WS_RATE_LIMIT_WINDOW_MS;
    const actionMax = config.actionMax ?? 30;
    const chatMax = config.chatMax ?? 10;
    const tableMax = config.tableMax ?? DEFAULT_WS_TABLE_EVENT_MAX;
    this.limits = {
      action: actionMax,
      chat: chatMax,
      table: tableMax,
    };
    this.connectionTotalMax = config.connectionTotalMax ?? actionMax + chatMax + tableMax;
  }

  private checkKey(key: string, maxAllowed: number, nowMs: number): boolean {
    const cutoff = nowMs - this.windowMs;
    const timestamps = this.buckets.get(key) ?? [];
    const active = timestamps.filter((t) => t > cutoff);
    if (active.length >= maxAllowed) {
      this.buckets.set(key, active);
      return false;
    }
    active.push(nowMs);
    this.buckets.set(key, active);
    return true;
  }

  consume(connectionId: string, eventType: ClientEventType, nowMs = Date.now()): boolean {
    const category = classifyClientEventCategory(eventType);
    const categoryKey = `${connectionId}:${category}`;
    const totalKey = `${connectionId}:__total__`;

    if (!this.checkKey(totalKey, this.connectionTotalMax, nowMs)) {
      return false;
    }
    if (!this.checkKey(categoryKey, this.limits[category], nowMs)) {
      return false;
    }
    return true;
  }

  removeConnection(connectionId: string): void {
    const prefix = `${connectionId}:`;
    for (const key of this.buckets.keys()) {
      if (key.startsWith(prefix)) {
        this.buckets.delete(key);
      }
    }
  }
}
