import { Inject, Injectable, type OnApplicationShutdown } from '@nestjs/common';
import { and, count, gt, inArray, isNull } from 'drizzle-orm';
import {
  API_METRIC_DEFINITIONS,
  GAME_SERVER_METRIC_DEFINITIONS,
  type MetricLabels,
  type MetricsRegistry,
} from '@truco/shared';
import { DRIZZLE_DB, type AppDatabase } from '../../db/database.provider.js';
import { adminSessionsTable, matchesTable, reportsTable } from '../../db/schema/index.js';
import { MATCH_LIFECYCLE_CONSUMER } from '../lobby/ports/match-lifecycle-consumer.js';

/** Token de inyección del registro de métricas (mismo objeto que usan los hooks de Fastify). */
export const METRICS = Symbol('METRICS');
/** Token del logger estructurado (pino) compartido con el bootstrap. */
export const REQUEST_LOGGER = Symbol('REQUEST_LOGGER');
/** Token de la configuración de observabilidad (token de `/metrics`, URL interna). */
export const OBSERVABILITY_CONFIG = Symbol('OBSERVABILITY_CONFIG');

export interface ApiLoggerLike {
  info(fields: Record<string, unknown>, message: string): void;
  warn(fields: Record<string, unknown>, message: string): void;
  error(fields: Record<string, unknown>, message: string): void;
}

export interface ApiObservabilityConfig {
  /** Token exigido en `Authorization: Bearer …` de `/v1/metrics`. */
  readonly metricsToken: string | null;
  /** Base del game-server para completar métricas WS (opcional). */
  readonly gameServerInternalUrl: string | null;
  readonly internalSecret: string | null;
}

export interface QueueStats {
  readonly pending: number;
  readonly failed: number;
}

export interface QueueStatsProvider {
  stats(): Promise<QueueStats>;
}

export interface GameServerMetricsSnapshot {
  readonly wsConnections: number;
  readonly roomsByStatus: Record<string, number>;
  readonly reconnections: number;
  readonly wsErrors: number;
  readonly actionLatencyMs: { readonly action: string; readonly p95: number }[];
}

@Injectable()
export class MetricsService implements OnApplicationShutdown {
  readonly registry: MetricsRegistry;

  constructor(
    @Inject(DRIZZLE_DB) private readonly db: AppDatabase,
    @Inject(OBSERVABILITY_CONFIG) private readonly config: ApiObservabilityConfig,
    @Inject(METRICS) registry: MetricsRegistry,
    @Inject(REQUEST_LOGGER) private readonly logger: ApiLoggerLike,
    @Inject(MATCH_LIFECYCLE_CONSUMER)
    private readonly consumer: unknown,
  ) {
    this.registry = registry;
  }

  /** Actualiza los gauges que dependen de la base y de la cola de jobs. */
  async refresh(now: Date = new Date()): Promise<void> {
    const [activeMatches] = await this.db
      .select({ total: count() })
      .from(matchesTable)
      .where(isNull(matchesTable.endedAt));
    this.registry.set('truco_active_matches', Number(activeMatches?.total ?? 0));

    const [openReports] = await this.db
      .select({ total: count() })
      .from(reportsTable)
      .where(inArray(reportsTable.status, ['OPEN', 'IN_REVIEW']));
    this.registry.set('truco_open_reports', Number(openReports?.total ?? 0));

    const [adminSessions] = await this.db
      .select({ total: count() })
      .from(adminSessionsTable)
      .where(and(isNull(adminSessionsTable.revokedAt), gt(adminSessionsTable.expiresAt, now)));
    this.registry.set('truco_admin_sessions_active', Number(adminSessions?.total ?? 0));

    await this.refreshQueueMetrics();
    await this.refreshGameServerMetrics();
  }

  private async refreshQueueMetrics(): Promise<void> {
    const provider = this.consumer as Partial<QueueStatsProvider> | null;
    if (!provider || typeof provider.stats !== 'function') return;
    try {
      const stats = await provider.stats();
      this.registry.set('truco_jobs_pending', stats.pending, { queue: 'match-lifecycle' });
      this.registry.set('truco_jobs_failed_total', stats.failed, { queue: 'match-lifecycle' });
    } catch (error) {
      this.logger.warn({ detail: (error as Error).message }, 'metrics_queue_unavailable');
    }
  }

  /**
   * El game-server es la fuente de verdad de conexiones WS, salas y latencia de acción.
   * Si no responde, se registra el fallo y las métricas quedan en su último valor conocido.
   */
  private async refreshGameServerMetrics(): Promise<void> {
    const base = this.config.gameServerInternalUrl;
    if (!base) return;
    try {
      const response = await fetch(`${base.replace(/\/$/, '')}/internal/metrics`, {
        headers: this.config.internalSecret
          ? { authorization: `Bearer ${this.config.internalSecret}` }
          : {},
        signal: AbortSignal.timeout(1_500),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const snapshot = (await response.json()) as GameServerMetricsSnapshot;
      this.registry.set('truco_ws_connections', snapshot.wsConnections);
      for (const [status, total] of Object.entries(snapshot.roomsByStatus)) {
        this.registry.set('truco_rooms_by_status', total, { status });
      }
      this.registry.set('truco_ws_reconnections_total', snapshot.reconnections);
      this.registry.set('truco_ws_errors_total', snapshot.wsErrors);
      for (const entry of snapshot.actionLatencyMs) {
        this.registry.observe('truco_action_duration_seconds', entry.p95 / 1000, {
          action: entry.action,
        });
      }
    } catch (error) {
      this.logger.warn({ detail: (error as Error).message }, 'metrics_game_server_unavailable');
    }
  }

  /** Texto Prometheus con las métricas locales + las del game-server. */
  async render(): Promise<string> {
    await this.refresh();
    return this.registry.render();
  }

  increment(name: string, labels: MetricLabels = {}): void {
    this.registry.increment(name, labels);
  }

  observe(name: string, value: number, labels: MetricLabels = {}): void {
    this.registry.observe(name, value, labels);
  }

  async onApplicationShutdown(): Promise<void> {
    // Los gauges viven en memoria: no hay recursos que liberar.
    await Promise.resolve();
  }
}

/** Métricas que publica este proceso (documentado en `docs/RUNBOOKS.md`). */
export const API_EXPOSED_METRICS = [...API_METRIC_DEFINITIONS, ...GAME_SERVER_METRIC_DEFINITIONS]
  .map((definition) => definition.name)
  .filter((name, index, all) => all.indexOf(name) === index);
