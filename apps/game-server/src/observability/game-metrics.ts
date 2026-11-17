import { GAME_SERVER_METRIC_DEFINITIONS, MetricsRegistry } from '@truco/shared';

export interface GameServerMetricsSnapshot {
  readonly wsConnections: number;
  readonly roomsByStatus: Record<string, number>;
  readonly reconnections: number;
  readonly wsErrors: number;
  readonly actionLatencyMs: { readonly action: string; readonly p95: number }[];
}

const MAX_SAMPLES_PER_ACTION = 500;

/**
 * Métricas del game-server: conexiones WS, salas por estado, reconexiones, errores y
 * latencia de acciones. Se exponen en `/internal/metrics` (protegido) y la API las
 * re-publica dentro de `/v1/metrics` para que Prometheus tenga una sola URL.
 */
export class GameMetrics {
  readonly registry = new MetricsRegistry(GAME_SERVER_METRIC_DEFINITIONS);
  readonly #samples = new Map<string, number[]>();
  #connections = 0;
  #reconnections = 0;
  #errors = 0;

  get connections(): number {
    return this.#connections;
  }

  get reconnections(): number {
    return this.#reconnections;
  }

  onConnectionOpened(): void {
    this.#connections += 1;
    this.registry.set('truco_ws_connections', this.#connections);
  }

  onConnectionClosed(): void {
    this.#connections = Math.max(0, this.#connections - 1);
    this.registry.set('truco_ws_connections', this.#connections);
  }

  onReconnection(): void {
    this.#reconnections += 1;
    this.registry.increment('truco_ws_reconnections_total');
  }

  onError(): void {
    this.#errors += 1;
    this.registry.increment('truco_ws_errors_total');
  }

  onAction(action: string, durationMs: number): void {
    this.registry.observe('truco_action_duration_seconds', Math.max(durationMs, 0) / 1000, {
      action,
    });
    const samples = this.#samples.get(action) ?? [];
    samples.push(durationMs);
    if (samples.length > MAX_SAMPLES_PER_ACTION) samples.shift();
    this.#samples.set(action, samples);
  }

  /** p95 por acción sobre las últimas muestras (aproximado, acotado en memoria). */
  p95ByAction(): { action: string; p95: number }[] {
    const output: { action: string; p95: number }[] = [];
    for (const [action, samples] of this.#samples) {
      if (samples.length === 0) continue;
      const sorted = [...samples].sort((a, b) => a - b);
      const index = Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95));
      output.push({ action, p95: Math.round((sorted[index] ?? 0) * 100) / 100 });
    }
    return output.sort((a, b) => a.action.localeCompare(b.action));
  }

  snapshot(roomsByStatus: Record<string, number>): GameServerMetricsSnapshot {
    for (const [status, total] of Object.entries(roomsByStatus)) {
      this.registry.set('truco_rooms_by_status', total, { status });
    }
    return {
      wsConnections: this.#connections,
      roomsByStatus,
      reconnections: this.#reconnections,
      wsErrors: this.#errors,
      actionLatencyMs: this.p95ByAction(),
    };
  }

  /** Texto Prometheus (para debug local y paridad con la API). */
  renderPrometheus(roomsByStatus: Record<string, number>): string {
    this.snapshot(roomsByStatus);
    return this.registry.render();
  }
}
