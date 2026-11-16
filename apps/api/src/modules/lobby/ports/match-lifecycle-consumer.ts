import {
  MATCH_LIFECYCLE_DLQ_NAME,
  MATCH_LIFECYCLE_QUEUE_NAME,
  type MatchLifecycleEvent,
  MatchLifecycleEventSchema,
} from '@truco/shared';
import { Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';

export const MATCH_LIFECYCLE_CONSUMER = Symbol('MATCH_LIFECYCLE_CONSUMER');

export type MatchLifecycleEventHandler = (event: MatchLifecycleEvent) => Promise<void>;

export interface DeadLetterLifecycleMessage {
  readonly idempotencyKey: string;
  readonly rawPayload: unknown;
  readonly errorMessage: string;
  readonly attemptsMade: number;
  readonly failedAtMs: number;
}

export interface MatchLifecycleConsumer {
  start(handler: MatchLifecycleEventHandler): Promise<void>;
  listDeadLetterMessages(limit?: number): Promise<readonly DeadLetterLifecycleMessage[]>;
  close(): Promise<void>;
}

export interface SubscribableLifecycleSource {
  subscribe(handler: (event: MatchLifecycleEvent) => Promise<void> | void): () => void;
}

export function deriveLifecycleIdempotencyKey(raw: unknown): string {
  if (raw && typeof raw === 'object') {
    const rec = raw as Record<string, unknown>;
    if (typeof rec['matchId'] === 'string' && typeof rec['kind'] === 'string') {
      return `${rec['kind']}:${rec['matchId']}`;
    }
    if (
      rec['kind'] === 'table.seatVacated' &&
      typeof rec['roomId'] === 'string' &&
      typeof rec['seat'] === 'number' &&
      typeof rec['vacatedAtMs'] === 'number'
    ) {
      return `table.seatVacated:${rec['roomId']}:${rec['seat']}:${rec['vacatedAtMs']}`;
    }
  }
  return `unknown:${Date.now()}`;
}

export class NoopMatchLifecycleConsumer implements MatchLifecycleConsumer {
  async start(_handler: MatchLifecycleEventHandler): Promise<void> {
    // No-op cuando no se configura fuente de eventos
  }

  async listDeadLetterMessages(): Promise<readonly DeadLetterLifecycleMessage[]> {
    return [];
  }

  async close(): Promise<void> {
    // No-op
  }
}

export interface InMemoryMatchLifecycleConsumerOptions {
  readonly maxAttempts?: number;
  readonly initialBackoffMs?: number;
}

function sleepMs(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Consumidor en memoria con reintentos exponenciales y cola de mensajes fallidos (DLQ)
 * para tests locales e integración sin Redis externo.
 */
export class InMemoryMatchLifecycleConsumer implements MatchLifecycleConsumer {
  private unsubscribe: (() => void) | null = null;
  private readonly maxAttempts: number;
  private readonly initialBackoffMs: number;
  private readonly dlq: DeadLetterLifecycleMessage[] = [];

  constructor(
    private readonly bus: SubscribableLifecycleSource,
    options: InMemoryMatchLifecycleConsumerOptions = {},
  ) {
    this.maxAttempts = Math.max(1, options.maxAttempts ?? 4);
    this.initialBackoffMs = Math.max(0, options.initialBackoffMs ?? 25);
  }

  async start(handler: MatchLifecycleEventHandler): Promise<void> {
    if (this.unsubscribe) return;
    this.unsubscribe = this.bus.subscribe(async (raw) => {
      await this.processWithRetryAndDlq(raw, handler);
    });
  }

  async processWithRetryAndDlq(raw: unknown, handler: MatchLifecycleEventHandler): Promise<void> {
    const idempotencyKey = deriveLifecycleIdempotencyKey(raw);
    let lastErr: unknown = null;

    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      try {
        const parsed = MatchLifecycleEventSchema.parse(raw);
        await handler(parsed);
        return;
      } catch (err) {
        lastErr = err;
        if (attempt < this.maxAttempts) {
          const delay = this.initialBackoffMs * 2 ** (attempt - 1);
          await sleepMs(delay);
        }
      }
    }

    this.dlq.push({
      idempotencyKey,
      rawPayload: structuredClone(raw),
      errorMessage: lastErr instanceof Error ? lastErr.message : String(lastErr),
      attemptsMade: this.maxAttempts,
      failedAtMs: Date.now(),
    });
  }

  async listDeadLetterMessages(limit = 50): Promise<readonly DeadLetterLifecycleMessage[]> {
    return this.dlq.slice(-limit).map((m) => structuredClone(m));
  }

  async close(): Promise<void> {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
  }
}

export interface BullMqMatchLifecycleConsumerOptions {
  readonly queueName?: string;
  readonly dlqQueueName?: string;
}

/**
 * Consumidor productivo sobre BullMQ + Redis 7 (`truco-match-lifecycle`) con desvío automático
 * a cola Dead-Letter (`truco-match-lifecycle-dlq`) al agotar reintentos con backoff exponencial.
 */
export class BullMqMatchLifecycleConsumer implements MatchLifecycleConsumer {
  private readonly redisUrl: string;
  private readonly queueName: string;
  private readonly dlqQueueName: string;
  private workerConn: Redis | null = null;
  private dlqConn: Redis | null = null;
  private worker: Worker | null = null;
  private dlqQueue: Queue | null = null;
  private closed = false;

  constructor(redisUrl: string, options: BullMqMatchLifecycleConsumerOptions = {}) {
    this.redisUrl = redisUrl;
    this.queueName = options.queueName ?? MATCH_LIFECYCLE_QUEUE_NAME;
    this.dlqQueueName = options.dlqQueueName ?? MATCH_LIFECYCLE_DLQ_NAME;
  }

  async start(handler: MatchLifecycleEventHandler): Promise<void> {
    if (this.worker || this.closed) return;
    this.workerConn = new Redis(this.redisUrl, { maxRetriesPerRequest: null });
    this.dlqConn = new Redis(this.redisUrl, { maxRetriesPerRequest: null });
    this.dlqQueue = new Queue(this.dlqQueueName, {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      connection: this.dlqConn as any,
      defaultJobOptions: {
        removeOnComplete: false,
        removeOnFail: false,
      },
    });

    this.worker = new Worker(
      this.queueName,
      async (job) => {
        const parsed = MatchLifecycleEventSchema.parse(job.data);
        await handler(parsed);
      },
      {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        connection: this.workerConn as any,
        concurrency: 4,
      },
    );

    this.worker.on('failed', (job, err) => {
      if (!job || !this.dlqQueue || this.closed) return;
      const configuredMaxAttempts = job.opts.attempts ?? 1;
      if (job.attemptsMade < configuredMaxAttempts) return;

      const idempotencyKey = deriveLifecycleIdempotencyKey(job.data);
      const dlqEntry: DeadLetterLifecycleMessage = {
        idempotencyKey,
        rawPayload: job.data,
        errorMessage: err.message,
        attemptsMade: job.attemptsMade,
        failedAtMs: Date.now(),
      };
      const sanitizedJobId = `dlq-${idempotencyKey.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
      void this.dlqQueue.add('dead-letter', dlqEntry, { jobId: sanitizedJobId }).catch(() => {
        // Evitar unhandled rejection si Redis está cerrándose durante shutdown
      });
    });

    await this.worker.waitUntilReady();
  }

  async listDeadLetterMessages(limit = 50): Promise<readonly DeadLetterLifecycleMessage[]> {
    if (!this.dlqQueue) return [];
    const jobs = await this.dlqQueue.getJobs(
      ['waiting', 'delayed', 'completed', 'failed'],
      0,
      limit - 1,
    );
    return jobs.map((j) => j.data as DeadLetterLifecycleMessage);
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    if (this.worker) {
      await this.worker.close();
      this.worker = null;
    }
    if (this.dlqQueue) {
      await this.dlqQueue.close();
      this.dlqQueue = null;
    }
    for (const conn of [this.workerConn, this.dlqConn]) {
      if (conn && conn.status !== 'end') {
        try {
          await conn.quit();
        } catch {
          conn.disconnect();
        }
      }
    }
    this.workerConn = null;
    this.dlqConn = null;
  }
}
