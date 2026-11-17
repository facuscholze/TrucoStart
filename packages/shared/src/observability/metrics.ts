/**
 * Registro mínimo de métricas en formato Prometheus, sin dependencias externas.
 *
 * Se usa en `apps/api` (expone `/v1/metrics` protegido) y en `apps/game-server`
 * (expone `/internal/metrics`, firmado, y la API lo consume para completar el texto).
 */

export type MetricLabels = Readonly<Record<string, string>>;

interface MetricDefinition {
  readonly name: string;
  readonly help: string;
  readonly type: 'counter' | 'gauge' | 'histogram';
  readonly labelNames: readonly string[];
  readonly buckets?: readonly number[];
}

export const API_METRIC_DEFINITIONS: readonly MetricDefinition[] = Object.freeze([
  {
    name: 'truco_http_requests_total',
    help: 'Requests HTTP atendidos por método, ruta y estado.',
    type: 'counter',
    labelNames: ['method', 'route', 'status'],
  },
  {
    name: 'truco_http_request_duration_seconds',
    help: 'Latencia de requests HTTP.',
    type: 'histogram',
    labelNames: ['method', 'route'],
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5],
  },
  {
    name: 'truco_http_errors_total',
    help: 'Errores 5xx por código de error.',
    type: 'counter',
    labelNames: ['error_code'],
  },
  {
    name: 'truco_active_matches',
    help: 'Partidas en curso (no terminadas).',
    type: 'gauge',
    labelNames: [],
  },
  {
    name: 'truco_open_reports',
    help: 'Reportes abiertos o en revisión.',
    type: 'gauge',
    labelNames: [],
  },
  {
    name: 'truco_admin_sessions_active',
    help: 'Sesiones administrativas vigentes.',
    type: 'gauge',
    labelNames: [],
  },
  {
    name: 'truco_jobs_failed_total',
    help: 'Jobs fallidos por cola.',
    type: 'counter',
    labelNames: ['queue'],
  },
  {
    name: 'truco_jobs_pending',
    help: 'Jobs pendientes por cola.',
    type: 'gauge',
    labelNames: ['queue'],
  },
  {
    name: 'truco_ws_connections',
    help: 'Conexiones WebSocket abiertas en el game-server (vía interna).',
    type: 'gauge',
    labelNames: [],
  },
  {
    name: 'truco_rooms_by_status',
    help: 'Salas por estado en el game-server (vía interna).',
    type: 'gauge',
    labelNames: ['status'],
  },
  {
    name: 'truco_ws_reconnections_total',
    help: 'Reconexiones aceptadas en el game-server (vía interna).',
    type: 'counter',
    labelNames: [],
  },
  {
    name: 'truco_ws_errors_total',
    help: 'Errores de WebSocket en el game-server (vía interna).',
    type: 'counter',
    labelNames: [],
  },
  {
    name: 'truco_action_duration_seconds',
    help: 'Latencia de acciones de juego procesadas en el game-server (vía interna).',
    type: 'histogram',
    labelNames: ['action'],
    buckets: [0.01, 0.025, 0.05, 0.1, 0.15, 0.25, 0.5, 1],
  },
]);

export const GAME_SERVER_METRIC_DEFINITIONS: readonly MetricDefinition[] = Object.freeze([
  {
    name: 'truco_ws_connections',
    help: 'Conexiones WebSocket abiertas.',
    type: 'gauge',
    labelNames: [],
  },
  {
    name: 'truco_rooms_by_status',
    help: 'Salas por estado.',
    type: 'gauge',
    labelNames: ['status'],
  },
  {
    name: 'truco_ws_reconnections_total',
    help: 'Reconexiones aceptadas.',
    type: 'counter',
    labelNames: [],
  },
  {
    name: 'truco_ws_errors_total',
    help: 'Errores de WebSocket.',
    type: 'counter',
    labelNames: [],
  },
  {
    name: 'truco_action_duration_seconds',
    help: 'Latencia de acciones de juego.',
    type: 'histogram',
    labelNames: ['action'],
    buckets: [0.01, 0.025, 0.05, 0.1, 0.15, 0.25, 0.5, 1],
  },
]);

function labelKey(labelNames: readonly string[], labels: MetricLabels): string {
  return labelNames.map((name) => `${name}="${String(labels[name] ?? '')}"`).join(',');
}

export class MetricsRegistry {
  readonly #definitions: Map<string, MetricDefinition>;
  readonly #counters = new Map<string, number>();
  readonly #gauges = new Map<string, number>();
  readonly #histograms = new Map<string, Map<number, number>>();

  constructor(definitions: readonly MetricDefinition[] = API_METRIC_DEFINITIONS) {
    this.#definitions = new Map(definitions.map((definition) => [definition.name, definition]));
  }

  #definition(name: string): MetricDefinition {
    const definition = this.#definitions.get(name);
    if (!definition) throw new Error(`Métrica desconocida: ${name}`);
    return definition;
  }

  increment(name: string, labels: MetricLabels = {}, value = 1): void {
    const definition = this.#definition(name);
    const key = `${definition.name}|${labelKey(definition.labelNames, labels)}`;
    this.#counters.set(key, (this.#counters.get(key) ?? 0) + value);
  }

  set(name: string, value: number, labels: MetricLabels = {}): void {
    const definition = this.#definition(name);
    const key = `${definition.name}|${labelKey(definition.labelNames, labels)}`;
    this.#gauges.set(key, value);
  }

  observe(name: string, value: number, labels: MetricLabels = {}): void {
    const definition = this.#definition(name);
    const key = `${definition.name}|${labelKey(definition.labelNames, labels)}`;
    const buckets = this.#histograms.get(key) ?? new Map<number, number>();
    for (const bucket of definition.buckets ?? []) {
      if (value <= bucket) buckets.set(bucket, (buckets.get(bucket) ?? 0) + 1);
    }
    buckets.set(Number.POSITIVE_INFINITY, (buckets.get(Number.POSITIVE_INFINITY) ?? 0) + 1);
    this.#histograms.set(key, buckets);
  }

  /** Texto en formato de exposición Prometheus. */
  render(): string {
    const lines: string[] = [];
    for (const definition of this.#definitions.values()) {
      lines.push(`# HELP ${definition.name} ${definition.help}`);
      lines.push(`# TYPE ${definition.name} ${definition.type}`);
      const prefix = `${definition.name}|`;
      if (definition.type === 'counter') {
        for (const [key, value] of this.#counters) {
          if (!key.startsWith(prefix)) continue;
          lines.push(`${definition.name}${this.#renderLabels(definition, key)} ${value}`);
        }
      } else if (definition.type === 'gauge') {
        for (const [key, value] of this.#gauges) {
          if (!key.startsWith(prefix)) continue;
          lines.push(`${definition.name}${this.#renderLabels(definition, key)} ${value}`);
        }
      } else {
        for (const [key, buckets] of this.#histograms) {
          if (!key.startsWith(prefix)) continue;
          const labelsFromKey = key.slice(prefix.length);
          for (const [bucket, count] of [...buckets].sort((a, b) => a[0] - b[0])) {
            const bucketLabel = `le="${Number.isFinite(bucket) ? bucket : '+Inf'}"`;
            const merged = labelsFromKey ? `${labelsFromKey},${bucketLabel}` : bucketLabel;
            lines.push(`${definition.name}_bucket{${merged}} ${count}`);
          }
          const total = buckets.get(Number.POSITIVE_INFINITY) ?? 0;
          const labels = labelsFromKey ? `{${labelsFromKey}}` : '';
          lines.push(`${definition.name}_sum${labels} ${total}`);
          lines.push(`${definition.name}_count${labels} ${total}`);
        }
      }
    }
    return `${lines.join('\n')}\n`;
  }

  #renderLabels(definition: MetricDefinition, key: string): string {
    const labelsFromKey = key.slice(`${definition.name}|`.length);
    return labelsFromKey ? `{${labelsFromKey}}` : '';
  }

  /** Lee una métrica ya registrada (para tests y para fusionar métricas internas). */
  read(name: string, labels: MetricLabels = {}): number | undefined {
    const definition = this.#definition(name);
    const key = `${definition.name}|${labelKey(definition.labelNames, labels)}`;
    return definition.type === 'gauge' ? this.#gauges.get(key) : this.#counters.get(key);
  }
}

/** Acepta `METRICS_TOKEN` sólo con cuerpo y longitud razonables. */
export function isValidMetricsToken(token: unknown): token is string {
  // Sin espacios ni caracteres de control: cualquier token imprimible de 24+ caracteres sirve.
  return typeof token === 'string' && /^[\x21-\x7e]{24,200}$/.test(token);
}
