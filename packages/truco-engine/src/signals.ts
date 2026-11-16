import signalsCatalogJson from './data/signals.json' with { type: 'json' };

export interface SignalDefinition {
  readonly id: string;
  readonly label: string;
  readonly meaning: string;
}

export const SIGNALS_CATALOG: readonly SignalDefinition[] = Object.freeze(
  signalsCatalogJson.map((entry) =>
    Object.freeze({
      id: entry.id,
      label: entry.label,
      meaning: entry.meaning,
    }),
  ),
);

const SIGNAL_MAP: ReadonlyMap<string, SignalDefinition> = new Map(
  SIGNALS_CATALOG.map((signal) => [signal.id, signal]),
);

export function isValidSignalId(signalId: string): boolean {
  return SIGNAL_MAP.has(signalId);
}

export function getSignalDefinition(signalId: string): SignalDefinition | undefined {
  return SIGNAL_MAP.get(signalId);
}
