import type { ProgressionConfig } from '@truco/shared';
import { useEffect, useState, type FormEvent } from 'react';
import { Button, Card, Field, inputClass, StatusPill } from './primitives.js';

const CONFIG_FIELDS: ReadonlyArray<{
  readonly key: keyof ProgressionConfig;
  readonly label: string;
  readonly min: number;
  readonly max: number;
}> = [
  { key: 'humanMatchXp', label: 'XP por partida humana', min: 0, max: 10_000 },
  { key: 'botMatchXp', label: 'XP reducido por partida con bots', min: 0, max: 10_000 },
  { key: 'dailyXpCap', label: 'Tope diario de XP humano', min: 0, max: 100_000 },
  { key: 'botDailyXpCap', label: 'Tope diario de XP bot (separado)', min: 0, max: 100_000 },
  { key: 'dailyBonusXpCap', label: 'Tope diario de XP de bonos', min: 0, max: 100_000 },
  { key: 'humanMatchCoins', label: 'Monedas simbólicas por partida humana', min: 0, max: 1_000 },
  { key: 'botMatchCoins', label: 'Monedas simbólicas por partida bot', min: 0, max: 1_000 },
  { key: 'dailyCoinCap', label: 'Tope diario de monedas emitidas', min: 0, max: 10_000 },
  { key: 'botDailyCoinCap', label: 'Tope diario de monedas bot', min: 0, max: 10_000 },
  { key: 'dailyCoinSpendCap', label: 'Tope diario de canjes', min: 0, max: 10_000 },
  { key: 'baseXpPerLevel', label: 'XP base por nivel', min: 1, max: 1_000_000 },
  { key: 'xpGrowthPerLevel', label: 'Crecimiento de XP por nivel', min: 0, max: 1_000_000 },
  {
    key: 'missionRewardMultiplierBp',
    label: 'Multiplicador de misiones (puntos base)',
    min: 0,
    max: 50_000,
  },
  {
    key: 'achievementRewardMultiplierBp',
    label: 'Multiplicador de logros (puntos base)',
    min: 0,
    max: 50_000,
  },
];

export function ProgressionConfigView({
  config,
  busy,
  onSave,
  onReverse,
}: {
  readonly config: ProgressionConfig;
  readonly busy: boolean;
  readonly onSave: (config: ProgressionConfig, reason: string) => void;
  readonly onReverse: (transactionId: string, reason: string) => void;
}) {
  const [draft, setDraft] = useState<ProgressionConfig>(config);
  const [reason, setReason] = useState('');
  const [transactionId, setTransactionId] = useState('');
  const [reversalReason, setReversalReason] = useState('');

  useEffect(() => setDraft(config), [config]);

  const updateField = (key: keyof ProgressionConfig, value: string) => {
    setDraft((current) => ({ ...current, [key]: Number(value) }));
  };

  const submitConfig = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onSave(draft, reason.trim());
  };

  const submitReversal = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onReverse(transactionId.trim(), reversalReason.trim());
  };

  return (
    <div className="space-y-4">
      <Card
        title="Progresión simbólica"
        subtitle="Cambios versionados y auditados. No afectan reglas, emparejamiento ni rating competitivo."
        actions={<StatusPill tone="gold">Moneda virtual sin valor económico</StatusPill>}
      >
        <p className="text-sm leading-6 text-ivory/70">
          Los puntos no se transfieren entre jugadores, no se compran con dinero y sólo habilitan
          cosméticos. Las recompensas y topes se aplican en el servidor; nivel y saldo no participan
          del matchmaking ni del cálculo Glicko-2.
        </p>
      </Card>

      <Card
        title="Configuración de recompensas"
        subtitle="Cada cambio requiere motivo y genera audit_logs."
      >
        <form onSubmit={submitConfig} className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {CONFIG_FIELDS.map((field) => (
              <Field key={field.key} label={field.label}>
                <input
                  type="number"
                  min={field.min}
                  max={field.max}
                  step={1}
                  required
                  value={draft[field.key]}
                  onChange={(event) => updateField(field.key, event.target.value)}
                  className={inputClass}
                />
              </Field>
            ))}
          </div>
          <Field
            label="Motivo auditado"
            hint="Mínimo 10 caracteres; se conserva en auditoría inmutable."
          >
            <textarea
              minLength={10}
              maxLength={500}
              required
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              className={inputClass}
              rows={3}
            />
          </Field>
          <Button type="submit" variant="primary" disabled={busy || reason.trim().length < 10}>
            Guardar configuración auditada
          </Button>
        </form>
      </Card>

      <Card
        title="Compensar un crédito"
        subtitle="No se borran asientos: la reversión agrega una entrada compensatoria al libro mayor."
      >
        <form
          onSubmit={submitReversal}
          className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end"
        >
          <Field label="ID del asiento positivo">
            <input
              required
              value={transactionId}
              onChange={(event) => setTransactionId(event.target.value)}
              className={inputClass}
              placeholder="UUID del asiento"
            />
          </Field>
          <Field label="Motivo de reversión">
            <input
              required
              minLength={10}
              maxLength={500}
              value={reversalReason}
              onChange={(event) => setReversalReason(event.target.value)}
              className={inputClass}
              placeholder="Motivo auditable"
            />
          </Field>
          <Button
            type="submit"
            variant="secondary"
            disabled={
              busy || transactionId.trim().length === 0 || reversalReason.trim().length < 10
            }
          >
            Crear compensación
          </Button>
        </form>
        <p className="mt-3 text-xs leading-5 text-ivory/55">
          Sólo un crédito positivo puede revertirse una vez y el saldo nunca puede quedar negativo.
          Si ya se gastaron esas monedas, el asiento no se elimina y la compensación queda
          bloqueada.
        </p>
      </Card>
    </div>
  );
}
