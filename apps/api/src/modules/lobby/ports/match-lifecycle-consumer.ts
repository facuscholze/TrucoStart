import {
  MATCH_LIFECYCLE_QUEUE_NAME,
  type MatchLifecycleEvent,
  MatchLifecycleEventSchema,
} from '@truco/shared';
import { Worker } from 'bullmq';
import { Redis } from 'ioredis';

export const MATCH_LIFECYCLE_CONSUMER = Symbol('MATCH_LIFECYCLE_CONSUMER');

export type MatchLifecycleEventHandler = (event: MatchLifecycleEvent) => Promise<void>;

export interface MatchLifecycleConsumer {
  start(handler: MatchLifecycleEventHandler): Promise<void>;
  close(): Promise<void>;
}

export interface SubscribableLifecycleSource {
  subscribe(handler: (event: MatchLifecycleEvent) => Promise<void> | void): () => void;
}

export class NoopMatchLifecycleConsumer implements MatchLifecycleConsumer {
  async start(_handler: MatchLifecycleEventHandler): Promise<void> {
    // No-op cuando no se configura fuente de eventos
  }

  async close(): Promise<void> {
    // No-op
  }
}

/**
 * Consumidor en memoria conectado a `InMemoryMatchLifecycleBus` para tests E2E sin Redis externo.
 */
export class InMemoryMatchLifecycleConsumer implements MatchLifecycleConsumer {
  private unsubscribe: (() => void) | null = null;

  constructor(private readonly bus: SubscribableLifecycleSource) {}

  async start(handler: MatchLifecycleEventHandler): Promise<void> {
    if (this.unsubscribe) return;
    this.unsubscribe = this.bus.subscribe(async (raw) => {
      const parsed = MatchLifecycleEventSchema.parse(raw);
      await handler(parsed);
    });
  }

  async close(): Promise<void> {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
  }
}

/**
 * Consumidor productivo sobre BullMQ + Redis 7 (`truco-match-lifecycle`).
 */
export class BullMqMatchLifecycleConsumer implements MatchLifecycleConsumer {
  private readonly redisUrl: string;
  private readonly queueName: string;
  private connection: Redis | null = null;
  private worker: Worker | null = null;
  private closed = false;

  constructor(redisUrl: string, options: { readonly queueName?: string } = {}) {
    this.redisUrl = redisUrl;
    this.queueName = options.queueName ?? MATCH_LIFECYCLE_QUEUE_NAME;
  }

  async start(handler: MatchLifecycleEventHandler): Promise<void> {
    if (this.worker || this.closed) return;
    this.connection = new Redis(this.redisUrl, { maxRetriesPerRequest: null });
    this.worker = new Worker(
      this.queueName,
      async (job) => {
        const parsed = MatchLifecycleEventSchema.parse(job.data);
        await handler(parsed);
      },
      {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        connection: this.connection as any,
        concurrency: 4,
      },
    );
    await this.worker.waitUntilReady();
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    if (this.worker) {
      await this.worker.close();
      this.worker = null;
    }
    if (this.connection && this.connection.status !== 'end') {
      try {
        await this.connection.quit();
      } catch {
        this.connection.disconnect();
      }
      this.connection = null;
    }
  }
}
