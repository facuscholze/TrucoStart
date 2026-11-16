import {
  MATCH_LIFECYCLE_QUEUE_NAME,
  type MatchLifecycleEvent,
  MatchLifecycleEventSchema,
} from '@truco/shared';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';

export interface MatchLifecyclePublisher {
  publish(event: MatchLifecycleEvent): Promise<void>;
  close(): Promise<void>;
}

export type MatchLifecycleSubscriber = (event: MatchLifecycleEvent) => Promise<void> | void;

export class NoopMatchLifecyclePublisher implements MatchLifecyclePublisher {
  async publish(_event: MatchLifecycleEvent): Promise<void> {
    // Sin operación cuando no se configura bus de eventos (tests unitarios aislados de sala)
  }

  async close(): Promise<void> {
    // No-op
  }
}

/**
 * Implementación en memoria de la cola de ciclo de vida de partidas para tests locales e integración sin Redis.
 * Valida cada evento contra `MatchLifecycleEventSchema` antes de despacharlo a los suscriptores.
 */
export class InMemoryMatchLifecycleBus implements MatchLifecyclePublisher {
  private readonly history: MatchLifecycleEvent[] = [];
  private readonly subscribers = new Set<MatchLifecycleSubscriber>();

  subscribe(handler: MatchLifecycleSubscriber): () => void {
    this.subscribers.add(handler);
    return () => {
      this.subscribers.delete(handler);
    };
  }

  async publish(event: MatchLifecycleEvent): Promise<void> {
    const validated = MatchLifecycleEventSchema.parse(structuredClone(event));
    this.history.push(validated);
    for (const subscriber of this.subscribers) {
      await subscriber(structuredClone(validated));
    }
  }

  getPublishedEvents(): readonly MatchLifecycleEvent[] {
    return this.history.map((item) => structuredClone(item));
  }

  async close(): Promise<void> {
    this.subscribers.clear();
  }
}

export interface BullMqMatchLifecyclePublisherOptions {
  readonly queueName?: string;
  readonly prefix?: string;
}

function buildDeterministicJobId(event: MatchLifecycleEvent): string {
  switch (event.kind) {
    case 'match.completed':
      return `match-completed-${event.matchId}`;
    case 'match.started':
      return `match-started-${event.matchId}`;
    case 'table.seatVacated':
      return `seat-vacated-${event.roomId}-${event.seat}-${event.vacatedAtMs}`;
  }
}

/**
 * Publicador productivo basado en BullMQ sobre Redis 7 (`apps/game-server -> Redis -> apps/api`).
 * `apps/game-server` jamás escribe directamente en PostgreSQL.
 */
export class BullMqMatchLifecyclePublisher implements MatchLifecyclePublisher {
  private readonly connection: Redis;
  private readonly queue: Queue;
  private closed = false;

  constructor(redisUrl: string, options: BullMqMatchLifecyclePublisherOptions = {}) {
    this.connection = new Redis(redisUrl, { maxRetriesPerRequest: null });
    this.queue = new Queue(options.queueName ?? MATCH_LIFECYCLE_QUEUE_NAME, {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      connection: this.connection as any,
      ...(options.prefix ? { prefix: options.prefix } : {}),
      defaultJobOptions: {
        attempts: 5,
        backoff: { type: 'exponential', delay: 500 },
        removeOnComplete: 500,
        removeOnFail: 1000,
      },
    });
  }

  async publish(event: MatchLifecycleEvent): Promise<void> {
    const validated = MatchLifecycleEventSchema.parse(event);
    await this.queue.add(validated.kind, validated, {
      jobId: buildDeterministicJobId(validated),
    });
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.queue.close();
    if (this.connection.status !== 'end') {
      try {
        await this.connection.quit();
      } catch {
        this.connection.disconnect();
      }
    }
  }
}
