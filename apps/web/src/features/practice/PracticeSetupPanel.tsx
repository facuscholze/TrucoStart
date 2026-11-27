import type { BotDifficulty, GameMode } from '@truco/shared';
import { CallButton } from '@truco/ui';
import { useState } from 'react';
import { messagesEsAr } from '../../i18n/messages.es-AR.js';
import { createTableRequest } from '../../lib/api-client.js';
import { ensureGuestOrActiveSession } from '../../lib/api-client.js';

export interface PracticeSetupPanelProps {
  readonly currentUserId: string | null;
  readonly onSessionChanged: (userId: string) => void;
  readonly onNavigate: (path: string) => void;
  /** Callback opcional para refrescar datos del lobby (la mesa de práctica no se publica). */
  readonly onBeforeCreate?: () => void;
}

/**
 * Panel "Jugar contra la máquina": elige modalidad, dificultad y puntos y crea la mesa de
 * práctica con bots (el game-server la arranca apenas el jugador entra).
 */
export function PracticeSetupPanel({
  currentUserId,
  onSessionChanged,
  onNavigate,
  onBeforeCreate,
}: PracticeSetupPanelProps) {
  const [mode, setMode] = useState<GameMode>('1v1');
  const [difficulty, setDifficulty] = useState<BotDifficulty>('MEDIUM');
  const [targetScore, setTargetScore] = useState<15 | 30>(15);
  const [busy, setBusy] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const difficulties: Array<{ id: BotDifficulty; label: string }> = [
    { id: 'EASY', label: messagesEsAr.home.machineDifficultyEasy },
    { id: 'MEDIUM', label: messagesEsAr.home.machineDifficultyMedium },
    { id: 'HARD', label: messagesEsAr.home.machineDifficultyHard },
  ];

  const handleCreate = async () => {
    setBusy(true);
    setErrorMsg(null);
    try {
      if (!currentUserId) {
        const user = await ensureGuestOrActiveSession();
        onSessionChanged(user.id);
      }
      onBeforeCreate?.();
      const created = await createTableRequest({
        mode,
        visibility: 'PRIVATE',
        targetScore,
        flor: false,
        turnTimeoutMs: 30_000,
        practice: { difficulty },
      });
      onNavigate(`/mesa/${encodeURIComponent(created.roomId)}?practice=1`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : messagesEsAr.launcher.sessionErrorFallback);
    } finally {
      setBusy(false);
    }
  };

  const optionButton = (
    selected: boolean,
    label: string,
    onClick: () => void,
    ariaLabel: string,
  ) => (
    <button
      key={label}
      type="button"
      aria-pressed={selected}
      aria-label={ariaLabel}
      onClick={onClick}
      className={`min-h-[44px] px-3.5 rounded-xl border text-sm font-bold transition-colors ${
        selected
          ? 'bg-gold text-surface border-gold'
          : 'bg-elevated text-ivory border-ivory/25 hover:border-gold/60'
      }`}
    >
      {label}
    </button>
  );

  return (
    <section
      aria-labelledby="machine-heading"
      className="rounded-2xl bg-surface border border-sky/40 p-5 space-y-3.5 shadow-lg"
    >
      <div className="space-y-1">
        <h2 id="machine-heading" className="font-display text-xl font-bold text-sky">
          {messagesEsAr.home.machineSectionTitle}
        </h2>
        <p className="text-xs tablet:text-sm text-muted leading-relaxed">
          {messagesEsAr.home.machineSectionBody}
        </p>
      </div>

      <div className="grid grid-cols-1 tablet:grid-cols-3 gap-3">
        <fieldset className="space-y-1.5">
          <legend className="text-xs uppercase tracking-wide font-bold text-muted">
            {messagesEsAr.home.machineModeLabel}
          </legend>
          <div className="flex gap-2">
            {optionButton(
              mode === '1v1',
              '1 vs 1',
              () => setMode('1v1'),
              '1 vs 1, modo 1 contra 1',
            )}
            {optionButton(
              mode === '2v2',
              '2 vs 2',
              () => setMode('2v2'),
              '2 vs 2, modo 2 contra 2',
            )}
          </div>
        </fieldset>

        <fieldset className="space-y-1.5">
          <legend className="text-xs uppercase tracking-wide font-bold text-muted">
            {messagesEsAr.home.machineDifficultyLabel}
          </legend>
          <div className="flex gap-2 flex-wrap">
            {difficulties.map((option) =>
              optionButton(
                difficulty === option.id,
                option.label,
                () => setDifficulty(option.id),
                `Dificultad ${option.label}`,
              ),
            )}
          </div>
        </fieldset>

        <fieldset className="space-y-1.5">
          <legend className="text-xs uppercase tracking-wide font-bold text-muted">
            {messagesEsAr.home.machinePointsLabel}
          </legend>
          <div className="flex gap-2">
            {optionButton(
              targetScore === 15,
              '15',
              () => setTargetScore(15),
              'Partida a 15 puntos',
            )}
            {optionButton(
              targetScore === 30,
              '30',
              () => setTargetScore(30),
              'Partida a 30 puntos',
            )}
          </div>
        </fieldset>
      </div>

      <CallButton
        tone="accept"
        subtitle={messagesEsAr.home.machineBotNote}
        disabled={busy}
        onClick={() => void handleCreate()}
      >
        {busy ? messagesEsAr.home.machineCtaBusy : messagesEsAr.home.machineCta}
      </CallButton>

      {errorMsg && (
        <p role="alert" className="text-sm text-danger-strong">
          {errorMsg}
        </p>
      )}
    </section>
  );
}
